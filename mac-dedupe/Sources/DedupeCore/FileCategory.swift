import Foundation

/// Grobe Einteilung nach Dateiendung. Ähnlichkeits- und Qualitätsprüfung
/// laufen später je Kategorie mit eigenen Verfahren.
public enum FileCategory: String, Sendable, CaseIterable, Hashable {
    case photo, video, audio, document, archive, other

    public init(pathExtension ext: String) {
        switch ext.lowercased() {
        case "jpg", "jpeg", "heic", "heif", "png", "gif", "tif", "tiff", "bmp", "webp",
             "dng", "raw", "cr2", "cr3", "nef", "arw", "orf", "rw2", "raf":
            self = .photo
        case "mov", "mp4", "m4v", "avi", "mkv", "3gp", "mts", "m2ts", "webm":
            self = .video
        case "mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg", "opus", "caf":
            self = .audio
        case "pdf", "doc", "docx", "pages", "txt", "rtf", "md", "odt", "xls", "xlsx",
             "numbers", "csv", "ppt", "pptx", "key", "epub":
            self = .document
        case "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso", "pkg":
            self = .archive
        default:
            self = .other
        }
    }

    public var displayName: String {
        switch self {
        case .photo: "Fotos"
        case .video: "Videos"
        case .audio: "Audio"
        case .document: "Dokumente"
        case .archive: "Archive"
        case .other: "Sonstiges"
        }
    }
}
