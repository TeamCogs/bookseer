import Foundation

public struct ServerLocation: Codable, Identifiable, Sendable, Equatable {
    public var id: UUID
    public var name: String
    public var address: String
    public init(id: UUID = UUID(), name: String, address: String) {
        self.id = id; self.name = name; self.address = address
    }
    public func validatedURL() throws -> URL {
        let value = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.split(separator: "/").allSatisfy({ $0 != "." && $0 != ".." })
        else { throw ClientError.invalidAddress }
        if parts.scheme == "http" && !Self.isLocalHost(host) { throw ClientError.httpsRequired }
        return url
    }
    public static func isLocalHost(_ value: String) -> Bool {
        let host = value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host == "::1" || host.hasSuffix(".local") || host.hasSuffix(".lan") || host.hasSuffix(".home.arpa") { return true }
        if host.contains(":") { return host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe80:") }
        let numbers = host.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
        if numbers.count == 4 && numbers.allSatisfy({ (0...255).contains($0) }) {
            return numbers[0] == 10 || numbers[0] == 127 || (numbers[0] == 192 && numbers[1] == 168)
                || (numbers[0] == 172 && (16...31).contains(numbers[1])) || (numbers[0] == 169 && numbers[1] == 254)
        }
        return !host.contains(".") && !host.allSatisfy(\.isNumber)
    }
}
public struct ServerProfile: Codable, Identifiable, Sendable, Equatable {
    public var id: UUID
    public var name: String
    /// Ordered by preference: usually home/LAN first, public HTTPS second.
    public var locations: [ServerLocation]
    public init(id: UUID = UUID(), name: String, locations: [ServerLocation]) {
        self.id = id; self.name = name; self.locations = locations
    }
    public func validate() throws {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !locations.isEmpty else { throw ClientError.missingLocation }
        var urls = Set<String>()
        for location in locations {
            let url = try location.validatedURL()
            guard !location.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  urls.insert(url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))).inserted
            else { throw ClientError.duplicateLocation }
        }
    }
}
public struct ConnectionInfo: Sendable, Equatable {
    public var location: ServerLocation
    public var isFallback: Bool
}
public enum ClientError: Error, LocalizedError, Sendable, Equatable {
    case invalidAddress, httpsRequired, missingLocation, duplicateLocation, noConnection
    case http(Int, String), invalidResponse, ambiguousWrite
    public var errorDescription: String? {
        switch self {
        case .invalidAddress: "Enter a full HTTP or HTTPS server address without credentials, a query, or a fragment."
        case .httpsRequired: "Use HTTPS for a public address. HTTP is supported for local network addresses."
        case .missingLocation: "Name this server and add at least one address."
        case .duplicateLocation: "Give each location a name and a different address."
        case .noConnection: "None of this server’s addresses could be reached. Check your connection and server addresses."
        case .http(_, let message): message
        case .invalidResponse: "This address did not return a valid Bookseerr response. Check for a proxy sign-in page or an incorrect address."
        case .ambiguousWrite: "The connection dropped after sending. Check Requests before trying again; the operation may have completed."
        }
    }
    public var isUnauthorized: Bool { if case .http(401, _) = self { true } else { false } }
}
