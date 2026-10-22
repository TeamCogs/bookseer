import BookseerrCore
import SwiftUI

struct WelcomeView: View {
    @Environment(AppStore.self) private var store
    @State private var editor: ServerProfile?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    BrandLabel().padding(.top, 16)
                    ZStack {
                        Circle().fill(Theme.gold.opacity(0.045)).frame(width: 280, height: 280)
                        BookCover(title: "Pride and Prejudice", author: "Jane Austen").frame(width: 110).rotationEffect(.degrees(13)).offset(x: 65, y: 10)
                        BookCover(title: "The Secret Garden", author: "Frances Hodgson Burnett").frame(width: 135).rotationEffect(.degrees(-9)).offset(x: -40)
                    }.frame(maxWidth: .infinity).frame(height: 290).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 13) {
                        Eyebrow(text: "Your books. Everyone’s next read.")
                        Text("A little closer to\nyour next chapter.")
                            .font(.system(.largeTitle, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                        Text("Your whole library, the formats you own, and the books you’re waiting for. All in one reading room.")
                            .font(.body).foregroundStyle(Theme.muted).lineSpacing(4)
                    }
                    if let error = store.error { Notice(message: error) }
                    Button {
                        editor = ServerProfile(name: "My Bookseerr", locations: [ServerLocation(name: "Home", address: ""), ServerLocation(name: "Public", address: "")])
                    } label: { Label("Connect your server", systemImage: "arrow.right") }
                        .buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("connect-server")
                    Button { Task { await store.startDemo() } } label: {
                        Text("Take a look around").font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 44)
                    }.accessibilityIdentifier("explore-sample")
                    if !store.profiles.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Eyebrow(text: "Saved servers")
                            ForEach(store.profiles) { profile in
                                Button { editor = profile } label: {
                                    HStack {
                                        Image(systemName: "server.rack").foregroundStyle(Theme.gold)
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(profile.name).foregroundStyle(Theme.text)
                                            Text("\(profile.locations.count) location\(profile.locations.count == 1 ? "" : "s")").font(.caption).foregroundStyle(Theme.muted)
                                        }
                                        Spacer(); Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
                                    }.padding().background(Theme.panel, in: .rect(cornerRadius: 13))
                                }
                            }
                        }
                    }
                    Text("Connect to your own self-hosted Bookseerr server. Sample mode uses an isolated library and sends no downloads.")
                        .font(.caption).foregroundStyle(Theme.muted).frame(maxWidth: .infinity).multilineTextAlignment(.center)
                }.padding(24)
            }.background(Theme.background)
                .sheet(item: $editor) { ServerEditor(profile: $0) }
        }
    }
}

struct ServerEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    private let id: UUID
    @State private var name: String
    @State private var locations: [ServerLocation]
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var problem: String?

    init(profile: ServerProfile) {
        id = profile.id
        _name = State(initialValue: profile.name)
        _locations = State(initialValue: profile.locations)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Server name", text: $name).accessibilityIdentifier("server-name")
                }
                Section {
                    ForEach($locations) { $location in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                TextField("Location name", text: $location.name).font(.subheadline.weight(.semibold))
                                if location.id == locations.first?.id { Text("PREFERRED").font(.caption2).foregroundStyle(Theme.gold) }
                            }
                            TextField("https://books.example.com", text: $location.address)
                                .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never)
                                .autocorrectionDisabled().font(.subheadline)
                                .accessibilityLabel("\(location.name) server address")
                                .accessibilityIdentifier("location-\(location.id)")
                        }.padding(.vertical, 5)
                    }
                    .onMove { locations.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { locations.remove(atOffsets: $0) }
                    .deleteDisabled(locations.count <= 1)
                    Button { locations.append(ServerLocation(name: "Another location", address: "")) } label: {
                        Label("Add another address", systemImage: "plus.circle")
                    }
                } header: { Text("Locations · tried from top to bottom") }
                  footer: {
                    Text("Put your home address first and public HTTPS address next. Bookseerr switches automatically when a location cannot be reached, and checks the preferred address again when the network changes. Use Edit to reorder locations. Leave unused addresses empty.")
                }
                Section {
                    TextField("Username", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password).privacySensitive()
                } header: { Text("Your Bookseerr account") }
                  footer: { Text("A saved session is reused when available. Passwords are never saved; sessions stay in your device’s Keychain. Every location you add is trusted to receive this server’s session.") }
                if let problem { Section { Notice(message: problem) }.listRowBackground(Color.clear).listRowInsets(EdgeInsets()) }
                Section {
                    Button {
                        busy = true; problem = nil
                        let profile = ServerProfile(id: id, name: name.trimmingCharacters(in: .whitespacesAndNewlines), locations: locations.filter { !$0.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
                        Task {
                            defer { busy = false }
                            do {
                                try await store.connect(profile: profile, username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                                password = ""; dismiss()
                            } catch { problem = error.localizedDescription; password = "" }
                        }
                    } label: {
                        HStack { if busy { ProgressView().tint(Theme.background) }; Text(busy ? "Finding your server…" : "Connect & save") }
                    }.buttonStyle(PrimaryButtonStyle()).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                        .accessibilityIdentifier("save-server")
                }
            }.disabled(busy).scrollContentBackground(.hidden).background(Theme.background)
                .navigationTitle("Connect to Bookseerr").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .topBarTrailing) { EditButton().disabled(busy) }
                }
        }.tint(Theme.gold).preferredColorScheme(.dark).interactiveDismissDisabled(busy)
    }
}
