# ADR 0001: Vertrieb mit Developer ID und Notarisierung statt App Store

**Status:** angenommen

## Kontext
Ein Duplikat-Scanner muss große Teile der Festplatte lesen. Der Mac App Store verlangt die App Sandbox: Zugriff gibt es nur auf Ordner, die der Nutzer einzeln freigibt. Systempfade, andere Nutzerordner und viele Programmdaten bleiben unerreichbar.

## Entscheidung
- Signatur mit Developer ID, Hardened Runtime und Notarisierung durch Apple. Verteilung als DMG.
- Keine App Sandbox. Vollzugriff auf die Festplatte wird mit einer klaren Erklärung und einem Link zu *Systemeinstellungen › Datenschutz & Sicherheit › Festplattenvollzugriff* angefragt.
- Ohne Vollzugriff funktioniert die App weiter mit Ordnern, die der Nutzer per Öffnen-Dialog wählt (Security-Scoped Bookmarks, damit die Freigabe Neustarts übersteht).
- Updates später über Sparkle mit signierten Appcasts.

## Folgen
- Mehr Zugriff, damit auch mehr Verantwortung: Rot markierte Orte werden nie angefasst (ADR 0004), gelöscht wird nur in den Papierkorb.
- Apple-Developer-Programm (99 €/Jahr) für Signatur und Notarisierung nötig. Für reine Eigenentwicklung reicht lokale Signatur.
