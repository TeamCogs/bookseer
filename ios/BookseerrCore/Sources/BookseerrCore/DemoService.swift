import Foundation

/// An isolated, in-memory reading room. It never connects to acquisition services.
public actor DemoService: BookseerrService {
    private var books: [BookResult] = []
    private var activity: [BookRequest] = []
    private var notices: [ReaderNotification] = []
    private let reader = User(id: "sample-reader", username: "alex", displayName: "Alex", role: "admin", autoApprove: true, weeklyLimit: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z")

    public init() {
        let titles: [(String, String, Int, Bool)] = [
            ("The Secret Garden", "Frances Hodgson Burnett", 1911, true),
            ("Pride and Prejudice", "Jane Austen", 1813, true),
            ("The Great Gatsby", "F. Scott Fitzgerald", 1925, true),
            ("Little Women", "Louisa May Alcott", 1868, true),
            ("Frankenstein", "Mary Shelley", 1818, true),
            ("The Time Machine", "H. G. Wells", 1895, true),
            ("The Odyssey", "Homer", -700, false),
            ("Persuasion", "Jane Austen", 1817, false),
            ("Dracula", "Bram Stoker", 1897, false),
            ("The Picture of Dorian Gray", "Oscar Wilde", 1890, false),
            ("A Room of One’s Own", "Virginia Woolf", 1929, true),
            ("The Wind in the Willows", "Kenneth Grahame", 1908, true),
        ]
        books = titles.enumerated().map { index, value in
            let identifiers = Identifiers(isbn: [], work: [])
            let item = LibraryItem(id: "sample-copy-\(index)", source: "bookorbit", sourceName: "Reading room", remoteId: String(index), title: value.0, author: value.1, mediaKind: .ebook, formats: index == 1 ? ["EPUB", "PDF"] : ["EPUB"], available: true, identifiers: identifiers)
            let present = Availability(status: .available, label: "In your library", reason: "An ebook file is present in the sample library.", items: [item], candidates: [], stale: false, confirmed: true)
            let missing = Availability(status: .notFound, label: "Not in your library", reason: "No copy was found in the complete sample inventory.", items: [], candidates: [], stale: false, confirmed: false)
            var audio = missing
            if index == 0 {
                var audioItem = item
                audioItem.id += "-audio"; audioItem.mediaKind = .audiobook; audioItem.formats = ["M4B"]
                audio = Availability(status: .available, label: "In your library", reason: "An audiobook file is present in the sample library.", items: [audioItem], candidates: [], stale: false, confirmed: true)
            }
            let topics = ["children", "romance", "fiction", "fiction", "horror", "science_fiction", "fantasy", "romance", "horror", "fiction", "history", "children"]
            return BookResult(book: CatalogBook(id: "sample-\(index)", title: value.0, author: value.1, year: value.2, identifiers: identifiers, origin: "demo", subjects: [topics[index]], languages: ["eng"]), availability: FormatAvailability(ebook: value.3 ? present : missing, audiobook: audio), copies: value.3 ? [item] : [])
        }
        let date = ISO8601DateFormatter().string(from: Date())
        activity = [
            BookRequest(id: "sample-request-1", catalogId: "sample-6", mediaKind: .ebook, title: "The Odyssey", author: "Homer", status: .pendingApproval, createdAt: date, updatedAt: date, message: "Jamie is waiting for an administrator’s approval.", requestedBy: "Jamie", requesterId: "sample-jamie", followers: 1, following: false),
            BookRequest(id: "sample-request-2", catalogId: "sample-7", mediaKind: .audiobook, title: "Persuasion", author: "Jane Austen", status: .downloading, createdAt: date, updatedAt: date, message: "Chaptarr is downloading the audiobook. This is sample activity.", requestedBy: "Alex", requesterId: "sample-reader", followers: 2, following: true),
        ]
        notices = [ReaderNotification(id: 1, message: "The Secret Garden is available as an ebook and audiobook.", read: false, createdAt: date)]
    }

    public func session() -> SessionResponse { SessionResponse(user: reader, csrf: "sample-only", demo: true) }
    public func login(username: String, password: String) -> SessionResponse { session() }
    public func logout() {}
    public func savedCookie() -> SessionCredential? { nil }
    public func connection() -> ConnectionInfo? { nil }
    public func networkChanged() {}
    public func imageData(_ path: String) throws -> Data { throw ClientError.invalidAddress }

    public func status() -> AppStatus {
        AppStatus(version: "0.1.0", demo: true, sources: [
            SourceState(source: "bookorbit", name: "Reading room", provider: "bookorbit", configured: true, status: "healthy", lastSuccess: ISO8601DateFormatter().string(from: Date()), snapshotVerified: true, count: 9),
            SourceState(source: "chaptarr", name: "Chaptarr", configured: true, status: "healthy", lastSuccess: ISO8601DateFormatter().string(from: Date()), count: 0),
        ], libraryCount: books.filter { $0.availability.ebook.status == .available }.count, requestCount: activity.filter { !$0.status.isClosed }.count, acquisitionReady: false, syncIntervalMinutes: 30, inventoryMaxAgeHours: 24)
    }
    private func withRequests(_ book: BookResult) -> BookResult {
        var result = book
        result.requests = Dictionary(activity.filter { $0.catalogId == book.id }.map { ($0.mediaKind.rawValue, RequestSummary(id: $0.id, status: $0.status, following: $0.following)) }, uniquingKeysWith: { _, last in last })
        return result
    }
    public func search(query: String, scope: String) -> SearchResponse {
        let found = books.filter { query.isEmpty || "\($0.book.title) \($0.book.author)".localizedCaseInsensitiveContains(query) }
        return SearchResponse(library: scope == "online" ? [] : found.filter { $0.availability.ebook.status == .available }.map(withRequests), discovery: scope == "local" ? [] : found.filter { $0.availability.ebook.status != .available }.map(withRequests), query: query)
    }
    public func discover(query: DiscoveryQuery = DiscoveryQuery()) -> DiscoveryResponse {
        let topics = [("", "All topics"), ("fiction", "Fiction"), ("fantasy", "Fantasy"), ("science_fiction", "Science fiction"), ("romance", "Romance"), ("horror", "Horror"), ("history", "History"), ("children", "Children’s books")]
        let filters = DiscoveryFilters(
            topics: topics.map { DiscoveryOption(id: $0.0, label: $0.1) },
            sorts: [("trending", "Trending"), ("popular", "Most shelved"), ("rating", "Top rated"), ("new", "Recently published")].map { DiscoveryOption(id: $0.0, label: $0.1) },
            languages: [("", "All languages"), ("eng", "English"), ("spa", "Spanish")].map { DiscoveryOption(id: $0.0, label: $0.1) },
            eras: [("", "Any publication date"), ("recent", "Last 5 years"), ("decade", "Last 10 years"), ("classics", "Before 1970")].map { DiscoveryOption(id: $0.0, label: $0.1) })
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())
        let words = query.q.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var found = books.filter { result in
            // The sample discovery catalogue is a separate selection from the library shelf.
            let book = result.book
            let text = "\(book.title) \(book.author) \((book.subjects ?? []).joined(separator: " "))"
            return result.availability.ebook.status != .available
                && words.allSatisfy { text.localizedCaseInsensitiveContains($0) }
                && (query.topic.isEmpty || book.subjects?.contains(query.topic) == true)
                && (query.language.isEmpty || book.languages?.contains(query.language) == true)
                && (query.era.isEmpty || book.year.map { value in
                    switch query.era {
                    case "recent": value >= year - 4 && value <= year
                    case "decade": value >= year - 9 && value <= year
                    case "classics": value <= 1969
                    default: false
                    }
                } == true)
        }
        if query.sort == "new" { found.sort { ($0.book.year ?? 0) > ($1.book.year ?? 0) } }
        let offset = max(0, query.page - 1) * 24
        return DiscoveryResponse(items: Array(found.dropFirst(offset).prefix(24)).map(withRequests), total: found.count, hasMore: offset + 24 < found.count,
            source: DiscoverySource(name: "Sample discovery catalogue"), page: query.page, pageSize: 24, mode: "demo", filters: filters)
    }
    public func library(query: String, kind: MediaKind?, offset: Int) -> LibraryResponse {
        let found = books.filter { book in
            (kind.map { book.availability[$0].status == .available } ?? true)
            && book.availability.ebook.status == .available
            && (query.isEmpty || "\(book.book.title) \(book.book.author)".localizedCaseInsensitiveContains(query))
        }
        return LibraryResponse(total: found.count, rawCopies: found.count + 1, hiddenDuplicates: 1, offset: offset, limit: 24, items: Array(found.dropFirst(offset).prefix(24)).map(withRequests))
    }
    public func requests() -> [BookRequest] { activity }
    public func request(catalogId: String, kind: MediaKind) throws -> RequestResponse {
        guard let book = books.first(where: { $0.id == catalogId }), book.canRequest(kind) else {
            throw ClientError.http(409, "This format is already present or its availability needs review.")
        }
        if let index = activity.firstIndex(where: { $0.catalogId == catalogId && $0.mediaKind == kind }) {
            guard ![.cancelled, .rejected].contains(activity[index].status) else { throw ClientError.http(409, "An administrator must reopen this request.") }
            if !activity[index].following { activity[index].followers += 1; activity[index].following = true }
            return RequestResponse(request: activity[index], joined: true)
        }
        let date = ISO8601DateFormatter().string(from: Date())
        let request = BookRequest(id: UUID().uuidString, catalogId: catalogId, mediaKind: kind, title: book.book.title, author: book.book.author, status: .pendingSetup, createdAt: date, updatedAt: date, message: "Sample request saved. No download has been sent.", requestedBy: "Alex", requesterId: reader.id, followers: 1, following: true)
        activity.insert(request, at: 0)
        return RequestResponse(request: request, joined: false)
    }
    public func requestAction(id: String, action: RequestAction) throws -> [BookRequest] {
        guard let index = activity.firstIndex(where: { $0.id == id }) else { throw ClientError.http(404, "Request not found.") }
        switch action {
        case .approve:
            guard activity[index].status.canApprove else { throw ClientError.http(409, "This request is already active.") }
            activity[index].status = .pendingSetup; activity[index].message = "Approved in the sample reading room."
        case .reject, .cancel:
            guard activity[index].status.canCancel else { throw ClientError.http(409, "This request has already progressed.") }
            activity[index].status = action == .reject ? .rejected : .cancelled
        case .retry:
            guard activity[index].status.canRetry else { throw ClientError.http(409, "This request is already active.") }
            activity[index].status = .pendingSetup
        case .unfollow:
            if activity[index].following { activity[index].following = false; activity[index].followers = max(0, activity[index].followers - 1) }
        }
        return activity
    }
    public func notifications() -> [ReaderNotification] { notices }
    public func readNotifications() { for index in notices.indices { notices[index].read = true } }
    public func review(catalogId: String, kind: MediaKind, itemId: String, dismiss: Bool) throws -> BookResult {
        guard let book = books.first(where: { $0.id == catalogId }) else { throw ClientError.http(404, "Book not found.") }
        return withRequests(book)
    }
    public func sync() {}
}
