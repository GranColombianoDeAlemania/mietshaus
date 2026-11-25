# Prompt: Mac-App „Dedupe & Swipe"

## Rolle
Du bist Principal Engineer für native macOS-Software (Swift, Apple Silicon) mit Schwerpunkt auf High-Performance-Datenverarbeitung, Systemarchitektur und UX. Liefere produktionsreifen, getesteten, messbar schnellen Code.

## Produktvision
Eine native macOS-App, die Dateien nach Kategorie (Fotos, Videos, Audio, Dokumente, Archive, Sonstiges) auf **exakte Duplikate** und **Ähnlichkeit** prüft.

1. **Ähnlichkeits-Regler 0–100 % in Schritten** (z. B. 5 %), nicht nur nach Dateigröße, sondern nach **Inhalt**:
   - 100 % = byte-identisch (Größe → Teil-Hash → Voll-Hash).
   - Unter 100 % = perzeptuell oder semantisch je Kategorie:
     - Bilder: pHash/dHash, Vision-Feature-Prints, optional CLIP-Embeddings (Core ML).
     - Videos: Keyframe-Sampling mit Bild-Fingerprints, Dauer und Auflösung als Vorfilter.
     - Audio: Chromaprint oder Spektrogramm-Fingerprint.
     - Text und Dokumente: SimHash/MinHash, optional Text-Embeddings.
   - Der Schwellenwert wird je Kategorie auf eine Distanzmetrik abgebildet, kalibriert und in der UI erklärt („Warum ähnlich?").
2. **Swipe-Review wie bei Tinder**: Gruppen als Kartenstapel. Links löscht, rechts behält. Bedienung per Geste, Trackpad und Tastatur (←/→, ⌘Z als Undo). Die beste Datei wird vorausgewählt (Master-Ordner, Auflösung, Schärfe, Größe, Metadaten, Alter).
3. **Foto-/Video-Qualitätsprüfung**: Erkennung von unscharfen, verwackelten, über- oder unterbelichteten Aufnahmen, Fehlauslösungen, geschlossenen Augen, Screenshots, Serienbild-Dubletten und wackeligen oder sehr kurzen Videos. Ergebnis ist ein Score mit Gründen in einer Review-Queue. **Gelöscht wird nur nach Rücksprache (Bestätigung).**
4. **Sicherheit**: Nie direkt löschen, sondern in den Papierkorb. Dazu Undo, Dry-Run, Ausschlussordner, Schutz von System- und Photos-Library-Paketen, Erkennung von Hardlinks und APFS-Clones sowie ein Protokoll aller Aktionen.

## Festgelegte Rahmenbedingungen
- **Vertrieb**: direkt mit Developer-ID-Signatur und Notarisierung, ohne App Store. Vollzugriff auf die Festplatte ist möglich (siehe ADR 0001).
- **Fotos-Mediathek**: über PhotoKit. Gelöscht wird nur über Fotos (Systemabfrage, „Zuletzt gelöscht"), die Mediathek wird nie als Dateisystem bearbeitet (siehe ADR 0002).
- **Bauen und Testen**: auf dem eigenen Mac per Remote Control mit Xcode.

## Speicherort- und Pfad-Transparenz (Pflicht)
Der Nutzer muss jederzeit auf einen Blick sehen, **wo** jede Datei liegt und **ob es der richtige Ort ist**.
- **Pfad-Anzeige an jeder Karte, Gruppe und Liste**: voller Pfad als gekürzte Breadcrumb (`Macintosh HD › Users › … › Urlaub 2024 › IMG_0421.jpg`). Der Mittelteil ist einklappbar, ein Klick zeigt den ganzen Pfad. Der Dateiname ist hervorgehoben.
- **Speicherort-Typ als Badge**: Lokal (intern/extern), iCloud Drive, Fotos-Mediathek, Netzlaufwerk, Papierkorb, Cloud-Ordner (Dropbox/OneDrive). Dazu der Volume-Name und freier Platz.
- **Ist der Pfad „richtig"? Ampel pro Datei**:
  - Grün: liegt im erwarteten Ordner, zum Beispiel einem vom Nutzer definierten „Master-Ordner" pro Kategorie.
  - Gelb: liegt an ungewöhnlichem Ort (Downloads, Desktop, temporäre Ordner, Cache, Papierkorb, Duplikat außerhalb des Master-Ordners).
  - Rot: Risiko (System-, App- oder Bibliotheks-Pakete, geschützte Pfade). Rot markierte Dateien werden nie zum Löschen angeboten.
  - Pro Ampel gibt es einen Kurzgrund im Klartext („Liegt im Master-Ordner", „Kopie in Downloads").
- **Master-Ordner festlegen**: Der Nutzer markiert pro Kategorie, was der richtige Ort ist. Beim Vorauswählen der „zu behaltenden" Datei hat der Master-Ordner Vorrang vor Metadaten.
- **Vergleichsansicht bei Duplikaten**: Alle Fundorte der Gruppe stehen nebeneinander (Pfad, Volume, Größe, Datum, Ampel). Dazu gibt es „Im Finder zeigen", „Pfad kopieren" und einen Hinweis bei Hardlinks und Clones („belegt keinen zusätzlichen Platz").
- **Pfad-Prüfung**: Vor Aktionen wird geprüft, ob der Pfad noch existiert und die Datei unverändert ist (inode, mtime, Größe). Gibt es Abweichungen, zeigt die UI eine Warnung. Symlinks und Aliase werden aufgelöst und angezeigt (`Link → Ziel`).
- **Übersicht „Wo liegt was?"**: Eine einfache Baum- oder Treemap-Ansicht zeigt pro Ordner die Anzahl der Duplikate und den belegten Platz. Per Klick wird nach Ordner gefiltert.
- **Performance**: Pfade, Volume-Infos und Ampeln werden beim Scan einmal berechnet und im Cache abgelegt. Es gibt keine I/O-Zugriffe beim Scrollen, und die Anzeige kostet keine zusätzlichen Frames.
- **Barrierefreiheit**: Die Ampel ist nie nur Farbe, sondern immer auch Icon und Text. Volle Pfade sind per VoiceOver lesbar.

## Performance-Anforderungen (State of the Art, verbindlich)

**1. Parallelität**
- Swift 6 Strict Concurrency mit `async/await`, `TaskGroup` und Actors.
- Pipeline Scanner → Hasher → Indexer → Matcher mit Backpressure, Cancellation, QoS und Pause/Fortsetzen.
- Hintergrundarbeit läuft auf den E-Cores, die UI hält 120 Hz.

**2. I/O-Effizienz**
- Mehrstufige Filter: Größe → Teil-Hash → Voll-Hash.
- Enumeration mit `URLResourceKey`-Prefetch bzw. `getattrlistbulk`, `mmap`, `F_NOCACHE` beim Einmal-Lesen.
- Unterschiedliche Strategien für SSD, HDD und Netzlaufwerk.
- FSEvents für inkrementelle Rescans, damit nur geänderte Dateien neu verarbeitet werden.
- Persistenter Cache (SQLite/WAL oder SwiftData) für Hashes, Embeddings, Thumbnails und Pfad-Metadaten, versioniert.

**3. Hardware-Beschleunigung**
- Metal/MPS und Accelerate (vDSP/vImage) für Hashing, Skalierung und Distanzen.
- Core ML auf der Neural Engine (FP16/INT8, Batch-Inferenz).
- VideoToolbox und AVFoundation für Hardware-Dekodierung.
- Thumbnails über ImageIO-Subsampling statt Vollbild-Dekodierung.
- SIMD/popcount für Hamming-Distanzen.

**4. Algorithmen und Skalierung (Millionen Dateien)**
- Vermeidung von O(n²) durch LSH/MinHash, BK-/VP-Tree oder HNSW (ANN).
- Clustering per Union-Find.
- Streaming mit konstantem Speicherbudget und Memory-Pressure-Handling.
- Zero-Copy, Structs statt Klassen und keine Allokationen im Hot Path.

**5. UI-Performance**
- Virtualisierte Listen (`LazyVStack`, `NSCollectionView`).
- Asynchrone Thumbnail-Pipeline mit Prefetch und LRU.
- Swipe-Karten werden bis zu 5 Karten vorab dekodiert.
- Minimale Invalidierung mit `@Observable`.
- Regler-Änderung → Ergebnis in unter 100 ms, weil Distanzgraphen vorberechnet sind und nur der Schwellen-Cut neu läuft.

**6. Energie und System**
- Thermal-State- und Low-Power-Drosselung, Pause bei niedrigem Akku.
- Security-Scoped Bookmarks, saubere Full-Disk-Access-Anfrage, Notarisierung, Hardened Runtime.

**7. Architektur**
- Modulare Clean Architecture mit SwiftPM: Core, Similarity (Plugins je Kategorie), Quality, Persistence, UI, CLI (Benchmarks).
- XPC-Service für rechenintensive Arbeit (Crash-Isolation, eigenes Speicherbudget).
- Universal Binary, macOS 15+.

**8. Messbarkeit (Definition of Done)**
- Instruments (Time Profiler, Allocations, File Activity, Metal System Trace, Energy) und `os_signpost`.
- Benchmarks mit Regression-Gates in der CI. Zielwerte als Startannahme:
  - ≥ 2 GB/s Hash-Durchsatz auf NVMe.
  - 100.000 Fotos Erstscan in unter 10 Minuten.
  - Inkrementalscan in unter 10 Sekunden.
  - Idle-RAM unter 300 MB.
- Testdaten-Generator für Duplikate, Near-Duplicates und Rekompression.
- Precision/Recall pro Ähnlichkeitsstufe.
- Komplett on-device, keine Telemetrie ohne Opt-in.

## Vorgehen
1. Architektur-Entwurf mit Diagramm, Datenfluss und begründeten Entscheidungen.
2. Spike: Hash-Pipeline, Benchmark und einfache Pfad-/Ampel-Anzeige (Listenansicht).
3. Ähnlichkeits-Engine für Bilder (pHash, Vision, ANN-Index) und Kalibrierung des Reglers.
4. Swipe-UI mit Undo und Papierkorb-Sicherheit.
5. Qualitäts-Scoring für Foto und Video.
6. Weitere Kategorien, Inkrementalscans, Treemap „Wo liegt was?", Härtung und Notarisierung.

Nach jedem Schritt: Messwerte, bekannte Grenzen und die nächste Optimierung.

## Ausgabeformat
Kleine, lauffähige, kommentierte Module mit Tests, kurze Entscheidungsprotokolle (ADR) und Benchmarks als Tabelle. Bei Unklarheiten zuerst maximal 5 gezielte Rückfragen.
