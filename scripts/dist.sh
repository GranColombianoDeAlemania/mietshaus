#!/usr/bin/env bash
# Builds the app for Linux: scripts/dist.sh linux [x64|arm64]
set -euo pipefail
cd "$(dirname "$0")/.."
PLATTFORM="$1"; ARCH="${2:-x64}"
npx vite build
rm -rf "release/Mietshaus-$PLATTFORM-$ARCH"
npx electron-packager . Mietshaus --platform="$PLATTFORM" --arch="$ARCH" --out=release \
  --ignore='^/(src|scripts|release|resources|node_modules/\.vite)' --ignore='\.ts$' --overwrite \
  --extra-resource=resources/tessdata --no-asar
cd release
rm -f "Mietshaus-$PLATTFORM-$ARCH.zip"
zip -qry "Mietshaus-$PLATTFORM-$ARCH.zip" "Mietshaus-$PLATTFORM-$ARCH"
echo "Fertig: release/Mietshaus-$PLATTFORM-$ARCH.zip"
