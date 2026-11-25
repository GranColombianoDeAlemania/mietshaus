import DedupeCore
import Foundation

/// Spike-Werkzeug: scannt Ordner, findet exakte Duplikate und zeigt pro Datei
/// Speicherort, Ampel und Vorschlag. Löscht nichts.
///
///     swift run -c release dedupe-cli ~/Pictures ~/Downloads --master photo=~/Pictures/Archiv
@main
struct DedupeCLI {
    static func main() async {
        do {
            let arguments = try Arguments.parse(Array(CommandLine.arguments.dropFirst()))
            try await run(arguments)
        } catch let error as Arguments.Error {
            FileHandle.standardError.write(Data("Fehler: \(error.message)\n\n\(Arguments.usage)\n".utf8))
            exit(2)
        } catch {
            FileHandle.standardError.write(Data("Fehler: \(error)\n".utf8))
            exit(1)
        }
    }

    static func run(_ arguments: Arguments) async throws {
        let clock = ContinuousClock()
        let scanStart = clock.now
        let scan = try FileScanner.scan(ScanOptions(
            roots: arguments.roots,
            excludedPaths: arguments.excluded,
            minimumSize: arguments.minimumSize
        ))
        let scanDuration = clock.now - scanStart

        let (groups, stats) = try await DuplicateFinder().findDuplicates(in: scan.files)

        let classifier = LocationClassifier(masterFolders: arguments.masterFolders)
        let volumes = VolumeCache()
        let policy = KeeperPolicy()

        print("Benchmark")
        print(Table.render([
            ["Stufe", "Dateien danach", "Gelesen", "Zeit", "Durchsatz"],
            ["Verzeichnis-Scan", "\(scan.files.count)", "–", format(scanDuration), "–"],
            ["Größenfilter", "\(stats.candidatesAfterSize)", "–", format(stats.durationSize), "–"],
            ["Teil-Hash", "\(stats.candidatesAfterPartial)", bytes(stats.bytesHashedPartial), format(stats.durationPartial), throughput(stats.bytesHashedPartial, stats.durationPartial)],
            ["Voll-Hash", "\(stats.duplicateFiles)", bytes(stats.bytesHashedFull), format(stats.durationFull), throughput(stats.bytesHashedFull, stats.durationFull)],
        ]))
        print("Symlinks übersprungen: \(scan.skippedSymlinks) · Hardlinks zusammengefasst: \(stats.hardlinkAliases) · nicht lesbar: \(scan.unreadableEntries + stats.unreadableFiles)")
        let reclaimable = groups.reduce(Int64(0)) { $0 + $1.reclaimableBytes }
        print("Duplikatgruppen: \(groups.count) · freigebbar: \(bytes(reclaimable))\n")

        for (index, group) in groups.prefix(arguments.limit).enumerated() {
            var verdicts: [String: LocationVerdict] = [:]
            for file in group.files {
                verdicts[file.path] = classifier.classify(path: file.path, category: file.category, volume: volumes.info(for: file))
            }
            let proposal = policy.propose(for: group, verdicts: verdicts)
            let keep = Set(proposal.keep.map(\.path))

            print("[\(index + 1)] \(group.files.count) × \(bytes(group.size)) · freigebbar \(bytes(group.reclaimableBytes)) · \(group.files[0].category.displayName)")
            for file in group.files {
                let verdict = verdicts[file.path]!
                let volume = volumes.info(for: file)
                let action = verdict.isLocked ? "geschützt" : (keep.contains(file.path) ? "behalten " : "löschen? ")
                print("    \(lightMarker(verdict.light)) \(action) \(Breadcrumb(path: file.path, volume: volume).display())")
                print("        \(verdict.kind.label) · \(verdict.reason)")
            }
            for alias in group.hardlinks {
                print("    ↔ Hardlink (belegt keinen Platz): \(alias.path)")
            }
            print("")
        }
        if groups.count > arguments.limit {
            print("… \(groups.count - arguments.limit) weitere Gruppen (--limit erhöhen)")
        }
    }

