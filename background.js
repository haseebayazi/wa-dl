/**
 * background.js — MV3 service worker
 * ------------------------------------------------------------------
 * Owns everything that must outlive the page:
 *
 *   - the download queue (concurrency, retry, cancel)
 *   - chrome.downloads integration
 *   - duplicate detection against IndexedDB history
 *   - statistics counters
 *   - chrome.notifications
 *
 * The queue lives in memory. Chrome may suspend an idle MV3 worker,
 * but every queue transition triggers chrome API activity (downloads,
 * storage, messaging) which keeps the worker alive while work is
 * pending; a suspended worker simply restarts with an empty queue,
 * which is safe because history/stats are already persisted.
 * ------------------------------------------------------------------
 */

'use strict';

// Shared classic-script modules (same files the content script uses).
importScripts('utils/helpers.js', 'utils/storage.js', 'utils/license.js');

const helpers = globalThis.WAMD.helpers;
const store = globalThis.WAMD.storage;
const license = globalThis.WAMD.license;

/** Maximum automatic retry attempts per failed item. */
const MAX_RETRIES = 3;

/** In-memory download queue. Map preserves insertion order. */
const queue = new Map(); // id → item

/** Batches (bulk downloads) → summary notification when settled. */
const batches = new Map(); // batchId → {total, done, failed, duplicates}

/** Number of downloads currently handed to chrome.downloads. */
let activeCount = 0;

/* ============================ Free-tier quota ============================ */

/**
 * Serialize free-quota reservations so parallel enqueues can't race past
 * the limit (e.g. a bulk batch prepared with Promise.all). Each call runs
 * after the previous one settles.
 *
 * @returns {Promise<object>} result of license.reserve()
 */
let reserveChain = Promise.resolve();
function reserveSlot() {
  const p = reserveChain.then(() => license.reserve());
  reserveChain = p.then(() => {}, () => {});
  return p;
}

/**
 * Notify the user (once, if notifications are on) that the free download
 * allowance is spent. The popup's upgrade card is the always-visible cue.
 *
 * @param {object} settings
 * @param {object} slot  failed license.reserve() result
 */
function notifyQuota(settings, slot) {
  notify('Free download limit reached',
    `You've used all ${slot.limit} free downloads. Upgrade to MediaVault Pro for unlimited saving.`,
    settings);
}

/* ================================ Queue ================================ */

/**
 * Add one prepared payload (from the content script) to the queue and
 * kick the pump. Performs duplicate detection before queueing.
 *
 * @param {object} payload  serializable item from utils/download.js
 * @returns {Promise<{status: string, id: string}>}
 */
async function enqueue(payload) {
  const settings = await store.getSettings();

  // Duplicate detection: content hash recorded on previous completions.
  if (settings.duplicateDetection && payload.dedupeKey) {
    const dup = await store.hasHistory(payload.dedupeKey).catch(() => false);
    if (dup) {
      trackBatch(payload.batchId, 'duplicates');
      checkBatchDone(payload.batchId, settings);
      await maybeNotify(settings, 'duplicate', payload);
      broadcastQueue();
      return { status: 'duplicate', id: payload.id };
    }
  }

  // Free-tier gate: consume one of the 50 lifetime free downloads (Pro is
  // unlimited and never counted). Over the limit → refuse and prompt upgrade.
  // Batch accounting for refused items is handled by the caller, which stops
  // the batch and adjusts its total — so we don't touch the batch here.
  const slot = await reserveSlot();
  if (!slot.ok) {
    notifyQuota(settings, slot);
    broadcastQueue();
    return { status: 'quota_exceeded', id: payload.id, limit: slot.limit, remaining: 0 };
  }

  queue.set(payload.id, {
    ...payload,
    state: 'queued',       // queued | active | completed | failed | duplicate | canceled
    reserved: !slot.pro,   // true when a free slot was consumed (refund on failure)
    attempts: 0,
    error: null,
    addedAt: Date.now()
  });
  broadcastQueue();
  pump();
  return { status: 'queued', id: payload.id };
}

/**
 * Start as many queued items as the concurrency limit allows.
 * Re-entrant safe: called after every state change.
 */
