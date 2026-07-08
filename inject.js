/**
 * inject.js — page-context bridge (MAIN world)
 * ------------------------------------------------------------------
 * Registered in the manifest as a MAIN-world content script, so it
 * runs in the page context regardless of WhatsApp's CSP. Deliberately
 * tiny: it does NOT touch WhatsApp's internal modules or undocumented
 * APIs. Its only job is a fallback path for reading blob: URLs when
 * the isolated-world fetch fails (rare, but possible after CSP or
 * blob-partitioning changes).
 *
 * Protocol (DOM CustomEvents, same-page only — nothing leaves the tab):
 *   content → page : "wamd-blob-request"  { requestId, blobUrl }
 *   page → content : "wamd-blob-response" { requestId, ok, dataUrl?, error? }
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  // Guard against double injection (e.g. extension reload).
  if (window.__wamdBridgeInstalled) return;
  window.__wamdBridgeInstalled = true;

  /**
   * Respond to a blob-fetch request from the content script: fetch the
   * blob in page context, encode as a data URL, dispatch the response.
   *
   * @param {CustomEvent} ev  detail: { requestId, blobUrl }
   */
  async function onBlobRequest(ev) {
    const { requestId, blobUrl } = (ev && ev.detail) || {};
    if (!requestId || typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) return;

    /** Dispatch a response event back to the isolated world. */
    const respond = (detail) => {
      document.dispatchEvent(new CustomEvent('wamd-blob-response', {
        detail: { requestId, ...detail }
      }));
    };

    try {
      const res = await fetch(blobUrl);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => respond({ ok: true, dataUrl: reader.result });
      reader.onerror = () => respond({ ok: false, error: 'FileReader failed' });
      reader.readAsDataURL(blob);
    } catch (err) {
      respond({ ok: false, error: err && err.message ? err.message : 'fetch failed' });
    }
  }

  document.addEventListener('wamd-blob-request', onBlobRequest);
})();
