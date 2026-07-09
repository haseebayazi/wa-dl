/**
 * wa-engine.js — isolated-world engine relay
 * ------------------------------------------------------------------
 * Always present (manifest content script). Bridges the popup/background
 * (chrome.runtime) and the MAIN-world bridge (wa-bridge.js, reached via
 * window.postMessage — the popup injects that bridge on demand). It:
 *
 *   - relays status / listChats / stats requests to the page bridge
 *   - runs Store-based downloads: asks the page to decrypt each selected
 *     message, then feeds it into the existing background download queue
 *     (dedupe, naming, notifications and the queue UI are all reused)
 *
 * Shares the isolated world with content.js, so WAMD.helpers / storage /
 * download are available.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const REQ = 'WAMD_ENGINE_REQ';
  const RES = 'WAMD_ENGINE_RES';
  const { helpers, storage, download } = globalThis.WAMD || {};

  // chrome.runtime messages are capped (~64 MB) and base64 inflates ~33%.
  const MAX_MESSAGE_BYTES = 44 * 1024 * 1024;

  /* ----------------------- page request plumbing ----------------------- */

  let seq = 0;
  const pending = new Map();

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== RES) return;
    const settle = pending.get(d.id);
    if (!settle) return;
    pending.delete(d.id);
    settle(d);
  });

  function call(action, args, timeout = 180000) {
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

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  /* --------------------------- media caching --------------------------- */

  let cache = { chatId: null, chatName: '', items: [] };

  const TYPE_TO_KINDS = {
    images: ['image', 'gif', 'sticker'],
    videos: ['video'],
    audio: ['audio', 'voice'],
    documents: ['document']
  };
  const bucketFor = (kind) => ({
    image: 'image', gif: 'image', sticker: 'image',
    video: 'video', audio: 'audio', voice: 'audio', document: 'document'
  })[kind] || 'other';

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

  const inRange = (t, from, to) => {
    const ms = t * 1000;
    if (from && ms < from) return false;
    if (to && ms > to) return false;
    return true;
  };

  async function runDownload(opts) {
    const { chatId, chatName, types, from, to, limit } = opts;
    if (cache.chatId !== chatId || !cache.items.length) await getStats(chatId, chatName);

    const allow = new Set();
    (types && types.length ? types : Object.keys(TYPE_TO_KINDS))
      .forEach((t) => (TYPE_TO_KINDS[t] || []).forEach((k) => allow.add(k)));

    let items = cache.items.filter((it) => allow.has(it.kind));
    if (from || to) items = items.filter((it) => inRange(it.t, from, to));
    items.sort((a, b) => a.t - b.t);
    if (limit && limit > 0) items = items.slice(0, limit);

    const settings = await storage.getSettings();
    const name = chatName || cache.chatName || 'Chat';
    const batchId = helpers.uid();
    if (items.length) await send({ type: 'WAMD_REGISTER_BATCH', batchId, total: items.length });

    let queued = 0;
    let failed = 0;
    for (const it of items) {
      try {
        const media = await call('downloadOne', { id: it.id, mimetype: it.mimetype });
        if ((media.size || 0) > MAX_MESSAGE_BYTES) { failed += 1; continue; }
        const ext = helpers.extensionForMime(media.mimetype || it.mimetype) || 'bin';
        const when = it.t ? new Date(it.t * 1000) : new Date();
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
        const res = await send({
          type: 'WAMD_ENQUEUE',
          payload: {
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
          }
        });
        if (res && res.result && res.result.status) queued += 1;
        else failed += 1;
      } catch (_) {
        failed += 1;
      }
    }
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
        return respond(call('status', {}, 15000));
      case 'WAMD_ENGINE_CHATS':
        return respond(call('listChats', {}, 60000));
      case 'WAMD_ENGINE_STATS':
        return respond(getStats(msg.chatId, msg.chatName));
      case 'WAMD_ENGINE_DOWNLOAD':
        return respond(runDownload(msg));
      default:
        return false;
    }
  });
})();
