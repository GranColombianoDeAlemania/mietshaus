#!/usr/bin/env bash
# Smoke test of the server image, locked down as in compose.yaml (read-only, no capabilities, no new privileges):
# start, status, logo, first user, upload and OCR of a photographed receipt, then the meter photo.
# Run: bash scripts/rauchtest.sh <image>
set -euo pipefail
BILD="$1"
DATEN="$(mktemp -d)"; chmod 777 "$DATEN"
KEKS="$(mktemp)"
URL=http://127.0.0.1:18080
aufraeumen() { docker logs mietshaus-rauch 2>&1 | tail -40 || true; docker rm -f mietshaus-rauch >/dev/null 2>&1 || true; }
trap aufraeumen EXIT

docker run -d --name mietshaus-rauch --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 1g --pids-limit 256 -v "$DATEN:/daten" -p 127.0.0.1:18080:8080 "$BILD" >/dev/null

for i in $(seq 1 60); do curl -fsS "$URL/api/status" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$URL/api/status" | grep -q '"einrichtung":true'
echo "Status ok"
test "$(curl -fsS -o /dev/null -w '%{content_type}' "$URL/logo.svg")" = "image/svg+xml"
test "$(curl -fsS -o /dev/null -w '%{content_type}' "$URL/symbole/cockpit.svg")" = "image/svg+xml"
echo "Logo ok"

PW="rauch-$(date +%s)-test"
curl -fsS -c "$KEKS" -H 'X-Mietshaus: 1' -H 'Content-Type: application/json' \
  -d "{\"login\":\"rauch\",\"name\":\"Rauchtest\",\"passwort\":\"$PW\"}" "$URL/api/einrichten" >/dev/null
echo "Benutzer ok"

ID=$(curl -fsS -b "$KEKS" -H 'X-Mietshaus: 1' -H 'Content-Type: application/octet-stream' --data-binary @scripts/testdaten/beleg.png \
  "$URL/api/hochladen?name=beleg.png&opt=%7B%7D" | sed -E 's/.*"id":([0-9]+).*/\1/')
for i in $(seq 1 90); do
  DOK=$(curl -fsS -b "$KEKS" -H 'X-Mietshaus: 1' -H 'Content-Type: application/json' -d "{\"fn\":\"dokument\",\"args\":[$ID]}" "$URL/api/call")
  echo "$DOK" | grep -q '"analyse":"fertig"' && break; sleep 1
done
echo "$DOK" | grep -q '"betrag_ct":4890' || { echo "OCR fehlgeschlagen: $DOK"; exit 1; }
echo "OCR ok"