async function pump() {
  const settings = await store.getSettings();
  for (const item of queue.values()) {
    if (activeCount >= settings.maxConcurrent) break;
    if (item.state !== 'queued') continue;
    item.state = 'active';
    activeCount += 1;
    runItem(item, settings); // intentionally not awaited — parallel
  }
  broadcastQueue();
}

/**
 * Execute one queue item via chrome.downloads, with retry/backoff.
 * On success records history + stats and (maybe) notifies.
 *
 * @param {object} item      mutable queue entry
 * @param {object} settings  resolved settings snapshot
 */
async function runItem(item, settings) {
  try {
    item.attempts += 1;
    const downloadId = await chrome.downloads.download({
      url: item.url,
      filename: item.filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    item.downloadId = downloadId;
    await waitForDownload(downloadId);

    item.state = 'completed';
    item.url = null; // free the (potentially huge) data URL immediately
    await store.addHistory({
      dedupeKey: item.dedupeKey || `id:${item.id}`,
      filename: item.filename,
      chatName: item.chatName,
      kind: item.kind,
      bytes: item.bytes
    }).catch(() => { /* history is best-effort */ });
    await store.recordDownloadStat(item).catch(() => { /* stats best-effort */ });
    trackBatch(item.batchId, 'done');
    await maybeNotify(settings, 'completed', item);
  } catch (err) {
    if (item.state === 'canceled') {
      // User canceled while active — nothing more to do.
    } else if (item.attempts < MAX_RETRIES) {
      // Exponential backoff, THEN requeue — while sleeping the item
      // stays 'active' so pump() cannot start it a second time.
      await helpers.sleep(1000 * 2 ** (item.attempts - 1));
      if (item.state === 'active') item.state = 'queued';
    } else {
      item.state = 'failed';
      item.error = err && err.message ? err.message : String(err);
      // A reserved free slot shouldn't be spent on a download that failed.
      if (item.reserved) { item.reserved = false; await license.refund(); }
      trackBatch(item.batchId, 'failed');
      await maybeNotify(settings, 'failed', item);
    }
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    checkBatchDone(item.batchId, settings);
    broadcastQueue();
    pump();
  }
}

/**
 * Resolve when a chrome.downloads item reaches a terminal state,
 * reject on interruption. Also polls as a safety net because delta
 * events can be missed if the worker restarts mid-download.
 *
 * @param {number} downloadId
 * @returns {Promise<void>}
 */
function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    /** Detach listener + interval once settled. */
    const cleanup = () => {
      chrome.downloads.onChanged.removeListener(onChanged);
      clearInterval(poll);
    };
    /** React to state deltas for our download id. */
    function onChanged(delta) {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') { cleanup(); resolve(); }
      else if (delta.state.current === 'interrupted') {
        cleanup(); reject(new Error('Download interrupted'));
      }
    }
    chrome.downloads.onChanged.addListener(onChanged);
    const poll = setInterval(async () => {
      try {
        const [d] = await chrome.downloads.search({ id: downloadId });
        if (!d) { cleanup(); reject(new Error('Download vanished')); return; }
        if (d.state === 'complete') { cleanup(); resolve(); }
        else if (d.state === 'interrupted') { cleanup(); reject(new Error(d.error || 'Interrupted')); }
      } catch (e) { cleanup(); reject(e); }
    }, 2000);
  });
}

/**
 * Cancel one item (both in-queue and in-flight states).
 *
 * @param {string} id queue item id
 */
async function cancelItem(id) {
  const item = queue.get(id);
  if (!item) return;
  if (item.state === 'active' && item.downloadId != null) {
    await chrome.downloads.cancel(item.downloadId).catch(() => {});
  }
  item.state = 'canceled';
  item.url = null;
  if (item.reserved) { item.reserved = false; await license.refund(); }
  broadcastQueue();
}

/**
 * Reset a failed item for another round of attempts.
 *
 * @param {string} id queue item id
 */
function retryItem(id) {
  const item = queue.get(id);
  if (!item || item.state !== 'failed') return;
  if (!item.url) { item.error = 'Cannot retry: data released. Re-run the download.'; broadcastQueue(); return; }
  item.state = 'queued';
  item.attempts = 0;
  item.error = null;
  pump();
}

