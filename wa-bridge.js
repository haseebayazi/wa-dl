/**
 * wa-bridge.js — MAIN-world engine bridge (page context)
 * ------------------------------------------------------------------
 * Injected on demand by the popup (via chrome.scripting, world:MAIN)
 * AFTER WhatsApp Web has fully booted, on top of the bundled
 * @wppconnect/wa-js 3.23.3 (window.WPP). Injecting late — rather than at
 * document_start — is what lets wa-js find WhatsApp's internal modules.
 *
 * Exposes, over window.postMessage only (plain cloneable payloads):
 *   - status       → engine readiness + chat count
 *   - listChats    → every chat/group
 *   - collectMedia → all media messages of a chat (whole loaded history)
 *   - downloadOne  → decrypt one message's media to a data: URL
 *
 * Live WhatsApp message objects never leave this world; downloadOne uses
 * the objects cached from the last collectMedia call so it can use the
 * robust message-model download path.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__WAMD_BRIDGE__) return;   // idempotent (popup may re-inject)
  window.__WAMD_BRIDGE__ = true;

  const REQ = 'WAMD_ENGINE_REQ';   // isolated → page
  const RES = 'WAMD_ENGINE_RES';   // page → isolated
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'gif']);

  /** Live message objects from the last collectMedia, keyed by id. */
  let msgCache = new Map();

  /**
   * Tolerant readiness wait (mirrors what works in practice): accept any
   * of wa-js's ready signals, and never hard-block — after the timeout we
   * proceed best-effort, exactly like the reference implementation.
   *
   * @returns {Promise<boolean>}
   */
  async function ensureReady() {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      try {
        const W = window.WPP;
        if (W) {
          if (typeof W.isReady === 'function' && await W.isReady()) return true;
          if (typeof W.isReady === 'boolean' && W.isReady) return true;
          if (W.webpack && typeof W.webpack.isReady === 'function' && await W.webpack.isReady()) return true;
          if (W.webpack && W.webpack.isReady === true) return true;
        }
      } catch (_) { /* keep waiting */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    return !!window.WPP; // best-effort: proceed if WPP exists at all
  }

  /* ------------------------- message mapping ------------------------- */

  const mapKind = (type) => ({ ptt: 'voice', gif: 'gif' })[type] || type;

  function senderName(m) {
    try {
      const s = m.senderObj || (m.from && m.from.contact);
      if (s) return s.formattedName || s.pushname || s.name || (s.id && s.id.user) || '';
    } catch (_) { /* ignore */ }
    const a = m.author || m.from;
    return (a && (a.user || a._serialized)) || (typeof a === 'string' ? a : '') || 'Unknown';
  }

  function serializeMsg(m) {
    const id = (m.id && m.id._serialized) || m.id || '';
    return {
      id: String(id),
      type: m.type,
      kind: mapKind(m.type),
      t: m.t || m.timestamp || 0,
      caption: String(m.caption || (m.type !== 'chat' ? m.body : '') || '').slice(0, 300),
      filename: String(m.filename || (m.mediaData && m.mediaData.filename) || ''),
      mimetype: String(m.mimetype || (m.mediaData && m.mediaData.mimetype) || ''),
      size: Number(m.size || (m.mediaData && m.mediaData.size) || 0) || 0,
      sender: senderName(m)
    };
  }

  const isMediaMsg = (m) => {
    const kind = String(m.type || m.mediaType || '').toLowerCase();
    return m.isMedia || m.isMMS || !!m.mediaKey || !!m.mediaData || MEDIA_TYPES.has(kind);
  };

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Failed to read media blob'));
      r.readAsDataURL(blob);
    });
  }

  /** Read an already-decrypted blob from a message's caches, if present. */
  function cachedBlob(m) {
    const md = m && (m.mediaData || m._mediaData);
    const mb = md && md.mediaBlob;
    try {
      if (mb && typeof mb.forceToBlob === 'function') {
        const b = mb.forceToBlob();
        if (b instanceof Blob && b.size > 0) return b;
      }
    } catch (_) { /* ignore corrupt blob */ }
    return null;
  }

  /**
   * Download + decrypt a message's media into a Blob, trying the robust
   * message-model path first, then the WPP.chat API by id.
   *
   * @param {object} message  live WhatsApp message object
   * @param {string} id       serialized message id
   * @returns {Promise<Blob>}
   */
  async function downloadBlob(message, id) {
    const cached = cachedBlob(message);
    if (cached) return cached;

    if (message && typeof message.downloadMedia === 'function') {
      try {
        const r = await message.downloadMedia({
          downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true
        });
        if (r instanceof Blob) return r;
        await new Promise((res) => setTimeout(res, 250));
        const b = cachedBlob(message);
        if (b) return b;
      } catch (_) { /* fall through to API */ }
    }

    const chat = window.WPP && window.WPP.chat;
    if (chat && typeof chat.downloadMedia === 'function') {
      const b = await chat.downloadMedia(id);
      if (b instanceof Blob) return b;
    }
    throw new Error('Media could not be decrypted (expired or unavailable)');
  }

  /* ----------------------------- actions ----------------------------- */

  const actions = {
    async status() {
      const ready = await ensureReady();
      let chats = 0;
      try { chats = (await window.WPP.chat.list()).length; } catch (_) { chats = -1; }
      return { readyState: ready ? 'ready' : 'loading', chats };
    },

    async listChats() {
      await ensureReady();
      const list = await window.WPP.chat.list();
      return (list || [])
        .map((c) => ({
          id: (c && c.id && c.id._serialized) || (c && c.id) || '',
          name: (c && (c.formattedTitle || c.name ||
            (c.contact && (c.contact.formattedName || c.contact.pushname)) ||
            (c.id && c.id.user))) || 'Chat',
          isGroup: !!(c && c.isGroup)
        }))
        .filter((c) => c.id && c.id !== 'status@broadcast');
    },

    async collectMedia({ chatId }) {
      await ensureReady();
      let msgs = null;
      try {
        msgs = await window.WPP.chat.getMessages(chatId, { count: 10000 });
      } catch (_) {
        try { msgs = await window.WPP.chat.getMessages(chatId, { count: 3000 }); }
        catch (_2) { msgs = await window.WPP.chat.getMessages(chatId); }
      }
      msgs = msgs || [];

      // If WhatsApp returned another chat's buffer, open the chat and retry.
      const otherChat = (m) => {
        const r = m && m.id && (m.id.remote || m.id._remote);
        const rs = (r && r._serialized) || (typeof r === 'string' ? r : '') || m.chatId || '';
        return rs && rs !== chatId;
      };
      if (msgs.length && msgs.filter(otherChat).length > msgs.length * 0.6) {
        try {
          const chat = window.WPP.chat;
          if (chat.openChatBottom) await chat.openChatBottom(chatId);
          else if (chat.openChatAt) await chat.openChatAt(chatId);
          await new Promise((r) => setTimeout(r, 250));
          msgs = await window.WPP.chat.getMessages(chatId, { count: 5000 });
        } catch (_) { /* keep what we have */ }
      }
      msgs = msgs.filter((m) => !otherChat(m));

      msgCache = new Map();
      const items = [];
      for (const m of msgs) {
        if (!isMediaMsg(m)) continue;
        const dto = serializeMsg(m);
        if (!dto.id) continue;
        msgCache.set(dto.id, m);
        items.push(dto);
      }
      return { items };
    },

    async downloadOne({ id, mimetype }) {
      await ensureReady();
      let message = msgCache.get(id);
      if (!message) {
        // Cache miss (e.g. popup reopened) — look the message up by id.
        try { message = await window.WPP.chat.getMessageById(id); } catch (_) { /* ignore */ }
      }
      const blob = await downloadBlob(message, id);
      if (!blob || blob.size === 0) throw new Error('Empty media');
      const dataUrl = await blobToDataURL(blob);
      return { dataUrl, mimetype: blob.type || mimetype || '', size: blob.size };
    }
  };

  /* --------------------------- postMessage --------------------------- */

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== REQ) return;
    const { id, action, args } = d;
    const fn = actions[action];
    if (!fn) { post(id, false, null, `Unknown engine action: ${action}`); return; }
    try {
      post(id, true, await fn(args || {}), null);
    } catch (err) {
      post(id, false, null, String((err && err.message) || err));
    }
  });

  function post(id, ok, result, error) {
    window.postMessage({ source: RES, id, ok, result, error }, '*');
  }

  console.info('[WAMD-Engine] bridge injected (wa-js', (window.WPP && window.WPP.version) || '?', ')');
})();
