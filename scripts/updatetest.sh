#!/bin/bash
# Test of the Mac app's self-update: builds the current version and a newer one (version +test), offers the newer one
# as a "release" from a local web server, starts the older app and checks that it replaced itself and started again.
# Run on a Mac: bash scripts/updatetest.sh   (takes a few minutes, two builds)
set -euo pipefail
cd "$(dirname "$0")/.."
T="$(mktemp -d)"
ALT=$(node -p "require('./package.json').version")
NEU="${ALT%.*}.$(( ${ALT##*.} + 90 ))"
cp package.json "$T/package.json.orig"
trap 'cp "$T/package.json.orig" package.json' EXIT

npm run dist:mac >/dev/null
mkdir -p "$T/programme" "$T/release"
ditto -x -k release/Mietshaus-mac-arm64.zip "$T/programme"
npm pkg set version="$NEU" >/dev/null
npm run dist:mac >/dev/null
cp release/Mietshaus-mac-arm64.zip "$T/release/"
shasum -a 256 "$T/release/Mietshaus-mac-arm64.zip" | cut -d' ' -f1 > "$T/release/Mietshaus-mac-arm64.zip.sha256"
cp "$T/package.json.orig" package.json

PORT=8799
cat > "$T/release/release.json" <<JSON
{ "tag_name": "v$NEU", "html_url": "http://127.0.0.1:$PORT/", "body": "Test",
  "assets": [ { "name": "Mietshaus-mac-arm64.zip", "browser_download_url": "http://127.0.0.1:$PORT/Mietshaus-mac-arm64.zip" },
              { "name": "Mietshaus-mac-arm64.zip.sha256", "browser_download_url": "http://127.0.0.1:$PORT/Mietshaus-mac-arm64.zip.sha256" } ] }
JSON
(cd "$T/release" && python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1) &
WEB=$!
mkdir -p "$T/daten"
MIETSHAUS_UPDATE_QUELLE="http://127.0.0.1:$PORT/release.json" MIETSHAUS_UPDATE_SOFORT=1 MIETSHAUS_DB="$T/daten/m.sqlite" \
  "$T/programme/Mietshaus.app/Contents/MacOS/Mietshaus" --user-data-dir="$T/daten" >"$T/app.log" 2>&1 &
ok=0
for i in $(seq 1 90); do
  sleep 1
  v=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$T/programme/Mietshaus.app/Contents/Info.plist" 2>/dev/null || true)
  if [ "$v" = "$NEU" ] && pgrep -f "$T/programme/Mietshaus.app/Contents/MacOS/Mietshaus" >/dev/null; then ok=1; break; fi
done
grep -i "update" "$T/app.log" || true
pkill -f "$T/programme/Mietshaus.app" || true
kill $WEB || true
if [ $ok = 1 ]; then echo "Updatetest: $ALT → $NEU installiert und neu gestartet."; else echo "Updatetest: FEHLGESCHLAGEN (installiert: ${v:-?})"; exit 1; fi
[ -d "$T/programme/Mietshaus.app.alt" ] && echo "Hinweis: alte Version liegt noch daneben" || echo "Alte Version aufgeräumt."
