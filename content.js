/**
 * content.js — content script orchestrator (isolated world)
 * ------------------------------------------------------------------
 * Wires everything together on web.whatsapp.com:
 *
 *   - one debounced MutationObserver watching the app for
 *     media, chat switches and the full-screen viewer
 *   - the floating download button inside the media viewer
 *   - in-page toast notifications
 *   - request handlers for the popup (chat state, bulk download)
 *
 * DOM reads live in utils/dom.js, selectors in utils/selectors.js,
 * download preparation in utils/download.js — this file only
 * coordinates them.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const { selectors, helpers, storage, dom, download } = globalThis.WAMD;

  /** Cached summary of the last media scan (served to the popup). */
  let lastScan = { chatName: null, counts: {}, senders: [], total: 0, loaded: 0, at: 0 };

  /** blob: URLs already auto-downloaded from the viewer this session. */
  const autoDownloaded = new Set();

  /** The floating button element (single instance, moved as needed). */
  let floatButton = null;

  /** Observer handle kept for cleanup on page unload. */
  let observer = null;

  /* ============================ Bootstrap ============================ */

  /**
   * Entry point: wait for WhatsApp to finish booting, then install the
   * observer and run the first scan. (The page-context bridge in
   * inject.js is registered separately in the manifest, MAIN world.)
   */
  async function init() {
    await waitForApp();
    startObserver();
    rescan();
    console.info('[WAMD] WA Media Downloader Pro ready');
  }

  /**
   * Poll until WhatsApp's app root exists (it boots asynchronously).
   * Gives up after ~60s — e.g. on the QR/landing screen variants where
   * selectors legitimately never match.
   */
  async function waitForApp() {
    for (let i = 0; i < 120; i++) {
      if (selectors.query('appRoot')) return;
      await helpers.sleep(500);
    }
  }

  /* ========================= Mutation observer ========================= */

  /**
   * One body-level observer with a debounced handler. WhatsApp mutates
   * the DOM constantly, so per-mutation work must be near-zero: we only
   * schedule a rescan and a viewer check.
   */
  function startObserver() {
    const debouncedScan = helpers.debounce(rescan, 400);
    const debouncedViewer = helpers.debounce(syncViewerButton, 120);

    observer = new MutationObserver(() => {
      debouncedScan();
      debouncedViewer();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Cleanup on navigation/teardown to avoid leaked observers.
    window.addEventListener('pagehide', () => {
      if (observer) { observer.disconnect(); observer = null; }
      debouncedScan.cancel();
      debouncedViewer.cancel();
    }, { once: true });
  }

  /**
   * Re-scan the open chat and refresh the cached summary the popup
   * reads. Cheap enough to run on every debounced mutation burst.
   */
  function rescan() {
    const items = dom.scanChatMedia();
    const counts = {};
    const senders = new Set();
    let loaded = 0;
    for (const item of items) {
      counts[item.kind] = (counts[item.kind] || 0) + 1;
      if (item.loaded) loaded += 1;
      if (item.sender) senders.add(item.sender);
    }
    lastScan = {
      chatName: dom.getChatName(),
      counts,
      senders: [...senders].sort((a, b) => a.localeCompare(b)),
      total: items.length,
      loaded,
      at: Date.now()
    };
  }

  /* ======================= Floating viewer button ======================= */

  /**
   * Create (once) the floating download button shown over the media
   * viewer. Bottom-right, animated, styled by styles/content.css.
   *
   * @returns {HTMLElement}
   */
  function ensureFloatButton() {
    if (floatButton) return floatButton;
    floatButton = document.createElement('button');
    floatButton.className = 'wamd-fab';
    floatButton.type = 'button';
    floatButton.title = 'Download media (WA Media Downloader Pro)';
    floatButton.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.17l3.09-3.09a1 1 0 1 1 1.41 1.42l-4.79 4.79a1 1 0 0 1-1.42 0L6.5 11.5a1 1 0 1 1 1.41-1.42L11 13.17V4a1 1 0 0 1 1-1Z"/>' +
      '<path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/></svg>' +
      '<span>Download</span>';
    floatButton.addEventListener('click', onFloatButtonClick);
    return floatButton;
  }

  /**
   * Show the button while a viewer (media/status/profile photo) is
   * open, hide it otherwise. Runs debounced from the observer.
   */
  function syncViewerButton() {
    const hasMedia = dom.getViewerMedia() || dom.getProfilePhoto();
    const btn = ensureFloatButton();
    if (hasMedia) {
      if (!btn.isConnected) document.body.appendChild(btn);
      btn.classList.add('wamd-fab--visible');
      maybeAutoDownload();
    } else {
      btn.classList.remove('wamd-fab--visible');
      // Remove from DOM after the exit animation to keep the tree clean.
      setTimeout(() => {
        if (!btn.classList.contains('wamd-fab--visible') && btn.isConnected) btn.remove();
      }, 300);
    }
  }

  /**
   * Click handler for the floating button: downloads whatever the
   * viewer currently displays (image, video, status or profile photo).
   */
  async function onFloatButtonClick() {
    const btn = ensureFloatButton();
    const viewer = dom.getViewerMedia();
    const profile = viewer ? null : dom.getProfilePhoto();
    const el = viewer ? viewer.el : profile;
    if (!el) { toast('No media found in the viewer', 'error'); return; }

    btn.classList.add('wamd-fab--busy');
    try {
      const kind = viewer ? viewer.kind : 'profile';
      await downloadElement(el, kind);
    } finally {
      btn.classList.remove('wamd-fab--busy');
    }
  }

  /**
   * If the auto-download setting is on, download newly opened viewer
   * media once per blob URL (the Set prevents loops when the observer
   * refires).
   */
  async function maybeAutoDownload() {
    const settings = await storage.getSettings();
    if (!settings.autoDownload) return;
    const viewer = dom.getViewerMedia();
    if (!viewer) return;
    const src = dom.getMediaSource(viewer.el);
    if (!src || autoDownloaded.has(src)) return;
    autoDownloaded.add(src);
    if (autoDownloaded.size > 200) autoDownloaded.clear(); // memory cap
    await downloadElement(viewer.el, viewer.kind);
  }

  /* ========================== Download plumbing ========================== */

  /**
   * Download a single on-page media element through the background
   * queue (or in-page for oversized files).
   *
   * @param {Element} el     media element with a blob: source
   * @param {string} kind    media kind for naming/statistics
   * @param {string} [batchId] set for bulk downloads
   * @returns {Promise<string>} resulting state: queued|duplicate|large|error
   */
  async function downloadElement(el, kind, batchId) {
    const src = dom.getMediaSource(el);
    if (!src) {
      if (!batchId) toast('Media not loaded yet — open it in WhatsApp first', 'error');
      return 'error';
    }
    const settings = await storage.getSettings();
    const { sender, when } = dom.getSenderAndTime(el);
    const { messageId } = dom.getMessageInfo(el);

    try {
      const payload = await download.preparePayload(settings, {
        blobUrl: src,
        kind,
        chatName: dom.getChatName() || 'Unknown Chat',
        sender,
        messageId,
        when,
        caption: dom.getItemCaption(el, kind)
      });

      if (payload.tooLarge) {
        // Oversized for messaging — save directly from the page and
        // report to the background for history/stats only.
        download.downloadInPage(payload.blob, payload.filename);
        await send({
          type: 'WAMD_RECORD_EXTERNAL',
          record: {
            dedupeKey: `sha256:${payload.hash}`,
            filename: payload.filename,
            chatName: dom.getChatName() || 'Unknown Chat',
            kind,
            bytes: payload.bytes
          }
        });
        if (!batchId) toast('Large file — saved to default downloads folder');
        return 'large';
      }

      if (batchId) payload.batchId = batchId;
      const res = await send({ type: 'WAMD_ENQUEUE', payload });
      const status = res && res.result ? res.result.status : 'error';
      if (!batchId) {
        if (status === 'duplicate') toast('Already downloaded — duplicate skipped');
        else toast('Download queued ✓');
      }
      return status;
    } catch (err) {
      if (!batchId) toast(`Download failed: ${err.message}`, 'error');
      return 'error';
    }
  }

  /**
   * Bulk download: scan the chat, apply the requested filters/limit and
   * feed everything into the background queue as one batch.
   *
   * @param {'images'|'videos'|'documents'|'audio'|'all'} filter
   * @param {number} [limit=0]  0 = no limit; N = newest N items
   * @param {{dateFrom?: string, dateTo?: string,
   *          senders?: string[]}} [opts]  extra filters:
   *          - dateFrom/dateTo: "YYYY-MM-DD" range (inclusive); items
   *            with no parseable timestamp are skipped when a range is set
   *          - senders: whitelist of sender names (empty/absent = all)
   * @returns {Promise<object>} summary for the popup
   */
  async function bulkDownload(filter, limit, opts = {}) {
    const KIND_FILTERS = {
      images: ['image', 'gif', 'sticker'],
      videos: ['video'],
      documents: ['document'],
      audio: ['audio', 'voice'],
      all: null
    };
    const kinds = KIND_FILTERS[filter] === undefined ? null : KIND_FILTERS[filter];

    let items = dom.scanChatMedia().filter((i) => !kinds || kinds.includes(i.kind));

    // Sender filter (within the currently open chat).
    if (Array.isArray(opts.senders) && opts.senders.length) {
      const allow = new Set(opts.senders);
      items = items.filter((i) => allow.has(i.sender));
    }

    // Date-range filter on the message timestamp. Items whose date could
    // not be parsed are dropped (and counted) so the range stays honest.
    let undated = 0;
    const from = opts.dateFrom ? new Date(`${opts.dateFrom}T00:00:00`) : null;
    const to = opts.dateTo ? new Date(`${opts.dateTo}T23:59:59.999`) : null;
    if (from || to) {
      items = items.filter((i) => {
        if (!(i.when instanceof Date)) { undated += 1; return false; }
        if (from && i.when < from) return false;
        if (to && i.when > to) return false;
        return true;
      });
    }

    // Newest messages are at the bottom of the DOM → take from the end.
    if (limit > 0) items = items.slice(-limit);

    const downloadable = items.filter((i) => i.loaded && i.kind !== 'document');
    const documents = items.filter((i) => i.kind === 'document');
    const skipped = items.length - downloadable.length - documents.length;

    const batchId = helpers.uid();
    if (downloadable.length) {
      await send({ type: 'WAMD_REGISTER_BATCH', batchId, total: downloadable.length });
    }

    let queued = 0;
    let unreachable = 0; // items that never reached the background queue
    // Sequential preparation keeps memory flat (one blob at a time);
    // the background queue provides the parallelism.
    for (const item of downloadable) {
      const state = await downloadElement(item.el, item.kind, batchId);
      if (state === 'queued' || state === 'large' || state === 'duplicate') queued += 1;
      if (state === 'error' || state === 'large') unreachable += 1;
    }
    // Shrink the batch total for items the queue never saw, so the
    // "Queue complete" summary still fires.
    if (unreachable > 0) {
      await send({ type: 'WAMD_BATCH_ADJUST', batchId, delta: -unreachable });
    }

    // Documents can't be read as blobs from the list; trigger
    // WhatsApp's own download control on each bubble instead.
    let docsClicked = 0;
    for (const docItem of documents) {
      if (clickDocumentDownload(docItem.el)) docsClicked += 1;
      await helpers.sleep(350); // pace the clicks so WhatsApp keeps up
    }

    toast(`Bulk download: ${queued} queued` +
      (docsClicked ? `, ${docsClicked} documents via WhatsApp` : '') +
      (skipped ? `, ${skipped} not loaded` : '') +
      (undated ? `, ${undated} skipped (no date)` : ''));
    return { queued, documents: docsClicked, skipped, undated, total: items.length };
  }

  /**
   * Trigger WhatsApp's own download affordance inside a document
   * bubble. Uses only user-visible UI (no internal APIs); filenames
   * and folders follow WhatsApp's defaults on this path.
   *
   * @param {Element} bubble  the message container of the document
   * @returns {boolean} whether a click target was found
   */
  function clickDocumentDownload(bubble) {
    const target = selectors.query('documentBubble', bubble);
    const clickable = target
      ? (target.closest('[role="button"]') || target)
      : null;
    if (!clickable) return false;
    clickable.click();
    return true;
  }

  /* ============================== Toasts ============================== */

  /**
   * Show a transient in-page toast (bottom-right, above the FAB).
   *
   * @param {string} text
   * @param {'info'|'error'} [level='info']
   */
  function toast(text, level = 'info') {
    const el = document.createElement('div');
    el.className = `wamd-toast wamd-toast--${level}`;
    el.textContent = text;
    document.body.appendChild(el);
    // Trigger the CSS enter transition on the next frame.
    requestAnimationFrame(() => el.classList.add('wamd-toast--visible'));
    setTimeout(() => {
      el.classList.remove('wamd-toast--visible');
      setTimeout(() => el.remove(), 400);
    }, 3200);
  }

  /* ============================ Messaging ============================ */

  /**
   * Thin promise wrapper around chrome.runtime.sendMessage that never
   * throws on a closed channel.
   *
   * @param {object} msg
   * @returns {Promise<object|null>}
   */
  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  /**
   * Handle popup requests. Synchronous data is answered immediately;
   * bulk downloads respond when the batch has been fully enqueued.
   */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg && msg.type) {
      case 'WAMD_GET_STATE':
        rescan(); // fresh numbers when the popup opens
        sendResponse({
          ok: true,
          result: {
            chatName: lastScan.chatName,
            counts: lastScan.counts,
            senders: lastScan.senders,
            total: lastScan.total,
            loaded: lastScan.loaded,
            health: selectors.healthReport()
          }
        });
        return false;

      case 'WAMD_BULK_DOWNLOAD':
        bulkDownload(msg.filter, msg.limit || 0, {
          dateFrom: msg.dateFrom || null,
          dateTo: msg.dateTo || null,
          senders: msg.senders || null
        })
          .then((summary) => sendResponse({ ok: true, result: summary }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true; // async

      default:
        return false;
    }
  });

  init();
})();
