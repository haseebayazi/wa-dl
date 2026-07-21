/**
 * utils/config.js
 * ------------------------------------------------------------------
 * Build-time feature configuration.
 *
 * MediaVault ships in two builds from one codebase (see build.sh):
 *
 *   v1 (free)  engine = false, paid = false
 *              The DOM-only, 100% free build submitted to the store
 *              first. No WhatsApp-engine mode and no paywall: the
 *              engine files, the `scripting` permission, the Gumroad
 *              host permission and the web-accessible resources are all
 *              omitted, the "Download by chat" card is hidden, and every
 *              feature is unlocked with no download limit.
 *
 *   v2 (pro)   engine = true, paid = true
 *              Adds the WhatsApp-engine mode (whole-history export, ZIP,
 *              chat-text export — uses WhatsApp's internal APIs) and the
 *              freemium paywall (50 free downloads, then Pro).
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
    paid: true,
    proFeaturesShort: 'whole-chat export, ZIP, filters & more',
    proFeaturesLong: 'whole-chat history export, Save-as-ZIP, chat text (.txt) ' +
      'export, date & sender filters, auto-scroll loading, folder organisation ' +
      'and custom file naming'
  };
})(globalThis);
