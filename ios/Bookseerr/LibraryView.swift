import BookseerrCore
import SwiftUI

struct LibraryView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var kind = "all"
    @State private var books: [BookResult] = []
    @State private var total: Int?
    @State private var duplicates = 0
    @State private var nextOffset = 0
    @State private var hasMore = false
    @State private var loading = false
    @State private var loadingMore = false
    @State private var problem: String?
    private var signature: String { "\(query)|\(kind)|\(store.revision)" }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow(text: "Collected. Connected. Yours.")
                    Text("Your library").font(.system(.largeTitle, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                    Text(total.map { "\($0.formatted()) titles · one home for every copy" } ?? "Books from your connected libraries")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                }.padding(.top, 8)
                VStack(spacing: 12) {
                    SearchField(text: $query, placeholder: "Search your library")
                    Picker("Format", selection: $kind) {
                        Text("All formats").tag("all")
                        Text("Ebooks").tag("ebook")
                        Text("Audiobooks").tag("audiobook")
                    }.pickerStyle(.segmented)
                }
                if duplicates > 0 {
                    Label("\(duplicates.formatted()) extra copies grouped with their titles", systemImage: "square.stack")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                if let problem {
                    Notice(message: "\(problem)\(books.isEmpty ? "" : " Previously loaded titles are still shown.")") {
                        Button("Retry") { Task { await load(reset: true) } }
                    }
                }
                if loading { ProgressView("Opening your library…").frame(maxWidth: .infinity).padding() }
                BookGrid(books: books)
                if total == 0 && !loading && problem == nil {
                    EmptyState(title: "No titles here yet", message: query.isEmpty ? "Connect and sync a library server in the Bookseerr web app, or choose another format." : "Try another title or author.")
                }
                if hasMore {
                    Button { Task { await load(reset: false) } } label: {
                        HStack { if loadingMore { ProgressView() }; Text("Load more books") }.frame(maxWidth: .infinity, minHeight: 48)
                    }.disabled(loadingMore || loading).buttonStyle(.bordered)
                }
            }.padding(20)
        }.scrollDismissesKeyboard(.interactively)
            .task(id: signature) {
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
                await load(reset: true)
            }
            .refreshable { await store.refresh(); await load(reset: true) }
    }
    private func load(reset: Bool) async {
        guard let service = store.service else { return }
        let requested = signature
        if reset { loading = true } else { guard !loadingMore else { return }; loadingMore = true }
        defer { if requested == signature { loading = false }; loadingMore = false }
        do {
            let result = try await service.library(query: query, kind: MediaKind(rawValue: kind), offset: reset ? 0 : nextOffset)
            guard !Task.isCancelled, requested == signature else { return }
            if reset { books = result.items }
            else {
                var seen = Set(books.map(\.id))
                books.append(contentsOf: result.items.filter { seen.insert($0.id).inserted })
            }
            total = result.total; duplicates = result.hiddenDuplicates
            nextOffset = result.offset + result.items.count
            hasMore = nextOffset < result.total && !result.items.isEmpty
            problem = nil
            store.connection = await service.connection()
        } catch {
            guard !Task.isCancelled, requested == signature else { return }
            problem = error.localizedDescription
            if (error as? ClientError)?.isUnauthorized == true { store.handle(error) }
        }
    }
}
