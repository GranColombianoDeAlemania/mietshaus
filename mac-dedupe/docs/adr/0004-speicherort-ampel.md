# ADR 0004: Speicherort-Ampel und Vorauswahl

**Status:** angenommen

## Kontext
Der Nutzer soll auf einen Blick sehen, wo eine Datei liegt und ob das der richtige Ort ist. Daraus ergibt sich auch, welche Kopie behalten wird.

## Regeln (in dieser Reihenfolge, die erste passende gewinnt)

| Ampel | Bedingung | Beispiel-Grund |
|---|---|---|
| Rot | Systempfad (`/System`, `/Library`, `/usr`, `/Applications` …) | „Systembereich – wird nicht verändert" |
| Rot | In einer Fotos-Mediathek | „Nur über die Fotos-App bearbeiten" |
| Rot | In einem Programmpaket (`.app`, `.framework` …) | „Teil eines Programmpakets" |
| Rot | Im `~/Library` (außer iCloud Drive und Cloud-Ordnern) | „Gehört zu Programmdaten" |
| Gelb | Im Papierkorb | „Liegt bereits im Papierkorb" |
| Grün | Im Master-Ordner der Kategorie | „Liegt im Master-Ordner für Fotos" |
| Gelb | Downloads, Schreibtisch, temporärer Ordner, Cache | „Kopie in Downloads" |
| Gelb | Master-Ordner festgelegt, Datei liegt woanders | „Außerhalb des Master-Ordners" |
| Grün | Sonst | „Normaler Ordner" |

Rot heißt gesperrt: Die Datei wird nie zum Löschen angeboten, und `SafeDeleter` verweigert die Aktion auch dann, wenn die UI sie trotzdem auslöst.

## Vorauswahl
1. Rot markierte Kopien werden immer behalten. Gibt es welche, gelten alle freien Kopien als Löschkandidaten.
2. Sonst: Master-Ordner → bessere Ampel → ältere Datei → kürzerer Pfad → alphabetisch.

Bildqualität (Auflösung, Schärfe) kommt in Schritt 3/5 als Kriterium nach dem Master-Ordner dazu. Bei exakten Duplikaten ist sie ohnehin gleich.

## Folgen
- Die Regeln sind reine Funktionen ohne I/O und vollständig unit-getestet.
- Ordnernamen wie „Downloads" werden über den echten Pfad im Home-Ordner erkannt, nicht über den lokalisierten Namen im Finder.
