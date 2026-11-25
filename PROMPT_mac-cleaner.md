# Prompt: Mac-App „Dedupe & Swipe" – Duplikat-, Ähnlichkeits- und Foto-Qualitätsprüfung

## Rolle
Du bist Principal Engineer für native macOS-Software (Swift, Apple Silicon) mit Schwerpunkt auf High-Performance-Datenverarbeitung, Systemarchitektur und UX. Liefere produktionsreifen, getesteten, messbar schnellen Code.

## Produktvision
Eine native macOS-App, die Dateien nach Kategorie (Fotos, Videos, Audio, Dokumente, Archive, Code/Sonstiges) auf **exakte Duplikate** und **Ähnlichkeit** prüft.

1. **Ähnlichkeits-Schieberegler 0–100 % in Schritten** (z. B. 5 %), nicht nur Dateigröße, sondern **Inhalt**:
   - 100 % = byte-identisch (Größe → Teil-Hash → Voll-Hash BLAKE3/xxHash3).
   - <100 % = perzeptuell/semantisch je Kategorie:
     - Bilder: pHash/dHash + Vision-Feature-Prints (`VNGenerateImageFeaturePrintRequest`), optional CLIP-Embeddings (Core ML).
     - Videos: Keyframe-Sampling + Bild-Fingerprints, Dauer/Auflösung als Vorfilter.
     - Audio: Chromaprint/Spektrogramm-Fingerprint.
     - Text/Dokumente: SimHash/MinHash, optional Text-Embeddings (NaturalLanguage).
   - Der Schwellenwert wird auf eine Distanzmetrik je Kategorie abgebildet, kalibriert und in der UI erklärt („Warum ähnlich?“).
2. **Swipe-Review à la Tinder**: Gruppen als Kartenstapel; **links = löschen, rechts = behalten**, per Geste, Trackpad und Tastatur (←/→, Undo ⌘Z). Beste Datei wird vorausgewählt (Auflösung, Schärfe, Größe, Metadaten, Alter). Stapelverarbeitung, Fortschritt, Gamification optional.
3. **Foto-/Video-Qualitätsprüfung**: Erkennung schlechter Medien – unscharf/Bewegungsunschärfe, Über-/Unterbelichtung, Fehlauslösungen (Finger/Linse/Boden/Tasche), geschlossene Augen, Screenshots/Belege, Serienbild-Dubletten, wackelige/sehr kurze Videos. Ergebnis als **Score + Gründe**, Review-Queue, **Löschen nur nach Bestätigung**.
4. **Sicherheit**: Nie direkt löschen – `NSWorkspace.recycle`/Papierkorb, Undo, Dry-Run, Ausschlussordner, Schutz von System-/iCloud-/Photos-Library-Paketen, Hardlink-/APFS-Clone-Erkennung (kein Scheinspeicher-Gewinn), Protokoll aller Aktionen.

## Performance-Anforderungen (State of the Art, verbindlich)

### 1. Parallelität & Concurrency
- Swift 6 Strict Concurrency, `async/await`, `TaskGroup`, Actors; keine Data Races.
- Pipeline-Architektur (Producer → Hasher → Indexer → Matcher) mit **Backpressure**, Cancellation, Priorisierung (QoS), Pausieren/Fortsetzen.
- Nutzung aller P-/E-Cores; Hintergrundarbeit auf E-Cores, UI bleibt <16 ms/Frame (120 Hz ProMotion).

### 2. I/O-Effizienz
- Mehrstufige Filterung: **Größe → erste/letzte 4–64 KB-Hash → Voll-Hash** (spart >95 % I/O).
- `FileManager`-Enumeration mit `URLResourceKey`-Prefetch, `getattrlistbulk`/`fts`, `mmap`, `F_NOCACHE` für Einmal-Lesen, gebatchte `read` mit Alignment, Rücksicht auf SSD vs. HDD vs. Netzwerk-Volumes.
- FSEvents für **inkrementelle** Rescans; nur geänderte Dateien (inode, mtime, size) neu verarbeiten.
- Persistenter Cache (SQLite/GRDB WAL oder SwiftData/LMDB) für Hashes, Embeddings, Thumbnails; versioniert und invalidierbar.

