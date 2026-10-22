import Foundation

public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public final class URLSessionTransport: HTTPTransport, Sendable {
    private let session: URLSession
    public init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }
    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
        return (data, http)
    }
}

public struct SessionCredential: Codable, Sendable, Equatable {
    public var value: String
    public var secure: Bool
    public var expiresAt: Date?
    public init(value: String, secure: Bool = false, expiresAt: Date? = nil) {
        self.value = value; self.secure = secure; self.expiresAt = expiresAt
    }
}

/// Only explicitly saved locations share a session. Reads may fail over; writes are never replayed.
public actor APIClient: BookseerrService {
    private let profile: ServerProfile
    private let urls: [URL]
    private let transport: any HTTPTransport
    private var credential: SessionCredential?
    private var csrf: String?
    private var selected: Int?
    private var lastProbe = Date.distantPast
    private var selectionTask: Task<Int, any Error>?

    public init(profile: ServerProfile, credential: SessionCredential? = nil,
                transport: any HTTPTransport = URLSessionTransport()) throws {
        try profile.validate()
        self.profile = profile
        urls = try profile.locations.map { try $0.validatedURL() }
        self.credential = credential?.expiresAt.map { $0 > Date() } == false ? nil : credential
        self.transport = transport
    }

    public func connection() -> ConnectionInfo? {
        selected.map { ConnectionInfo(location: profile.locations[$0], isFallback: $0 > 0) }
    }
    public func savedCookie() -> SessionCredential? { credential }
    public func networkChanged() { lastProbe = .distantPast }

    private func endpoint(base: URL, path: String, query: [URLQueryItem] = []) throws -> URL {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        let prefix = parts.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        parts.percentEncodedPath = (prefix.isEmpty ? "" : "/" + prefix) + path
        if !query.isEmpty { parts.queryItems = query }
        guard let url = parts.url else { throw ClientError.invalidAddress }
        return url
    }

    private func selectLocation(excluding excluded: Set<Int> = []) async throws -> Int {
        if excluded.isEmpty, let selected, Date().timeIntervalSince(lastProbe) < 30 { return selected }
        if let selectionTask {
            let index = try await selectionTask.value
            if !excluded.contains(index) { return index }
        }
        let transport = transport
        let candidates = try urls.enumerated().filter {
            !excluded.contains($0.offset) && (credential?.secure != true || $0.element.scheme == "https")
        }.map { (index: $0.offset, url: try endpoint(base: $0.element, path: "/api/health")) }
        let task = Task<Int, any Error> {
            for candidate in candidates {
                try Task.checkCancellation()
                var request = URLRequest(url: candidate.url)
                request.timeoutInterval = candidate.index == 0 && candidates.count > 1 ? 1.5 : 5
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                do {
                    let (data, response) = try await transport.data(for: request)
                    if response.statusCode == 200,
                       let health = try? JSONDecoder().decode(Health.self, from: data), health.status == "ok", !health.version.isEmpty {
                        return candidate.index
                    }
                } catch is CancellationError { throw CancellationError() }
                catch let error as URLError where error.code == .cancelled { throw CancellationError() }
                catch { continue }
            }
            throw ClientError.noConnection
        }
        selectionTask = task
        do {
            let index = try await task.value
            selected = index; lastProbe = Date(); selectionTask = nil
            return index
        } catch {
            selectionTask = nil; selected = nil; lastProbe = .distantPast
            throw error
        }
    }

    private func send(path: String, method: String = "GET", body: Data? = nil,
                      query: [URLQueryItem] = []) async throws -> Data {
        try Task.checkCancellation()
        var index = try await selectLocation()
        // Each saved location can be used once. Only reads may be retried.
        var failedLocations = Set<Int>()
        for attempt in 0..<urls.count {
            try Task.checkCancellation()
            var request = URLRequest(url: try endpoint(base: urls[index], path: path, query: query))
            request.httpMethod = method
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            if method != "GET", let csrf { request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token") }
            if let credential {
                guard !credential.secure || urls[index].scheme == "https" else { throw ClientError.httpsRequired }
                request.setValue("bookseerr_session=" + credential.value, forHTTPHeaderField: "Cookie")
            }
            let data: Data
            let response: HTTPURLResponse
            do {
                (data, response) = try await transport.data(for: request)
            } catch {
                if error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
                lastProbe = .distantPast
                if method != "GET" { throw ClientError.ambiguousWrite }
                failedLocations.insert(index)
                if attempt < urls.count - 1 {
                    index = try await selectLocation(excluding: failedLocations)
                    continue
                }
                throw ClientError.noConnection
            }
            if let header = response.value(forHTTPHeaderField: "Set-Cookie") {
                let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: request.url!)
                if let cookie = cookies.first(where: { $0.name == "bookseerr_session" }) {
                    credential = cookie.value.isEmpty ? nil : SessionCredential(value: cookie.value, secure: cookie.isSecure, expiresAt: cookie.expiresDate)
                    if cookie.isSecure && urls[index].scheme != "https" { lastProbe = .distantPast }
                }
            }
            guard (200..<300).contains(response.statusCode) else {
                if response.statusCode == 401 { credential = nil; csrf = nil }
                let message = (try? JSONDecoder().decode(Problem.self, from: data))?.error
                throw ClientError.http(response.statusCode, message ?? "The server returned an unexpected response (\(response.statusCode)).")
            }
            return data
        }
        throw ClientError.noConnection
    }
    private func decode<T: Decodable & Sendable>(_ type: T.Type, path: String, method: String = "GET",
                                                 payload: [String: String]? = nil,
                                                 query: [URLQueryItem] = []) async throws -> T {
        let body = try payload.map { try JSONEncoder().encode($0) }
        let data = try await send(path: "/api" + path, method: method, body: body, query: query)
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw ClientError.invalidResponse }
    }
    private func segment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
    }
    public func session() async throws -> SessionResponse {
        let result = try await decode(SessionResponse.self, path: "/session")
        csrf = result.csrf
        return result
    }
    public func login(username: String, password: String) async throws -> SessionResponse {
        let result = try await decode(SessionResponse.self, path: "/session", method: "POST", payload: ["username": username, "password": password])
        csrf = result.csrf
        return result
    }
    public func logout() async throws {
        let _: OK = try await decode(OK.self, path: "/session", method: "DELETE")
        credential = nil; csrf = nil
    }
    public func status() async throws -> AppStatus { try await decode(AppStatus.self, path: "/status") }
    public func search(query: String, scope: String = "all") async throws -> SearchResponse {
        try await decode(SearchResponse.self, path: "/search", query: [.init(name: "q", value: query), .init(name: "scope", value: scope)])
    }
    public func library(query: String = "", kind: MediaKind? = nil, offset: Int = 0) async throws -> LibraryResponse {
        var items: [URLQueryItem] = [.init(name: "q", value: query), .init(name: "offset", value: String(offset)), .init(name: "limit", value: "24")]
        if let kind { items.append(.init(name: "kind", value: kind.rawValue)) }
        return try await decode(LibraryResponse.self, path: "/library", query: items)
    }
    public func discover(query: DiscoveryQuery = DiscoveryQuery()) async throws -> DiscoveryResponse {
        try await decode(DiscoveryResponse.self, path: "/discover", query: [
            .init(name: "q", value: query.q), .init(name: "topic", value: query.topic),
            .init(name: "sort", value: query.sort), .init(name: "language", value: query.language),
            .init(name: "era", value: query.era), .init(name: "page", value: String(query.page)),
        ])
    }
    public func requests() async throws -> [BookRequest] { try await decode(Items<BookRequest>.self, path: "/requests").items }
    public func request(catalogId: String, kind: MediaKind) async throws -> RequestResponse {
        try await decode(RequestResponse.self, path: "/requests", method: "POST", payload: ["catalogId": catalogId, "mediaKind": kind.rawValue])
    }
    public func requestAction(id: String, action: RequestAction) async throws -> [BookRequest] {
        try await decode(Items<BookRequest>.self, path: "/requests/\(segment(id))/\(action.rawValue)", method: "POST", payload: [:]).items
    }
    public func notifications() async throws -> [ReaderNotification] { try await decode(Items<ReaderNotification>.self, path: "/notifications").items }
    public func readNotifications() async throws {
        let _: OK = try await decode(OK.self, path: "/notifications/read", method: "POST", payload: [:])
    }
    public func review(catalogId: String, kind: MediaKind, itemId: String, dismiss: Bool) async throws -> BookResult {
        let body = try JSONEncoder().encode(MatchBody(catalogId: catalogId, mediaKind: kind, itemIds: [itemId]))
        let data = try await send(path: dismiss ? "/api/matches/dismiss" : "/api/matches", method: "POST", body: body)
        guard let result = try? JSONDecoder().decode(BookResult.self, from: data) else { throw ClientError.invalidResponse }
        return result
    }
    public func sync() async throws {
        _ = try await send(path: "/api/sync", method: "POST", body: Data("{}".utf8))
    }
    public func imageData(_ path: String) async throws -> Data {
        if path.hasPrefix("/api/covers/") { return try await send(path: path) }
        // External artwork never receives a server's cookie or CSRF token.
        guard let url = URL(string: path), url.scheme == "https" else { throw ClientError.invalidAddress }
        let (data, response) = try await transport.data(for: URLRequest(url: url))
        guard response.statusCode == 200, data.count <= 5 * 1024 * 1024 else { throw ClientError.invalidResponse }
        return data
    }
}

private struct Health: Decodable { let status: String; let version: String }
private struct Problem: Decodable { let error: String }
private struct OK: Decodable, Sendable { let ok: Bool }
private struct Items<T: Decodable & Sendable>: Decodable, Sendable { let items: [T] }
private struct MatchBody: Encodable { let catalogId: String; let mediaKind: MediaKind; let itemIds: [String] }
