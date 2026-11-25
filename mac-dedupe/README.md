# Dedupe & Swipe (macOS)

Native Mac-App, die Duplikate und ähnliche Dateien findet, schlechte Fotos und Videos erkennt und das Aufräumen per Swipe erlaubt (links löschen, rechts behalten). Für jede Datei zeigt sie, wo sie liegt und ob das der richtige Ort ist.

> Vorläufig liegt das Projekt im Repo `mietshaus`. Sobald das eigene Repo `dedupe-swipe` existiert, zieht es dorthin um.

- Anforderungen: [PROMPT.md](PROMPT.md)
- Architektur: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Entscheidungen: [docs/adr/](docs/adr/)

## Stand
Schritt 1 (Architektur) und Gerüst von Schritt 2 (Hash-Spike mit Pfad-Ampel). Der Code ist **noch nicht auf macOS gebaut**.

## Bauen und testen (auf dem Mac, Xcode 16 oder neuer, macOS 15+)

```bash
cd mac-dedupe
swift build -c release
swift test
```

## Benchmark-Scan (löscht nichts)

```bash
swift run -c release dedupe-cli ~/Pictures ~/Downloads \
  --master photo=~/Pictures \
  --exclude ~/Pictures/Photos\ Library.photoslibrary \
  --limit 10
```

Die Ausgabe enthält eine Tabelle mit Dateien, gelesenen Bytes, Zeit und Durchsatz pro Stufe. Danach folgen die Gruppen mit Breadcrumb-Pfad, Ampel, Speicherort und Vorschlag.

Für Ordner außerhalb des eigenen Home-Ordners braucht das Terminal eventuell Festplattenvollzugriff (*Systemeinstellungen › Datenschutz & Sicherheit*).
