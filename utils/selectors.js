/**
 * utils/selectors.js
 * ------------------------------------------------------------------
 * Single source of truth for every WhatsApp Web DOM selector used by
 * WA Media Downloader Pro.
 *
 * WhatsApp Web's DOM is not a public API and changes over time.
 * To keep maintenance cheap, every "role" the extension needs is
 * expressed as an ORDERED LIST of candidate CSS selectors — the first
 * one that matches wins. When WhatsApp ships a redesign, only this
 * file should need updating; no business logic lives here.
 *
 * Loaded as a classic script into:
 *   - the content script world (via manifest content_scripts)
 * It attaches itself to `globalThis.WAMD.selectors`.
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  // Namespace shared by all WAMD classic-script modules.
  root.WAMD = root.WAMD || {};

  /**
   * Role → ordered candidate selectors.
   * Order matters: put the most specific / most current selector first
   * and progressively more generic fallbacks after it.
   */
  const ROLES = {
    /* ---------------- Application chrome ---------------- */

    // The main app container; used to detect that WhatsApp finished booting.
    appRoot: ['#app', '#main', 'div[data-asset-chat-background]'],

    // Container of the currently open conversation.
    conversationPanel: ['#main', 'div[id="main"]'],

    // Header of the open conversation (holds the chat name).
    conversationHeader: [
      '#main header',
      'header[data-testid="conversation-header"]',
      'div[data-testid="conversation-panel-wrapper"] header'
    ],

    // Chat title text inside the conversation header.
    chatTitle: [
      '#main header span[title]',
      '#main header span[dir="auto"][title]',
      'header [data-testid="conversation-info-header-chat-title"]',
      '#main header span[dir="auto"]',
      'header span[title]'
    ],

    // Scrollable message list of the open conversation.
    messageList: [
      '#main [data-tab="8"]',
      '#main div[role="application"]',
      '#main div[tabindex="0"][role="region"]',
      '#main .copyable-area',
      '#main'
    ],

    /* ---------------- Messages ---------------- */

    // A single message bubble container. `data-id` carries the message id.
    // Bare `div[data-id]` is kept as a lenient fallback; scans are already
    // scoped to #main, and closest() only ever runs on in-conversation
    // elements, so this won't pick up sidebar chat-list rows.
    messageContainer: [
      '#main div[data-id]',
      'div[data-id][class*="message"]',
      'div[data-id]',
      '[data-id]'
    ],

    // Incoming/outgoing markers (used to resolve the sender).
    messageIn: ['.message-in', 'div[data-id*="false_"]'],
    messageOut: ['.message-out', 'div[data-id*="true_"]'],

    // Element carrying the "[time] sender:" metadata inside a bubble.
    messageMeta: [
      'div[data-pre-plain-text]',
      '[data-pre-plain-text]'
    ],

    /* ---------------- Media inside messages ---------------- */

    // Chat images (thumbnails and loaded full images use blob: URLs).
    chatImage: [
      'img[src^="blob:"]',
      'img[data-testid="image-thumb"]'
    ],

    // Inline videos and GIF players.
    chatVideo: [
      'video[src^="blob:"]',
      'video source[src^="blob:"]',
      'video'
    ],

    // Voice notes / audio messages render an <audio> element once loaded.
    chatAudio: [
      'audio[src^="blob:"]',
      'audio'
    ],

    // Voice-note bubble (visible even before <audio> exists).
    voiceNoteBubble: [
      '[data-testid="audio-play"]',
      'button[aria-label*="Play voice message" i]',
      'span[data-icon="audio-play"]'
    ],

    // Sticker images.
    chatSticker: [
      'img[data-testid="sticker"]',
      'img[alt=""][src^="blob:"][style*="visibility"]',
      'div[data-testid="sticker-container"] img'
    ],

    // Document message bubble (PDFs, office files, archives…).
    documentBubble: [
      'div[data-testid="document-thumb"]',
      'div[role="button"][title*="Download" i]',
      'div[data-icon="document-refreshed-thin"]'
    ],

    // The filename label inside a document bubble.
    documentTitle: [
      'span[data-testid="document-title"]',
      'div[data-testid="document-thumb"] ~ div span[dir="auto"]',
      'div[role="button"][title] span[dir="auto"]'
    ],

    // Caption text attached to an image/video message. WhatsApp renders
    // it as selectable text inside the same bubble as the media.
    mediaCaption: [
      'span[data-testid="media-caption"]',
      'div[class*="copyable-text"] span.selectable-text',
      'span.selectable-text.copyable-text',
      'span.selectable-text span[dir="ltr"]',
      'span.selectable-text'
    ],

    /* ---------------- Full-screen media viewer ---------------- */

    // Overlay shown when the user opens an image/video full screen.
    mediaViewer: [
      'div[data-animate-media-viewer="true"]',
      'div[data-testid="media-viewer"]',
      'div[aria-label*="viewer" i]'
    ],

    // The active (centered) media element inside the viewer.
    mediaViewerActiveMedia: [
      'div[data-animate-media-viewer] img[src^="blob:"]',
      'div[data-animate-media-viewer] video',
      'div[data-testid="media-viewer"] img[src^="blob:"]',
      'div[data-testid="media-viewer"] video'
    ],

    /* ---------------- Status & profile ---------------- */

    // Status viewer overlay (status images/videos also use blob: URLs).
    statusViewer: [
      'div[data-testid="status-v3-viewer"]',
      'div[aria-label*="status" i] img[src^="blob:"]'
    ],

    // Enlarged profile photo (contact/group info panel).
    profilePhotoLarge: [
      'div[data-testid="image-viewer"] img',
      'section img[src^="blob:"][style*="object-fit"]',
      'div[role="dialog"] img[src^="blob:"]'
    ]
  };

  /**
   * Return the first selector of a role that matches inside `scope`,
   * or null when none matches. Never throws on invalid selectors so a
   * stale entry can't break the whole extension.
   *
   * @param {string} role       Key of ROLES.
   * @param {ParentNode} scope  Element/document to query. Defaults to document.
   * @returns {Element|null}
   */
  function query(role, scope = document) {
    const candidates = ROLES[role] || [];
    for (const sel of candidates) {
      try {
        const el = scope.querySelector(sel);
        if (el) return el;
      } catch (_) { /* invalid selector — skip candidate */ }
    }
    return null;
  }

  /**
   * Like query() but returns ALL matches of the first candidate
   * selector that yields at least one element.
   *
   * @param {string} role
   * @param {ParentNode} scope
   * @returns {Element[]}
   */
  function queryAll(role, scope = document) {
    const candidates = ROLES[role] || [];
    for (const sel of candidates) {
      try {
        const list = scope.querySelectorAll(sel);
        if (list.length) return Array.from(list);
      } catch (_) { /* skip invalid candidate */ }
    }
    return [];
  }

  /**
   * Test whether `el` matches any candidate of a role.
   * Used by MutationObserver code to classify added nodes.
   *
   * @param {Element} el
   * @param {string} role
   * @returns {boolean}
   */
  function matches(el, role) {
    if (!el || el.nodeType !== 1) return false;
    const candidates = ROLES[role] || [];
    for (const sel of candidates) {
      try {
        if (el.matches(sel)) return true;
      } catch (_) { /* skip invalid candidate */ }
    }
    return false;
  }

  /**
   * Walk up from `el` to find the closest ancestor matching a role.
   *
   * @param {Element} el
   * @param {string} role
   * @returns {Element|null}
   */
  function closest(el, role) {
    if (!el || el.nodeType !== 1) return null;
    const candidates = ROLES[role] || [];
    for (const sel of candidates) {
      try {
        const hit = el.closest(sel);
        if (hit) return hit;
      } catch (_) { /* skip invalid candidate */ }
    }
    return null;
  }

  /**
   * Health check: report which roles currently resolve on the page.
   * Surfaced in the popup so users can see when WhatsApp changed its
   * DOM and which features degraded.
   *
   * @returns {Object<string, boolean>}
   */
  function healthReport() {
    const report = {};
    for (const role of Object.keys(ROLES)) {
      report[role] = query(role) !== null;
    }
    return report;
  }

  root.WAMD.selectors = { ROLES, query, queryAll, matches, closest, healthReport };
})(globalThis);
