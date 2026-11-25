// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DedupeSwipe",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "DedupeCore", targets: ["DedupeCore"]),
        .executable(name: "dedupe-cli", targets: ["DedupeCLI"]),
    ],
    targets: [
        // Plattformnaher Kern: Scan, Hashing, Duplikate, Speicherort-Ampel, sicheres Löschen.
        .target(name: "DedupeCore"),
        // Headless-Werkzeug für Scans und Benchmarks (Schritt 2: Spike).
        .executableTarget(name: "DedupeCLI", dependencies: ["DedupeCore"]),
        .testTarget(name: "DedupeCoreTests", dependencies: ["DedupeCore"]),
    ]
)
