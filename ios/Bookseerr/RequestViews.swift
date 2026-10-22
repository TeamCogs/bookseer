import BookseerrCore
import SwiftUI

struct RequestsView: View {
    @Environment(AppStore.self) private var store
    @State private var filter = "active"
    @State private var selected: BookRequest?
    private var visible: [BookRequest] {
        store.requests.filter { filter == "following" ? $0.following : filter == "completed" ? $0.status.isClosed : !$0.status.isClosed }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow(text: "Good things are on their way")
                    Text("Your requests").font(.system(.largeTitle, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                    Text("From the first request to ready to read.").font(.subheadline).foregroundStyle(Theme.muted)
                }.padding(.top, 8)
                Picker("Requests", selection: $filter) {
                    Text("Active").tag("active")
                    Text("Following").tag("following")
                    Text("Completed").tag("completed")
                }.pickerStyle(.segmented)
                if store.requiresRequestCheck {
                    Notice(message: "The connection changed during an operation. Refresh this list and check whether it completed.") {
                        Button("Check request status") { Task { await store.checkRequests() } }
                    }
                }
                if store.status == nil { ProgressView("Loading requests…").frame(maxWidth: .infinity) }
                else if visible.isEmpty {
                    EmptyState(title: "A little room for your next read", message: filter == "active" ? "Find a book in Discover and request an ebook or audiobook." : "Requests matching this filter will appear here.", symbol: "text.badge.plus")
                }
                LazyVStack(spacing: 13) {
                    ForEach(visible) { request in
                        Button { selected = request } label: { RequestRow(request: request) }.buttonStyle(.plain)
                    }
                }
            }.padding(20)
        }.refreshable { await store.checkRequests(); await store.refresh() }
            .task { await store.checkRequests() }
            .sheet(item: $selected) { RequestDetailView(initial: $0) }
    }
}
private struct RequestRow: View {
    let request: BookRequest
    var body: some View {
        HStack(spacing: 15) {
            BookCover(title: request.title, author: request.author, url: request.coverUrl).frame(width: 58)
            VStack(alignment: .leading, spacing: 7) {
                Text(request.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                Text(request.author).font(.caption).foregroundStyle(Theme.muted)
                Label(request.status.title, systemImage: request.mediaKind.symbol)
                    .font(.caption.weight(.medium)).foregroundStyle(Theme.requestColor(request.status))
                if request.followers > 1 { Text("\(request.followers) readers following").font(.caption2).foregroundStyle(Theme.muted) }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.muted)
        }.padding(14).background(Theme.panel, in: .rect(cornerRadius: 15))
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(Theme.line))
            .accessibilityElement(children: .combine)
    }
}
struct RequestDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let initial: BookRequest
    @State private var busy = false
    @State private var pendingAction: RequestAction?
    private var request: BookRequest { store.requests.first { $0.id == initial.id } ?? initial }
    private var canCancel: Bool {
        request.status.canCancel && (store.user?.isAdmin == true || (request.requesterId == store.user?.id && request.following && request.followers <= 1))
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(alignment: .top, spacing: 20) {
                        BookCover(title: request.title, author: request.author, url: request.coverUrl).frame(width: 95)
                        VStack(alignment: .leading, spacing: 10) {
                            Eyebrow(text: request.mediaKind.title)
                            Text(request.title).font(.system(.title2, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
                            Text(request.author).font(.subheadline).foregroundStyle(Theme.muted)
                            Text(request.status.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.requestColor(request.status))
                        }
                    }
                    VStack(alignment: .leading, spacing: 15) {
                        Label(request.status.title, systemImage: request.status == .available ? "checkmark.circle.fill" : "clock")
                            .font(.headline).foregroundStyle(Theme.requestColor(request.status))
                        Text(request.message).font(.subheadline).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                        Divider().overlay(Theme.line)
                        LabeledContent("Requested by", value: request.requestedBy)
                        LabeledContent("Readers following", value: request.followers.formatted())
                        if let date = request.updatedAt.bookseerrDate { LabeledContent("Updated") { Text(date, style: .relative) } }
                    }.font(.footnote).padding(18).background(Theme.panel, in: .rect(cornerRadius: 16))
                    if let error = store.error { Notice(message: error) }
                    if store.user?.isAdmin == true {
                        if request.status.canApprove {
                            Button("Approve request") { Task { await act(.approve) } }.buttonStyle(PrimaryButtonStyle())
                        }
                        if request.status.canRetry {
                            Button("Review complete · reopen request") { pendingAction = .retry }.buttonStyle(.bordered)
                        }
                        if request.status.canCancel {
                            Button("Decline request", role: .destructive) { pendingAction = .reject }.buttonStyle(.bordered)
                        }
                    }
                    if request.following {
                        Button("Stop following") { pendingAction = .unfollow }.buttonStyle(.bordered)
                    }
                    if canCancel { Button("Cancel request", role: .destructive) { pendingAction = .cancel }.buttonStyle(.bordered) }
                    if [.downloading, .importing, .submitting, .requested, .pendingUpstream].contains(request.status) {
                        Text("Acquisition has progressed. Manage active downloads in Chaptarr.").font(.caption).foregroundStyle(Theme.muted)
                    }
                }.padding(22).disabled(busy)
            }.background(Theme.background).navigationTitle("Request details").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .refreshable { await store.checkRequests() }
                .confirmationDialog("Update this request?", isPresented: Binding(get: { pendingAction != nil }, set: { if !$0 { pendingAction = nil } }), presenting: pendingAction) { action in
                    Button(action == .retry ? "Reopen request" : action == .unfollow ? "Stop following" : action == .reject ? "Decline request" : "Cancel request", role: action == .retry ? nil : .destructive) {
                        Task { await act(action) }
                    }
                } message: { action in
                    Text(action == .retry ? "Confirm you have checked the upstream state before reopening this request." : action == .unfollow ? "You will stop receiving updates for this request. If nobody follows an early request, the server may cancel it." : "This changes the shared request for all its readers.")
                }
        }.tint(Theme.gold).preferredColorScheme(.dark)
    }
    private func act(_ action: RequestAction) async {
        guard !busy else { return }; busy = true
        await store.act(on: request, action: action)
        busy = false
    }
}
