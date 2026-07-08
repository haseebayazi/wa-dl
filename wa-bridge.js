/**
 * wa-bridge.js — MAIN-world engine bridge (page context)
 * ------------------------------------------------------------------
 * Runs in the WhatsApp Web page's own JavaScript context, on top of the
 * bundled @wppconnect/wa-js library (window.WPP). Unlike the DOM layer,
 * this can read WhatsApp's internal Store directly:
 *
 *   - enumerate every chat (even ones that aren't open)
 *   - collect media messages across the whole loaded chat history
 *   - download + decrypt any media on demand (no scrolling required)
 *
 * It talks to the isolated-world relay (wa-engine.js) ONLY through
 * window.postMessage with plain, structured-cloneable payloads — no
 * WhatsApp objects ever cross the boundary.
 *
 * Uses WhatsApp internal APIs via wa-js; those are undocumented and can
 * change, so every call is defensive and failures are reported, never
 * thrown into the page.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const TAG = '[WAMD-Engine]';
  const REQ = 'WAMD_ENGINE_REQ';   // isolated → page
  const RES = 'WAMD_ENGINE_RES';   // page → isolated

  /** 'loading' until WPP reports ready; then 'ready' or 'error'. */
  let readyState = 'loading';
  let readyError = null;

  /** WhatsApp message types we treat as downloadable media. */
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'gif']);

  /**
   * Resolve once wa-js is fully ready (modules injected AND the WhatsApp
   * connection is authenticated/ready). Combines every signal wa-js
   * exposes plus a poll, with a safety timeout so we never hang forever.
   *
   * @returns {Promise<void>}
   */
  function whenReady() {
    return new Promise((resolve, reject) => {
      const isReady = () => {
        try {
          if (!window.WPP) return false;
          if (WPP.isFullReady) return true;
          if (WPP.conn && typeof WPP.conn.isMainReady === 'function' && WPP.conn.isMainReady()) return true;
          return false;
        } catch (_) { return false; }
      };
      if (isReady()) { resolve(); return; }

      let settled = false;
      const finish = () => {
        if (settled) return;
        if (!isReady()) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      };

      try { if (WPP.webpack && WPP.webpack.onFullReady) WPP.webpack.onFullReady(finish); } catch (_) { /* ignore */ }
      try { if (WPP.on) WPP.on('conn.main_ready', finish); } catch (_) { /* ignore */ }

      const poll = setInterval(finish, 500);
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        reject(new Error('Timed out waiting for WhatsApp to be ready (are you logged in?)'));
      }, 90000);
    });
  }

  /** Best-effort chat count for the status line. */
  async function safeChatCount() {
    try { return (await WPP.chat.list()).length; } catch (_) { return -1; }
  }

  /* ------------------------- message mapping ------------------------- */

  /** Map a WhatsApp internal type to the extension's media kind. */
  function mapKind(type) {
    return ({ ptt: 'voice', gif: 'gif' })[type] || type;
  }

  /** Best display name for a message's sender. */
  function senderName(m) {
    try {
      if (m.senderObj) {
        const s = m.senderObj;
        return s.formattedName || s.pushname || s.name ||
          (s.id && (s.id.user || s.id._serialized)) || 'Unknown';
      }
    } catch (_) { /* ignore */ }
    const a = m.author || m.from;
    if (a && a._serialized) return a.user || a._serialized;
    return a || 'Unknown';
  }

  /**
   * Reduce a wa-js RawMessage to a plain, cloneable DTO with just the
   * fields the relay/UI need. WhatsApp message objects are not cloneable
   * (methods + cycles), so we must project them here.
   */
  function serializeMsg(m) {
    const id = typeof m.id === 'string' ? m.id : (m.id && m.id._serialized) || '';
    const fromMe = typeof m.id === 'object' && m.id ? !!m.id.fromMe : String(id).startsWith('true_');
    return {
      id,
      type: m.type,
      kind: mapKind(m.type),
      t: m.t || m.messageTimestamp || 0,           // unix seconds
      caption: (m.caption || (m.type !== 'chat' ? m.body : '') || '').toString().slice(0, 300),
      filename: (m.filename || (m.mediaData && m.mediaData.filename) || '').toString(),
      mimetype: (m.mimetype || (m.mediaData && m.mediaData.mimetype) || '').toString(),
      size: Number(m.size || (m.mediaData && m.mediaData.size) || 0) || 0,
      sender: senderName(m),
      fromMe
    };
  }

  /** Read a Blob as a data: URL (transferable to the queue). */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Failed to read media blob'));
      r.readAsDataURL(blob);
    });
  }

  /* ----------------------------- actions ----------------------------- */

  const actions = {
    /** Engine status + rough chat count (used for the popup banner). */
    async status() {
      return {
        readyState,
        error: readyError,
        chats: readyState === 'ready' ? await safeChatCount() : 0
      };
    },

    /** All chats as {id, name, isGroup}, minus the status broadcast. */
    async listChats() {
      const list = await WPP.chat.list();
      return list
        .map((c) => ({
          id: (c.id && c.id._serialized) || String(c.id),
          name: c.formattedTitle || c.name ||
            (c.contact && (c.contact.formattedName || c.contact.pushname)) ||
            (c.id && c.id.user) || 'Unknown',
          isGroup: !!c.isGroup
        }))
        .filter((c) => c.id && c.id !== 'status@broadcast');
    },

    /**
     * Collect every media message of a chat across its loaded history.
     * count:-1 makes wa-js page back through history until exhausted.
     *
     * @param {{chatId: string}} args
     */
    async collectMedia({ chatId }) {
      const msgs = await WPP.chat.getMessages(chatId, { count: -1 });
      const items = [];
      for (const m of msgs) {
        if (MEDIA_TYPES.has(m.type)) items.push(serializeMsg(m));
      }
      return { items };
    },

    /**
     * Download + decrypt one media message and return it as a data URL.
     *
     * @param {{id: string, mimetype?: string}} args
     */
    async downloadMedia({ id, mimetype }) {
      const blob = await WPP.chat.downloadMedia(id);
      if (!blob) throw new Error('No media returned (message may be expired)');
      const dataUrl = await blobToDataURL(blob);
      return { dataUrl, mimetype: blob.type || mimetype || '', size: blob.size || 0 };
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
    if (readyState !== 'ready' && action !== 'status') {
      post(id, false, null, `Engine ${readyState}${readyError ? ': ' + readyError : ''}`);
      return;
    }
    try {
      post(id, true, await fn(args || {}), null);
    } catch (err) {
      post(id, false, null, String((err && err.message) || err));
    }
  });

  /** Send a response frame back to the isolated relay. */
  function post(id, ok, result, error) {
    window.postMessage({ source: RES, id, ok, result, error }, '*');
  }

  /* ------------------------------ boot ------------------------------ */

  (async () => {
    try {
      if (!window.WPP) {
        readyState = 'error';
        readyError = 'wa-js library not present';
        console.warn(TAG, readyError);
        return;
      }
      await whenReady();
      readyState = 'ready';
      console.info(TAG, 'ready — internal engine connected. chats:', await safeChatCount());
    } catch (err) {
      readyState = 'error';
      readyError = String((err && err.message) || err);
      console.warn(TAG, 'init failed:', readyError);
    }
  })();
})();
