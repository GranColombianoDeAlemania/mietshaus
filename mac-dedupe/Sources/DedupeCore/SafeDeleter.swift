import Foundation

/// Beleg einer Papierkorb-Aktion. Wird für Undo und das Aktionsprotokoll aufbewahrt.
public struct TrashReceipt: Sendable, Codable, Equatable {
    public let date: Date
    public let originalPath: String
    /// `nil` bei Dry-Run.
    public let trashedPath: String?
    public let size: Int64
    public let dryRun: Bool
}

public enum DeletionError: Error, Sendable, Equatable {
    case locked(reason: String)
    case fileChanged(FileState)
    case cannotUndo(reason: String)
}

/// Löscht nie endgültig: verschiebt in den Papierkorb, nach Prüfung von Ampel und Datei-Zustand.
public struct SafeDeleter: Sendable {
    public var dryRun: Bool

    public init(dryRun: Bool = true) {
        self.dryRun = dryRun
    }

    public func moveToTrash(_ file: FileRecord, verdict: LocationVerdict) throws -> TrashReceipt {
        guard !verdict.isLocked else { throw DeletionError.locked(reason: verdict.reason) }
        let state = file.verify()
        guard state == .unchanged else { throw DeletionError.fileChanged(state) }

        if dryRun {
            return TrashReceipt(date: Date(), originalPath: file.path, trashedPath: nil, size: file.size, dryRun: true)
        }
        var resulting: NSURL?
        try FileManager.default.trashItem(at: file.url, resultingItemURL: &resulting)
        return TrashReceipt(
            date: Date(),
            originalPath: file.path,
            trashedPath: (resulting as URL?)?.path(percentEncoded: false),
            size: file.size,
            dryRun: false
        )
    }

    /// Holt eine Datei aus dem Papierkorb an ihren ursprünglichen Ort zurück.
    public func undo(_ receipt: TrashReceipt) throws {
        guard !receipt.dryRun else { return }
        guard let trashed = receipt.trashedPath else {
            throw DeletionError.cannotUndo(reason: "Ort im Papierkorb unbekannt")
        }
        guard FileManager.default.fileExists(atPath: trashed) else {
            throw DeletionError.cannotUndo(reason: "Datei ist nicht mehr im Papierkorb")
        }
        guard !FileManager.default.fileExists(atPath: receipt.originalPath) else {
            throw DeletionError.cannotUndo(reason: "Am ursprünglichen Ort liegt inzwischen eine andere Datei")
        }
        let original = URL(fileURLWithPath: receipt.originalPath)
        try FileManager.default.createDirectory(at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: URL(fileURLWithPath: trashed), to: original)
    }
}
