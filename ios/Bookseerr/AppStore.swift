import BookseerrCore
import Foundation
import Network
import Observation
import Security

@MainActor @Observable
final class AppStore {
    var profiles: [ServerProfile] = []
    var activeProfile: ServerProfile?
    var user: User?
    var status: AppStatus?
    var requests: [BookRequest] = []
    var notifications: [ReaderNotification] = []
    var connection: ConnectionInfo?
    var service: (any BookseerrService)?
    var isDemo = false
    var isRestoring = true
    var revision = 0
    var error: String?
    var toast: String?
    var requiresRequestCheck = false
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private var refreshing = false
    private(set) var sessionID = UUID()

    init() {
        if let data = UserDefaults.standard.data(forKey: "bookseerr.servers.v1") {
            profiles = (try? JSONDecoder().decode([ServerProfile].self, from: data)) ?? []
        }
    }
    var unreadCount: Int { notifications.filter { !$0.read }.count }
    var activeRequests: [BookRequest] { requests.filter { !$0.status.isClosed } }

    func bootstrap() async {
        monitor.pathUpdateHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.recheckConnection()
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.teamcogs.bookseerr.network"))
        defer { isRestoring = false }
        if ProcessInfo.processInfo.arguments.contains("-demo") { await startDemo(); return }
        guard let selected = UserDefaults.standard.string(forKey: "bookseerr.activeServer"),
              let profile = profiles.first(where: { $0.id.uuidString == selected }),
              let credential = SessionVault.load(profile.id) else { return }
        do {
            let client = try APIClient(profile: profile, credential: credential)
            let session = try await client.session()
            guard let user = session.user else { SessionVault.remove(profile.id); return }
            activate(service: client, profile: profile, user: user, demo: session.demo)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    func connect(profile: ServerProfile, username: String, password: String) async throws {
        let client = try APIClient(profile: profile, credential: SessionVault.load(profile.id))
        var session = try await client.session()
        if session.user == nil {
            guard !username.isEmpty, !password.isEmpty else { throw ClientError.http(401, "Enter your Bookseerr username and password.") }
            session = try await client.login(username: username, password: password)
        }
        guard let user = session.user else { throw ClientError.http(401, "Sign in to continue.") }
        // Require a working authenticated API before saving a new server profile.
        let checkedStatus = try await client.status()
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) { profiles[index] = profile }
        else { profiles.append(profile) }
        persistProfiles()
        UserDefaults.standard.set(profile.id.uuidString, forKey: "bookseerr.activeServer")
        try SessionVault.save(await client.savedCookie(), for: profile.id)
        activate(service: client, profile: profile, user: user, demo: session.demo)
        status = checkedStatus
        await refresh()
    }
    private func activate(service: any BookseerrService, profile: ServerProfile?, user: User, demo: Bool) {
        CoverMemory.images.removeAllObjects()
        sessionID = UUID()
        self.service = service; activeProfile = profile; self.user = user; isDemo = demo
        status = nil; requests = []; notifications = []; connection = nil
        requiresRequestCheck = false; error = nil; revision += 1
    }
    func startDemo() async {
        let demo = DemoService()
        let session = await demo.session()
        activate(service: demo, profile: nil, user: session.user!, demo: true)
        await refresh()
    }
    func refresh() async {
        guard let service, !refreshing else { return }
        let currentSession = sessionID
        refreshing = true
        defer { refreshing = false }
        do {
            async let newStatus = service.status()
            async let newRequests = service.requests()
            async let newNotices = service.notifications()
            let (status, requests, notifications) = try await (newStatus, newRequests, newNotices)
            guard sessionID == currentSession, !Task.isCancelled else { return }
            self.status = status; self.requests = requests; self.notifications = notifications
            self.connection = await service.connection()
            if let profile = activeProfile { try SessionVault.save(await service.savedCookie(), for: profile.id) }
            error = nil
        } catch {
            guard sessionID == currentSession else { return }
            handle(error)
        }
    }
    func recheckConnection() async {
        await service?.networkChanged()
        if user != nil { await refresh() }
    }
    func handle(_ problem: any Error) {
        if problem is CancellationError || (problem as? URLError)?.code == .cancelled { return }
        if let clientError = problem as? ClientError {
            if clientError.isUnauthorized {
                if let profile = activeProfile { SessionVault.remove(profile.id) }
                clearSession()
                error = "Your session expired. Sign in again to continue."
                return
            }
            if clientError == .ambiguousWrite { requiresRequestCheck = true }
        }
        error = problem.localizedDescription
    }
    func request(_ book: BookResult, kind: MediaKind) async throws -> RequestResponse {
        guard let service, book.canRequest(kind), !requiresRequestCheck else {
            throw ClientError.http(409, "Refresh Requests before submitting another request.")
        }
        let currentSession = sessionID
        do {
            let result = try await service.request(catalogId: book.id, kind: kind)
            guard sessionID == currentSession else { throw CancellationError() }
            revision += 1
            toast = result.joined ? "You’re following the existing request." : "\(kind.title) request saved."
            await refresh()
            return result
        } catch { if sessionID == currentSession { handle(error) }; throw error }
    }
    func checkRequests() async {
        guard let service else { return }
        let currentSession = sessionID
        do {
            let result = try await service.requests()
            guard sessionID == currentSession, !Task.isCancelled else { return }
            requests = result
            connection = await service.connection()
            requiresRequestCheck = false; error = nil; revision += 1
        } catch { if sessionID == currentSession { handle(error) } }
    }
    func act(on request: BookRequest, action: RequestAction) async {
        guard let service else { return }
        let currentSession = sessionID
        do {
            let result = try await service.requestAction(id: request.id, action: action)
            guard sessionID == currentSession else { return }
            requests = result
            revision += 1; toast = "Request updated."
            await refresh()
        } catch { if sessionID == currentSession { handle(error) } }
    }
    func markNotificationsRead() async {
        guard let service else { return }
        let currentSession = sessionID
        do {
            try await service.readNotifications()
            let result = try await service.notifications()
            guard sessionID == currentSession else { return }
            notifications = result
        } catch { if sessionID == currentSession { handle(error) } }
    }
    func sync() async {
        guard let service else { return }
        let currentSession = sessionID
        do {
            try await service.sync()
            guard sessionID == currentSession else { return }
            revision += 1; await refresh(); toast = "Library check finished."
        } catch { if sessionID == currentSession { handle(error) } }
    }
    func signOut() async {
        if isDemo { clearSession(); return }
        do {
            try await service?.logout()
            if let profile = activeProfile { SessionVault.remove(profile.id) }
            clearSession()
        } catch { handle(error) }
    }
    func forgetSession() {
        if let profile = activeProfile { SessionVault.remove(profile.id) }
        clearSession()
    }
    private func clearSession() {
        CoverMemory.images.removeAllObjects()
        sessionID = UUID(); service = nil; user = nil; status = nil; requests = []; notifications = []
        activeProfile = nil; connection = nil; isDemo = false; error = nil; toast = nil
        requiresRequestCheck = false; revision += 1
    }
    func deleteProfile(_ profile: ServerProfile) {
        SessionVault.remove(profile.id)
        profiles.removeAll { $0.id == profile.id }; persistProfiles()
        if activeProfile?.id == profile.id { clearSession() }
    }
    private func persistProfiles() {
        UserDefaults.standard.set(try? JSONEncoder().encode(profiles), forKey: "bookseerr.servers.v1")
    }
}

enum SessionVault {
    private static func query(_ id: UUID) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.teamcogs.bookseerr.session", kSecAttrAccount as String: id.uuidString]
    }
    static func load(_ id: UUID) -> SessionCredential? {
        var query = query(id); query[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(SessionCredential.self, from: data)
    }
    static func save(_ credential: SessionCredential?, for id: UUID) throws {
        guard let credential else { remove(id); return }
        let data = try JSONEncoder().encode(credential)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query(id) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let result = SecItemAdd(query(id).merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil)
            guard result == errSecSuccess else { throw VaultError.unavailable }
        } else if status != errSecSuccess { throw VaultError.unavailable }
    }
    static func remove(_ id: UUID) { SecItemDelete(query(id) as CFDictionary) }
    enum VaultError: LocalizedError {
        case unavailable
        var errorDescription: String? { "The session could not be saved in Keychain. Unlock your device and try again." }
    }
}
