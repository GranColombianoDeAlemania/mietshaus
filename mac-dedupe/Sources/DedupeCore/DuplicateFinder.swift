import Foundation

/// Eine Gruppe byte-identischer Dateien (100 % Ähnlichkeit).
public struct DuplicateGroup: Sendable, Identifiable {
    public let id: ContentDigest
    public let size: Int64
    /// Unterschiedliche physische Dateien (verschiedene Inodes), nach Pfad sortiert.
    public let files: [FileRecord]
    /// Weitere Pfade, die per Hardlink auf eine der `files` zeigen.
    /// Sie belegen keinen zusätzlichen Platz und werden nicht als Kopie gezählt.
    public let hardlinks: [FileRecord]

    /// Freigebbarer Platz, wenn genau eine Kopie behalten wird.
    /// APFS-Clones sind hier noch nicht berücksichtigt (ARCHITECTURE.md, offene Punkte).
    public var reclaimableBytes: Int64 { size * Int64(files.count - 1) }
}

public struct DuplicateScanStats: Sendable {
    public var filesConsidered = 0
    public var hardlinkAliases = 0
    public var candidatesAfterSize = 0
    public var candidatesAfterPartial = 0
    public var duplicateFiles = 0
    public var unreadableFiles = 0
    public var bytesHashedPartial: Int64 = 0
    public var bytesHashedFull: Int64 = 0
    public var durationSize: Duration = .zero
    public var durationPartial: Duration = .zero
    public var durationFull: Duration = .zero

    public var totalDuration: Duration { durationSize + durationPartial + durationFull }
}

/// Mehrstufige Suche nach exakten Duplikaten: Hardlinks zusammenfassen → Größe → Teil-Hash → Voll-Hash.
/// Jede Stufe schließt den Großteil der Kandidaten aus, bevor die teure nächste Stufe läuft.
public struct DuplicateFinder: Sendable {
    public var maxConcurrency: Int

    public init(maxConcurrency: Int = ProcessInfo.processInfo.activeProcessorCount) {
        self.maxConcurrency = max(1, maxConcurrency)
    }

    public func findDuplicates(in files: [FileRecord]) async throws -> (groups: [DuplicateGroup], stats: DuplicateScanStats) {
        let clock = ContinuousClock()
        var stats = DuplicateScanStats()
        stats.filesConsidered = files.count

        // Stufe 0+1: Hardlinks zusammenfassen und nach Größe gruppieren (ohne I/O).
        let sizeStart = clock.now
        var byInode: [InodeKey: [FileRecord]] = [:]
        for file in files where file.size > 0 {
            byInode[file.inodeKey, default: []].append(file)
        }
        var aliases: [InodeKey: [FileRecord]] = [:]
        var bySize: [Int64: [FileRecord]] = [:]
        for (key, records) in byInode {
            let sorted = records.sorted { $0.path < $1.path }
            bySize[sorted[0].size, default: []].append(sorted[0])
            if sorted.count > 1 {
                aliases[key] = Array(sorted.dropFirst())
                stats.hardlinkAliases += sorted.count - 1
            }
        }
        let sizeCandidates = bySize.values.filter { $0.count > 1 }.flatMap { $0 }
        stats.candidatesAfterSize = sizeCandidates.count
        stats.durationSize = clock.now - sizeStart

        // Stufe 2: Teil-Hash (Anfang + Ende).
        let partialStart = clock.now
        let partials = try await concurrentCompactMap(sizeCandidates, maxConcurrency: maxConcurrency) { record -> Hashed? in
            guard let digest = try? ContentHasher.partialDigest(path: record.path, size: record.size) else { return nil }
            return Hashed(record: record, digest: digest)
        }
        stats.unreadableFiles += sizeCandidates.count - partials.count
        stats.bytesHashedPartial = partials.reduce(0) { $0 + min($1.record.size, Int64(2 * ContentHasher.partialChunkSize)) }

        var byPartial: [SizeAndDigest: [FileRecord]] = [:]
        for hashed in partials {
            byPartial[SizeAndDigest(size: hashed.record.size, digest: hashed.digest), default: []].append(hashed.record)
        }
        var final: [ContentDigest: [FileRecord]] = [:]
        var needFull: [FileRecord] = []
        for (key, records) in byPartial where records.count > 1 {
            if ContentHasher.partialCoversWholeFile(size: key.size) {
                final[key.digest] = records // Teil-Hash hat bereits alles gelesen
            } else {
                needFull.append(contentsOf: records)
            }
        }
        stats.candidatesAfterPartial = needFull.count + final.values.reduce(0) { $0 + $1.count }
        stats.durationPartial = clock.now - partialStart

        // Stufe 3: Voll-Hash nur für die verbliebenen Kandidaten.
        let fullStart = clock.now
        let fulls = try await concurrentCompactMap(needFull, maxConcurrency: maxConcurrency) { record -> FullHashed? in
            guard let result = try? ContentHasher.fullDigest(path: record.path) else { return nil }
            return FullHashed(record: record, digest: result.digest, bytesRead: result.bytesRead)
        }
        stats.unreadableFiles += needFull.count - fulls.count
        for hashed in fulls {
            final[hashed.digest, default: []].append(hashed.record)
            stats.bytesHashedFull += hashed.bytesRead
        }
        stats.durationFull = clock.now - fullStart

        let groups = final.compactMap { digest, records -> DuplicateGroup? in
            guard records.count > 1 else { return nil }
            let sorted = records.sorted { $0.path < $1.path }
            return DuplicateGroup(
                id: digest,
                size: sorted[0].size,
                files: sorted,
                hardlinks: sorted.flatMap { aliases[$0.inodeKey] ?? [] }
            )
        }
        .sorted { $0.reclaimableBytes != $1.reclaimableBytes ? $0.reclaimableBytes > $1.reclaimableBytes : $0.files[0].path < $1.files[0].path }

        stats.duplicateFiles = groups.reduce(0) { $0 + $1.files.count }
        return (groups, stats)
    }
}

private struct Hashed: Sendable {
    let record: FileRecord
    let digest: ContentDigest
}

private struct FullHashed: Sendable {
    let record: FileRecord
    let digest: ContentDigest
    let bytesRead: Int64
}

private struct SizeAndDigest: Hashable {
    let size: Int64
    let digest: ContentDigest
}
