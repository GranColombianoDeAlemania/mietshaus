# ADR 0003: Mehrstufige Hash-Pipeline mit SHA-256

**Status:** angenommen (Hash-Verfahren wird nach dem ersten Benchmark überprüft)

## Kontext
Exakte Duplikate (100 %) sollen schnell und ohne Falschtreffer gefunden werden. Das Lesen ganzer Dateien ist der teuerste Teil.

## Entscheidung
1. Hardlinks über (Gerät, Inode) zusammenfassen.
2. Nach Größe gruppieren (kein I/O).
3. Teil-Hash: Größe + erste und letzte 64 KiB. Dateien bis 128 KiB sind damit komplett gelesen.
4. Voll-Hash nur für die Restkandidaten, mit 1-MiB-Puffer, an Seitengrenzen ausgerichtet, `F_NOCACHE`.
5. Hash-Verfahren zunächst **SHA-256 aus CryptoKit**: keine fremde Abhängigkeit, kryptografisch sicher (keine Kollisionen in der Praxis) und auf Apple Silicon mit Hardware-Befehlen beschleunigt.
6. Parallelität auf die Kernzahl begrenzt.

## Prüfkriterium
Erreicht der Voll-Hash im CLI-Benchmark auf der internen SSD weniger als 2 GB/s und ist dabei der Prozessor und nicht die SSD der Engpass, wird auf BLAKE3 (über SIMD parallelisierbar) oder xxHash3-128 mit SHA-256-Gegenprobe gewechselt.

## Folgen
- Bei Millionen gleich großer Dateien (etwa Kamera-RAWs mit fester Größe) hilft der Größenfilter wenig. Dort trägt der Teil-Hash die Hauptlast.
- Mit dem Cache in Schritt 3/6 werden Hashes nur neu berechnet, wenn sich Inode, Größe oder mtime ändern.
