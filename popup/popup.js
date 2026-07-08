/**
 * popup/popup.js
 * ------------------------------------------------------------------
 * Controller for the toolbar popup:
 *
 *   - detects whether the active tab is WhatsApp Web
 *   - shows current chat + detected media counts (from content.js)
 *   - triggers bulk downloads
 *   - renders the live download queue (pushed by background.js)
 *   - shows statistics and searches download history
 *
 * Uses WAMD.helpers / WAMD.storage loaded as classic scripts before
 * this file. All chrome.* failures degrade to friendly UI states.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const { helpers, storage } = globalThis.WAMD;

  /** Shorthand for document.getElementById. */
  const $ = (id) => document.getElementById(id);

  /** The active WhatsApp tab id (null when off-site). */
  let waTabId = null;

  /* ============================ Bootstrap ============================ */

  /**
   * Popup entry point: apply theme, detect the WhatsApp tab, then load
   * every panel in parallel.
   */
  async function init() {
    await applyTheme();
    wireEvents();

    waTabId = await findWhatsAppTab();
    const onSite = waTabId !== null;
    $('view-offsite').classList.toggle('hidden', onSite);
    $('view-main').classList.toggle('hidden', !onSite);

    await Promise.all([
      onSite ? refreshChatState() : Promise.resolve(),
      refreshQueue(),
      refreshStats(),
      runSearch('')
    ]);
  }

  /**
   * Resolve the popup theme from settings: explicit dark/light pins
   * html[data-theme]; "auto" leaves it unset so the CSS media query
   * decides.
   */
  async function applyTheme() {
    const settings = await storage.getSettings().catch(() => null);
    const mode = settings ? settings.darkMode : 'auto';
    if (mode === 'dark' || mode === 'light') {
      document.documentElement.dataset.theme = mode;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }

  /**
   * Find the active tab if it is WhatsApp Web; otherwise any open
   * WhatsApp tab (so the popup still works from another window focus).
   *
   * @returns {Promise<number|null>} tab id or null
   */
  async function findWhatsAppTab() {
    const isWA = (tab) => tab && tab.url && tab.url.startsWith('https://web.whatsapp.com');
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (isWA(active)) return active.id;
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    return tabs.length ? tabs[0].id : null;
  }

  /** Attach all static event listeners once. */
  function wireEvents() {
    $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('btn-open-wa').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      window.close();
    });
    $('btn-refresh').addEventListener('click', refreshChatState);
    $('btn-clear-dates').addEventListener('click', () => {
      $('date-from').value = '';
      $('date-to').value = '';
    });
    $('btn-clear-queue').addEventListener('click', async () => {
      await send({ type: 'WAMD_CLEAR_SETTLED' });
      refreshQueue();
    });

    // One handler for every bulk-download button.
    for (const btn of document.querySelectorAll('.btn-grid .btn')) {
      btn.addEventListener('click', () => startBulk(btn));
    }

    // Debounced history search.
    $('search').addEventListener('input', helpers.debounce((ev) => {
      runSearch(ev.target.value);
    }, 250));

    // Live queue updates pushed by the service worker.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'WAMD_QUEUE_UPDATE') renderQueue(msg.queue);
    });
  }

  /* ========================= Messaging helpers ========================= */

  /**
   * Send a message to the background service worker.
   *
   * @param {object} msg
   * @returns {Promise<object|null>} response or null on error
   */
  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  /**
   * Send a message to the content script in the WhatsApp tab.
   *
   * @param {object} msg
   * @returns {Promise<object|null>} response or null when unreachable
   */
  function sendToTab(msg) {
    if (waTabId === null) return Promise.resolve(null);
    return chrome.tabs.sendMessage(waTabId, msg).catch(() => null);
  }

  /* ========================== Chat state panel ========================== */

  /**
   * Ask content.js for the current chat + media counts and render
   * them. Also surfaces selector-health warnings so users understand
   * degradation after WhatsApp updates.
   */
  async function refreshChatState() {
    const res = await sendToTab({ type: 'WAMD_GET_STATE' });
    if (!res || !res.ok) {
      $('chat-name').textContent = 'WhatsApp still loading — reload the tab if this persists';
      return;
    }
    const { chatName, counts, senders, total, loaded, health } = res.result;

    $('chat-name').textContent = chatName ? `Chat: ${chatName}` : 'No chat open';
    const kinds = ['image', 'video', 'audio', 'voice', 'document', 'sticker'];
    for (const kind of kinds) {
      // GIFs are counted with images in the chip row.
      const extra = kind === 'image' ? (counts.gif || 0) : 0;
      $(`c-${kind}`).textContent = (counts[kind] || 0) + extra;
    }
    renderSenders(senders || []);
    $('scan-note').textContent = total
      ? `${loaded} of ${total} items loaded and downloadable`
      : 'No media detected — open a chat and scroll through it';

    // Selector health: warn when core roles stopped matching.
    const critical = ['conversationPanel', 'chatTitle'];
    const broken = critical.filter((role) => health && health[role] === false);
    const warnEl = $('health-warning');
    if (chatName === null && broken.length) {
      warnEl.textContent = '⚠ WhatsApp Web may have changed its layout — some features are degraded. Check for an extension update.';
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  }

  /* ======================== Sender filter (chat) ======================== */

  /**
   * Render one checkbox per detected sender in the open chat, preserving
   * any selections across refreshes. No selection means "all senders".
   *
   * @param {string[]} senders  distinct sender names from the last scan
   */
  function renderSenders(senders) {
    const list = $('sender-list');
    const prev = new Set(selectedSenders());
    list.textContent = '';

    if (!senders.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'No senders detected yet — scroll the chat.';
      list.appendChild(p);
      updateSenderSummary();
      return;
    }

    for (const name of senders) {
      const label = document.createElement('label');
      label.className = 'sender-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.checked = prev.has(name);
      cb.addEventListener('change', updateSenderSummary);
      const span = document.createElement('span');
      span.textContent = name;
      label.append(cb, span);
      list.appendChild(label);
    }
    updateSenderSummary();
  }

  /** The list of currently checked sender names (empty = all). */
  function selectedSenders() {
    return Array.from($('sender-list').querySelectorAll('input:checked'))
      .map((cb) => cb.value);
  }

  /** Update the "(N selected)" / "(all)" hint next to the sender list. */
  function updateSenderSummary() {
    const n = selectedSenders().length;
    $('sender-summary').textContent = n ? `(${n} selected)` : '(all)';
  }

  /* ========================== Bulk downloads ========================== */

  /**
   * Kick off a bulk download for the clicked filter button, applying the
   * scope limit, optional date range and sender selection. Shows a busy
   * spinner until the batch has been fully enqueued by the content script.
   *
   * @param {HTMLButtonElement} btn  clicked button (data-filter attr)
   */
  async function startBulk(btn) {
    const filter = btn.dataset.filter;
    const limit = parseInt($('scope').value, 10) || 0;
    const dateFrom = $('date-from').value || null;
    const dateTo = $('date-to').value || null;
    const senders = selectedSenders();

    btn.disabled = true;
    btn.classList.add('busy');
    try {
      const res = await sendToTab({
        type: 'WAMD_BULK_DOWNLOAD', filter, limit, dateFrom, dateTo, senders
      });
      if (!res || !res.ok) {
        $('scan-note').textContent = 'Bulk download failed — is a chat open?';
      }
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      refreshQueue();
    }
  }

  /* ============================ Queue panel ============================ */

  /** Pull the current queue snapshot from the background. */
  async function refreshQueue() {
    const res = await send({ type: 'WAMD_GET_QUEUE' });
    if (res && res.ok) renderQueue(res.result);
  }

  /**
   * Render the queue list, the summary line and the progress bar.
   *
   * @param {object[]} items  serialized queue snapshot
   */
  function renderQueue(items) {
    const list = $('queue-list');
    list.textContent = '';

    const settled = items.filter((i) =>
      ['completed', 'failed', 'duplicate', 'canceled'].includes(i.state)).length;

    // Summary + progress bar.
    $('queue-summary').textContent = items.length
      ? `${settled}/${items.length} done`
      : 'empty';
    const progress = $('queue-progress');
    progress.classList.toggle('hidden', items.length === 0);
    $('queue-progress-bar').style.width = items.length
      ? `${Math.round((settled / items.length) * 100)}%`
      : '0%';

    // Newest first, capped for popup performance.
    for (const item of items.slice(-40).reverse()) {
      const li = document.createElement('li');

      const state = document.createElement('span');
      state.className = `state state-${item.state}`;
      state.textContent = item.state;
      li.appendChild(state);

      const name = document.createElement('span');
      name.className = 'name';
      name.title = item.error || item.filename;
      name.textContent = (item.filename || '').split('/').pop();
      li.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = helpers.formatBytes(item.bytes);
      li.appendChild(meta);

      // Retry / cancel controls where applicable.
      if (item.canRetry) {
        li.appendChild(miniButton('↻', 'Retry', async () => {
          await send({ type: 'WAMD_RETRY', id: item.id });
          refreshQueue();
        }));
      }
      if (item.state === 'queued' || item.state === 'active') {
        li.appendChild(miniButton('✕', 'Cancel', async () => {
          await send({ type: 'WAMD_CANCEL', id: item.id });
          refreshQueue();
        }));
      }
      list.appendChild(li);
    }
  }

  /**
   * Build one small inline action button for queue rows.
   *
   * @param {string} glyph  button text
   * @param {string} title  tooltip
   * @param {Function} onClick
   * @returns {HTMLButtonElement}
   */
  function miniButton(glyph, title, onClick) {
    const b = document.createElement('button');
    b.className = 'mini';
    b.title = title;
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ============================ Statistics ============================ */

  /** Load and render the statistics card. */
  async function refreshStats() {
    const res = await send({ type: 'WAMD_GET_STATS' });
    if (!res || !res.ok) return;
    const s = res.result;
    $('s-total').textContent = s.totalDownloads;
    $('s-images').textContent = s.images;
    $('s-videos').textContent = s.videos;
    $('s-audio').textContent = s.audio;
    $('s-documents').textContent = s.documents;
    $('s-bytes').textContent = helpers.formatBytes(s.bytes);
    $('s-last').textContent = s.lastDownloadAt
      ? `Last: ${(s.lastDownloadName || '').split('/').pop()} · ${new Date(s.lastDownloadAt).toLocaleString()}`
      : 'No downloads yet';
  }

  /* ========================== History search ========================== */

  /**
   * Query download history and render up to 25 results.
   *
   * @param {string} query  substring filter (empty = recent files)
   */
  async function runSearch(query) {
    const res = await send({ type: 'WAMD_SEARCH_HISTORY', query, limit: 25 });
    const list = $('search-results');
    list.textContent = '';
    if (!res || !res.ok) return;

    for (const row of res.result) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.title = row.filename;
      name.textContent = (row.filename || '').split('/').pop();
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = new Date(row.timestamp).toLocaleDateString();
      li.append(name, meta);
      list.appendChild(li);
    }
    if (!res.result.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = query ? 'No matches.' : 'Nothing downloaded yet.';
      list.appendChild(li);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
