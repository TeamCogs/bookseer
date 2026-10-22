import BookseerrCore
import SwiftUI

struct DiscoverView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var scope = "all"
    @State private var filters = DiscoveryQuery()
    @State private var discovery: DiscoveryResponse?
    @State private var search: SearchResponse?
    @State private var loading = true
    @State private var problem: String?
    @State private var loaded: LoadKey?
    private struct LoadKey: Hashable {
        var query: String; var scope: String; var filters: DiscoveryQuery; var revision: Int
    }
    private var text: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var signature: LoadKey { LoadKey(query: text, scope: scope, filters: filters, revision: store.revision) }
    private var browsing: Bool { text.isEmpty }
    private var heading: String {
        if discovery?.mode == "curated" { return "Explore the catalogue" }
        if discovery?.mode == "demo" { return "Explore sample titles" }
        if !filters.topic.isEmpty {
            return discovery?.filters.topics.first { $0.id == filters.topic }?.label ?? "Explore a topic"
        }
        if !filters.q.isEmpty { return "Explore “\(filters.q)”" }
        switch filters.sort {
        case "popular": return "On everyone’s reading list"
        case "rating": return "Loved by readers"
        case "new": return "Recently published"
        default: return filters.language.isEmpty && filters.era.isEmpty ? "Trending this week" : "Trending now"
        }
    }
    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    SearchField(text: $query)
                    if !browsing {
                        Picker("Search in", selection: $scope) {
                            Text("All books").tag("all")
                            Text("Your library").tag("local")
                            Text("Online").tag("online")
                        }.pickerStyle(.segmented)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: browsing ? "Beyond your shelves" : "Find & request")
                        Text(browsing ? "Your next read." : "Find your next read.")
                            .font(.system(.largeTitle, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                        Text(browsing ? "Follow what’s catching readers’ attention, or follow your curiosity." : "Your connected shelves come first. Request the formats you’re missing.")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    if browsing, let discovery {
                        DiscoveryControls(query: $filters, filters: discovery.filters, curated: discovery.mode == "curated")
                    }
                    if let problem {
                        Notice(message: problem) { Button("Try again") { Task { await load() } } }
                    }
                    if loading { ProgressView(browsing ? "Finding your next read…" : "Searching books…").frame(maxWidth: .infinity).padding(.vertical, 12) }
                    if !loading, loaded == signature {
                        if browsing, let discovery {
                            discoveryContent(discovery, scroll: scroll)
                        } else if let search {
                            searchContent(search)
                        }
                    }
                }.padding(20).padding(.bottom, 20)
            }.scrollDismissesKeyboard(.interactively)
                .task(id: signature) {
                    loading = true; problem = nil
                    do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
                    await load()
                }
                .refreshable { await store.refresh(); await load() }
        }
    }
    @ViewBuilder private func discoveryContent(_ response: DiscoveryResponse, scroll: ScrollViewProxy) -> some View {
        if let warning = response.warning {
            Notice(message: warning) { Button("Try again") { Task { await load() } } }
        }
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(title: heading)
            if let address = response.source.url, let url = URL(string: address) {
                Link(destination: url) { Label(response.source.name, systemImage: "arrow.up.right") }.font(.caption).tint(Theme.muted)
            } else { Text(response.source.name).font(.caption).foregroundStyle(Theme.muted) }
        }.id("discovery-results")
        if response.items.isEmpty && response.warning == nil {
            EmptyState(title: "Try another direction", message: "No titles match these filters. Try another topic or clear a filter.", symbol: "safari")
        } else {
            BookGrid(books: response.items)
        }
        if !response.items.isEmpty {
            HStack {
                Button("Previous") { filters.page -= 1; scroll.scrollTo("discovery-results", anchor: .top) }.disabled(response.page <= 1)
                Spacer()
                Text("Page \(response.page)").font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Button("Next page") { filters.page += 1; scroll.scrollTo("discovery-results", anchor: .top) }.disabled(!response.hasMore || response.page >= 100)
            }.font(.subheadline).tint(Theme.gold).padding(.vertical, 8)
        }
        Text(response.mode == "live" ? "Community trends and catalogue metadata from Open Library. Browse lists are the same for everyone. Each title shows the formats you already own."
             : response.mode == "demo" ? "Sample titles demonstrate discovery without contacting any book services."
             : "This server’s operator selects the available titles and formats.")
            .font(.caption).foregroundStyle(Theme.muted)
    }
    @ViewBuilder private func searchContent(_ response: SearchResponse) -> some View {
        if let warning = response.warning { Notice(message: warning) }
        if !response.library.isEmpty {
            SectionTitle(title: "In your library", subtitle: "Your connected books, with every format in view.")
            BookGrid(books: response.library)
        }
        if !response.uniqueDiscovery.isEmpty {
            SectionTitle(title: "Discover & request", subtitle: "Find a book, then request the format you’re missing.")
            BookGrid(books: response.uniqueDiscovery)
        }
        if response.library.isEmpty && response.uniqueDiscovery.isEmpty && problem == nil {
            EmptyState(title: "No matching titles", message: "Try another title, author, or ISBN.", symbol: "magnifyingglass")
        }
    }
    private func load() async {
        guard let service = store.service else { return }
        let requested = signature
        loading = true; problem = nil
        defer { if requested == signature { loading = false } }
        do {
            if browsing {
                let result = try await service.discover(query: filters)
                guard !Task.isCancelled, requested == signature else { return }
                discovery = result
            } else {
                let result = try await service.search(query: text, scope: scope)
                guard !Task.isCancelled, requested == signature else { return }
                search = result
            }
            loaded = requested
            store.connection = await service.connection()
        } catch {
            guard !Task.isCancelled, requested == signature else { return }
            problem = (error as? ClientError).map { error in
                if case .http(404, _) = error { return "This server needs an update to support book discovery. Direct search and your Library tab are still available." }
                return error.localizedDescription
            } ?? error.localizedDescription
            if (error as? ClientError)?.isUnauthorized == true { store.handle(error) }
        }
    }
}

