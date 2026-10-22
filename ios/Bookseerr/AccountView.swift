import BookseerrCore
import SwiftUI

struct AccountView: View {
    @Environment(AppStore.self) private var store
    @State private var editor: ServerProfile?
    @State private var syncing = false
    @State private var showForget = false
    var body: some View {
        List {
            Section {
                HStack(spacing: 15) {
                    Text(String(store.user?.displayName.prefix(1) ?? "R")).font(.title2.weight(.medium))
                        .foregroundStyle(Theme.gold).frame(width: 55, height: 55).background(Theme.gold.opacity(0.1), in: .circle)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(store.user?.displayName ?? "Reader").font(.title3.weight(.semibold)).foregroundStyle(Theme.text)
                        Text(store.user?.isAdmin == true ? "Administrator" : "Reader").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                }.padding(.vertical, 5)
                if let user = store.user, user.weeklyLimit > 0 {
                    LabeledContent("Request allowance", value: "\(user.weeklyLimit) per rolling week").font(.footnote)
                }
                if store.isDemo { Label("Sample library · downloads disabled", systemImage: "sparkles").font(.footnote).foregroundStyle(Theme.gold) }
            }.listRowBackground(Theme.panel)

            if let connection = store.connection {
                Section("Current connection") {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(connection.location.name, systemImage: connection.isFallback ? "globe" : "house")
                            .font(.headline).foregroundStyle(Theme.green)
                        Text(connection.location.address).font(.caption).foregroundStyle(Theme.muted).textSelection(.enabled)
                        Text(connection.isFallback ? "Using an alternate address. Your preferred address is checked again when the network changes or the app returns to the foreground." : "Using your preferred address. The next saved location is tried automatically when this address cannot be reached.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }.padding(.vertical, 5)
                    Button("Check preferred address now") { Task { await store.recheckConnection() } }
                }.listRowBackground(Theme.panel)
            }
            Section {
                ForEach(store.profiles) { profile in
                    Button { editor = profile } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "server.rack").foregroundStyle(Theme.gold)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(profile.name).foregroundStyle(Theme.text)
                                Text(profile.locations.map(\.name).joined(separator: " → ")).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if profile.id == store.activeProfile?.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green) }
                            else { Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.muted) }
                        }.padding(.vertical, 4)
                    }
                }.onDelete { indices in for profile in indices.map({ store.profiles[$0] }) { store.deleteProfile(profile) } }
                Button {
                    editor = ServerProfile(name: "My Bookseerr", locations: [ServerLocation(name: "Home", address: ""), ServerLocation(name: "Public", address: "")])
                } label: { Label("Add a server", systemImage: "plus.circle") }
            } header: { Text("Your servers") }
              footer: { Text("Each server has its own sign-in and ordered list of trusted locations. Tap a server to edit its addresses or switch to it.") }
                .listRowBackground(Theme.panel)

            if let status = store.status {
                Section("Connected libraries") {
                    ForEach(status.sources.filter(\.configured)) { source in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text(source.title).font(.subheadline.weight(.medium))
                                Spacer()
                                Label(source.status.capitalized, systemImage: source.status == "healthy" ? "checkmark.circle" : "exclamationmark.circle")
                                    .font(.caption).foregroundStyle(source.status == "healthy" ? Theme.green : Theme.gold)
                            }
                            if let date = source.lastSuccess?.bookseerrDate { Text("Last complete sync \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(Theme.muted) }
                            if let error = source.error { Text(error).font(.caption).foregroundStyle(Theme.gold) }
                        }.padding(.vertical, 4)
                    }
                    if store.user?.isAdmin == true {
                        Button {
                            syncing = true
                            Task { await store.sync(); syncing = false }
                        } label: { HStack { Label("Check libraries now", systemImage: "arrow.trianglehead.2.clockwise.rotate.90"); if syncing { Spacer(); ProgressView() } } }
                            .disabled(syncing)
                    }
                    if let address = store.connection?.location.address, let url = URL(string: address) {
                        Link(destination: url) { Label("Open Bookseerr on the web", systemImage: "arrow.up.right.square") }
                    }
                }.listRowBackground(Theme.panel)
            }
            Section {
                Button(store.isDemo ? "Leave sample library" : "Sign out", role: .destructive) { Task { await store.signOut() } }
                if !store.isDemo { Button("Remove this device’s saved session", role: .destructive) { showForget = true } }
            } footer: { Text("Bookseerr for iOS · 0.1.0\nYour books. Everyone’s next read.") }
                .listRowBackground(Theme.panel)
        }.scrollContentBackground(.hidden).background(Theme.background)
            .sheet(item: $editor) { ServerEditor(profile: $0) }
            .confirmationDialog("Remove the session from this device?", isPresented: $showForget) {
                Button("Remove saved session", role: .destructive) { store.forgetSession() }
            } message: { Text("This signs out on this device. If the server is offline, its session cannot be revoked remotely and will expire on the server’s schedule.") }
    }
}

struct NotificationsView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedRequest: BookRequest?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SectionTitle(title: "Your reading room, in the loop", subtitle: "Updates on the books you’re following.")
                if store.notifications.isEmpty { EmptyState(title: "All quiet on your shelves", message: "Request updates will appear here.", symbol: "bell") }
                ForEach(store.notifications) { notification in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: notification.read ? "bell" : "circle.fill").font(.caption).foregroundStyle(notification.read ? Theme.muted : Theme.gold)
                            Text(notification.message).font(.subheadline).foregroundStyle(Theme.text)
                        }
                        if let date = notification.createdAt.bookseerrDate { Text(date, style: .relative).font(.caption).foregroundStyle(Theme.muted) }
                        if let requestID = notification.requestId, let request = store.requests.first(where: { $0.id == requestID }) {
                            Button("View request") { selectedRequest = request }.font(.caption.weight(.semibold))
                        }
                    }.padding(17).frame(maxWidth: .infinity, alignment: .leading).background(Theme.panel, in: .rect(cornerRadius: 14))
                }
                if store.unreadCount > 0 { Button("Mark all as read") { Task { await store.markNotificationsRead() } }.buttonStyle(.bordered) }
            }.padding(20)
        }.background(Theme.background).navigationTitle("Notifications")
            .refreshable { await store.refresh() }
            .sheet(item: $selectedRequest) { RequestDetailView(initial: $0) }
    }
}
