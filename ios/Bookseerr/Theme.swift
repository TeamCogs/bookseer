import BookseerrCore
import SwiftUI

enum Theme {
    static let background = Color(red: 0.055, green: 0.075, blue: 0.10)
    static let panel = Color(red: 0.095, green: 0.12, blue: 0.15)
    static let raised = Color(red: 0.13, green: 0.16, blue: 0.19)
    static let text = Color(red: 0.94, green: 0.93, blue: 0.89)
    static let muted = Color(red: 0.65, green: 0.69, blue: 0.73)
    static let gold = Color(red: 0.88, green: 0.72, blue: 0.47)
    static let green = Color(red: 0.62, green: 0.81, blue: 0.72)
    static let line = Color.white.opacity(0.09)
    static func statusColor(_ status: AvailabilityStatus) -> Color {
        switch status { case .available: green; case .needsReview: gold; case .unknown: gold; case .notFound: muted }
    }
    static func requestColor(_ status: RequestStatus) -> Color {
        switch status {
        case .available: green
        case .failed, .rejected: .red.opacity(0.85)
        case .cancelled: muted
        default: gold
        }
    }
}

struct BrandMark: View {
    var size: CGFloat = 30
    var body: some View {
        Image(systemName: "book.pages.fill")
            .font(.system(size: size * 0.58, weight: .regular))
            .foregroundStyle(Theme.gold).frame(width: size, height: size)
            .background(Theme.gold.opacity(0.1), in: .rect(cornerRadius: size * 0.25))
            .accessibilityHidden(true)
    }
}
struct BrandLabel: View {
    var body: some View {
        HStack(spacing: 8) {
            BrandMark()
            Text("bookseerr").font(.system(.title3, design: .rounded, weight: .semibold)).tracking(-0.5).fixedSize(horizontal: true, vertical: false)
        }.foregroundStyle(Theme.text).accessibilityElement(children: .combine)
    }
}
struct Eyebrow: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(.caption2.weight(.semibold)).tracking(2).foregroundStyle(Theme.gold) }
}
struct SectionTitle: View {
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(.title2, design: .serif, weight: .medium)).foregroundStyle(Theme.text)
            if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(Theme.muted) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).foregroundStyle(Theme.background)
            .frame(maxWidth: .infinity).padding(.vertical, 15)
            .background(Theme.gold.opacity(configuration.isPressed ? 0.8 : 1), in: .rect(cornerRadius: 13))
    }
}
struct Notice<Action: View>: View {
    let message: String
    var symbol = "exclamationmark.circle"
    @ViewBuilder var action: () -> Action
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(Theme.gold)
            VStack(alignment: .leading, spacing: 8) {
                Text(message).font(.footnote).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                action().font(.footnote.weight(.semibold))
            }
            Spacer(minLength: 0)
        }.padding(13).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.gold.opacity(0.08), in: .rect(cornerRadius: 12))
            .accessibilityElement(children: .contain)
    }
}
extension Notice where Action == EmptyView {
    init(message: String, symbol: String = "exclamationmark.circle") {
        self.message = message; self.symbol = symbol; self.action = { EmptyView() }
    }
}
struct EmptyState: View {
    let title: String
    let message: String
    var symbol = "books.vertical"
    var body: some View {
        ContentUnavailableView { Label(title, systemImage: symbol) }
            description: { Text(message) }
            .foregroundStyle(Theme.muted).padding(.vertical, 25)
    }
}
struct SearchField: View {
    @Binding var text: String
    var placeholder = "Title, author, or ISBN"
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
            TextField(placeholder, text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.search).accessibilityIdentifier("book-search")
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                    .accessibilityLabel("Clear search").frame(minWidth: 30, minHeight: 30)
            }
        }.padding(.horizontal, 14).padding(.vertical, 10)
            .background(Theme.panel, in: .rect(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(Theme.line))
            .onChange(of: text) { _, value in if value.count > 200 { text = String(value.prefix(200)) } }
    }
}
extension String {
    var bookseerrDate: Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: self) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: self)
    }
}
