#!/usr/bin/env bash
#
# build.sh — package MediaVault for the Chrome Web Store.
#
# Two builds come from this one codebase:
#
#   ./build.sh v1   FREE build (recommended FIRST submission).
#                   DOM-only and no paywall: the engine files, the
#                   `scripting` + Gumroad permissions and web-accessible
#                   resources are dropped, the "Download by chat" card is
#                   hidden, and every feature is free with no limit.
#                   Lowest review risk. → version 1.0.0
#
#   ./build.sh v2   PAID build. Adds the WhatsApp-engine mode
#                   (whole-history export, ZIP, chat-text export) that
#                   uses WhatsApp's internal APIs, plus the freemium
#                   paywall (50 free downloads, then Pro). → version 2.0.0
#
#   ./build.sh      Builds both.
#
# Output: dist/mediavault-<target>-v<version>.zip
#
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

build_one() {
  local target="$1" engine paid version stage out
  case "$target" in
    v1) engine=false; paid=false; version="1.0.0" ;;
    v2) engine=true;  paid=true;  version="2.0.0" ;;
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
  if [ "$paid" = true ]; then
    cat > "$stage/utils/config.js" <<'EOF'
(function (root) {
  'use strict';
  root.WAMD = root.WAMD || {};
  root.WAMD.config = {
    engine: true,
    paid: true,
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
    paid: false,
    proFeaturesShort: '',
    proFeaturesLong: ''
  };
})(globalThis);
EOF
  fi

  # ---- Transform the manifest for this target + set the version ----
  node - "$stage/manifest.json" "$version" "$engine" "$paid" <<'NODE'
const fs = require('fs');
const [, , mp, version, engine, paid] = process.argv;
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
if (paid === 'false') {
  // Free build: no payment/licence check, so drop the payment host.
  m.host_permissions = (m.host_permissions || []).filter((h) => !h.includes('gumroad.com'));
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
echo "Upload the v1 zip first (free, DOM-only). After it's approved, upload the"
echo "v2 zip (paid engine build) as an update to the same store item. See SUBMISSION.md."
