import Foundation

/// Vorschlag für eine Duplikatgruppe: was behalten, was zum Löschen anbieten.
/// Der Nutzer entscheidet am Ende per Swipe; das hier ist nur die Vorauswahl.
public struct KeepProposal: Sendable {
    public let keep: [FileRecord]
    public let deleteCandidates: [FileRecord]
}

public struct KeeperPolicy: Sendable {
    public init() {}

    /// Reihenfolge der Kriterien:
    /// 1. Im Master-Ordner
    /// 2. Bessere Ampel (grün vor gelb)
    /// 3. Ältere Datei (wahrscheinlich das Original)
    /// 4. Kürzerer Pfad, dann alphabetisch (stabile Reihenfolge)
    public func rank(_ files: [FileRecord], verdicts: [String: LocationVerdict]) -> [FileRecord] {
        files.sorted { a, b in
            let va = verdicts[a.path], vb = verdicts[b.path]
            let ma = va?.isInMasterFolder ?? false, mb = vb?.isInMasterFolder ?? false
            if ma != mb { return ma }
            let la = va?.light ?? .yellow, lb = vb?.light ?? .yellow
            if la != lb { return la < lb }
            if a.modified != b.modified { return a.modified < b.modified }
            if a.path.count != b.path.count { return a.path.count < b.path.count }
            return a.path < b.path
        }
    }

    /// Rot markierte Dateien werden immer behalten und nie angeboten.
    /// Gibt es keine geschützte Kopie, wird die bestplatzierte behalten.
    public func propose(for group: DuplicateGroup, verdicts: [String: LocationVerdict]) -> KeepProposal {
        let locked = group.files.filter { verdicts[$0.path]?.isLocked == true }
        let free = rank(group.files.filter { verdicts[$0.path]?.isLocked != true }, verdicts: verdicts)
        if !locked.isEmpty {
            return KeepProposal(keep: locked, deleteCandidates: free)
        }
        return KeepProposal(keep: Array(free.prefix(1)), deleteCandidates: Array(free.dropFirst()))
    }
}
