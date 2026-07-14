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

  const { helpers, storage, license } = globalThis.WAMD;

  /** Shorthand for document.getElementById. */
  const $ = (id) => document.getElementById(id);

  /** The active WhatsApp tab id (null when off-site). */
  let waTabId = null;

  /** Cached licence/quota status (refreshed from the background). */
  let proState = { pro: false, used: 0, limit: license.FREE_LIMIT, remaining: license.FREE_LIMIT, plan: null };

  /* ============================ Bootstrap ============================ */

  /**
   * Popup entry point: apply theme, detect the WhatsApp tab, then load
   * every panel in parallel.
   */
  async function init() {
    await applyTheme();
    wireEvents();
    await refreshLicense();

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

    if (onSite) engineInit();
  }

  /* ========================= Licensing / paywall ========================= */

  /** Pull the licence/quota status from the background and render it. */
  async function refreshLicense() {
    const res = await send({ type: 'WAMD_LICENSE_STATUS' });
    if (res && res.ok) proState = res.result;
    renderAccount();
    applyProLocks();
  }

  /** Render the account card (Pro badge, or free quota + upgrade pitch). */
  function renderAccount() {
    $('account-card').classList.remove('hidden');
    $('plan-tag').hidden = !proState.pro;

    if (proState.pro) {
      $('acct-title').textContent = 'MediaVault Pro';
      $('acct-title').classList.add('is-pro');
      $('acct-sub').textContent = proState.plan === 'monthly'
        ? 'Monthly subscription · unlimited downloads'
        : 'Lifetime licence · unlimited downloads';
      $('btn-upgrade').textContent = 'Manage';
      $('quota-wrap').classList.add('hidden');
      $('acct-pitch').classList.add('hidden');
      $('link-have-key').classList.add('hidden');
      return;
    }

    const { used, limit } = proState;
    const left = Math.max(0, limit - used);
    $('acct-title').textContent = 'Free plan';
    $('acct-title').classList.remove('is-pro');
    $('acct-sub').textContent = `${left} of ${limit} free downloads left`;
    $('quota-wrap').classList.remove('hidden');
    const pct = Math.min(100, Math.round((used / limit) * 100));
    $('quota-fill').style.width = `${pct}%`;
    $('quota-fill').classList.toggle('full', used >= limit);
    $('quota-text').textContent = used >= limit
      ? 'Free limit reached — upgrade for unlimited downloads'
      : `${used} / ${limit} downloads used`;
    $('btn-upgrade').textContent = 'Upgrade';
    const p = license.PRICING;
    $('acct-pitch').classList.remove('hidden');
    $('link-have-key').classList.remove('hidden');
    $('acct-pitch').textContent =
      `Go Pro for unlimited downloads, whole-chat export, ZIP, filters & more — ` +
      `${p.monthly.price}${p.monthly.period} or ${p.lifetime.launch} lifetime.`;
  }

  /**
   * Enable/disable Pro-only controls based on the licence. Free users see
   * the controls locked; the primary action buttons are intercepted at
   * click time (see the guards in the engine/bulk handlers).
   */
  function applyProLocks() {
    const pro = proState.pro;
    // Sub-option inputs are disabled outright for free users.
    for (const id of ['n-caption', 'n-orig', 'n-zip', 'e-from', 'e-to',
      'date-from', 'date-to', 'auto-scroll']) {
      const el = $(id);
      if (el) el.disabled = !pro;
    }
    // Visual "locked" treatment on every data-pro group.
    for (const group of document.querySelectorAll('[data-pro]')) {
      group.classList.toggle('locked', !pro);
    }
    // Pro users have already unlocked everything — drop the "PRO" tags.
    for (const badge of document.querySelectorAll('.pro-badge')) {
      badge.style.display = pro ? 'none' : '';
    }
  }

  /** Open the checkout/upgrade page in a new tab. */
  function openUpgrade() {
    chrome.tabs.create({ url: license.CONFIG.checkoutUrl });
  }

  /**
   * Guard a Pro-only action: returns true (and opens the upgrade page)
   * when the user is on the free plan, so callers can bail early.
   *
   * @returns {boolean} true when blocked
   */
  function blockIfFree() {
    if (proState.pro) return false;
    openUpgrade();
    return true;
  }

  /* ============================ Engine ============================ */

  /**
   * Boot the Store engine: inject wa-js + the page bridge into the tab's
   * MAIN world (on demand, now that WhatsApp is loaded — this timing is
   * what lets wa-js hook WhatsApp's internals), then wait for readiness
   * and load the chat list.
   */
  async function engineInit() {
    wireEngineEvents();
    const injected = await ensureEngineInjected();
    if (!injected) {
      setBadge('unavailable', 'err');
      $('engine-note').textContent = 'Could not inject the engine. Reload the WhatsApp tab and reopen.';
      return;
    }
    if (await waitForEngine(20)) await loadEngineChats();
  }

  /**
   * Inject the vendor library and page bridge into the MAIN world via
   * chrome.scripting, skipping either if it is already present.
   *
   * @returns {Promise<boolean>} whether injection succeeded
   */
  async function ensureEngineInjected() {
    if (waTabId === null || !chrome.scripting) return false;
    const runInMain = async (func) => {
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: waTabId }, world: 'MAIN', func
        });
        return res && res.result;
      } catch (_) { return undefined; }
    };
    const injectFile = (file) => chrome.scripting.executeScript({
      target: { tabId: waTabId }, world: 'MAIN', files: [file]
    });

    try {
      if (!(await runInMain(() => !!window.WPP))) {
        await injectFile('vendor/wppconnect-wa.js');
      }
      if (!(await runInMain(() => !!window.__WAMD_BRIDGE__))) {
        await injectFile('wa-bridge.js');
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Set the engine status badge text + state class. */
  function setBadge(text, cls) {
    const b = $('engine-status');
    b.textContent = text;
    b.className = `badge${cls ? ' ' + cls : ''}`;
  }

  /**
   * Poll engine status until ready (wa-js needs a moment to connect).
   *
   * @param {number} tries
   * @returns {Promise<boolean>}
   */
  async function waitForEngine(tries) {
    for (let i = 0; i < tries; i++) {
      const res = await sendToTab({ type: 'WAMD_ENGINE_STATUS' });
      const s = res && res.ok ? res.result : null;
      if (s && s.readyState === 'ready') { setBadge('connected', 'ok'); return true; }
      setBadge('connecting…', '');
      await new Promise((r) => setTimeout(r, 1500));
    }
    setBadge('timed out', 'err');
    $('engine-note').textContent = 'Engine did not connect. Make sure you are logged into WhatsApp Web, then reload the tab.';
    return false;
  }

  /** Attach engine-card listeners once. */
  let engineWired = false;
  function wireEngineEvents() {
    if (engineWired) return;
    engineWired = true;
    $('engine-reload-chats').addEventListener('click', loadEngineChats);
    $('engine-chat').addEventListener('change', loadEngineStats);
    $('engine-download').addEventListener('click', startEngineDownload);
    $('engine-export-text').addEventListener('click', startExportText);
  }

  /** Populate the chat dropdown from the engine. */
  async function loadEngineChats() {
    const sel = $('engine-chat');
    sel.innerHTML = '<option value="">Loading chats…</option>';
    const res = await sendToTab({ type: 'WAMD_ENGINE_CHATS' });
    if (!res || !res.ok) {
      sel.innerHTML = '<option value="">Could not load chats</option>';
      $('engine-note').textContent = res && res.error ? res.error : 'Chat list failed.';
      return;
    }
    const chats = res.result || [];
    sel.innerHTML = '<option value="">Select a chat / group…</option>';
    for (const c of chats) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = (c.isGroup ? '👥 ' : '') + c.name;
      opt.dataset.name = c.name;
      sel.appendChild(opt);
    }
    $('engine-note').textContent = `${chats.length} chats available.`;
  }

  /** Load and render media statistics for the selected chat. */
  async function loadEngineStats() {
    const sel = $('engine-chat');
    const chatId = sel.value;
    $('engine-download').disabled = true;
    $('engine-export-text').disabled = !chatId; // text export needs only a chat
    $('engine-stats').classList.add('hidden');
    $('engine-range').textContent = '';
    if (!chatId) return;

    const chatName = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : '';
    $('engine-note').textContent = 'Scanning chat history…';
    const res = await sendToTab({ type: 'WAMD_ENGINE_STATS', chatId, chatName });
    if (!res || !res.ok) {
      $('engine-note').textContent = `Could not read chat: ${res && res.error ? res.error : 'unknown error'}`;
      return;
    }
    const s = res.result;
    $('e-total').textContent = s.total;
    $('e-image').textContent = s.counts.image || 0;
    $('e-video').textContent = s.counts.video || 0;
    $('e-audio').textContent = s.counts.audio || 0;
    $('e-document').textContent = s.counts.document || 0;
    $('engine-stats').classList.remove('hidden');
    if (s.from && s.to) {
      const fmt = (ms) => new Date(ms).toLocaleDateString();
      $('engine-range').textContent = `Date range: ${fmt(s.from)} – ${fmt(s.to)}`;
    }
    $('engine-note').textContent = s.total ? 'Adjust filters, then download.' : 'No media found in this chat.';
    $('engine-download').disabled = s.total === 0;
  }

  /** Kick off a Store-based download for the selected chat + filters. */
  async function startEngineDownload() {
    if (blockIfFree()) return;   // whole-history export is a Pro feature
    const sel = $('engine-chat');
    const chatId = sel.value;
    if (!chatId) return;
    const chatName = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : '';
    const types = Array.from(document.querySelectorAll('.e-type:checked')).map((c) => c.value);
    if (!types.length) { $('engine-note').textContent = 'Select at least one media type.'; return; }

    const from = $('e-from').value ? new Date(`${$('e-from').value}T00:00:00`).getTime() : null;
    const to = $('e-to').value ? new Date(`${$('e-to').value}T23:59:59.999`).getTime() : null;
    const limit = parseInt($('e-limit').value, 10) || 0;
    const naming = {
      useCaption: $('n-caption').checked,
      appendOrig: $('n-orig').checked,
      useDate: $('n-date').checked
    };
    const zip = $('n-zip').checked;

    const btn = $('engine-download');
    btn.disabled = true;
    btn.classList.add('busy');
    $('engine-note').textContent = zip
      ? 'Building ZIP… scanning history and decrypting media. Keep this tab open — this can take a while.'
      : 'Downloading… large chats can take a while. Keep this popup open.';
    try {
      const res = await sendToTab({
        type: 'WAMD_ENGINE_DOWNLOAD', chatId, chatName, types, from, to, limit, naming, zip
      });
      if (!res || !res.ok) {
        $('engine-note').textContent = `Download failed: ${res && res.error ? res.error : 'unknown error'}`;
      } else {
        const r = res.result;
        $('engine-note').textContent = zip
          ? `ZIP saved: ${r.queued} file(s)` + (r.failed ? `, ${r.failed} unavailable/expired` : '') + '.'
          : `Queued ${r.queued} file(s)` + (r.failed ? `, ${r.failed} unavailable/expired` : '') + '. See the queue below.';
      }
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      refreshQueue();
      refreshLicense();
    }
  }

  /** Export the selected chat's full text transcript to a .txt file. */
  async function startExportText() {
    if (blockIfFree()) return;   // chat-text export is a Pro feature
    const sel = $('engine-chat');
    const chatId = sel.value;
    if (!chatId) return;
    const chatName = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : '';
    const from = $('e-from').value ? new Date(`${$('e-from').value}T00:00:00`).getTime() : null;
    const to = $('e-to').value ? new Date(`${$('e-to').value}T23:59:59.999`).getTime() : null;

    const btn = $('engine-export-text');
    btn.disabled = true;
    btn.classList.add('busy');
    $('engine-note').textContent = 'Reading chat history and building the transcript…';
    try {
      const res = await sendToTab({ type: 'WAMD_ENGINE_EXPORT_TEXT', chatId, chatName, from, to });
      $('engine-note').textContent = (res && res.ok)
        ? `Saved transcript: ${res.result.count} message(s) → ${chatName || 'Chat'}_chat.txt`
        : `Text export failed: ${res && res.error ? res.error : 'unknown error'}`;
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
    }
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
    $('btn-upgrade').addEventListener('click', openUpgrade);
    $('link-have-key').addEventListener('click', (ev) => {
      ev.preventDefault();
      chrome.runtime.openOptionsPage();
    });
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
   * scope limit, optional date range and sender selection. When the
   * "auto-scroll" toggle is on it drives the auto-load path instead, which
   * scrolls the chat to pull in and download older history.
   *
   * @param {HTMLButtonElement} btn  clicked button (data-filter attr)
   */
  async function startBulk(btn) {
    const filter = btn.dataset.filter;
    const limit = parseInt($('scope').value, 10) || 0;
    const dateFrom = $('date-from').value || null;
    const dateTo = $('date-to').value || null;
    const senders = selectedSenders();
    const autoScroll = $('auto-scroll').checked;

    if (autoScroll && blockIfFree()) return; // auto-scroll loader is Pro

    btn.disabled = true;
    btn.classList.add('busy');
    if (autoScroll) $('scan-note').textContent = 'Auto-scrolling and downloading… keep this tab open.';
    try {
      const res = await sendToTab({
        type: autoScroll ? 'WAMD_AUTO_DOWNLOAD' : 'WAMD_BULK_DOWNLOAD',
        filter, limit, dateFrom, dateTo, senders
      });
      if (!res || !res.ok) {
        $('scan-note').textContent = 'Download failed — is a chat open?';
      } else if (autoScroll && res.result) {
        const r = res.result;
        $('scan-note').textContent =
          `Auto-load done: ${r.queued} queued` + (r.documents ? `, ${r.documents} docs` : '') + '.';
      }
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      refreshQueue();
      refreshLicense();   // quota may have moved
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
