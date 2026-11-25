import Foundation

public struct ScanOptions: Sendable {
    public var roots: [URL]
    /// Ordner, die samt Inhalt übersprungen werden.
    public var excludedPaths: [String]
    /// Kleinere Dateien werden ignoriert. Leere Dateien sind nie Duplikate im Sinne der App.
    public var minimumSize: Int64
    public var includeHidden: Bool
    /// Pakete (.app, .photoslibrary …) werden standardmäßig nicht betreten.
    /// Die Fotos-Mediathek läuft ausschließlich über PhotoKit (ADR 0002).
    public var descendIntoPackages: Bool

    public init(
        roots: [URL],
        excludedPaths: [String] = [],
        minimumSize: Int64 = 1,
        includeHidden: Bool = false,
        descendIntoPackages: Bool = false
    ) {
        self.roots = roots
        self.excludedPaths = excludedPaths
        self.minimumSize = minimumSize
        self.includeHidden = includeHidden
        self.descendIntoPackages = descendIntoPackages
    }
}

public struct ScanResult: Sendable {
    public var files: [FileRecord] = []
    /// Symlinks werden nicht gehasht (sonst doppelt gezählt), aber gezählt.
    public var skippedSymlinks = 0
    public var unreadableEntries = 0
}

/// Spike-Version: sammelt alles in ein Array.
/// Später: Streaming in die Pipeline, getattrlistbulk und FSEvents (siehe ARCHITECTURE.md).
public enum FileScanner {
    public static func scan(_ options: ScanOptions) throws -> ScanResult {
        var result = ScanResult()
        var enumerationErrors = 0
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey]
        let keySet = Set(keys)
        let excluded = options.excludedPaths.map { $0.hasSuffix("/") ? String($0.dropLast()) : $0 }

        var enumerationOptions: FileManager.DirectoryEnumerationOptions = []
        if !options.includeHidden { enumerationOptions.insert(.skipsHiddenFiles) }
        if !options.descendIntoPackages { enumerationOptions.insert(.skipsPackageDescendants) }

        for root in options.roots {
            guard let enumerator = FileManager.default.enumerator(
                at: root,
                includingPropertiesForKeys: keys,
                options: enumerationOptions,
                errorHandler: { _, _ in
                    enumerationErrors += 1
                    return true // weitermachen, z. B. bei fehlender Berechtigung
                }
            ) else {
                result.unreadableEntries += 1
                continue
            }

            for case let url as URL in enumerator {
                try Task.checkCancellation()
                let path = url.path(percentEncoded: false)
                if excluded.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) {
                    enumerator.skipDescendants()
                    continue
                }
                guard let values = try? url.resourceValues(forKeys: keySet) else {
                    result.unreadableEntries += 1
                    continue
                }
                if values.isSymbolicLink == true {
                    result.skippedSymlinks += 1
                    continue
                }
                guard values.isRegularFile == true else { continue }
                guard let record = FileRecord.stat(path: path) else {
                    result.unreadableEntries += 1
                    continue
                }
                if record.size >= max(options.minimumSize, 1) {
                    result.files.append(record)
                }
            }
        }
        result.unreadableEntries += enumerationErrors
        return result
    }
}