private struct DiscoveryControls: View {
    @Binding var query: DiscoveryQuery
    let filters: DiscoveryFilters
    let curated: Bool
    @State private var refining = false
    private func binding(_ key: WritableKeyPath<DiscoveryQuery, String>) -> Binding<String> {
        Binding(get: { query[keyPath: key] }, set: { query[keyPath: key] = $0; query.page = 1 })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !curated {
                HStack(spacing: 9) {
                    collection("Trending", symbol: "chart.line.uptrend.xyaxis", sort: "trending")
                    collection("Most shelved", symbol: "books.vertical", sort: "popular")
                    collection("Top rated", symbol: "star", sort: "rating")
                }
                VStack(alignment: .leading, spacing: 11) {
                    Text("Follow a topic").font(.headline).foregroundStyle(Theme.text)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 9) {
                            ForEach(filters.topics) { option in
                                Button { query.topic = option.id; query.page = 1 } label: {
                                    Text(option.label).font(.subheadline).fixedSize()
                                        .padding(.horizontal, 14).padding(.vertical, 10)
                                        .foregroundStyle(query.topic == option.id ? Theme.gold : Theme.muted)
                                        .background(query.topic == option.id ? Theme.gold.opacity(0.1) : Theme.panel, in: .capsule)
                                        .overlay(Capsule().stroke(query.topic == option.id ? Theme.gold.opacity(0.6) : Theme.line))
                                }.buttonStyle(.plain).accessibilityAddTraits(query.topic == option.id ? [.isSelected] : [])
                            }
                        }.padding(.vertical, 2)
                    }
                }
            }
            DisclosureGroup("Refine discovery", isExpanded: $refining) {
                VStack(alignment: .leading, spacing: 14) {
                    TextField("Keywords: space, cooking, adventure…", text: binding(\.q))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
                        .accessibilityLabel("Discovery keywords").accessibilityIdentifier("discovery-keywords")
                        .onChange(of: query.q) { _, value in if value.count > 200 { query.q = String(value.prefix(200)) } }
                    if !curated {
                        Picker("Sort by", selection: binding(\.sort)) { ForEach(filters.sorts) { Text($0.label).tag($0.id) } }
                        Picker("Language", selection: binding(\.language)) { ForEach(filters.languages) { Text($0.label).tag($0.id) } }
                        Picker("First published", selection: binding(\.era)) { ForEach(filters.eras) { Text($0.label).tag($0.id) } }
                    }
                    Button("Clear filters") { query = DiscoveryQuery() }
                }.padding(.top, 14).font(.subheadline)
            }.tint(Theme.gold).padding(15).background(Theme.panel, in: .rect(cornerRadius: 12))
            if !query.q.isEmpty || !query.era.isEmpty || !query.language.isEmpty {
                Button("Clear filters") { query = DiscoveryQuery() }.font(.caption).tint(Theme.gold)
            }
        }
    }
    private func collection(_ title: String, symbol: String, sort: String) -> some View {
        Button { query.sort = sort; query.page = 1 } label: {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption.weight(.semibold))
            }.frame(maxWidth: .infinity, minHeight: 60, alignment: .leading).padding(12)
                .foregroundStyle(query.sort == sort ? Theme.gold : Theme.muted)
                .background(Theme.panel, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(query.sort == sort ? Theme.gold.opacity(0.5) : Theme.line))
        }.buttonStyle(.plain).accessibilityAddTraits(query.sort == sort ? [.isSelected] : [])
    }
}
