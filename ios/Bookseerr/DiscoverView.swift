import BookseerrCore
import SwiftUI

struct DiscoverView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var scope = "all"
    @State private var response: SearchResponse?
    @State private var loading = false
    @State private var problem: String?
    private var signature: String { "\(query)|\(scope)|\(store.revision)" }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow(text: "The reading room")
                    Text(query.isEmpty ? "Your next chapter\nstarts here." : "Find your next read.")
                        .font(.system(.largeTitle, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                    Text("A familiar favorite. Something entirely new.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                }.padding(.top, 8)
                VStack(spacing: 12) {
                    SearchField(text: $query)
                    Picker("Search in", selection: $scope) {
                        Text("All books").tag("all")
                        Text("Your library").tag("local")
                        Text("Online").tag("online")
                    }.pickerStyle(.segmented)
                }
                if let problem {
                    Notice(message: response == nil ? problem : "\(problem) Previously loaded titles are still shown.") {
                        Button("Try again") { Task { await load() } }
                    }
                }
                if let warning = response?.warning { Notice(message: warning) }
                if loading { ProgressView("Searching your shelves…").frame(maxWidth: .infinity).padding(.vertical, 12) }
                if let response {
                    if query.isEmpty, let featured = response.library.first, scope != "online" {
                        featuredBook(featured)
                    }
                    if !response.library.isEmpty {
                        SectionTitle(title: query.isEmpty ? "On your shelves" : "From your library", subtitle: "Your connected books, with every format in view.")
                        BookGrid(books: response.library)
                    }
                    if !response.uniqueDiscovery.isEmpty {
                        SectionTitle(title: "Beyond your shelves", subtitle: "Find a book, then request the format you’re missing.")
                        BookGrid(books: response.uniqueDiscovery)
                    }
                    if response.library.isEmpty && response.uniqueDiscovery.isEmpty && !loading && problem == nil {
                        EmptyState(title: query.count < 2 && scope != "local" ? "A whole world of books" : "No matching titles",
                                   message: query.count < 2 && scope != "local" ? "Enter at least two characters to search online, or browse your Library tab." : "Try another title, author, or ISBN. Connection status is available in You.", symbol: "magnifyingglass")
                    }
                }
            }.padding(20).padding(.bottom, 20)
        }.scrollDismissesKeyboard(.interactively)
            .task(id: signature) {
                do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
                await load()
            }
            .refreshable { await store.refresh(); await load() }
    }
    private func featuredBook(_ result: BookResult) -> some View {
        NavigationLink { BookDetailView(initial: result) } label: {
            HStack(spacing: 18) {
                BookCover(title: result.book.title, author: result.book.author, url: result.book.coverUrl).frame(width: 82)
                VStack(alignment: .leading, spacing: 9) {
                    Eyebrow(text: "Already on your shelf")
                    Text(result.book.title).font(.system(.title3, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                    Text(result.book.author).font(.caption).foregroundStyle(Theme.muted)
                    Label("Explore your copies", systemImage: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.gold).padding(.top, 2)
                }
                Spacer(minLength: 0)
            }.padding(17).frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [Theme.panel, Theme.gold.opacity(0.07)], startPoint: .leading, endPoint: .trailing), in: .rect(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.gold.opacity(0.13)))
        }.buttonStyle(.plain)
    }
    private func load() async {
        guard let service = store.service else { return }
        let requested = signature
        loading = true
        defer { if requested == signature { loading = false } }
        do {
            let result = try await service.search(query: query.trimmingCharacters(in: .whitespacesAndNewlines), scope: scope)
            guard !Task.isCancelled, requested == signature else { return }
            response = result; problem = nil
            store.connection = await service.connection()
        } catch {
            guard !Task.isCancelled, requested == signature else { return }
            problem = error.localizedDescription
            if (error as? ClientError)?.isUnauthorized == true { store.handle(error) }
        }
    }
}
