import Foundation

public enum MediaKind: String, Codable, CaseIterable, Sendable, Identifiable {
    case ebook, audiobook
    public var id: String { rawValue }
    public var title: String { self == .ebook ? "Ebook" : "Audiobook" }
    public var symbol: String { self == .ebook ? "book" : "headphones" }
}

public enum AvailabilityStatus: String, Codable, Sendable {
    case available, needsReview = "needs_review", notFound = "not_found", unknown
    public init(from decoder: any Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public enum RequestStatus: String, Codable, Sendable, CaseIterable {
    case pendingApproval = "pending_approval", pendingSetup = "pending_setup"
    case pendingMetadata = "pending_metadata", pendingUpstream = "pending_upstream"
    case checking, submitting, requested, downloading, importing, available, failed
    case needsReview = "needs_review", rejected, cancelled, unknown

    public init(from decoder: any Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
    public var title: String {
        switch self {
        case .pendingApproval: "Awaiting approval"
        case .pendingSetup: "Waiting for setup"
        case .pendingMetadata: "Finding metadata"
        case .pendingUpstream: "Preparing book"
        case .checking: "Checking libraries"
        case .submitting: "Sending request"
        case .requested: "Requested"
        case .downloading: "Downloading"
        case .importing: "Importing"
        case .available: "Ready to read"
        case .failed: "Failed"
        case .needsReview: "Needs review"
        case .rejected: "Declined"
        case .cancelled: "Cancelled"
        case .unknown: "Check server"
        }
    }
    public var isClosed: Bool { [.available, .rejected, .cancelled].contains(self) }
    public var canCancel: Bool { [.pendingApproval, .pendingSetup, .pendingMetadata, .checking].contains(self) }
    public var canApprove: Bool { [.pendingApproval, .pendingSetup, .pendingMetadata].contains(self) }
    public var canRetry: Bool { [.needsReview, .failed, .cancelled, .rejected].contains(self) }
}

public struct Identifiers: Codable, Sendable {
    public var isbn: [String]
    public var work: [String]
}
public struct CatalogBook: Codable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var author: String
    public var year: Int?
    public var coverUrl: String?
    public var identifiers: Identifiers
    public var origin: String
    public var subjects: [String]?
    public var languages: [String]?
    public var rating: Double?
    public var ratingCount: Int?
}
public struct LibraryItem: Codable, Sendable, Identifiable {
    public var id: String
    public var source: String
    public var sourceName: String?
    public var remoteId: String
    public var title: String
    public var author: String
    public var mediaKind: MediaKind
    public var formats: [String]
    public var available: Bool
    public var identifiers: Identifiers
    public var url: String?
    public var coverUrl: String?
    public var year: Int?
    public var originalTitle: String?
    public var libraryName: String {
        sourceName ?? (source == "bookorbit" ? "BookOrbit" : source == "chaptarr" ? "Chaptarr" : "Connected library")
    }
}
public struct Availability: Codable, Sendable {
    public var status: AvailabilityStatus
    public var label: String
    public var reason: String
    public var items: [LibraryItem]
    public var candidates: [LibraryItem]
    public var stale: Bool
    public var confirmed: Bool
}
public struct FormatAvailability: Codable, Sendable {
    public var ebook: Availability
    public var audiobook: Availability
    public subscript(_ kind: MediaKind) -> Availability { kind == .ebook ? ebook : audiobook }
}
public struct RequestSummary: Codable, Sendable {
    public var id: String
    public var status: RequestStatus
    public var following: Bool
    public static func from(_ request: BookRequest) -> Self {
        Self(id: request.id, status: request.status, following: request.following)
    }
}
public struct BookResult: Codable, Sendable, Identifiable {
    public var book: CatalogBook
    public var availability: FormatAvailability
    public var requests: [String: RequestSummary]?
    public var copies: [LibraryItem]?
    public var id: String { book.id }
    public func summary(for kind: MediaKind) -> RequestSummary? { requests?[kind.rawValue] }
    public func canRequest(_ kind: MediaKind) -> Bool {
        guard availability[kind].status == .notFound, !availability[kind].stale else { return false }
        guard let summary = summary(for: kind) else { return true }
        if summary.status == .available { return true }
        return !summary.following && ![.rejected, .cancelled, .unknown].contains(summary.status)
    }
}
public struct BookRequest: Codable, Sendable, Identifiable {
    public var id: String
    public var catalogId: String
    public var mediaKind: MediaKind
    public var title: String
    public var author: String
    public var coverUrl: String?
    public var status: RequestStatus
    public var createdAt: String
    public var updatedAt: String
    public var upstreamId: Int?
    public var message: String
    public var requestedBy: String
    public var requesterId: String
    public var followers: Int
    public var following: Bool
}
public struct User: Codable, Sendable, Identifiable {
    public var id: String
    public var username: String
    public var displayName: String
    public var role: String
    public var autoApprove: Bool
    public var weeklyLimit: Int
    public var disabled: Bool
    public var createdAt: String
    public var isAdmin: Bool { role == "admin" }
}
public struct ReaderNotification: Codable, Sendable, Identifiable {
    public var id: Int
    public var message: String
    public var requestId: String?
    public var read: Bool
    public var createdAt: String
}
public struct SourceState: Codable, Sendable, Identifiable {
    public var source: String
    public var name: String?
    public var provider: String?
    public var configured: Bool
    public var status: String
    public var lastSuccess: String?
    public var snapshotVerified: Bool?
    public var lastAttempt: String?
    public var count: Int
    public var error: String?
    public var id: String { source }
    public var title: String { name ?? (source == "bookorbit" ? "BookOrbit" : source == "chaptarr" ? "Chaptarr" : "Library server") }
}
public struct AppStatus: Codable, Sendable {
    public var version: String
    public var demo: Bool
    public var sources: [SourceState]
    public var libraryCount: Int
    public var requestCount: Int
    public var acquisitionReady: Bool
    public var syncIntervalMinutes: Int
    public var inventoryMaxAgeHours: Int
}
public struct SessionResponse: Codable, Sendable {
    public var user: User?
    public var csrf: String?
    public var demo: Bool
}
public struct SearchResponse: Codable, Sendable {
    public var library: [BookResult]
    public var discovery: [BookResult]
    public var warning: String?
    public var query: String
    public var uniqueDiscovery: [BookResult] {
        var ids = Set(library.map(\.id))
        var works = Set(library.flatMap { $0.book.identifiers.work })
        var isbns = Set(library.flatMap { $0.book.identifiers.isbn })
        return discovery.filter { result in
            let identifiers = result.book.identifiers
            let duplicate = ids.contains(result.id)
                || !works.isDisjoint(with: identifiers.work)
                || !isbns.isDisjoint(with: identifiers.isbn)
            ids.insert(result.id)
            works.formUnion(identifiers.work)
            isbns.formUnion(identifiers.isbn)
            return !duplicate
        }
    }
}
public struct DiscoveryOption: Codable, Sendable, Identifiable {
    public var id: String
    public var label: String
}
public struct DiscoveryFilters: Codable, Sendable {
    public var topics: [DiscoveryOption]
    public var sorts: [DiscoveryOption]
    public var languages: [DiscoveryOption]
    public var eras: [DiscoveryOption]
}
public struct DiscoverySource: Codable, Sendable {
    public var name: String
    public var url: String?
}
public struct DiscoveryResponse: Codable, Sendable {
    public var items: [BookResult]
    public var total: Int?
    public var hasMore: Bool
    public var source: DiscoverySource
    public var warning: String?
    public var page: Int
    public var pageSize: Int
    public var mode: String
    public var filters: DiscoveryFilters
}
public struct DiscoveryQuery: Sendable, Hashable {
    public var q: String
    public var topic: String
    public var sort: String
    public var language: String
    public var era: String
    public var page: Int
    public init(q: String = "", topic: String = "", sort: String = "trending", language: String = "", era: String = "", page: Int = 1) {
        self.q = q; self.topic = topic; self.sort = sort; self.language = language; self.era = era; self.page = page
    }
}
public struct LibraryResponse: Codable, Sendable {
    public var total: Int
    public var rawCopies: Int
    public var hiddenDuplicates: Int
    public var offset: Int
    public var limit: Int
    public var items: [BookResult]
}
public struct RequestResponse: Codable, Sendable {
    public var request: BookRequest
    public var joined: Bool
}
public enum RequestAction: String, Sendable { case approve, reject, cancel, retry, unfollow }

public protocol BookseerrService: Sendable {
    func session() async throws -> SessionResponse
    func login(username: String, password: String) async throws -> SessionResponse
    func logout() async throws
    func status() async throws -> AppStatus
    func search(query: String, scope: String) async throws -> SearchResponse
    func discover(query: DiscoveryQuery) async throws -> DiscoveryResponse
    func library(query: String, kind: MediaKind?, offset: Int) async throws -> LibraryResponse
    func requests() async throws -> [BookRequest]
    func request(catalogId: String, kind: MediaKind) async throws -> RequestResponse
    func requestAction(id: String, action: RequestAction) async throws -> [BookRequest]
    func notifications() async throws -> [ReaderNotification]
    func readNotifications() async throws
    func review(catalogId: String, kind: MediaKind, itemId: String, dismiss: Bool) async throws -> BookResult
    func sync() async throws
    func connection() async -> ConnectionInfo?
    func networkChanged() async
    func savedCookie() async -> SessionCredential?
    func imageData(_ path: String) async throws -> Data
}
