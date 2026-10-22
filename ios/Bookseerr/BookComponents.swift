import BookseerrCore
import ImageIO
import SwiftUI

@MainActor enum CoverMemory {
    static let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>(); cache.totalCostLimit = 30 * 1024 * 1024; return cache
    }()
}
struct BookCover: View {
    @Environment(AppStore.self) private var store
    let title: String
    let author: String
    var url: String?
    @State private var artwork: UIImage?
    private var cacheKey: String { "\(store.activeProfile?.id.uuidString ?? "sample")|\(url ?? "")" }
    private var shade: Int { title.unicodeScalars.reduce(0) { $0 + Int($1.value) } % 5 }
    private var colors: [Color] {
        let palette: [[Color]] = [
            [Color(red: 0.15, green: 0.30, blue: 0.27), Color(red: 0.08, green: 0.17, blue: 0.16)],
            [Color(red: 0.43, green: 0.24, blue: 0.20), Color(red: 0.23, green: 0.12, blue: 0.11)],
            [Color(red: 0.22, green: 0.30, blue: 0.42), Color(red: 0.10, green: 0.15, blue: 0.24)],
            [Color(red: 0.42, green: 0.34, blue: 0.19), Color(red: 0.23, green: 0.19, blue: 0.12)],
            [Color(red: 0.32, green: 0.25, blue: 0.38), Color(red: 0.16, green: 0.12, blue: 0.22)],
        ]
        return palette[shade]
    }
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
                RoundedRectangle(cornerRadius: 3).stroke(Theme.gold.opacity(0.45), lineWidth: 0.7).padding(10)
                VStack(spacing: 10) {
                    Text(author.uppercased()).font(.system(size: max(7, geometry.size.width * 0.055), weight: .medium)).tracking(1.5).lineLimit(2)
                    Spacer(minLength: 0)
                    Image(systemName: ["leaf", "sun.max", "moon.stars", "bird", "sparkles"][shade])
                        .font(.system(size: geometry.size.width * 0.32, weight: .ultraLight))
                    Spacer(minLength: 0)
                    Text(title).font(.system(size: max(12, geometry.size.width * 0.13), weight: .medium, design: .serif))
                        .multilineTextAlignment(.center).lineLimit(4).minimumScaleFactor(0.7)
                    Rectangle().fill(Theme.gold.opacity(0.6)).frame(width: 20, height: 1).padding(.top, 5)
                }.foregroundStyle(Theme.gold.opacity(0.95)).padding(geometry.size.width * 0.13)
                if let artwork { Image(uiImage: artwork).resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped() }
                HStack { Color.black.opacity(0.22).frame(width: 5); Color.white.opacity(0.09).frame(width: 1); Spacer() }
            }
        }
        .aspectRatio(0.66, contentMode: .fit)
        .clipShape(.rect(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.white.opacity(0.12), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.3), radius: 10, x: 0, y: 6)
        .accessibilityHidden(true)
        .task(id: cacheKey) {
            artwork = nil
            guard let url, let service = store.service else { return }
            let key = cacheKey as NSString
            if let image = CoverMemory.images.object(forKey: key) { artwork = image; return }
            do {
                let data = try await service.imageData(url)
                guard !Task.isCancelled, let decoded = await CoverDecoder.thumbnail(data) else { return }
                guard !Task.isCancelled else { return }
                let image = UIImage(cgImage: decoded)
                CoverMemory.images.setObject(image, forKey: key, cost: decoded.bytesPerRow * decoded.height)
                artwork = image
            } catch { /* A typographic cover is the intentional fallback. */ }
        }
    }
}
private enum CoverDecoder {
    static func thumbnail(_ data: Data) async -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 700,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    }
}
struct FormatBadge: View {
    let kind: MediaKind
    let value: Availability
    private var label: String {
        switch value.status {
        case .available: kind == .ebook ? "Ebook" : "Audio"
        case .notFound: kind == .ebook ? "No ebook" : "No audio"
        case .needsReview: "Review"
        case .unknown: "Unverified"
        }
    }
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: kind.symbol)
            Text(label)
            if value.status == .available { Image(systemName: "checkmark").font(.system(size: 7, weight: .bold)) }
            if value.stale { Image(systemName: "clock") }
        }.font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.statusColor(value.status))
            .padding(.horizontal, 6).padding(.vertical, 5)
            .background(Theme.statusColor(value.status).opacity(0.1), in: .rect(cornerRadius: 5))
            .accessibilityLabel("\(kind.title): \(value.label)\(value.stale ? ", inventory is stale" : "")")
    }
}
struct BookCard: View {
    let result: BookResult
    var body: some View {
        NavigationLink {
            BookDetailView(initial: result)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                BookCover(title: result.book.title, author: result.book.author, url: result.book.coverUrl)
                HStack(spacing: 4) {
                    FormatBadge(kind: .ebook, value: result.availability.ebook)
                    FormatBadge(kind: .audiobook, value: result.availability.audiobook)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.book.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text).lineLimit(2)
                    Text(result.book.author.isEmpty ? "Unknown author" : result.book.author).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(result.book.title), by \(result.book.author). Ebook: \(result.availability.ebook.label). Audiobook: \(result.availability.audiobook.label).")
            .accessibilityAddTraits(.isButton)
    }
}
struct BookGrid: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let books: [BookResult]
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 240 : 145), spacing: 20, alignment: .top)], alignment: .leading, spacing: 25) {
            ForEach(books) { BookCard(result: $0) }
        }
    }
}