/** Remove settled (completed/failed/duplicate/canceled) items. */
function clearSettled() {
  for (const [id, item] of queue) {
    if (['completed', 'failed', 'duplicate', 'canceled'].includes(item.state)) queue.delete(id);
  }
  broadcastQueue();
}

/**
 * Serialize the queue for the popup (drops bulky fields like the
 * data URL so messages stay small).
 *
 * @returns {object[]}
 */
function snapshotQueue() {
  return Array.from(queue.values()).map((i) => ({
    id: i.id,
    filename: i.filename,
    kind: i.kind,
    chatName: i.chatName,
    bytes: i.bytes,
    state: i.state,
    attempts: i.attempts,
    error: i.error,
    canRetry: i.state === 'failed' && !!i.url
  }));
}

/** Push the current queue snapshot to any open popup. */
function broadcastQueue() {
  chrome.runtime.sendMessage({ type: 'WAMD_QUEUE_UPDATE', queue: snapshotQueue() })
    .catch(() => { /* no popup open — expected */ });
}

/* ============================ Batch tracking ============================ */

/**
 * Register a bulk-download batch so a single summary notification is
 * emitted when it settles (instead of one toast per file).
 *
 * @param {string} batchId
 * @param {number} total  number of items in the batch
 */
function registerBatch(batchId, total) {
  if (!batchId || batches.has(batchId) || !(total > 0)) return;
  batches.set(batchId, { total, done: 0, failed: 0, duplicates: 0 });
}

/**
 * Shrink a batch's expected total when the content script could not
 * hand some items to the queue (preparation error / oversized file),
 * then re-check completion so the summary still fires.
 *
 * @param {string} batchId
 * @param {number} delta  negative number of items removed from the batch
 */
async function adjustBatch(batchId, delta) {
  const b = batches.get(batchId);
  if (!b) return;
  b.total = Math.max(0, b.total + delta);
  checkBatchDone(batchId, await store.getSettings());
}

/**
 * Increment one counter of a batch.
 *
 * @param {string|undefined} batchId
 * @param {'done'|'failed'|'duplicates'} key
 */
function trackBatch(batchId, key) {
  const b = batchId ? batches.get(batchId) : null;
  if (b) b[key] += 1;
}

/**
 * If a batch fully settled, emit its summary notification and forget it.
 *
 * @param {string|undefined} batchId
 * @param {object} settings
 */
function checkBatchDone(batchId, settings) {
  const b = batchId ? batches.get(batchId) : null;
  if (!b || b.done + b.failed + b.duplicates < b.total) return;
  batches.delete(batchId);
  if (b.total === 0) return; // batch emptied by adjustments — nothing to report
  notify('Queue complete',
    `${b.done} downloaded, ${b.failed} failed, ${b.duplicates} duplicates skipped.`,
    settings);
}

/* ============================ Notifications ============================ */

/**
 * Emit a per-item notification unless the item belongs to a batch
 * (batches notify once, on completion) or notifications are disabled.
 *
 * @param {object} settings
 * @param {'completed'|'failed'|'duplicate'} event
 * @param {object} item
 */
async function maybeNotify(settings, event, item) {
  if (item.batchId) return; // batch summary covers it
  const name = (item.filename || '').split('/').pop();
  const messages = {
    completed: ['Download complete', name],
    failed: ['Download failed', `${name}\n${item.error || ''}`],
    duplicate: ['Duplicate skipped', `${name} was already downloaded.`]
  };
  const [title, message] = messages[event];
  notify(title, message, settings);
}

/**
 * Low-level chrome.notifications wrapper honoring the user setting.
 *
 * @param {string} title
 * @param {string} message
 * @param {object} settings
 */
function notify(title, message, settings) {
  if (!settings.notifications) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title,
    message: String(message || '').slice(0, 300)
  }, () => { void chrome.runtime.lastError; /* notification errors are non-fatal */ });
}

/* ============================ Licensing ============================ */

/**
 * Verify a licence key with the configured payment provider and, on
 * success, unlock Pro. Uses Gumroad's public verify endpoint by default
 * (no secret key required); works for both one-time and subscription
 * licences. See utils/license.js CONFIG and LAUNCH.md.
 *
 * @param {string} key  the licence key the user pasted
 * @returns {Promise<{pro: boolean, plan: string}>}
 */
