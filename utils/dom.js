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
   * Read the caption text of the media message containing `el`, if any.
   * Used by the "caption" naming style. Returns null when the bubble has
   * no caption (plain media) or the selector no longer matches.
   *
   * @param {Element} el  any element inside a media message
   * @returns {string|null}
   */
  function getCaption(el) {
    const bubble = S().closest(el, 'messageContainer');
    if (!bubble) return null;
    const capEl = S().query('mediaCaption', bubble);
    if (!capEl) return null;
    const text = (capEl.textContent || '').replace(/\s+/g, ' ').trim();
    return text || null;
  }

  /**
   * Read the original filename shown on a document bubble (e.g.
   * "invoice.pdf"). Returned with its extension stripped so the caller
   * can append the detected one; null when unavailable.
   *
   * @param {Element} el  the document bubble / an element inside it
   * @returns {string|null}
   */
  function getDocumentName(el) {
    const bubble = S().closest(el, 'messageContainer') || el;
    const titleEl = S().query('documentTitle', bubble);
    if (!titleEl) return null;
    const raw = (titleEl.getAttribute('title') || titleEl.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) return null;
    return raw.replace(/\.[A-Za-z0-9]{1,8}$/, '') || raw;
  }

  /**
   * Best caption-like label for a scanned item: the media caption for
   * image/video/audio, or the original filename for documents.
   *
   * @param {Element} el
   * @param {string} kind
   * @returns {string|null}
   */
  function getItemCaption(el, kind) {
    return kind === 'document' ? getDocumentName(el) : getCaption(el);
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
      if (sel.matches(el, 'chatSticker')) return 'sticker';
      // Reliable path: WhatsApp tags every chat photo as image-thumb,
      // whether or not it has been decrypted into a blob yet.
      if (sel.matches(el, 'chatImageThumb')) return 'image';
      // Fallback for older markup: a blob image that isn't avatar-sized.
      // Prefer the RENDERED width (avatars show ~40px, real photos are
      // wide); reject only when a width is actually known.
      if (String(el.src).startsWith('blob:')) {
        const shown = el.getBoundingClientRect().width || el.width || 0;
        const width = shown || el.naturalWidth || 0;
        if (!width || width >= 56) return 'image';
      }
      return null;
    }
    if (el.tagName === 'VIDEO') return 'video';
    if (el.tagName === 'AUDIO') {
      // Voice notes and audio files both render <audio>; a play button /
      // waveform in the bubble marks a voice note, else it's an audio file.
      const bubble = sel.closest(el, 'messageContainer');
      const isVoice = bubble
        ? (!!sel.query('voiceNoteBubble', bubble) ||
           !!bubble.querySelector('[aria-label*="voice" i]'))
        : false;
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
      const caption = getItemCaption(el, kind);
      found.push({ el, kind, loaded, messageId, sender, when, caption });
    };

    // Image messages. Scan ALL <img> (not just blobs): WhatsApp only turns
    // a photo into a blob: URL once it scrolls into view, so an image is
    // "loaded" (downloadable now) when its src is a blob, and reported as
    // not-loaded otherwise so the count reflects the whole chat.
    for (const img of listRoot.querySelectorAll('img')) {
      const kind = classifyMediaElement(img);
      if (!kind) continue;
      const loaded = String(img.currentSrc || img.src || '').startsWith('blob:');
      push(img, kind, loaded);
    }
    for (const video of listRoot.querySelectorAll('video')) {
      if (!sel.closest(video, 'messageContainer')) continue;
      push(video, 'video', !!getMediaSource(video));
    }
    // Video message thumbnails that haven't spawned a <video> element yet.
    for (const thumb of sel.queryAll('videoThumb', listRoot)) {
      const bubble = sel.closest(thumb, 'messageContainer');
      if (bubble) push(bubble, 'video', false);
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
   * When the viewer container selector doesn't match (WhatsApp DOM
   * change), falls back to a size heuristic: the opened viewer image is a
   * blob element covering at least half the viewport, which is far larger
   * than any in-chat thumbnail, so it can be identified without a selector.
   *
   * @returns {{el: Element, kind: string}|null}
   */
  function getViewerMedia() {
    const viewer = getOpenViewer();
    const scope = viewer || document;

    let best = null;
    let bestArea = 0;
    for (const el of scope.querySelectorAll('img[src^="blob:"], video')) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    if (!best) return null;

    if (viewer) {
      if (bestArea < 10000) return null; // ignore thumbnail strip
    } else {
      // No viewer container matched — only treat a dominant, near-full-screen
      // element as "the open viewer" so in-chat thumbnails aren't picked up.
      const rect = best.getBoundingClientRect();
      const bigEnough = rect.width >= window.innerWidth * 0.5 &&
        rect.height >= window.innerHeight * 0.5;
      if (!bigEnough) return null;
    }
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
    getCaption,
    getDocumentName,
    getItemCaption,
    classifyMediaElement,
    getMediaSource,
    scanChatMedia,
    getOpenViewer,
    getViewerMedia,
    getProfilePhoto
  };
})(globalThis);