    static func lightMarker(_ light: TrafficLight) -> String {
        switch light {
        case .green: "[GRÜN]"
        case .yellow: "[GELB]"
        case .red: "[ROT] "
        }
    }

    static func seconds(_ d: Duration) -> Double {
        Double(d.components.seconds) + Double(d.components.attoseconds) / 1e18
    }

    static func format(_ d: Duration) -> String {
        String(format: "%.3f s", seconds(d))
    }

    static func bytes(_ count: Int64) -> String {
        count.formatted(.byteCount(style: .file))
    }

    static func throughput(_ count: Int64, _ d: Duration) -> String {
        let s = seconds(d)
        guard s > 0, count > 0 else { return "–" }
        return "\(Int64(Double(count) / s).formatted(.byteCount(style: .file)))/s"
    }
}

struct Arguments {
    struct Error: Swift.Error { let message: String }

    var roots: [URL] = []
    var excluded: [String] = []
    var masterFolders: [FileCategory: String] = [:]
    var minimumSize: Int64 = 1
    var limit = 20

    static let usage = """
    Aufruf: dedupe-cli <ordner> [<ordner> …] [Optionen]
      --master <kategorie>=<ordner>   Master-Ordner (photo, video, audio, document, archive, other)
      --exclude <ordner>              Ordner überspringen (mehrfach möglich)
      --min-size <bytes>              kleinere Dateien ignorieren (Standard 1)
      --limit <n>                     höchstens n Gruppen ausgeben (Standard 20)
    """

    static func parse(_ args: [String]) throws -> Arguments {
        var result = Arguments()
        var iterator = args.makeIterator()
        func value(for flag: String) throws -> String {
            guard let v = iterator.next() else { throw Error(message: "\(flag) braucht einen Wert") }
            return v
        }
        while let arg = iterator.next() {
            switch arg {
            case "--master":
                let spec = try value(for: arg)
                let parts = spec.split(separator: "=", maxSplits: 1).map(String.init)
                guard parts.count == 2, let category = FileCategory(rawValue: parts[0]) else {
                    throw Error(message: "--master erwartet z. B. photo=/Users/ich/Bilder")
                }
                result.masterFolders[category] = expand(parts[1])
            case "--exclude":
                result.excluded.append(expand(try value(for: arg)))
            case "--min-size":
                guard let n = Int64(try value(for: arg)), n >= 0 else { throw Error(message: "--min-size erwartet eine Zahl") }
                result.minimumSize = n
            case "--limit":
                guard let n = Int(try value(for: arg)), n > 0 else { throw Error(message: "--limit erwartet eine positive Zahl") }
                result.limit = n
            case "-h", "--help":
                print(usage)
                exit(0)
            default:
                if arg.hasPrefix("-") { throw Error(message: "Unbekannte Option \(arg)") }
                result.roots.append(URL(fileURLWithPath: expand(arg)))
            }
        }
        guard !result.roots.isEmpty else { throw Error(message: "Mindestens einen Ordner angeben") }
        return result
    }

    static func expand(_ path: String) -> String {
        let expanded = (path as NSString).expandingTildeInPath
        return URL(fileURLWithPath: expanded).standardizedFileURL.path(percentEncoded: false)
    }
}

enum Table {
    static func render(_ rows: [[String]]) -> String {
        guard let header = rows.first else { return "" }
        let widths = header.indices.map { column in rows.map { $0[column].count }.max() ?? 0 }
        func line(_ row: [String]) -> String {
            "| " + row.enumerated().map { $1.padding(toLength: widths[$0], withPad: " ", startingAt: 0) }.joined(separator: " | ") + " |"
        }
        let divider = "|" + widths.map { String(repeating: "-", count: $0 + 2) }.joined(separator: "|") + "|"
        return ([line(header), divider] + rows.dropFirst().map(line)).joined(separator: "\n")
    }
}
