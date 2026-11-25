import Darwin
import Foundation

/// Metadaten einer regulären Datei, so wie sie beim Scan vorgefunden wurde.
/// Bewusst ein kleiner Werttyp: Millionen davon sollen in den Speicher passen.
public struct FileRecord: Sendable, Hashable, Identifiable {
    public let path: String
    public let size: Int64
    public let modified: Date
    public let device: UInt64
    public let inode: UInt64
    public let linkCount: UInt32

    public init(path: String, size: Int64, modified: Date, device: UInt64, inode: UInt64, linkCount: UInt32) {
        self.path = path
        self.size = size
        self.modified = modified
        self.device = device
        self.inode = inode
        self.linkCount = linkCount
    }

    public var id: String { path }
    public var url: URL { URL(fileURLWithPath: path) }
    public var category: FileCategory { FileCategory(pathExtension: url.pathExtension) }
    public var inodeKey: InodeKey { InodeKey(device: device, inode: inode) }

    /// Liest die Metadaten per `lstat` (folgt keinen Symlinks).
    /// Gibt `nil` zurück, wenn der Pfad fehlt oder keine reguläre Datei ist.
    public static func stat(path: String) -> FileRecord? {
        var st = Darwin.stat()
        guard lstat(path, &st) == 0, (st.st_mode & S_IFMT) == S_IFREG else { return nil }
        let modified = Date(
            timeIntervalSince1970: TimeInterval(st.st_mtimespec.tv_sec)
                + TimeInterval(st.st_mtimespec.tv_nsec) / 1_000_000_000
        )
        return FileRecord(
            path: path,
            size: Int64(st.st_size),
            modified: modified,
            device: UInt64(UInt32(bitPattern: st.st_dev)),
            inode: UInt64(st.st_ino),
            linkCount: UInt32(st.st_nlink)
        )
    }

    /// Prüft vor jeder Aktion, ob die Datei noch genau die ist, die gescannt wurde.
    public func verify() -> FileState {
        guard let now = FileRecord.stat(path: path) else {
            return FileManager.default.fileExists(atPath: path)
                ? .changed(reason: "Ist keine normale Datei mehr")
                : .missing
        }
        if now.device != device || now.inode != inode {
            return .changed(reason: "Datei wurde durch eine andere ersetzt")
        }
        if now.size != size { return .changed(reason: "Größe hat sich geändert") }
        if now.modified != modified { return .changed(reason: "Inhalt wurde seit dem Scan geändert") }
        return .unchanged
    }
}

/// Identität einer Datei auf dem Datenträger. Gleicher Schlüssel = Hardlink.
public struct InodeKey: Sendable, Hashable {
    public let device: UInt64
    public let inode: UInt64
}

public enum FileState: Sendable, Equatable {
    case unchanged
    case missing
    case changed(reason: String)

    public var message: String {
        switch self {
        case .unchanged: "Unverändert"
        case .missing: "Datei existiert nicht mehr an diesem Ort"
        case .changed(let reason): reason
        }
    }
}
