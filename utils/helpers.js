/**
 * utils/helpers.js
 * ------------------------------------------------------------------
 * Pure, dependency-free utility functions shared by every layer of
 * WA Media Downloader Pro (content script, service worker, popup,
 * options page). No DOM access and no chrome.* calls in this file so
 * it stays trivially testable.
 *
 * Attaches to `globalThis.WAMD.helpers`.
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  root.WAMD = root.WAMD || {};

  /**
   * Debounce: postpone `fn` until `wait` ms elapsed without new calls.
   * Used to coalesce MutationObserver bursts into a single scan.
   *
   * @param {Function} fn
   * @param {number} wait
   * @returns {Function} debounced wrapper (has .cancel())
   */
  function debounce(fn, wait) {
    let timer = null;
    const wrapper = function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
    wrapper.cancel = () => clearTimeout(timer);
    return wrapper;
  }

  /**
   * Throttle: run `fn` at most once every `wait` ms (leading edge).
   *
   * @param {Function} fn
   * @param {number} wait
   * @returns {Function}
   */
  function throttle(fn, wait) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  /**
   * Promise-based sleep, used for retry backoff.
   *
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate a short unique id for queue items / media registry keys.
   *
   * @returns {string}
   */
  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Make a string safe to use as a file or folder name on
   * Windows/macOS/Linux: strips reserved characters, control chars,
   * trailing dots/spaces, and caps the length.
   *
   * @param {string} name
   * @param {number} [maxLen=80]
   * @returns {string}
   */
  function sanitizeFilename(name, maxLen = 80) {
    const cleaned = String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')      // reserved on Windows
      .replace(/[\u0000-\u001f\u007f]/g, '')   // control characters
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');            // Windows forbids trailing dot/space
    return (cleaned || 'unknown').slice(0, maxLen);
  }

  /**
   * Format a byte count as a human readable string (e.g. "1.4 MB").
   *
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /**
   * Format a Date as `YYYY-MM-DD_HH-MM-SS` for the timestamp naming rule.
   *
   * @param {Date} [date=new Date()]
   * @returns {string}
   */
  function timestampSlug(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
      `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
  }

  /**
   * Map a MIME type to a sensible file extension.
   * Falls back to the MIME subtype, then "bin".
   *
   * @param {string} mime
   * @returns {string} extension without leading dot
   */
  function extensionForMime(mime) {
    const MAP = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/avif': 'avif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/3gpp': '3gp',
      'audio/ogg': 'ogg',
      'audio/ogg; codecs=opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/wav': 'wav',
      'application/pdf': 'pdf',
      'application/zip': 'zip',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'text/plain': 'txt'
    };
    const key = String(mime || '').toLowerCase().split(';')[0].trim();
    if (MAP[key]) return MAP[key];
    const sub = key.split('/')[1];
    return (sub && /^[a-z0-9.+-]{1,8}$/.test(sub)) ? sub.replace(/^x-/, '') : 'bin';
  }

  /**
   * Map an internal media kind to the folder bucket used by the
   * "organize into folders" setting.
   *
   * @param {string} kind  image|video|audio|voice|document|gif|sticker|profile|status
   * @returns {string} folder name
   */
  function folderForKind(kind) {
    const MAP = {
      image: 'Images',
      gif: 'Images',
      sticker: 'Stickers',
      video: 'Videos',
      audio: 'Audio',
      voice: 'Audio',
      document: 'Documents',
      profile: 'Profile Pictures',
      status: 'Status'
    };
    return MAP[kind] || 'Other';
  }

  /**
   * SHA-256 of an ArrayBuffer as a hex string.
   * Used for content-based duplicate detection.
   *
   * @param {ArrayBuffer} buffer
   * @returns {Promise<string>}
   */
  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Convert a Blob to a base64 data: URL (transferable over
   * chrome.runtime messaging, downloadable by chrome.downloads).
   *
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  root.WAMD.helpers = {
    debounce,
    throttle,
    sleep,
    uid,
    sanitizeFilename,
    formatBytes,
    timestampSlug,
    extensionForMime,
    folderForKind,
    sha256Hex,
    blobToDataURL
  };
})(globalThis);
