/**
 * utils/download.js
 * ------------------------------------------------------------------
 * Business logic that turns a detected media element into a download
 * request for the background queue:
 *
 *   1. fetch the blob: URL (isolated world can read page blobs;
 *      a page-context bridge via inject.js is the fallback)
 *   2. hash the bytes for duplicate detection
 *   3. build the target filename from the user's naming rules
 *   4. hand a serializable payload to the service worker
 *
 * No DOM queries in this file — element metadata arrives from
 * utils/dom.js. Attaches to `globalThis.WAMD.download`.
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  root.WAMD = root.WAMD || {};
  const H = () => root.WAMD.helpers;

  // chrome.runtime messages are capped (~64 MB); base64 inflates by
  // ~33%, so anything above this many raw bytes is downloaded in-page
  // via an <a download> anchor instead of the background queue.
  const MAX_MESSAGE_BYTES = 44 * 1024 * 1024;

  /**
   * Fetch a blob: URL from the isolated world. Content scripts share
   * the page's origin, so this normally succeeds; when it doesn't
   * (e.g. CSP quirks after a WhatsApp update), fall back to asking the
   * page-context bridge (inject.js) to fetch it and stream it back.
   *
   * @param {string} blobUrl
   * @returns {Promise<Blob>}
   */
  async function fetchBlob(blobUrl) {
    try {
      const res = await fetch(blobUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    } catch (err) {
      return fetchBlobViaPage(blobUrl);
    }
  }

  /**
   * Ask the page-context script (inject.js) to fetch the blob and
   * return it as a data URL through a DOM CustomEvent. Used only as a
   * fallback when the isolated-world fetch fails.
   *
   * @param {string} blobUrl
   * @returns {Promise<Blob>}
   */
  function fetchBlobViaPage(blobUrl) {
    return new Promise((resolve, reject) => {
      const requestId = H().uid();
      const timeout = setTimeout(() => {
        document.removeEventListener('wamd-blob-response', onResponse);
        reject(new Error('Page-context blob fetch timed out'));
      }, 15000);

      /** Handle the bridge's response event for our request id. */
      function onResponse(ev) {
        const detail = ev.detail || {};
        if (detail.requestId !== requestId) return;
        clearTimeout(timeout);
        document.removeEventListener('wamd-blob-response', onResponse);
        if (!detail.ok) { reject(new Error(detail.error || 'Page fetch failed')); return; }
        // Convert the returned data URL back to a Blob.
        fetch(detail.dataUrl).then((r) => r.blob()).then(resolve, reject);
      }

      document.addEventListener('wamd-blob-response', onResponse);
      document.dispatchEvent(new CustomEvent('wamd-blob-request', {
        detail: { requestId, blobUrl }
      }));
    });
  }

  /**
   * Build the relative download path from the user's settings.
   *
   * Naming styles:
   *   chat_datetime    → ChatName_YYYY-MM-DD_HH-MM-SS.ext
   *   sender_messageid → Sender_MessageID.ext
   *
   * With `organizeFolders` on, the file is placed under
   *   <downloadFolder>/<ChatName>/<TypeFolder>/
   * otherwise directly under <downloadFolder>/.
   *
   * @param {object} settings  resolved settings object
   * @param {{kind: string, chatName: string, sender: string,
   *          messageId: string|null, when: Date|null, ext: string}} meta
   * @returns {string} path relative to the browser download directory
   */
  function buildFilename(settings, meta) {
    const h = H();
    const chat = h.sanitizeFilename(meta.chatName || 'Unknown Chat');
    const ext = meta.ext || 'bin';

    let base;
    if (settings.namingStyle === 'sender_messageid' && meta.messageId) {
      base = `${h.sanitizeFilename(meta.sender || 'Unknown')}_${h.sanitizeFilename(meta.messageId, 40)}`;
    } else {
      base = `${chat}_${h.timestampSlug(meta.when instanceof Date ? meta.when : new Date())}`;
    }

    const segments = [h.sanitizeFilename(settings.downloadFolder || 'WhatsApp')];
    if (settings.organizeFolders) {
      segments.push(chat, h.folderForKind(meta.kind));
    }
    segments.push(`${base}.${ext}`);
    return segments.join('/');
  }

  /**
   * Prepare a serializable queue payload for one media item:
   * fetches the bytes, hashes them, converts to a data URL and builds
   * the filename. Returns null when the media exceeds the messaging
   * size cap (caller should use downloadInPage instead).
   *
   * @param {object} settings
   * @param {{blobUrl: string, kind: string, chatName: string,
   *          sender: string, messageId: string|null, when: Date|null}} item
   * @returns {Promise<object|null>} payload for the background queue
   */
  async function preparePayload(settings, item) {
    const h = H();
    const blob = await fetchBlob(item.blobUrl);
    if (!blob || blob.size === 0) throw new Error('Media is empty or expired');

    const ext = h.extensionForMime(blob.type);
    const filename = buildFilename(settings, { ...item, ext });

    // Content hash is the primary dedupe key; the WhatsApp message id
    // is a cheaper secondary key kept for readability in history.
    const hash = await h.sha256Hex(await blob.arrayBuffer());

    if (blob.size > MAX_MESSAGE_BYTES) {
      // Too big to ship over runtime messaging — signal in-page path.
      return { tooLarge: true, blob, filename, hash, bytes: blob.size, kind: item.kind };
    }

    const dataUrl = await h.blobToDataURL(blob);
    return {
      tooLarge: false,
      id: h.uid(),
      url: dataUrl,
      filename,
      bytes: blob.size,
      mime: blob.type,
      kind: item.kind,
      chatName: item.chatName || 'Unknown Chat',
      sender: item.sender || 'Unknown',
      messageId: item.messageId || null,
      dedupeKey: `sha256:${hash}`
    };
  }

  /**
   * Last-resort in-page download for oversized files: creates a
   * temporary <a download> anchor. The browser saves it to the default
   * download directory (folder organization is not possible on this
   * path — documented limitation).
   *
   * @param {Blob} blob
   * @param {string} filename  full relative path; only the basename is used
   */
  function downloadInPage(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  root.WAMD.download = {
    MAX_MESSAGE_BYTES,
    fetchBlob,
    buildFilename,
    preparePayload,
    downloadInPage
  };
})(globalThis);
