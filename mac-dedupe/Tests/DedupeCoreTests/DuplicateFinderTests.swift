import Foundation
import Testing
@testable import DedupeCore

/// Legt echte Dateien in einem temporären Ordner an und prüft die gesamte Pipeline.
@Suite("Exakte Duplikate")
struct DuplicateFinderTests {
    let root: URL

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dedupe-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func write(_ name: String, _ data: Data) throws -> URL {
        let url = root.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
        return url
    }

    static func randomData(_ count: Int, seed: UInt64) -> Data {
        var state = seed
        var data = Data(count: count)
        for i in 0..<count {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            data[i] = UInt8(truncatingIfNeeded: state >> 33)
        }
        return data
    }

    @Test func findsDuplicatesAndIgnoresLookalikes() async throws {
        defer { try? FileManager.default.removeItem(at: root) }
        let big = Self.randomData(300_000, seed: 1) // größer als 2 × 64 KiB → Voll-Hash nötig
        var middleChanged = big
        middleChanged[150_000] ^= 0xFF // gleiche Größe, gleicher Anfang/Ende, anderer Inhalt
        let small = Self.randomData(1_000, seed: 2)

        let a = try write("a/foto.jpg", big)
        _ = try write("b/foto-kopie.jpg", big)
        _ = try write("c/fast-gleich.jpg", middleChanged)
        _ = try write("d/klein.txt", small)
        _ = try write("e/klein-kopie.txt", small)
        _ = try write("f/leer.txt", Data()) // leere Dateien zählen nicht
        _ = try write("g/leer2.txt", Data())
        try FileManager.default.linkItem(at: a, to: root.appendingPathComponent("a/hardlink.jpg"))

        let scan = try FileScanner.scan(ScanOptions(roots: [root]))
        let (groups, stats) = try await DuplicateFinder(maxConcurrency: 2).findDuplicates(in: scan.files)

        let names = groups.map { Set($0.files.map { URL(fileURLWithPath: $0.path).lastPathComponent }) }
        #expect(groups.count == 2)
        #expect(names.contains(["foto.jpg", "foto-kopie.jpg"]) || names.contains(["hardlink.jpg", "foto-kopie.jpg"]))
        #expect(names.contains(["klein.txt", "klein-kopie.txt"]))
        #expect(!names.contains { $0.contains("fast-gleich.jpg") })

        let bigGroup = try #require(groups.first { $0.size == Int64(big.count) })
        #expect(bigGroup.hardlinks.count == 1)
        #expect(bigGroup.reclaimableBytes == Int64(big.count)) // Hardlink zählt nicht als Kopie
        #expect(stats.hardlinkAliases == 1)
        #expect(stats.bytesHashedFull >= Int64(3 * big.count)) // a, b und die Lookalike-Datei
    }

    @Test func verifyDetectsChanges() throws {
        defer { try? FileManager.default.removeItem(at: root) }
        let url = try write("x.txt", Data("eins".utf8))
        let record = try #require(FileRecord.stat(path: url.path(percentEncoded: false)))
        #expect(record.verify() == .unchanged)

        try Data("zwei!".utf8).write(to: url)
        #expect(record.verify() != .unchanged)

        try FileManager.default.removeItem(at: url)
        #expect(record.verify() == .missing)
    }
}

@Suite("Vorauswahl und sicheres Löschen")
struct KeeperAndDeleterTests {
    let internalDisk = VolumeInfo(name: "Macintosh HD", isInternal: true, isLocal: true)

    func record(_ path: String, age: TimeInterval) -> FileRecord {
        FileRecord(path: path, size: 10, modified: Date(timeIntervalSince1970: 1_000_000 - age), device: 1, inode: UInt64(path.hashValue.magnitude), linkCount: 1)
    }

    @Test func masterFolderWinsOverAge() {
        let classifier = LocationClassifier(homeDirectory: "/Users/anna", masterFolders: [.photo: "/Users/anna/Pictures"])
        let older = record("/Users/anna/Downloads/a.jpg", age: 1000)
        let master = record("/Users/anna/Pictures/a.jpg", age: 0)
        let group = DuplicateGroup(id: try! ContentDigestFixture.make(), size: 10, files: [older, master], hardlinks: [])
        let verdicts = Dictionary(uniqueKeysWithValues: group.files.map {
            ($0.path, classifier.classify(path: $0.path, category: $0.category, volume: internalDisk))
        })
        let proposal = KeeperPolicy().propose(for: group, verdicts: verdicts)
        #expect(proposal.keep.map(\.path) == [master.path])
        #expect(proposal.deleteCandidates.map(\.path) == [older.path])
    }

    @Test func lockedFilesAreNeverOffered() {
        let classifier = LocationClassifier(homeDirectory: "/Users/anna")
        let system = record("/Library/Desktop Pictures/a.jpg", age: 0)
        let copy = record("/Users/anna/Desktop/a.jpg", age: 0)
        let group = DuplicateGroup(id: try! ContentDigestFixture.make(), size: 10, files: [system, copy], hardlinks: [])
        let verdicts = Dictionary(uniqueKeysWithValues: group.files.map {
            ($0.path, classifier.classify(path: $0.path, category: $0.category, volume: internalDisk))
        })
        let proposal = KeeperPolicy().propose(for: group, verdicts: verdicts)
        #expect(proposal.keep.map(\.path) == [system.path])
        #expect(proposal.deleteCandidates.map(\.path) == [copy.path])

        #expect(throws: DeletionError.self) {
            try SafeDeleter(dryRun: true).moveToTrash(system, verdict: verdicts[system.path]!)
        }
    }

    @Test func dryRunKeepsFile() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("dedupe-dry-\(UUID().uuidString).txt")
        try Data("inhalt".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let file = try #require(FileRecord.stat(path: url.path(percentEncoded: false)))
        let verdict = LocationVerdict(kind: .internalDisk, light: .yellow, reason: "Test", isInMasterFolder: false)

        let receipt = try SafeDeleter(dryRun: true).moveToTrash(file, verdict: verdict)
        #expect(receipt.dryRun)
        #expect(receipt.trashedPath == nil)
        #expect(FileManager.default.fileExists(atPath: file.path))
    }
}

/// Erzeugt einen beliebigen Digest für Gruppen in Unit-Tests.
enum ContentDigestFixture {
    static func make() throws -> ContentDigest {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("dedupe-digest-\(UUID().uuidString)")
        try Data("x".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        return try ContentHasher.fullDigest(path: url.path(percentEncoded: false)).digest
    }
}
