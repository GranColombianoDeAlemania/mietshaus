import Foundation
import Synchronization

/// Wo eine Datei physisch bzw. logisch liegt. Wird in der UI als Badge gezeigt.
public enum LocationKind: Sendable, Hashable {
    case internalDisk
    case externalDisk
    case network
    case iCloudDrive
    case cloudFolder(provider: String)
    case photosLibrary
    case trash
    case system

    public var label: String {
        switch self {
        case .internalDisk: "Interne Festplatte"
        case .externalDisk: "Externes Laufwerk"
        case .network: "Netzlaufwerk"
        case .iCloudDrive: "iCloud Drive"
        case .cloudFolder(let provider): provider
        case .photosLibrary: "Fotos-Mediathek"
        case .trash: "Papierkorb"
        case .system: "Systembereich"
        }
    }

    /// SF-Symbol für das Badge.
    public var symbolName: String {
        switch self {
        case .internalDisk: "internaldrive"
        case .externalDisk: "externaldrive"
        case .network: "network"
        case .iCloudDrive, .cloudFolder: "icloud"
        case .photosLibrary: "photo.on.rectangle"
        case .trash: "trash"
        case .system: "gearshape"
        }
    }
}

/// Ampel „Ist das der richtige Ort?". Nie nur Farbe: immer mit Symbol und Text anzeigen.
public enum TrafficLight: Int, Sendable, Comparable {
    case green = 0, yellow = 1, red = 2

    public static func < (lhs: TrafficLight, rhs: TrafficLight) -> Bool { lhs.rawValue < rhs.rawValue }

    public var label: String {
        switch self {
        case .green: "Richtiger Ort"
        case .yellow: "Bitte prüfen"
        case .red: "Geschützt"
        }
    }

    public var symbolName: String {
        switch self {
        case .green: "checkmark.circle.fill"
        case .yellow: "exclamationmark.triangle.fill"
        case .red: "lock.fill"
        }
    }
}

public struct LocationVerdict: Sendable, Equatable {
    public let kind: LocationKind
    public let light: TrafficLight
    /// Kurzgrund im Klartext, z. B. „Kopie in Downloads".
    public let reason: String
    public let isInMasterFolder: Bool
    /// Rot = wird nie zum Löschen angeboten.
    public var isLocked: Bool { light == .red }
}

public struct VolumeInfo: Sendable, Equatable {
    public let name: String
    public let isInternal: Bool
    public let isLocal: Bool

    public init(name: String, isInternal: Bool, isLocal: Bool) {
        self.name = name
        self.isInternal = isInternal
        self.isLocal = isLocal
    }

    public static func lookup(url: URL) -> VolumeInfo {
        let values = try? url.resourceValues(forKeys: [.volumeNameKey, .volumeIsInternalKey, .volumeIsLocalKey])
        return VolumeInfo(
            name: values?.volumeName ?? "Unbekanntes Volume",
            isInternal: values?.volumeIsInternal ?? true,
            isLocal: values?.volumeIsLocal ?? true
        )
    }
}

/// Volume-Infos einmal pro Datenträger nachschlagen, nicht pro Datei (kein I/O beim Scrollen).
public final class VolumeCache: Sendable {
    private let storage = Mutex<[UInt64: VolumeInfo]>([:])

    public init() {}

    public func info(for record: FileRecord) -> VolumeInfo {
        if let cached = storage.withLock({ $0[record.device] }) { return cached }
        let info = VolumeInfo.lookup(url: record.url)
        storage.withLock { $0[record.device] = info }
        return info
    }
}

/// Reine Regel-Logik ohne I/O: gleiche Eingabe → gleiches Ergebnis, daher gut testbar.
public struct LocationClassifier: Sendable {
    public var homeDirectory: String
    /// Vom Nutzer festgelegter „richtiger Ort" je Kategorie.
    public var masterFolders: [FileCategory: String]

    public init(homeDirectory: String = NSHomeDirectory(), masterFolders: [FileCategory: String] = [:]) {
        self.homeDirectory = homeDirectory.hasSuffix("/") ? String(homeDirectory.dropLast()) : homeDirectory
        self.masterFolders = masterFolders.mapValues { $0.hasSuffix("/") ? String($0.dropLast()) : $0 }
    }

