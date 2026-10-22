import Foundation
import XCTest
@testable import BookseerrCore

private let health = Data(#"{"status":"ok","version":"0.1.0"}"#.utf8)
private let signedOut = Data(#"{"user":null,"csrf":null,"demo":false}"#.utf8)
private struct Stub: Sendable {
    var host: String = "reader.local"
    var path: String = "/api/health"
    var method: String = "GET"
    var status = 200
    var body: Data = health
    var headers: [String: String] = [:]
    var failure: URLError.Code?
}
private actor StubTransport: HTTPTransport {
    var stubs: [Stub]
    var recorded: [URLRequest] = []
    init(_ stubs: [Stub]) { self.stubs = stubs }
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        guard !stubs.isEmpty else { throw StubError.unexpectedRequest }
        let stub = stubs.removeFirst()
        guard request.url?.host == stub.host, request.url?.path == stub.path, request.httpMethod == stub.method else { throw StubError.unexpectedRequest }
        if let failure = stub.failure { throw URLError(failure) }
        return (stub.body, HTTPURLResponse(url: request.url!, statusCode: stub.status, httpVersion: "HTTP/1.1", headerFields: stub.headers)!)
    }
    enum StubError: Error { case unexpectedRequest }
}

final class ClientTests: XCTestCase, @unchecked Sendable {
    private var profile: ServerProfile {
        ServerProfile(name: "Reading room", locations: [
            ServerLocation(name: "Home", address: "http://reader.local:5057"),
            ServerLocation(name: "Public", address: "https://books.example.com"),
        ])
    }

    func testServerProfilesValidateAndRoundTripMultipleLocations() throws {
        let profile = self.profile
        try profile.validate()
        let data = try JSONEncoder().encode(profile)
        XCTAssertEqual(try JSONDecoder().decode(ServerProfile.self, from: data), profile)
        for address in ["file:///tmp/server", "https://name:password@books.example.com", "https://books.example.com?token=secret", "https://books.example.com/#x"] {
            XCTAssertThrowsError(try ServerLocation(name: "Bad", address: address).validatedURL())
        }
        XCTAssertThrowsError(try ServerLocation(name: "Public", address: "http://books.example.com").validatedURL())
        for host in ["192.168.1.8", "10.0.0.8", "172.16.0.8", "reader.local", "localhost", "[::1]"] {
            XCTAssertNoThrow(try ServerLocation(name: "Home", address: "http://\(host):5057").validatedURL())
        }
        var duplicate = profile; duplicate.locations.append(duplicate.locations[0])
        XCTAssertThrowsError(try duplicate.validate())
    }

    func testHomeLocationIsPreferredAndHealthNeverContainsCredentials() async throws {
        let transport = StubTransport([Stub(), Stub(path: "/api/session", body: signedOut)])
        let client = try APIClient(profile: profile, credential: SessionCredential(value: "sample-cookie"), transport: transport)
        _ = try await client.session()
        let connection = await client.connection()
        XCTAssertEqual(connection?.location.name, "Home")
        XCTAssertEqual(connection?.isFallback, false)
        let requests = await transport.recorded
        XCTAssertNil(requests[0].value(forHTTPHeaderField: "Cookie"))
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Cookie"), "bookseerr_session=sample-cookie")
    }

    func testOffHomeNetworkAutomaticallyUsesPublicAddress() async throws {
        let transport = StubTransport([
            Stub(failure: .cannotConnectToHost),
            Stub(host: "books.example.com"),
            Stub(host: "books.example.com", path: "/api/session", body: signedOut),
        ])
        let client = try APIClient(profile: profile, transport: transport)
        _ = try await client.session()
        let connection = await client.connection()
        XCTAssertEqual(connection?.location.name, "Public")
        XCTAssertEqual(connection?.isFallback, true)
    }

    func testReadFailsOverAndNetworkChangeReturnsToHome() async throws {
        let status = try JSONEncoder().encode(await DemoService().status())
        let transport = StubTransport([
            Stub(), Stub(path: "/api/session", body: signedOut),
            Stub(path: "/api/status", failure: .networkConnectionLost),
            Stub(host: "books.example.com"), Stub(host: "books.example.com", path: "/api/status", body: status),
            Stub(), Stub(path: "/api/status", body: status),
        ])
        let client = try APIClient(profile: profile, transport: transport)
        _ = try await client.session()
        _ = try await client.status()
        let publicConnection = await client.connection()
        XCTAssertEqual(publicConnection?.location.name, "Public")
        await client.networkChanged()
        _ = try await client.status()
        let homeConnection = await client.connection()
        XCTAssertEqual(homeConnection?.location.name, "Home")
    }

    func testMutationIsNeverAutomaticallyReplayedAfterConnectionLoss() async throws {
        let transport = StubTransport([Stub(), Stub(path: "/api/requests", method: "POST", failure: .timedOut)])
        let client = try APIClient(profile: profile, transport: transport)
        do { _ = try await client.request(catalogId: "sample-8", kind: .ebook); XCTFail("Expected uncertain submission") }
        catch { XCTAssertEqual(error as? ClientError, .ambiguousWrite) }
        let requests = await transport.recorded
        XCTAssertEqual(requests.filter { $0.httpMethod == "POST" }.count, 1)
        XCTAssertEqual(requests.count, 2)
    }

    func testEverySavedLocationCanBeTriedWithoutRevisitingFailures() async throws {
        var profile = self.profile
        profile.locations.append(.init(name: "Backup", address: "https://backup.example.com"))
        let status = try JSONEncoder().encode(await DemoService().status())
        let transport = StubTransport([
            Stub(), Stub(path: "/api/status", failure: .networkConnectionLost),
            Stub(host: "books.example.com"), Stub(host: "books.example.com", path: "/api/status", failure: .timedOut),
            Stub(host: "backup.example.com"), Stub(host: "backup.example.com", path: "/api/status", body: status),
        ])
        let client = try APIClient(profile: profile, transport: transport)
        _ = try await client.status()
        let connection = await client.connection()
        XCTAssertEqual(connection?.location.name, "Backup")
        let requests = await transport.recorded
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/status" }.count, 3)
    }

    func testAuthenticationErrorsDoNotRetryAnotherLocation() async throws {
        let transport = StubTransport([Stub(), Stub(path: "/api/status", status: 401, body: Data(#"{"error":"Sign in to continue."}"#.utf8))])
        let client = try APIClient(profile: profile, credential: .init(value: "expired-sample"), transport: transport)
        do { _ = try await client.status(); XCTFail("Expected session expiry") }
        catch { XCTAssertEqual(error as? ClientError, .http(401, "Sign in to continue.")) }
        let credential = await client.savedCookie()
        XCTAssertNil(credential)
        let requests = await transport.recorded
        XCTAssertEqual(requests.count, 2)
    }

    func testSessionAndCsrfArePreservedAcrossExplicitlyTrustedLocations() async throws {
        let demo = DemoService()
        let session = try JSONEncoder().encode(await demo.session())
        let result = try JSONEncoder().encode(try await demo.request(catalogId: "sample-8", kind: .ebook))
        let transport = StubTransport([
            Stub(), Stub(path: "/api/session", method: "POST", body: session, headers: ["Set-Cookie": "bookseerr_session=sample-cookie; Path=/; HttpOnly; Max-Age=604800"]),
            Stub(failure: .cannotConnectToHost), Stub(host: "books.example.com"),
            Stub(host: "books.example.com", path: "/api/requests", method: "POST", status: 201, body: result),
        ])
        let client = try APIClient(profile: profile, transport: transport)
        _ = try await client.login(username: "reader", password: "sample-password")
        await client.networkChanged()
        _ = try await client.request(catalogId: "sample-8", kind: .ebook)
        let requests = await transport.recorded
        let posted = requests.last!
        XCTAssertEqual(posted.url?.host, "books.example.com")
        XCTAssertEqual(posted.value(forHTTPHeaderField: "Cookie"), "bookseerr_session=sample-cookie")
        XCTAssertEqual(posted.value(forHTTPHeaderField: "X-CSRF-Token"), "sample-only")
        let body = try JSONSerialization.jsonObject(with: posted.httpBody!) as? [String: String]
        XCTAssertEqual(body?["mediaKind"], "ebook")
    }

    func testSecureSessionSkipsPlainHttpLocations() async throws {
        let transport = StubTransport([Stub(host: "books.example.com"), Stub(host: "books.example.com", path: "/api/session", body: signedOut)])
        let client = try APIClient(profile: profile, credential: SessionCredential(value: "secure-session", secure: true), transport: transport)
        _ = try await client.session()
        let requests = await transport.recorded
        XCTAssertTrue(requests.allSatisfy { $0.url?.scheme == "https" })
    }

    func testExternalArtworkDoesNotReceiveServerCredentials() async throws {
        let transport = StubTransport([Stub(host: "covers.example.com", path: "/cover.jpg", body: Data([1, 2, 3]))])
        let client = try APIClient(profile: profile, credential: SessionCredential(value: "sample-cookie"), transport: transport)
        _ = try await client.imageData("https://covers.example.com/cover.jpg")
        let request = await transport.recorded.first!
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(request.value(forHTTPHeaderField: "X-CSRF-Token"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }

    func testUncertainAndStaleAvailabilityNeverEnablesRequests() async throws {
        let results = await DemoService().search(query: "Dracula", scope: "all")
        var book = results.discovery[0]
        XCTAssertTrue(book.canRequest(.ebook))
        book.availability.ebook.status = .unknown
        XCTAssertFalse(book.canRequest(.ebook))
        book.availability.ebook.status = .needsReview
        XCTAssertFalse(book.canRequest(.ebook))
        book.availability.ebook.status = .notFound; book.availability.ebook.stale = true
        XCTAssertFalse(book.canRequest(.ebook))
        book.availability.ebook.stale = false
        book.requests = ["ebook": RequestSummary(id: "r", status: .rejected, following: false)]
        XCTAssertFalse(book.canRequest(.ebook))
    }

    func testSampleRequestsJoinWithoutDuplicatesAndKeepFormatsSeparate() async throws {
        let demo = DemoService()
        let first = try await demo.request(catalogId: "sample-8", kind: .ebook)
        let second = try await demo.request(catalogId: "sample-8", kind: .ebook)
        XCTAssertEqual(first.request.id, second.request.id)
        XCTAssertTrue(second.joined)
        XCTAssertEqual(second.request.followers, 1)
        let results = await demo.search(query: "Secret Garden", scope: "all")
        XCTAssertEqual(results.library[0].availability.ebook.status, .available)
        XCTAssertEqual(results.library[0].availability.audiobook.status, .available)
        let audioLibrary = await demo.library(query: "", kind: .audiobook, offset: 0)
        XCTAssertEqual(audioLibrary.total, 1)
    }

    func testLibraryFirstDiscoveryDeduplicatesSharedIdentityWithoutCollapsingHomonyms() async throws {
        let demo = DemoService()
        var local = await demo.search(query: "Secret Garden", scope: "all").library[0]
        local.book.identifiers.work = ["ol:shared-work"]
        var sameWork = local
        sameWork.book.id = "online-edition"
        var distinctWork = local
        distinctWork.book.id = "different-work"
        distinctWork.book.identifiers.work = ["ol:other-work"]
        let response = SearchResponse(library: [local], discovery: [sameWork, distinctWork], query: "Secret Garden")
        XCTAssertEqual(response.uniqueDiscovery.map(\.id), ["different-work"])
    }

    func testSubpathHostingAndQueryEncoding() async throws {
        let profile = ServerProfile(name: "Subpath", locations: [.init(name: "Home", address: "http://reader.local/bookseerr")])
        let results = await DemoService().search(query: "A & B", scope: "all")
        let transport = StubTransport([Stub(path: "/bookseerr/api/health"), Stub(path: "/bookseerr/api/search", body: try JSONEncoder().encode(results))])
        let client = try APIClient(profile: profile, transport: transport)
        _ = try await client.search(query: "A & B", scope: "all")
        let request = await transport.recorded.last!
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(items?.first(where: { $0.name == "q" })?.value, "A & B")
    }

    func testServerCataloguePolicyDisablesUnlistedFormats() async throws {
        var result = await DemoService().search(query: "Dracula", scope: "all").discovery[0]
        XCTAssertTrue(result.canRequest(.ebook))
        XCTAssertTrue(result.canRequest(.audiobook))
        result.requestPolicy = RequestPolicy(ebook: true, audiobook: false, message: "Ebooks only on this server.")
        let decoded = try JSONDecoder().decode(BookResult.self, from: JSONEncoder().encode(result))
        XCTAssertTrue(decoded.canRequest(.ebook))
        XCTAssertFalse(decoded.canRequest(.audiobook))
    }

    func testActualBackendResponseContracts() throws {
        guard let path = ProcessInfo.processInfo.environment["BOOKSEERR_CONTRACT_FIXTURE"] else {
            throw XCTSkip("Generate an isolated backend fixture with ios/scripts/export-api-contract.mjs to run the cross-language contract check.")
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        func decode<T: Decodable>(_ type: T.Type, _ key: String) throws -> T {
            try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(payload[key])))
        }
        let session = try decode(SessionResponse.self, "session")
        XCTAssertEqual(session.user?.username, "contract-reader")
        XCTAssertFalse(session.demo)
        let search = try decode(SearchResponse.self, "search")
        XCTAssertEqual(search.discovery.first?.book.title, "Persuasion")
        let library = try decode(LibraryResponse.self, "library")
        XCTAssertEqual(library.items.first?.availability.ebook.status, .available)
        XCTAssertEqual(try decode(AppStatus.self, "status").libraryCount, 1)
        let requested = try decode(RequestResponse.self, "requested")
        XCTAssertEqual(requested.request.mediaKind, .ebook)
        XCTAssertFalse(requested.joined)
        struct RequestList: Decodable { let items: [BookRequest] }
        struct NotificationList: Decodable { let items: [ReaderNotification] }
        XCTAssertEqual(try decode(RequestList.self, "requests").items.first?.id, requested.request.id)
        _ = try decode(NotificationList.self, "notifications")
    }
}
