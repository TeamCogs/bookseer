import BookseerrCore
import SwiftUI

struct BookDetailView: View {
    @Environment(AppStore.self) private var store
    @State private var result: BookResult
    @State private var busy = false
    @State private var problem: String?
    @State private var submitted: BookRequest?
    @State private var reviewDecision: ReviewDecision?
    init(initial: BookResult) { _result = State(initialValue: initial) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 25) {
                VStack(spacing: 18) {
                    BookCover(title: result.book.title, author: result.book.author, url: result.book.coverUrl).frame(width: 150)
                    VStack(spacing: 8) {
                        Eyebrow(text: "Your next chapter")
                        Text(result.book.title).font(.system(.largeTitle, design: .serif, weight: .medium)).multilineTextAlignment(.center).foregroundStyle(Theme.text)
                        Text(result.book.author).font(.title3).foregroundStyle(Theme.muted)
                        if let year = result.book.year { Text(String(year)).font(.caption).foregroundStyle(Theme.muted) }
                    }
                }.frame(maxWidth: .infinity).padding(.top, 15)
                if let problem { Notice(message: problem) }
                if store.requiresRequestCheck {
                    Notice(message: "A previous operation lost its connection. Check Requests before sending another request.") {
                        Button("Check Requests") { Task { await store.checkRequests() } }
                    }
                }
                SectionTitle(title: "Make it your next read", subtitle: "Choose a format. We’ll check your library again before requesting.")
                ForEach(MediaKind.allCases) { kind in formatPanel(kind) }
                Text("\(result.book.origin == "openlibrary" ? "Catalogue information from Open Library." : result.book.origin == "demo" ? "Sample catalogue." : "From your connected library.") Availability comes from your server’s last complete inventory.")
                    .font(.caption).foregroundStyle(Theme.muted).padding(.bottom, 15)
            }.padding(20)
        }.background(Theme.background).navigationTitle("Book details").navigationBarTitleDisplayMode(.inline)
            .sheet(item: $submitted) { RequestDetailView(initial: $0) }
            .alert(item: $reviewDecision) { decision in
                Alert(title: Text(decision.dismiss ? "Dismiss this match?" : "Confirm this copy?"),
                      message: Text("\(decision.item.title) by \(decision.item.author)\n\n\(decision.dismiss ? "This saves an administrator decision that this copy is a different book." : "This saves an administrator decision linking this copy to \(result.book.title).")"),
                      primaryButton: .default(Text(decision.dismiss ? "Different book" : "Confirm same book")) { Task { await review(decision) } },
                      secondaryButton: .cancel())
            }
    }
    private func formatPanel(_ kind: MediaKind) -> some View {
        let value = result.availability[kind]
        let summary = result.summary(for: kind)
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: kind.symbol).font(.title3).foregroundStyle(Theme.gold)
                Text(kind.title).font(.headline).foregroundStyle(Theme.text)
                Spacer()
                Text(value.label).font(.caption.weight(.medium)).foregroundStyle(Theme.statusColor(value.status))
                    .multilineTextAlignment(.trailing)
            }
            Text(value.reason).font(.footnote).foregroundStyle(Theme.muted)
            if value.stale { Notice(message: "This inventory is stale. Previously verified copies are retained; absence cannot be confirmed.", symbol: "clock") }
            if value.confirmed { Label("Identity confirmed by an administrator", systemImage: "checkmark.shield").font(.caption).foregroundStyle(Theme.green) }
            ForEach(value.items) { item in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.libraryName).font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                        Text("\(item.formats.isEmpty ? kind.title : item.formats.joined(separator: ", ")) · \(item.available ? "File present" : "Monitored · file missing")")
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 5)
                    if item.available, value.status == .available, let raw = item.url, let url = readerURL(raw) {
                        Link(destination: url) { Image(systemName: "arrow.up.right").frame(width: 44, height: 44).background(Theme.raised, in: .circle) }
                            .accessibilityLabel("Open \(kind.title) in \(item.libraryName)")
                    }
                }.padding(12).background(Theme.background.opacity(0.7), in: .rect(cornerRadius: 10))
            }
            if let summary {
                Label(summary.following ? "Following · \(summary.status.title)" : "Already requested · \(summary.status.title)", systemImage: summary.following ? "bell.badge" : "person.2")
                    .font(.footnote).foregroundStyle(Theme.gold)
            }
            if value.status == .notFound {
                Button { Task { await request(kind) } } label: {
                    HStack {
                        if busy { ProgressView().tint(Theme.background) }
                        else { Image(systemName: "plus") }
                        Text(requestLabel(kind))
                    }
                }.buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || !result.canRequest(kind) || store.requiresRequestCheck)
                    .opacity(result.canRequest(kind) && !store.requiresRequestCheck ? 1 : 0.45)
                    .accessibilityIdentifier("request-\(kind.rawValue)")
            }
            if !value.candidates.isEmpty {
                Divider().overlay(Theme.line)
                Text("Possible library matches").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.gold)
                ForEach(value.candidates) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                        Text("\(item.author) · \(item.libraryName) · \(item.formats.joined(separator: ", "))").font(.caption).foregroundStyle(Theme.muted)
                        if store.user?.isAdmin == true {
                            HStack {
                                Button("Same book") { reviewDecision = ReviewDecision(item: item, kind: kind, dismiss: false) }.buttonStyle(.bordered)
                                Button("Different book") { reviewDecision = ReviewDecision(item: item, kind: kind, dismiss: true) }.buttonStyle(.bordered)
                            }.font(.caption).disabled(busy)
                        } else { Text("An administrator needs to review this match.").font(.caption).foregroundStyle(Theme.gold) }
                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.background, in: .rect(cornerRadius: 10))
                }
            }
        }.padding(17).background(Theme.panel, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line))
    }
    private func requestLabel(_ kind: MediaKind) -> String {
        guard let summary = result.summary(for: kind) else {
            return store.user?.isAdmin == true || store.user?.autoApprove == true ? "Request \(kind.title.lowercased())" : "Request approval for \(kind.title.lowercased())"
        }
        if summary.status == .available { return "Request missing copy" }
        if [.cancelled, .rejected].contains(summary.status) { return "Administrator can reopen" }
        return summary.following ? "Following request" : "Follow existing request"
    }
    private func request(_ kind: MediaKind) async {
        guard !busy else { return }
        busy = true; problem = nil
        defer { busy = false }
        do {
            let response = try await store.request(result, kind: kind)
            var summaries = result.requests ?? [:]
            summaries[kind.rawValue] = RequestSummary.from(response.request)
            result.requests = summaries
            submitted = response.request
        } catch { problem = error.localizedDescription }
    }
    private func review(_ decision: ReviewDecision) async {
        guard let service = store.service else { return }
        busy = true; problem = nil
        defer { busy = false }
        do {
            result = try await service.review(catalogId: result.id, kind: decision.kind, itemId: decision.item.id, dismiss: decision.dismiss)
            store.revision += 1
        } catch { problem = error.localizedDescription; store.handle(error) }
    }
    private func readerURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), ["http", "https"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return nil }
        return url
    }
}
private struct ReviewDecision: Identifiable {
    let item: BookseerrCore.LibraryItem
    let kind: MediaKind
    let dismiss: Bool
    var id: String { "\(item.id)-\(dismiss)" }
}
