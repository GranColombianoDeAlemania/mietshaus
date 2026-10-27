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
# Ad-hoc signature, so macOS on Apple Silicon starts the app without a manual codesign step.
RCODESIGN="${RCODESIGN:-$(command -v rcodesign || echo "$HOME/.local/opt/rcodesign-0.29.0/rcodesign")}"
if [ -x "$RCODESIGN" ]; then
  "$RCODESIGN" sign release/Mietshaus-darwin-arm64/Mietshaus.app >/dev/null
  echo "Ad-hoc signiert mit $RCODESIGN"
else
  echo "Hinweis: rcodesign nicht gefunden – die App muss auf dem Mac mit 'codesign --force --deep --sign -' signiert werden."
fi
cd release/Mietshaus-darwin-arm64
zip -qry ../Mietshaus-mac-arm64.zip Mietshaus.app
echo "Fertig: release/Mietshaus-mac-arm64.zip"