### 3. Hardware-Beschleunigung
- **Metal / Metal Performance Shaders** und **Accelerate (vDSP/vImage/BNNS)** für Hashing, Bildskalierung, Distanzberechnung.
- **Core ML + Apple Neural Engine** für Embeddings und Qualitätsmodelle (Quantisierung FP16/INT8, Batch-Inferenz, Compute-Units konfigurierbar).
- Hardware-Dekodierung via VideoToolbox/AVFoundation; Thumbnails über `CGImageSource` mit `kCGImageSourceThumbnailMaxPixelSize` statt Vollbild-Dekodierung; ImageIO-Subsampling.
- SIMD-Intrinsics für Hamming-Distanz (popcount).

### 4. Algorithmen & Skalierung (Millionen Dateien)
- Vermeidung von O(n²): **LSH/MinHash, BK-Tree, VP-Tree, HNSW (ANN-Index)** für Vektor-Nachbarschaftssuche; Clustering via Union-Find/Connected Components.
- Streaming/Chunking, konstante Speichergrenze (z. B. <1–2 GB), Memory-Pressure-Handling, `autoreleasepool` in Schleifen.
- Zero-Copy wo möglich (`Data` mit `bytesNoCopy`, `UnsafeBufferPointer`), Vermeidung von Heap-Allokationen im Hot Path, Structs statt Klassen, `ContiguousArray`.

### 5. UI-Performance (SwiftUI/AppKit)
- Virtualisierte Listen (`LazyVStack`, `NSCollectionView`), asynchrone Thumbnail-Pipeline mit Prefetching, LRU-Cache, Prioritätswechsel beim Scrollen.
- Swipe-Karten Metal-/Core-Animation-beschleunigt, Vorab-Dekodierung der nächsten 3–5 Karten, `@Observable` mit minimalen Invalidierungen, Debounce beim Schieberegler (Neuberechnung nur auf dem Index, nicht neu hashen).
- Slider-Änderung → Ergebnis **< 100 ms** durch vorberechnete Distanzgraphen/Schwellen-Cuts.

### 6. Energie, Thermik, Systemverträglichkeit
- Energy-Impact-Budget, Thermal-State-Beobachtung (`ProcessInfo.thermalState`), Low-Power-Mode-Drosselung, Pause bei Akku <20 %.
- Sandbox, Security-Scoped Bookmarks, Full-Disk-Access sauber anfordern, Notarisierung, Hardened Runtime.

### 7. Architektur
- Modulare Clean Architecture: `Core` (Scanner, Hasher, Index), `Similarity` (Plugins je Kategorie), `Quality` (Modelle), `Persistence`, `UI`, `CLI` (headless Benchmarks). Swift Package Manager, Protokoll-orientierte Plugins.
- XPC-Service/Helper für isolierte, rechenintensive Arbeit (Crash-Isolation, eigenes Speicherbudget).
- Universal Binary (arm64 primär, x86_64 Fallback), macOS 15+ Zielplattform, Feature-Flags.

### 8. Messbarkeit & Qualität (Definition of Done)
- Benchmarks (XCTest `measure`, `swift-benchmark`), Profiling mit **Instruments** (Time Profiler, Allocations, File Activity, Metal System Trace, Energy Log) und `os_signpost`.
- Performance-Budgets in CI (Regression-Gates): Zielwerte z. B. ≥ 2 GB/s Hash-Durchsatz auf NVMe, 100 000 Fotos Erstscan < 10 min, Inkrementalscan < 10 s, Slider < 100 ms, Idle-RAM < 300 MB.
- Testdaten-Generator (synthetische Duplikate, Near-Duplicates, Rauschen, Rotation, Rekompression), Precision/Recall-Auswertung je Ähnlichkeitsstufe, Property-Based-Tests.
- Datenschutz: komplett **on-device**, keine Telemetrie ohne Opt-in.

## Vorgehen (bitte in dieser Reihenfolge)
1. Architektur-Entwurf mit Diagramm, Datenfluss, Schnittstellen und begründeten Technologieentscheidungen (inkl. Alternativen).
2. Spike: Hash-Pipeline + Benchmark (exakte Duplikate), Messwerte vorlegen.
3. Ähnlichkeits-Engine Bilder (pHash + Vision + ANN-Index), Kalibrierung Slider ↔ Distanz.
4. Swipe-UI mit Undo/Papierkorb-Sicherheit.
5. Qualitäts-Scoring Foto/Video.
6. Weitere Kategorien, Inkrementalscans (FSEvents), Härtung, Notarisierung.
Nach jedem Schritt: Messwerte, bekannte Grenzen, nächste Optimierung.

## Ausgabeformat
Code in kleinen, lauffähigen, kommentierten Modulen; Tests; kurze Entscheidungsprotokolle (ADR); Benchmarks als Tabelle. Bei Unklarheiten zuerst max. 5 gezielte Rückfragen.
