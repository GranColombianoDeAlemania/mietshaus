#!/usr/bin/env bash
# Builds an Apple Silicon (M1) app bundle and zips it with symlinks intact.
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build
rm -rf release
npx electron-packager . Hausverwalter --platform=darwin --arch=arm64 --out=release \
  --app-bundle-id=local.hausverwalter --app-category-type=public.app-category.business \
  --ignore='^/(src|scripts|release|node_modules/\.vite)' --ignore='\.ts$' --overwrite
cd release/Hausverwalter-darwin-arm64
zip -qry ../Hausverwalter-mac-arm64.zip Hausverwalter.app
echo "Fertig: release/Hausverwalter-mac-arm64.zip"
