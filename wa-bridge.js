/**
 * wa-bridge.js — MAIN-world engine bridge (page context)
 * ------------------------------------------------------------------
 * Injected on demand by the popup (chrome.scripting, world:MAIN) AFTER
 * WhatsApp Web has booted, on top of @wppconnect/wa-js 3.23.3
 * (window.WPP). Late injection is what lets wa-js find WhatsApp's
 * internal modules.
 *
 * Talks to the isolated relay (wa-engine.js) via window.postMessage:
 *   - status            engine readiness + chat count
 *   - listChats         every chat/group
 *   - collectMedia      quick media stats (single getMessages)
 *   - collectMediaFull  whole history, paged backwards
 *   - downloadOne       decrypt one message → data URL (individual mode)
 *   - downloadZip       decrypt a filtered set, build a ZIP, save it
 *
 * Live message objects never leave this world; downloads use the objects
 * cached from the last collect call for the robust message-model path.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__WAMD_BRIDGE__) return;
  window.__WAMD_BRIDGE__ = true;

  const REQ = 'WAMD_ENGINE_REQ';
  const RES = 'WAMD_ENGINE_RES';
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'gif']);

  let msgCache = new Map();   // id → live message object (from last collect)
  let lastChatId = null;
  let cacheMode = 'quick';    // 'quick' (stats) | 'full' (whole history)

  /* ----------------------------- readiness ----------------------------- */

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
    return !!window.WPP;
  }

  /* ------------------------- message mapping ------------------------- */

  const mapKind = (type) => ({ ptt: 'voice', gif: 'gif' })[type] || type;
  const msgId = (m) => String((m && m.id && m.id._serialized) || (m && m.id) || '');
  const msgTs = (m) => (m && (m.t || m.timestamp)) || 0;
  const msgChat = (m) => {
    const r = m && m.id && (m.id.remote || m.id._remote);
    return (r && r._serialized) || (typeof r === 'string' ? r : '') || (m && m.chatId) || '';
  };
  const isMediaMsg = (m) => {
    const kind = String(m.type || m.mediaType || '').toLowerCase();
    return m.isMedia || m.isMMS || !!m.mediaKey || !!m.mediaData || MEDIA_TYPES.has(kind);
  };

  function senderName(m) {
    try {
      const s = m.senderObj || (m.from && m.from.contact);
      if (s) return s.formattedName || s.pushname || s.name || (s.id && s.id.user) || '';
    } catch (_) { /* ignore */ }
    const a = m.author || m.from;
    return (a && (a.user || a._serialized)) || (typeof a === 'string' ? a : '') || 'Unknown';
  }

  function serializeMsg(m) {
    return {
      id: msgId(m),
      type: m.type,
      kind: mapKind(m.type),
      t: msgTs(m),
      caption: String(m.caption || (m.type !== 'chat' ? m.body : '') || '').slice(0, 300),
      filename: String(m.filename || (m.mediaData && m.mediaData.filename) || ''),
      mimetype: String(m.mimetype || (m.mediaData && m.mediaData.mimetype) || ''),
      size: Number(m.size || (m.mediaData && m.mediaData.size) || 0) || 0,
      sender: senderName(m)
    };
  }

  /* --------------------------- history fetch --------------------------- */

  /** Single quick pull for statistics (approximate for very large chats). */
  async function quickFetch(chatId) {
    let msgs = null;
    try { msgs = await window.WPP.chat.getMessages(chatId, { count: 10000 }); }
    catch (_) {
      try { msgs = await window.WPP.chat.getMessages(chatId, { count: 3000 }); }
      catch (_2) { msgs = await window.WPP.chat.getMessages(chatId); }
    }
    return (msgs || []).filter((m) => { const c = msgChat(m); return !c || c === chatId; });
  }

  /**
   * Page backwards through the whole loaded history, one batch at a time,
   * collecting media messages. Mirrors the reference implementation's
   * cursor logic (anchor on the oldest message of each batch).
   *
   * @param {string} chatId
   * @param {{batchSize?: number, maxBatches?: number}} [opts]
   * @returns {Promise<object[]>} media message objects (oldest-first order not guaranteed)
   */
  async function fullFetch(chatId, opts) {
    const batchSize = (opts && opts.batchSize) || 800;
    const maxBatches = (opts && opts.maxBatches) || 80;
    const keep = (opts && opts.keep) || isMediaMsg; // default: media only
    const out = [];
    const seen = new Set();
    let anchor = '';
    let noNew = 0;
    let sameAnchor = 0;

    for (let b = 0; b < maxBatches; b++) {
      const o = { count: batchSize, direction: anchor ? 'before' : undefined, id: anchor || undefined };
      let batch;
      try { batch = await window.WPP.chat.getMessages(chatId, o); }
      catch (_) { break; }
      if (!batch || !batch.length) break;

      batch = batch.filter((m) => { const c = msgChat(m); return !c || c === chatId; });
      if (anchor) batch = batch.filter((m) => msgId(m) !== anchor);
      if (!batch.length) break;

      let newCount = 0;
      for (const m of batch) {
        const id = msgId(m);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        newCount += 1;
        if (keep(m)) out.push(m);
      }

      // Cursor = oldest (min timestamp) message of the batch.
      let cur = batch[0];
      let curTs = msgTs(cur);
      for (const x of batch) {
        const t = msgTs(x);
        if (t && (!curTs || t < curTs)) { cur = x; curTs = t; }
      }
      const cursor = msgId(cur) || msgId(batch[batch.length - 1]);
      if (!cursor) break;

      if (cursor === anchor) { if (++sameAnchor >= 2) break; } else sameAnchor = 0;
      if (!newCount) { if (++noNew >= 2) break; } else noNew = 0;
      anchor = cursor;
    }
    return out;
  }

  /* ----------------------------- download ----------------------------- */

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read failed'));
      r.readAsDataURL(blob);
    });
  }

  function cachedBlob(m) {
    const md = m && (m.mediaData || m._mediaData);
    const mb = md && md.mediaBlob;
    try {
      if (mb && typeof mb.forceToBlob === 'function') {
        const b = mb.forceToBlob();
        if (b instanceof Blob && b.size > 0) return b;
      }
    } catch (_) { /* corrupt */ }
    return null;
  }

  async function downloadBlob(message, id) {
    const cached = cachedBlob(message);
    if (cached) return cached;
    if (message && typeof message.downloadMedia === 'function') {
      try {
        const r = await message.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true });
        if (r instanceof Blob) return r;
        await new Promise((res) => setTimeout(res, 250));
        const b = cachedBlob(message);
        if (b) return b;
      } catch (_) { /* fall through */ }
    }
    const chat = window.WPP && window.WPP.chat;
    if (chat && typeof chat.downloadMedia === 'function') {
      const b = await chat.downloadMedia(id);
      if (b instanceof Blob) return b;
    }
    throw new Error('Media unavailable (expired or not downloadable)');
  }

  /* ----------------------------- naming ----------------------------- */

  function sanitize(s, max) {
    const out = String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/[. ]+$/g, '')
      .trim();
    return (out || 'file').slice(0, max || 120);
  }
  const pad = (n) => String(n).padStart(2, '0');
  function stamp(t) {
    const d = t ? new Date(t * 1000) : new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  function extFromMime(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    const MAP = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a', 'application/pdf': 'pdf', 'application/zip': 'zip'
    };
    if (MAP[m]) return MAP[m];
    const sub = m.split('/')[1];
    return sub ? sub.replace(/^x-/, '').slice(0, 8) : 'bin';
  }

  /** Build a ZIP entry name from the naming options (caption / date / original). */
  function makeName(dto, naming, chatName, idx, ext) {
    naming = naming || {};
    const parts = [];
    if (naming.useCaption && dto.caption) {
      parts.push(sanitize(dto.caption, 80));
      if (naming.useDate) parts.push(stamp(dto.t));
    } else {
      parts.push(sanitize(chatName || 'Chat', 60));
      parts.push(stamp(dto.t));
    }
    parts.push(String(idx).padStart(4, '0'));
    if (naming.appendOrig && dto.filename) {
      const orig = sanitize(dto.filename.replace(/\.[^.]+$/, ''), 80);
      if (orig && !parts.join('_').includes(orig)) parts.push(orig);
    }
    return `${parts.join('_')}.${ext}`;
  }

  const inRange = (t, from, to) => {
    const ms = t * 1000;
    if (from && ms < from) return false;
    if (to && ms > to) return false;
    return true;
  };

  /** "YYYY-MM-DD HH:MM:SS" timestamp for the transcript. */
  function fullStamp(t) {
    const d = new Date(t * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /**
   * Format one message as a transcript line, or null to skip it.
   * `[date time] Sender: text` — media shows a <type> marker plus any
   * caption/filename; empty system/protocol messages are skipped.
   */
  function formatTextLine(m) {
    const ts = msgTs(m);
    if (!ts) return null;
    const fromMe = (m.id && typeof m.id === 'object' && m.id.fromMe) || msgId(m).startsWith('true_');
    const who = fromMe ? 'You' : (senderName(m) || 'Unknown');
    const type = String(m.type || '').toLowerCase();

    let body;
    if (MEDIA_TYPES.has(type)) {
      const label = type === 'ptt' ? 'voice' : type;
      body = `<${label}>`;
      if (m.caption) body += ` ${m.caption}`;
      else if (m.filename) body += ` ${m.filename}`;
    } else if (m.body) {
      body = String(m.body);
    } else if (m.subtitle) {
      body = String(m.subtitle);
    } else {
      return null; // system / protocol message with no text
    }
    return `[${fullStamp(ts)}] ${who}: ${body}`;
  }

  /* ------------------------------- ZIP ------------------------------- */

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }
  const u16 = (n) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n & 0xFFFF, true); return a; };
  const u32 = (n) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; };
  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
  /** Build an uncompressed (store) ZIP from [{name, bytes}]. */
  function makeZip(entries) {
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const data = e.bytes;
      const crc = crc32(data);
      const local = concat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
      ]);
      locals.push(local);
      centrals.push(concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
      ]));
      offset += local.length;
    }
    const cd = concat(centrals);
    const eocd = concat([
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(cd.length), u32(offset), u16(0)
    ]);
    return concat([...locals, cd, eocd]);
  }

  function anchorDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ----------------------------- actions ----------------------------- */

  function cacheAll(msgs, chatId, mode) {
    msgCache = new Map();
    lastChatId = chatId;
    cacheMode = mode || 'quick';
    const items = [];
    for (const m of msgs) {
      if (!isMediaMsg(m)) continue;
      const dto = serializeMsg(m);
      if (!dto.id) continue;
      msgCache.set(dto.id, m);
      items.push(dto);
    }
    return items;
  }

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
      return { items: cacheAll(await quickFetch(chatId), chatId, 'quick') };
    },

    async collectMediaFull({ chatId }) {
      await ensureReady();
      return { items: cacheAll(await fullFetch(chatId), chatId, 'full') };
    },

    async downloadOne({ id, mimetype }) {
      await ensureReady();
      let message = msgCache.get(id);
      if (!message) { try { message = await window.WPP.chat.getMessageById(id); } catch (_) { /* ignore */ } }
      const blob = await downloadBlob(message, id);
      if (!blob || blob.size === 0) throw new Error('Empty media');
      return { dataUrl: await blobToDataURL(blob), mimetype: blob.type || mimetype || '', size: blob.size };
    },

    async exportText({ chatId, chatName, from, to }) {
      await ensureReady();
      // Keep every message (not just media) for a full transcript.
      const msgs = await fullFetch(chatId, { keep: () => true });
      msgs.sort((a, b) => (msgTs(a) || 0) - (msgTs(b) || 0));

      const lines = [];
      let count = 0;
      for (const m of msgs) {
        const ts = msgTs(m);
        if ((from || to) && ts && !inRange(ts, from, to)) continue;
        const line = formatTextLine(m);
        if (line) { lines.push(line); count += 1; }
      }
      const header =
        `Chat: ${chatName || chatId}\n` +
        `Exported: ${new Date().toString()}\n` +
        `Messages: ${count}\n` +
        '----------------------------------------\n\n';
      const blob = new Blob([header + lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
      anchorDownload(blob, `${sanitize(chatName || 'Chat', 60)}_chat.txt`);
      return { count };
    },

    async downloadZip({ chatId, chatName, kinds, from, to, limit, naming }) {
      await ensureReady();
      // Always download from the FULL history — never reuse the quick
      // stats cache, which only holds the most recent window.
      if (lastChatId !== chatId || cacheMode !== 'full' || !msgCache.size) {
        cacheAll(await fullFetch(chatId), chatId, 'full');
      }

      const allow = new Set(kinds && kinds.length ? kinds : []);
      const wantAll = !allow.size;
      const list = [...msgCache.entries()]
        .map(([, m]) => m)
        .sort((a, b) => (msgTs(a) || 0) - (msgTs(b) || 0));

      const entries = [];
      let idx = 0;
      let failed = 0;
      for (const m of list) {
        if (limit > 0 && entries.length >= limit) break;
        const dto = serializeMsg(m);
        if (!wantAll && !allow.has(dto.kind)) continue;
        if ((from || to) && !inRange(dto.t, from, to)) continue;
        idx += 1;
        try {
          const blob = await downloadBlob(m, dto.id);
          if (!blob || !blob.size) { failed += 1; continue; }
          const ext = extFromMime(blob.type || dto.mimetype);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          entries.push({ name: makeName(dto, naming, chatName, idx, ext), bytes });
        } catch (_) { failed += 1; }
      }
      if (!entries.length) return { count: 0, failed, zip: true };
      const zip = makeZip(entries);
      anchorDownload(new Blob([zip], { type: 'application/zip' }), `${sanitize(chatName || 'Chat', 60)}_media.zip`);
      return { count: entries.length, failed, zip: true };
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
    try { post(id, true, await fn(args || {}), null); }
    catch (err) { post(id, false, null, String((err && err.message) || err)); }
  });

  function post(id, ok, result, error) {
    window.postMessage({ source: RES, id, ok, result, error }, '*');
  }

  console.info('[WAMD-Engine] bridge injected (wa-js', (window.WPP && window.WPP.version) || '?', ')');
})();
