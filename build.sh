#!/usr/bin/env bash
#
# build.sh — package MediaVault into a Chrome Web Store upload zip.
#
# Produces dist/mediavault-v<version>.zip containing only the files the
# extension needs at runtime (dev files, store assets and docs are excluded).
#
# Usage:  ./build.sh
#
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null || \
  grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' manifest.json | head -1 | grep -oE '[0-9]+(\.[0-9]+)*')
OUT="dist/mediavault-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# Whitelist exactly what ships in the package.
zip -r -X "$OUT" \
  manifest.json \
  background.js \
  content.js \
  inject.js \
  wa-bridge.js \
  wa-engine.js \
  popup \
  options \
  styles \
  utils \
  vendor \
  assets/icons/icon16.png \
  assets/icons/icon32.png \
  assets/icons/icon48.png \
  assets/icons/icon128.png \
  -x '*/.DS_Store' -x '*/.*' >/dev/null

echo "Built $OUT"
echo "Size: $(du -h "$OUT" | cut -f1)"
echo
echo "Contents:"
unzip -l "$OUT" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
echo
echo "Next: upload $OUT in the Chrome Web Store dashboard (see LAUNCH.md)."
