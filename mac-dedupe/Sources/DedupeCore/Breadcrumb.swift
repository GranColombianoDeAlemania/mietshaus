/// Pfad als Breadcrumb, beginnend mit dem Volume-Namen:
/// `Macintosh HD › Users › … › Urlaub 2024 › IMG_0421.jpg`
public struct Breadcrumb: Sendable, Equatable {
    public static let separator = " › "
    public static let ellipsis = "…"

    /// Alle Bestandteile ungekürzt. Das letzte Element ist der Dateiname.
    public let components: [String]

    public init(path: String, volume: VolumeInfo) {
        var parts = path.split(separator: "/").map(String.init)
        if path.hasPrefix("/Volumes/"), parts.count > 1 {
            // /Volumes/Backup/Fotos → Backup › Fotos
            parts.removeFirst()
        } else {
            parts.insert(volume.name, at: 0)
        }
        components = parts
    }

    public var fileName: String { components.last ?? "" }

    /// Gekürzte Fassung mit höchstens `maxVisible` Elementen (inklusive „…").
    /// Anfang (Volume) und Ende (Ordner + Datei) bleiben immer sichtbar.
    public func shortened(maxVisible: Int = 5) -> [String] {
        guard maxVisible >= 3, components.count > maxVisible else { return components }
        let head = min(2, (maxVisible - 1) / 2)
        let tail = maxVisible - 1 - head
        return Array(components.prefix(head)) + [Self.ellipsis] + Array(components.suffix(tail))
    }

    public func display(maxVisible: Int = 5) -> String {
        shortened(maxVisible: maxVisible).joined(separator: Self.separator)
    }

    /// Voller Pfad für „Klick zeigt alles" und VoiceOver.
    public var fullDisplay: String { components.joined(separator: Self.separator) }
}