async function verifyLicense(key) {
  const cfg = license.CONFIG;
  key = String(key || '').trim();
  if (!key) throw new Error('Enter your licence key.');
  if (!cfg.productPermalink || cfg.productPermalink.startsWith('REPLACE')) {
    throw new Error('Licence activation is not set up yet. Use the Buy button to purchase, or see LAUNCH.md.');
  }

  const body = new URLSearchParams({
    product_permalink: cfg.productPermalink,
    license_key: key,
    increment_uses_count: 'false'
  });
  let data;
  try {
    const resp = await fetch(cfg.verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    data = await resp.json().catch(() => ({}));
  } catch (err) {
    throw new Error('Could not reach the licence server. Check your connection and try again.');
  }
  if (!data || !data.success) {
    throw new Error((data && data.message) || 'Licence key not recognised.');
  }

  const p = data.purchase || {};
  if (p.refunded || p.disputed || p.chargebacked) {
    throw new Error('This purchase was refunded, so the licence is inactive.');
  }
  const ended = p.subscription_cancelled_at || p.subscription_failed_at || p.subscription_ended_at;
  if (ended && new Date(ended).getTime() < Date.now()) {
    throw new Error('This subscription has ended — please renew to keep Pro.');
  }

  const plan = p.subscription_id ? 'monthly' : 'lifetime';
  await license.activate(plan, key);
  return { pro: true, plan };
}

/* ============================ Message router ============================ */

/**
 * Central router for popup + content script requests. Returns true to
 * keep the response channel open for async handlers.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /** Run an async handler and funnel result/error into sendResponse. */
  const respond = (promise) => {
    promise
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true; // async response
  };

  switch (msg && msg.type) {
    case 'WAMD_ENQUEUE':
      return respond(enqueue(msg.payload));

    case 'WAMD_RESERVE':
      // Free-quota reservation for the in-page (oversized) download path,
      // which bypasses the queue. Content asks before saving so free users
      // can't exceed the limit on large files either.
      return respond(reserveSlot());

    case 'WAMD_LICENSE_STATUS':
      return respond(license.getStatus());

    case 'WAMD_LICENSE_VERIFY':
      return respond(verifyLicense(msg.key));

    case 'WAMD_LICENSE_DEACTIVATE':
      return respond(license.deactivate());

    case 'WAMD_REGISTER_BATCH':
      registerBatch(msg.batchId, msg.total);
      sendResponse({ ok: true });
      return false;

    case 'WAMD_BATCH_ADJUST':
      return respond(adjustBatch(msg.batchId, msg.delta));

    case 'WAMD_GET_QUEUE':
      sendResponse({ ok: true, result: snapshotQueue() });
      return false;

    case 'WAMD_RETRY':
      retryItem(msg.id);
      sendResponse({ ok: true });
      return false;

    case 'WAMD_CANCEL':
      return respond(cancelItem(msg.id));

    case 'WAMD_CLEAR_SETTLED':
      clearSettled();
      sendResponse({ ok: true });
      return false;

    case 'WAMD_GET_STATS':
      return respond(store.getStats());

    case 'WAMD_RESET_STATS':
      return respond(store.resetStats());

    case 'WAMD_SEARCH_HISTORY':
      return respond(store.searchHistory(msg.query, msg.limit || 100));

    case 'WAMD_COUNT_HISTORY':
      return respond(store.countHistory());

    case 'WAMD_CLEAR_HISTORY':
      return respond(store.clearHistory());

    case 'WAMD_RECORD_EXTERNAL':
      // In-page (oversized) downloads still count for stats/history.
      return respond((async () => {
        await store.addHistory(msg.record).catch(() => {});
        await store.recordDownloadStat({
          kind: msg.record.kind, bytes: msg.record.bytes, filename: msg.record.filename
        });
      })());

    default:
      return false; // not ours
  }
});

/* ============================ Lifecycle ============================ */

/**
 * First-install hook: persist default settings so the options page
 * shows real values immediately.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await store.saveSettings({});
  }
});
