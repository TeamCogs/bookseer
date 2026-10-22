// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BookseerrCore",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "BookseerrCore", targets: ["BookseerrCore"])],
    targets: [
        .target(name: "BookseerrCore"),
        .testTarget(name: "BookseerrCoreTests", dependencies: ["BookseerrCore"]),
    ]
)
