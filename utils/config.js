/**
 * utils/config.js
 * ------------------------------------------------------------------
 * Build-time feature configuration.
 *
 * MediaVault ships in two builds from one codebase (see build.sh):
 *
 *   v2 (full)     engine = true  — includes the WhatsApp-engine mode
 *                 (whole-history export, ZIP, chat-text export) which
 *                 uses WhatsApp's internal APIs.
 *   v1 (DOM-only) engine = false — only the rendered-DOM features
 *                 (single/bulk downloads, auto-scroll, filters). The
 *                 engine files, the `scripting` permission and the
 *                 web-accessible resources are omitted from the package,
 *                 and the "Download by chat" card is hidden.
 *
 * build.sh regenerates this file per target; the value committed here
 * is the full (v2) default used when the repo is loaded unpacked.
 *
 * Attaches to `globalThis.WAMD.config`.
 * ------------------------------------------------------------------
 */
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