    static let protectedPrefixes = [
        "/System/", "/Library/", "/usr/", "/bin/", "/sbin/", "/opt/", "/cores/",
        "/Applications/", "/private/etc/", "/private/var/db/",
    ]
    static let temporaryPrefixes = ["/tmp/", "/private/tmp/", "/private/var/folders/"]
    static let packageSuffixes = [".app", ".bundle", ".framework", ".plugin", ".kext", ".appex", ".xpc"]

    public func kind(path: String, volume: VolumeInfo) -> LocationKind {
        let components = path.split(separator: "/")
        if path.contains("/.Trash/") || path.contains("/.Trashes/") { return .trash }
        if components.dropLast().contains(where: { $0.hasSuffix(".photoslibrary") }) { return .photosLibrary }
        if path.hasPrefix(homeDirectory + "/Library/Mobile Documents/") { return .iCloudDrive }
        let cloudStorage = homeDirectory + "/Library/CloudStorage/"
        if path.hasPrefix(cloudStorage) {
            let folder = path.dropFirst(cloudStorage.count).split(separator: "/").first ?? "Cloud"
            let provider = folder.split(separator: "-").first.map(String.init) ?? String(folder)
            return .cloudFolder(provider: provider)
        }
        if path.hasPrefix(homeDirectory + "/Dropbox/") { return .cloudFolder(provider: "Dropbox") }
        if Self.protectedPrefixes.contains(where: { path.hasPrefix($0) }) { return .system }
        if !volume.isLocal { return .network }
        if !volume.isInternal { return .externalDisk }
        return .internalDisk
    }

    public func classify(path: String, category: FileCategory, volume: VolumeInfo) -> LocationVerdict {
        let kind = kind(path: path, volume: volume)
        func verdict(_ light: TrafficLight, _ reason: String, master: Bool = false) -> LocationVerdict {
            LocationVerdict(kind: kind, light: light, reason: reason, isInMasterFolder: master)
        }

        // Rot: niemals anfassen.
        switch kind {
        case .system:
            return verdict(.red, "Systembereich – wird nicht verändert")
        case .photosLibrary:
            return verdict(.red, "In der Fotos-Mediathek – nur über die Fotos-App bearbeiten")
        default:
            break
        }
        let directories = path.split(separator: "/").dropLast()
        if directories.contains(where: { dir in Self.packageSuffixes.contains(where: { dir.hasSuffix($0) }) }) {
            return verdict(.red, "Teil eines Programmpakets")
        }
        if path.hasPrefix(homeDirectory + "/Library/"), kind == .internalDisk || kind == .externalDisk {
            return verdict(.red, "Gehört zu Programmdaten im Library-Ordner")
        }

        if kind == .trash {
            return verdict(.yellow, "Liegt bereits im Papierkorb")
        }

        let master = masterFolders[category]
        if let master, path.hasPrefix(master + "/") {
            return verdict(.green, "Liegt im Master-Ordner für \(category.displayName)", master: true)
        }

        // Gelb: typische Orte für vorübergehende oder vergessene Kopien.
        if path.hasPrefix(homeDirectory + "/Downloads/") {
            return verdict(.yellow, "Kopie in Downloads – oft nur vorübergehend")
        }
        if path.hasPrefix(homeDirectory + "/Desktop/") {
            return verdict(.yellow, "Liegt auf dem Schreibtisch")
        }
        if Self.temporaryPrefixes.contains(where: { path.hasPrefix($0) }) {
            return verdict(.yellow, "Temporärer Ordner")
        }
        if path.split(separator: "/").dropLast().contains(where: { $0 == "Caches" || $0 == "Cache" }) {
            return verdict(.yellow, "Liegt in einem Cache-Ordner")
        }
        if master != nil {
            return verdict(.yellow, "Außerhalb des Master-Ordners für \(category.displayName)")
        }
        return verdict(.green, "Normaler Ordner (kein Master-Ordner festgelegt)")
    }
}
