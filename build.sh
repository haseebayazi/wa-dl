#!/usr/bin/env bash
#
# build.sh — package MediaVault for the Chrome Web Store.
#
# Two builds come from this one codebase:
#
#   ./build.sh v1   DOM-only build (recommended FIRST submission).
#                   No WhatsApp-engine mode: the engine files, the
#                   `scripting` permission and web-accessible resources
#                   are dropped, and the "Download by chat" card is
#                   hidden. Lower review risk. → version 1.0.0
#
#   ./build.sh v2   Full build. Adds the WhatsApp-engine mode
#                   (whole-history export, ZIP, chat-text export) that
#                   uses WhatsApp's internal APIs. → version 2.0.0
#
#   ./build.sh      Builds both.
#
# Output: dist/mediavault-<target>-v<version>.zip
#
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

build_one() {
  local target="$1" engine version stage out
  case "$target" in
    v1) engine=false; version="1.0.0" ;;
    v2) engine=true;  version="2.0.0" ;;
    *)  echo "usage: ./build.sh [v1|v2]"; return 1 ;;
  esac

  stage="$ROOT/dist/staging-$target"
  out="$ROOT/dist/mediavault-$target-v$version.zip"
  rm -rf "$stage"; mkdir -p "$stage/assets/icons"
  rm -f "$out"

  # ---- Copy the common runtime files ----
  cp manifest.json background.js content.js inject.js "$stage/"
  cp -r popup options styles utils "$stage/"
  cp assets/icons/icon16.png assets/icons/icon32.png \
     assets/icons/icon48.png assets/icons/icon128.png "$stage/assets/icons/"

  # ---- Engine (v2-only) files ----
  if [ "$engine" = true ]; then
    cp wa-bridge.js wa-engine.js "$stage/"
    mkdir -p "$stage/vendor"
    cp vendor/wppconnect-wa.js vendor/wppconnect-wa.js.LICENSE.txt "$stage/vendor/"
  fi

  # ---- Generate the build config module ----
  if [ "$engine" = true ]; then
    cat > "$stage/utils/config.js" <<'EOF'
(function (root) {
  'use strict';
  root.WAMD = root.WAMD || {};
  root.WAMD.config = {
    engine: true,
    proFeaturesShort: 'whole-chat export, ZIP, filters & more',
    proFeaturesLong: 'whole-chat history export, Save-as-ZIP, chat text (.txt) ' +
      'export, date & sender filters, auto-scroll loading, folder organisation ' +
      'and custom file naming'
  };
})(globalThis);
EOF
  else
    cat > "$stage/utils/config.js" <<'EOF'
(function (root) {
  'use strict';
  root.WAMD = root.WAMD || {};
  root.WAMD.config = {
    engine: false,
    proFeaturesShort: 'auto-scroll history, filters, folders & more',
    proFeaturesLong: 'auto-scroll history loading, date & sender filters, ' +
      'folder organisation and custom file naming'
  };
})(globalThis);
EOF
  fi

  # ---- Transform the manifest for this target + set the version ----
  node - "$stage/manifest.json" "$version" "$engine" <<'NODE'
const fs = require('fs');
const [, , mp, version, engine] = process.argv;
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
m.version = version;
if (engine === 'false') {
  // DOM-only build: strip everything the engine needs.
  m.permissions = (m.permissions || []).filter((p) => p !== 'scripting');
  for (const cs of (m.content_scripts || [])) {
    if (Array.isArray(cs.js)) cs.js = cs.js.filter((f) => f !== 'wa-engine.js');
  }
  delete m.web_accessible_resources;
}
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
NODE

  # ---- Zip from the staging dir ----
  ( cd "$stage" && zip -r -X "$out" . -x '*/.DS_Store' -x '*/.*' >/dev/null )
  rm -rf "$stage"

  echo "Built dist/mediavault-$target-v$version.zip ($(du -h "$out" | cut -f1))"
}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(v1 v2)
for t in "${targets[@]}"; do build_one "$t"; done

echo
echo "Upload the v1 zip first (DOM-only). After it's approved, upload the v2 zip"
echo "as an update to the same store item. See LAUNCH.md."
