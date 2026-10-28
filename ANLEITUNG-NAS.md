# Mietshaus auf der Synology

Mietshaus läuft als Container auf der Synology und hält dort die einzige Datenbank. Alle arbeiten damit – mit der
Mac-App oder im Browser (auch iPhone und iPad). Von außen erreichbar ist der Server **nur über Tailscale**: keine feste
IP, keine Portfreigabe im Router, nichts offen im Internet.

```
Mac-App / Browser ──Tailscale (verschlüsselt)──▶ Synology: tailscale serve (HTTPS) ──▶ Container mietshaus :8080
                                                                     │
                                                       /volume1/docker/mietshaus  (Datenbank, Dokumente, Sicherungen)
                                                       /volume1/eingang           (Scanner, iPhone → Postfach)
```

## 1. Tailscale auf der Synology
1. Paket-Zentrum → **Tailscale** installieren und öffnen, mit deinem Tailscale-Konto anmelden.
2. In der Tailscale-Verwaltung (login.tailscale.com → DNS) **MagicDNS** und **HTTPS Certificates** einschalten.
3. Per SSH auf der Synology (Systemsteuerung → Terminal & SNMP → SSH aktivieren), einmalig:
   ```bash
   sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
   ```
   Danach ist Mietshaus unter `https://<name-der-synology>.<dein-tailnet>.ts.net` erreichbar – mit gültigem Zertifikat,
   aber nur für Geräte in deinem Tailnet. `sudo tailscale serve status` zeigt die Adresse.

## 2. Ordner anlegen
1. Systemsteuerung → Freigegebener Ordner: **docker** (falls nicht vorhanden) und **eingang** anlegen.
2. In File Station den Ordner `docker/mietshaus` anlegen.
3. Benutzer-ID für den Container herausfinden (SSH): `id <dein-benutzer>` – z. B. `uid=1026 gid=100`. Steht dort
   etwas anderes, in `compose.yaml` die Zeile `user: "1026:100"` anpassen.

## 3. Container starten
1. Paket-Zentrum → **Container Manager** installieren.
2. Container Manager → **Projekt → Erstellen**: Name `mietshaus`, Pfad `/volume1/docker/mietshaus-projekt`,
   Quelle „compose.yaml erstellen“ und den Inhalt von [`compose.yaml`](compose.yaml) einfügen.
3. Das Image `ghcr.io/grancolombianodealemania/mietshaus` baut GitHub bei jedem Push (Aktion „Server-Image“).
   Damit die Synology es ohne Anmeldung laden kann: auf GitHub unter *Packages → mietshaus → Package settings* die
   Sichtbarkeit auf **Public** stellen (das Repository ist ohnehin öffentlich; Daten sind im Image keine).
4. Projekt starten. Unter `https://<synology>.<tailnet>.ts.net` erscheint **„Ersten Benutzer anlegen“**.

## 4. Benutzer
- Den ersten Benutzer legst du beim ersten Aufruf an, weitere unter **Einstellungen → Benutzer** (alle haben dieselben
  Rechte, das Änderungsprotokoll zeigt, wer was geändert hat).
- Passwort mindestens 10 Zeichen; nach fünf falschen Versuchen wartet der Login eine Minute (danach länger).

## 5. Geräte
- **Tailscale** auf jedem Mac, iPhone und iPad installieren und mit demselben Konto anmelden (bzw. die Personen in dein
  Tailnet einladen).
- **Mac-App:** Einstellungen → Verbindung → Server-Adresse eintragen → „Mit Server verbinden“. Die App startet neu
  und zeigt die Anmeldung. „Lokal arbeiten“ schaltet zurück auf die Daten dieses Macs (kein Abgleich zwischen beiden).
- **Browser:** die Adresse aufrufen, anmelden. Auf dem iPhone über *Teilen → Zum Home-Bildschirm* wie eine App.
  PDFs erzeugt der Browser über den Druckdialog („Als PDF sichern“).

## 6. Bisherige Daten übernehmen
Auf dem Mac, der bisher die Daten hatte: Mac-App mit dem (noch leeren) Server verbinden, anmelden, dann
**Einstellungen → Verbindung → Daten dieses Macs übertragen…**. Datenbank und alle Dokumente gehen auf den Server;
das klappt nur, solange dort noch kein Objekt angelegt ist. Die Daten auf dem Mac bleiben unverändert („Lokal
arbeiten“ zeigt sie weiter, aber ohne Abgleich).

## 7. Claude
In der Mac-App (mit Server verbunden): **Einstellungen → Claude Desktop → Verbindung erneuern**. Die App holt für
dich einen eigenen Claude-Schlüssel vom Server und trägt ihn in Claude Desktop ein; Claude arbeitet dann über den Server
(Vorschläge von Claude, Protokoll „Claude für <dein Name>“). Ein neuer Schlüssel macht den alten ungültig.

## 8. Sicherung
- Der Server sichert täglich nach `docker/mietshaus/sicherungen` (14 Tage, danach eine je Monat für ein Jahr) und vor
  jedem Update.
- **Hyper Backup** (Paket-Zentrum): den Ordner `docker/mietshaus` regelmäßig auf eine externe Platte oder in die Cloud
  sichern – erst das schützt vor Ausfall der Synology.

## 9. Update
Container Manager → Projekt `mietshaus` → **Aktion → Erstellen** (lädt das neueste Image). Vorher legt der Server bei
Änderungen am Datenbankschema selbst eine Sicherung an.

## Checkliste (auf deiner Synology zu prüfen)
- [ ] `https://<synology>.<tailnet>.ts.net` zeigt die Anmeldung, aus dem Heimnetz und über Mobilfunk.
- [ ] Ohne Tailscale ist die Adresse **nicht** erreichbar.
- [ ] Ein Scan in `eingang` erscheint nach spätestens einer Minute im Postfach.
- [ ] Unter `docker/mietshaus/sicherungen` liegt am nächsten Tag eine automatische Sicherung.
- [ ] Hyper Backup sichert `docker/mietshaus`.
