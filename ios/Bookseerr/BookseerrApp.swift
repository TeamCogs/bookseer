import SwiftUI

@main
struct BookseerrApp: App {
    @State private var store = AppStore()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.gold)
                .preferredColorScheme(.dark)
                .task { await store.bootstrap() }
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        Group {
            if store.isRestoring {
                ZStack {
                    Theme.background.ignoresSafeArea()
                    VStack(spacing: 24) { BrandMark(size: 60); ProgressView("Opening your reading room…") }
                }
            } else if store.user == nil { WelcomeView() }
            else { ReadingRoomView().id(store.sessionID) }
        }
    }
}

private enum AppTab: Hashable { case discover, library, requests, account }

struct ReadingRoomView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var phase
    @State private var selection = AppTab.discover
    var body: some View {
        TabView(selection: $selection) {
            page { DiscoverView() }
                .tabItem { Label("Discover", systemImage: "sparkles") }.tag(AppTab.discover)
            page { LibraryView() }
                .tabItem { Label("Library", systemImage: "books.vertical") }.tag(AppTab.library)
            page { RequestsView() }
                .tabItem { Label("Requests", systemImage: "text.badge.plus") }
                .badge(store.activeRequests.count).tag(AppTab.requests)
            page { AccountView() }
                .tabItem { Label("You", systemImage: "person.crop.circle") }.tag(AppTab.account)
        }
        .task(id: phase) {
            guard phase == .active else { return }
            await store.recheckConnection()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                await store.refresh()
            }
        }
        .overlay(alignment: .top) {
            if let toast = store.toast {
                Label(toast, systemImage: "checkmark.circle.fill")
                    .font(.subheadline).padding().background(Theme.panel, in: .rect(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.green.opacity(0.4)))
                    .padding(.horizontal).padding(.top, 8)
                    .accessibilityAddTraits(.updatesFrequently)
                    .onTapGesture { store.toast = nil }
                    .task(id: toast) {
                        do { try await Task.sleep(for: .seconds(4)) } catch { return }
                        store.toast = nil
                    }
            }
        }
    }
    private func page<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content()
                .background(Theme.background)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { BrandLabel() }
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink { NotificationsView() } label: {
                            Image(systemName: store.unreadCount > 0 ? "bell.badge" : "bell")
                                .foregroundStyle(Theme.text).frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Notifications, \(store.unreadCount) unread")
                    }
                }
                .toolbarBackground(Theme.background, for: .navigationBar, .tabBar)
                .toolbarBackground(.visible, for: .navigationBar, .tabBar)
                .navigationBarTitleDisplayMode(.inline)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if store.isDemo {
                        Text("Sample library · downloads disabled")
                            .font(.caption).foregroundStyle(Theme.gold)
                            .frame(maxWidth: .infinity).padding(.vertical, 7)
                            .background(Theme.gold.opacity(0.08))
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if let error = store.error {
                        Notice(message: error, symbol: "wifi.exclamationmark") {
                            Button(store.requiresRequestCheck ? "Check Requests" : "Retry") {
                                Task {
                                    if store.requiresRequestCheck { selection = .requests; await store.checkRequests() }
                                    else { await store.refresh() }
                                }
                            }
                        }.padding(12).background(Theme.background)
                    }
                }
        }
    }
}
