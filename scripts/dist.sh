#!/usr/bin/env bash
# Builds the app for another platform: scripts/dist.sh win32|linux [x64|arm64]
set -euo pipefail
cd "$(dirname "$0")/.."
PLATTFORM="$1"; ARCH="${2:-x64}"
npx vite build
rm -rf "release/Hausverwalter-$PLATTFORM-$ARCH"
npx electron-packager . Hausverwalter --platform="$PLATTFORM" --arch="$ARCH" --out=release \
  --ignore='^/(src|scripts|release|resources|node_modules/\.vite)' --ignore='\.ts$' --overwrite \
  --extra-resource=resources/tessdata --no-asar \
  --win32metadata.CompanyName="Hausverwalter" --win32metadata.ProductName="Hausverwalter" --win32metadata.FileDescription="Hausverwalter"
cd release
rm -f "Hausverwalter-$PLATTFORM-$ARCH.zip"
zip -qry "Hausverwalter-$PLATTFORM-$ARCH.zip" "Hausverwalter-$PLATTFORM-$ARCH"
echo "Fertig: release/Hausverwalter-$PLATTFORM-$ARCH.zip"
