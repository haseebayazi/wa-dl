/**
 * wa-engine.js — isolated-world engine relay
 * ------------------------------------------------------------------
 * Bridges the popup/background (chrome.runtime) and the MAIN-world
 * engine bridge (wa-bridge.js, reached via window.postMessage). It:
 *
 *   - answers popup requests for engine status, the chat list and
 *     per-chat media statistics
 *   - runs Store-based bulk downloads: for each selected media message
 *     it asks the page to decrypt the media, builds a filename with the
 *     user's naming rules and feeds it into the existing background queue
 *
 * Runs in the same isolated world as content.js, so it reuses the shared
 * WAMD.helpers / WAMD.storage / WAMD.download modules.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const REQ = 'WAMD_ENGINE_REQ';
  const RES = 'WAMD_ENGINE_RES';
  const { helpers, storage, download } = globalThis.WAMD || {};

  /* ----------------------- page request plumbing ----------------------- */

  let seq = 0;
  const pending = new Map(); // requestId → settle(frame)

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== RES) return;
    const settle = pending.get(d.id);
    if (!settle) return;
    pending.delete(d.id);
    settle(d);
  });

  /**
   * Call an action on the page-context bridge and await its response.
   *
   * @param {string} action
   * @param {object} [args]
   * @param {number} [timeout] ms
   * @returns {Promise<*>}
   */
  function call(action, args, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const id = `e${++seq}-${Date.now()}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Engine request timed out'));
      }, timeout);
      pending.set(id, (frame) => {
        clearTimeout(timer);
        frame.ok ? resolve(frame.result) : reject(new Error(frame.error || 'Engine error'));
      });
      window.postMessage({ source: REQ, id, action, args: args || {} }, '*');
    });
  }

  /** Thin wrapper around chrome.runtime.sendMessage that never throws. */
  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  /* --------------------------- media caching --------------------------- */

  // Cache the last chat's collected media so the stats call and the
  // subsequent download don't fetch the (potentially large) list twice.
  let cache = { chatId: null, chatName: '', items: [] };

  /** Which media kinds each popup filter maps to. */
  const TYPE_TO_KINDS = {
    images: ['image', 'gif', 'sticker'],
    videos: ['video'],
    audio: ['audio', 'voice'],
    documents: ['document']
  };

  /** Statistics bucket for a media kind. */
  function bucketFor(kind) {
    return ({
      image: 'image', gif: 'image', sticker: 'image',
      video: 'video', audio: 'audio', voice: 'audio', document: 'document'
    })[kind] || 'other';
  }

  /**
   * Collect a chat's media (cached) and summarise counts + date range.
   *
   * @param {string} chatId
   * @param {string} chatName
   */
  async function getStats(chatId, chatName) {
    const { items } = await call('collectMedia', { chatId });
    cache = { chatId, chatName: chatName || '', items };

    const counts = { image: 0, video: 0, audio: 0, document: 0, other: 0 };
    let min = Infinity;
    let max = 0;
    for (const it of items) {
      counts[bucketFor(it.kind)] += 1;
      if (it.t) { if (it.t < min) min = it.t; if (it.t > max) max = it.t; }
    }
    return {
      total: items.length,
      counts,
      from: Number.isFinite(min) ? min * 1000 : null,
      to: max ? max * 1000 : null
    };
  }

  /** Inclusive [from,to] timestamp filter (epoch ms args, seconds `t`). */
  function inRange(t, from, to) {
    const ms = t * 1000;
    if (from && ms < from) return false;
    if (to && ms > to) return false;
    return true;
  }

  /**
   * Download the selected chat's media through the background queue.
   *
   * @param {{chatId: string, chatName: string, types: string[],
   *          from: number|null, to: number|null, limit: number}} opts
   */
  async function runDownload(opts) {
    const { chatId, chatName, types, from, to, limit } = opts;
    if (cache.chatId !== chatId || !cache.items.length) {
      await getStats(chatId, chatName);
    }

    const allow = new Set();
    (types && types.length ? types : Object.keys(TYPE_TO_KINDS))
      .forEach((t) => (TYPE_TO_KINDS[t] || []).forEach((k) => allow.add(k)));

    let items = cache.items.filter((it) => allow.has(it.kind));
    if (from || to) items = items.filter((it) => inRange(it.t, from, to));
    items.sort((a, b) => a.t - b.t); // oldest first, stable download order
    if (limit && limit > 0) items = items.slice(0, limit);

    const settings = await storage.getSettings();
    const name = chatName || cache.chatName || 'Chat';
    const batchId = helpers.uid();
    if (items.length) {
      await send({ type: 'WAMD_REGISTER_BATCH', batchId, total: items.length });
    }

    let queued = 0;
    let failed = 0;
    for (const it of items) {
      try {
        const media = await call('downloadMedia', { id: it.id, mimetype: it.mimetype });
        const ext = helpers.extensionForMime(media.mimetype || it.mimetype) || 'bin';
        const when = it.t ? new Date(it.t * 1000) : new Date();
        // For the "caption" naming style, prefer the caption, then a
        // document's original filename (extension stripped).
        const docBase = it.filename ? it.filename.replace(/\.[^.]+$/, '') : '';
        const filename = download.buildFilename(settings, {
          kind: it.kind,
          chatName: name,
          sender: it.sender || 'Unknown',
          messageId: it.id,
          when,
          caption: it.caption || docBase || null,
          ext
        });
        const payload = {
          id: helpers.uid(),
          url: media.dataUrl,
          filename,
          bytes: media.size || it.size || 0,
          mime: media.mimetype || it.mimetype || '',
          kind: it.kind,
          chatName: name,
          sender: it.sender || 'Unknown',
          messageId: it.id,
          dedupeKey: `wamsg:${it.id}`,
          batchId
        };
        const res = await send({ type: 'WAMD_ENQUEUE', payload });
        if (res && res.result && res.result.status) queued += 1;
        else { failed += 1; }
      } catch (_) {
        failed += 1;
      }
    }
    // Items that never reached the queue must be removed from the batch
    // total so the "Queue complete" summary can still fire.
    if (failed > 0) await send({ type: 'WAMD_BATCH_ADJUST', batchId, delta: -failed });

    return { queued, failed, total: items.length };
  }

  /* ------------------------------ router ------------------------------ */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const respond = (promise) => {
      promise
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
      return true;
    };

    switch (msg && msg.type) {
      case 'WAMD_ENGINE_STATUS':
        return respond(call('status', {}, 10000));
      case 'WAMD_ENGINE_CHATS':
        return respond(call('listChats', {}, 45000));
      case 'WAMD_ENGINE_STATS':
        return respond(getStats(msg.chatId, msg.chatName));
      case 'WAMD_ENGINE_DOWNLOAD':
        return respond(runDownload(msg));
      default:
        return false;
    }
  });
})();
