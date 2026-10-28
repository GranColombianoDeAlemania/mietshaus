#!/usr/bin/env bash
# Builds an Apple Silicon (M1) app bundle and zips it with symlinks intact.
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build
rm -rf release
npx electron-packager . Mietshaus --platform=darwin --arch=arm64 --out=release \
  --app-bundle-id=local.mietshaus --app-category-type=public.app-category.business \
  --ignore='^/(src|scripts|release|resources|node_modules/\.vite)' --ignore='\.ts$' --overwrite \
  --extra-resource=resources/tessdata --no-asar
# Signature. On a Mac with a code signing certificate of its own (MIETSHAUS_SIGNATUR="Mietshaus Lokal", made once
# in Keychain Access → Certificate Assistant → Create a Certificate…, type "Code Signing"), every build keeps the
# same identity: the keychain then still trusts new versions and the stored mail password stays readable.
# Otherwise an ad-hoc signature (new identity per build), on Linux with rcodesign.
RCODESIGN="${RCODESIGN:-$(command -v rcodesign || echo "$HOME/.local/opt/rcodesign-0.29.0/rcodesign")}"
if [ "$(uname)" = "Darwin" ]; then
  codesign --force --deep --sign "${MIETSHAUS_SIGNATUR:--}" release/Mietshaus-darwin-arm64/Mietshaus.app
  echo "Signiert mit ${MIETSHAUS_SIGNATUR:-ad-hoc (MIETSHAUS_SIGNATUR nicht gesetzt)}"
elif [ -x "$RCODESIGN" ]; then
  "$RCODESIGN" sign release/Mietshaus-darwin-arm64/Mietshaus.app >/dev/null
  echo "Ad-hoc signiert mit $RCODESIGN"
else
  echo "Hinweis: rcodesign nicht gefunden – die App muss auf dem Mac mit 'codesign --force --deep --sign -' signiert werden."
fi
cd release/Mietshaus-darwin-arm64
zip -qry ../Mietshaus-mac-arm64.zip Mietshaus.app
echo "Fertig: release/Mietshaus-mac-arm64.zip"
