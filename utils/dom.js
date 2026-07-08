/**
 * utils/dom.js
 * ------------------------------------------------------------------
 * DOM-reading layer for the content script. Everything here answers
 * questions about the current WhatsApp Web page (what chat is open,
 * which media elements exist, what metadata a bubble carries) and
 * NOTHING here downloads, stores, or decides policy — that separation
 * keeps business logic independent from WhatsApp's changing markup.
 *
 * All selectors come from utils/selectors.js.
 * Attaches to `globalThis.WAMD.dom`.
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  root.WAMD = root.WAMD || {};
  const S = () => root.WAMD.selectors;

  /**
   * Name of the currently open conversation, or null when no chat
   * is open / the selector no longer matches.
   *
   * @returns {string|null}
   */
  function getChatName() {
    const el = S().query('chatTitle');
    if (!el) return null;
    return (el.getAttribute('title') || el.textContent || '').trim() || null;
  }

  /**
   * Extract the WhatsApp message id from the closest message bubble.
   * Bubble ids look like "false_123456789@c.us_ABCDEF123" — the last
   * segment is the per-message id, the middle one the chat JID.
   *
   * @param {Element} el  any element inside a message
   * @returns {{raw: string|null, messageId: string|null, fromMe: boolean}}
   */
  function getMessageInfo(el) {
    const bubble = S().closest(el, 'messageContainer');
    const raw = bubble ? bubble.getAttribute('data-id') : null;
    if (!raw) return { raw: null, messageId: null, fromMe: false };
    const parts = raw.split('_');
    return {
      raw,
      messageId: parts[parts.length - 1] || raw,
      fromMe: parts[0] === 'true'
    };
  }

  /**
   * Resolve sender + timestamp for a media element using the
   * `data-pre-plain-text` attribute WhatsApp puts on bubbles, e.g.
   * "[12:34, 1/2/2026] John Doe: ". Falls back to the chat name for
   * incoming messages and "Me" for outgoing ones.
   *
   * @param {Element} el  any element inside a message
   * @returns {{sender: string, when: Date|null}}
   */
  function getSenderAndTime(el) {
    const bubble = S().closest(el, 'messageContainer');
    const meta = bubble
      ? (S().query('messageMeta', bubble) || (bubble.matches('[data-pre-plain-text]') ? bubble : null))
      : null;
    const pre = meta ? meta.getAttribute('data-pre-plain-text') : null;

    let sender = null;
    let when = null;
    if (pre) {
      // "[HH:MM, D/M/YYYY] Sender Name: "
      const m = pre.match(/^\[(.+?)\]\s*(.*?):\s*$/);
      if (m) {
        sender = m[2].trim() || null;
        const parsed = parsePrePlainDate(m[1]);
        if (parsed) when = parsed;
      }
    }
    if (!sender) {
      const { fromMe } = getMessageInfo(el);
      sender = fromMe ? 'Me' : (getChatName() || 'Unknown');
    }
    return { sender, when };
  }

  /**
   * Best-effort parse of the "[12:34, 1/2/2026]" prefix. WhatsApp
   * localizes this string, so failures are expected and tolerated —
   * callers fall back to "now".
   *
   * @param {string} text  e.g. "12:34, 1/2/2026"
   * @returns {Date|null}
   */
  function parsePrePlainDate(text) {
    const m = String(text).match(/(\d{1,2}):(\d{2})(?:\s*([AP])\.?M\.?)?\s*,\s*(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/i);
    if (!m) return null;
    let [, hh, mm, ampm, a, b, c] = m;
    let hours = parseInt(hh, 10);
    if (ampm) {
      const isPM = ampm.toUpperCase() === 'P';
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }
    // Disambiguate D/M/Y vs M/D/Y vs Y/M/D as best we can.
    let day, month, year;
    if (a.length === 4) { year = +a; month = +b; day = +c; }
    else if (c.length === 4) { year = +c; day = +a; month = +b; if (month > 12) { [day, month] = [month, day]; } }
    else return null;
    if (month > 12) [day, month] = [month, day];
    const d = new Date(year, month - 1, day, hours, parseInt(mm, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Classify a media element found in the message list into one of the
   * extension's media kinds. Returns null for elements that are not
   * downloadable media (avatars, UI images, link previews without blob).
   *
   * @param {Element} el
   * @returns {'image'|'video'|'audio'|'voice'|'sticker'|null}
   */
  function classifyMediaElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const sel = S();

    // Ignore anything not inside an actual message bubble (rules out
    // avatars in the sidebar, emoji sprites, etc.).
    if (!sel.closest(el, 'messageContainer')) return null;

    if (el.tagName === 'IMG') {
      if (!String(el.src).startsWith('blob:')) return null;
      if (sel.matches(el, 'chatSticker')) return 'sticker';
      // Tiny images are avatars / UI chrome, not chat media.
      if ((el.naturalWidth || el.width || 0) < 48) return null;
      return 'image';
    }
    if (el.tagName === 'VIDEO') return 'video';
    if (el.tagName === 'AUDIO') {
      // Voice notes and audio files both render <audio>; the play
      // button testid distinguishes voice notes when present.
      const bubble = sel.closest(el, 'messageContainer');
      const isVoice = bubble ? !!sel.query('voiceNoteBubble', bubble) : false;
      return isVoice ? 'voice' : 'audio';
    }
    return null;
  }

  /**
   * Get the downloadable source URL of a classified media element.
   * <video> may keep its source on a child <source> element.
   *
   * @param {Element} el
   * @returns {string|null} a blob: URL or null when the media
   *          hasn't been loaded/decrypted by WhatsApp yet
   */
  function getMediaSource(el) {
    if (!el) return null;
    let src = el.currentSrc || el.src || null;
    if (!src && el.tagName === 'VIDEO') {
      const child = el.querySelector('source[src]');
      src = child ? child.src : null;
    }
    return src && src.startsWith('blob:') ? src : null;
  }

  /**
   * Scan the open conversation and return every currently loaded media
   * element with its metadata. Only media WhatsApp has already
   * decrypted (blob: URL present) can be downloaded — items still
   * showing a download arrow inside WhatsApp are reported as
   * `loaded:false` so the UI can explain the difference.
   *
   * @returns {{el: Element, kind: string, loaded: boolean,
   *            messageId: string|null, sender: string,
   *            when: Date|null}[]}
   */
  function scanChatMedia() {
    const sel = S();
    const listRoot = sel.query('messageList') || sel.query('conversationPanel') || document;
    const found = [];
    const seen = new Set();

    /**
     * Push one element into the result list, deduped by node identity.
     * @param {Element} el @param {string} kind @param {boolean} loaded
     */
    const push = (el, kind, loaded) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      const { messageId } = getMessageInfo(el);
      const { sender, when } = getSenderAndTime(el);
      found.push({ el, kind, loaded, messageId, sender, when });
    };

    // Loaded media elements (blob: URLs present).
    for (const img of listRoot.querySelectorAll('img[src^="blob:"]')) {
      const kind = classifyMediaElement(img);
      if (kind) push(img, kind, true);
    }
    for (const video of listRoot.querySelectorAll('video')) {
      if (!sel.closest(video, 'messageContainer')) continue;
      push(video, 'video', !!getMediaSource(video));
    }
    for (const audio of listRoot.querySelectorAll('audio')) {
      const kind = classifyMediaElement(audio);
      if (kind) push(audio, kind, !!getMediaSource(audio));
    }

    // Document bubbles are never blob-loaded in the list; report them
    // so counts are honest, marked not-loaded (download happens through
    // WhatsApp's own button, which we can programmatically click).
    for (const doc of sel.queryAll('documentBubble', listRoot)) {
      const bubble = sel.closest(doc, 'messageContainer');
      if (bubble) push(bubble, 'document', false);
    }

    return found;
  }

  /**
   * The full-screen media viewer element when open, else null.
   *
   * @returns {Element|null}
   */
  function getOpenViewer() {
    return S().query('mediaViewer') || S().query('statusViewer');
  }

  /**
   * The media element currently displayed in the open viewer.
   * Prefers the largest visible blob-backed <img>/<video> inside the
   * overlay, which is robust against carousel/thumbnail strips.
   *
   * @returns {{el: Element, kind: string}|null}
   */
  function getViewerMedia() {
    const viewer = getOpenViewer();
    if (!viewer) return null;

    let best = null;
    let bestArea = 0;
    for (const el of viewer.querySelectorAll('img[src^="blob:"], video')) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    if (!best || bestArea < 10000) return null; // ignore thumbnail strip
    return { el: best, kind: best.tagName === 'VIDEO' ? 'video' : 'image' };
  }

  /**
   * The enlarged profile photo element when a contact/group info photo
   * viewer is open, else null.
   *
   * @returns {Element|null}
   */
  function getProfilePhoto() {
    const el = S().query('profilePhotoLarge');
    return el && String(el.src).startsWith('blob:') ? el : null;
  }

  root.WAMD.dom = {
    getChatName,
    getMessageInfo,
    getSenderAndTime,
    classifyMediaElement,
    getMediaSource,
    scanChatMedia,
    getOpenViewer,
    getViewerMedia,
    getProfilePhoto
  };
})(globalThis);
