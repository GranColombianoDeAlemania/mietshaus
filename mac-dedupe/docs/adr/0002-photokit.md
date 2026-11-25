# ADR 0002: Fotos-Mediathek nur über PhotoKit

**Status:** angenommen

## Kontext
Die Fotos-Mediathek (`*.photoslibrary`) ist ein Paket mit eigener Datenbank. Wer Dateien darin direkt löscht oder verschiebt, beschädigt die Mediathek. Bei „Mac-Speicher optimieren" liegen viele Originale nur in iCloud.

## Entscheidung
- Der Dateisystem-Scan betritt keine Pakete. Pfade in einer `.photoslibrary` sind immer rot.
- Fotos und Videos der Mediathek werden über PhotoKit gelesen (`PHAsset`, `PHImageManager` für Vorschauen, `PHAssetResource` für Originale bei Bedarf).
- Gelöscht wird nur mit `PHAssetChangeRequest.deleteAssets`. macOS zeigt dabei selbst eine Bestätigung, die Objekte landen in „Zuletzt gelöscht" und sind 30 Tage wiederherstellbar.
- Für Ähnlichkeit und Qualität reichen meist Vorschaubilder in reduzierter Größe. So müssen keine Originale aus iCloud geladen werden.

## Folgen
- Zusätzliche Berechtigung „Fotos" (`NSPhotoLibraryUsageDescription`).
- Duplikate zwischen Mediathek und normalen Ordnern werden über Fingerprints verglichen, nicht über Pfade.
