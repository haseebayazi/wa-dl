/**
 * utils/storage.js
 * ------------------------------------------------------------------
 * All persistence for MediaVault:
 *
 *  - Settings      → chrome.storage.sync   (small, roams with account)
 *  - Statistics    → chrome.storage.local  (counters, updated often)
 *  - Download log  → IndexedDB             (unbounded history + dedupe index)
 *
 * IndexedDB is available in the MV3 service worker, the popup and the
 * content script, so the same wrapper is used everywhere. All data
 * stays on the local machine — nothing is ever uploaded.
 *
 * Attaches to `globalThis.WAMD.storage`.
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  root.WAMD = root.WAMD || {};

  /** Default values for every user-configurable setting. */
  const DEFAULT_SETTINGS = {
    downloadFolder: 'WhatsApp',      // root folder inside the browser download dir
    namingStyle: 'chat_datetime',    // 'chat_datetime' | 'sender_messageid'
    organizeFolders: true,           // WhatsApp/<Chat>/<Type>/file
    autoDownload: false,             // auto-download media opened in the viewer
    darkMode: 'auto',                // 'auto' | 'dark' | 'light' (popup/options UI)
    notifications: true,             // chrome.notifications toasts
    duplicateDetection: true,        // skip files already downloaded
    maxConcurrent: 3                 // parallel downloads in the queue (1-8)
  };

  /** Default values for the statistics counters. */
  const DEFAULT_STATS = {
    totalDownloads: 0,
    images: 0,
    videos: 0,
    audio: 0,
    documents: 0,
    other: 0,
    bytes: 0,
    lastDownloadAt: null,   // epoch ms
    lastDownloadName: null
  };

  /* ================= Settings (chrome.storage.sync) ================= */

  /**
   * Load settings, merging stored values over the defaults so new
   * settings added in future versions pick up their default.
   *
   * @returns {Promise<object>}
   */
  async function getSettings() {
    const stored = await chrome.storage.sync.get('settings');
    return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  }

  /**
   * Persist a partial settings patch (merged over current values).
   *
   * @param {object} patch
   * @returns {Promise<object>} the resulting full settings object
   */
  async function saveSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...patch };
    // Clamp values that could break the queue if hand-edited.
    next.maxConcurrent = Math.min(8, Math.max(1, Number(next.maxConcurrent) || 3));
    await chrome.storage.sync.set({ settings: next });
    return next;
  }

  /**
   * Subscribe to settings changes (any context).
   *
   * @param {(settings: object) => void} callback
   */
  function onSettingsChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.settings) {
        callback({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) });
      }
    });
  }

  /* ================= Statistics (chrome.storage.local) ================= */

  /**
   * Read the statistics counters.
   *
   * @returns {Promise<object>}
   */
  async function getStats() {
    const stored = await chrome.storage.local.get('stats');
    return { ...DEFAULT_STATS, ...(stored.stats || {}) };
  }

  /**
   * Record one completed download in the statistics.
   *
   * @param {{kind: string, bytes: number, filename: string}} info
   * @returns {Promise<object>} updated stats
   */
  async function recordDownloadStat(info) {
    const stats = await getStats();
    stats.totalDownloads += 1;
    stats.bytes += Math.max(0, Number(info.bytes) || 0);
    const bucket = { image: 'images', gif: 'images', sticker: 'images', status: 'images',
      profile: 'images', video: 'videos', audio: 'audio', voice: 'audio',
      document: 'documents' }[info.kind] || 'other';
    stats[bucket] += 1;
    stats.lastDownloadAt = Date.now();
    stats.lastDownloadName = info.filename || null;
    await chrome.storage.local.set({ stats });
    return stats;
  }

  /**
   * Reset all statistics counters to zero.
   *
   * @returns {Promise<void>}
   */
  async function resetStats() {
    await chrome.storage.local.set({ stats: { ...DEFAULT_STATS } });
  }

  /* ================= Download history (IndexedDB) ================= */

  const DB_NAME = 'wamd-history';
  const DB_VERSION = 1;
  const STORE = 'downloads';

  let dbPromise = null;

  /**
   * Open (and lazily create) the history database. The connection is
   * cached per context; IndexedDB handles multi-context access safely.
   *
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'dedupeKey' });
          store.createIndex('byTime', 'timestamp');
          store.createIndex('byChat', 'chatName');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  /**
   * Run one transaction against the history store.
   *
   * @param {'readonly'|'readwrite'} mode
   * @param {(store: IDBObjectStore) => IDBRequest|void} fn
   * @returns {Promise<*>} result of the request returned by `fn`
   */
  async function withStore(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  /**
   * Record a completed download in history. `dedupeKey` is the
   * duplicate-detection key (content hash or WhatsApp message id).
   *
   * @param {{dedupeKey: string, filename: string, chatName: string,
   *          kind: string, bytes: number, timestamp?: number}} record
   * @returns {Promise<void>}
   */
  async function addHistory(record) {
    const row = { timestamp: Date.now(), ...record };
    await withStore('readwrite', (store) => store.put(row));
  }

  /**
   * Check whether a dedupe key was already downloaded.
   *
   * @param {string} dedupeKey
   * @returns {Promise<boolean>}
   */
  async function hasHistory(dedupeKey) {
    if (!dedupeKey) return false;
    const row = await withStore('readonly', (store) => store.get(dedupeKey));
    return row !== undefined;
  }

  /**
   * Search history records by filename or chat name substring,
   * newest first, capped at `limit` results.
   *
   * @param {string} query   case-insensitive substring; empty = all
   * @param {number} [limit=100]
   * @returns {Promise<object[]>}
   */
  async function searchHistory(query, limit = 100) {
    const q = String(query || '').toLowerCase();
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const results = [];
      const tx = db.transaction(STORE, 'readonly');
      // Walk the time index backwards so newest rows come first.
      const cursorReq = tx.objectStore(STORE).index('byTime').openCursor(null, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        const row = cursor.value;
        const hay = `${row.filename || ''} ${row.chatName || ''}`.toLowerCase();
        if (!q || hay.includes(q)) results.push(row);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  /**
   * Count history rows (for the options page).
   *
   * @returns {Promise<number>}
   */
  async function countHistory() {
    return withStore('readonly', (store) => store.count());
  }

  /**
   * Wipe the entire download history (also disables dedupe hits).
   *
   * @returns {Promise<void>}
   */
  async function clearHistory() {
    await withStore('readwrite', (store) => store.clear());
  }

  root.WAMD.storage = {
    DEFAULT_SETTINGS,
    DEFAULT_STATS,
    getSettings,
    saveSettings,
    onSettingsChanged,
    getStats,
    recordDownloadStat,
    resetStats,
    addHistory,
    hasHistory,
    searchHistory,
    countHistory,
    clearHistory
  };
})(globalThis);
