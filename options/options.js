/**
 * options/options.js
 * ------------------------------------------------------------------
 * Controller for the settings page. Auto-saves on every change (no
 * save button), applies the theme immediately, shows storage usage
 * and hosts the destructive maintenance actions (clear history /
 * reset stats) behind confirm dialogs.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const { helpers, storage } = globalThis.WAMD;

  /** Shorthand for document.getElementById. */
  const $ = (id) => document.getElementById(id);

  /** Settings keys bound to a checkbox input. */
  const TOGGLES = ['organizeFolders', 'autoDownload', 'duplicateDetection', 'notifications'];

  /** Settings keys bound to a select/text input (value-based). */
  const VALUES = ['downloadFolder', 'namingStyle', 'darkMode'];

  /* ============================ Bootstrap ============================ */

  /**
   * Load stored settings into the form, apply theme, wire listeners
   * and compute storage usage.
   */
  async function init() {
    const settings = await storage.getSettings();

    for (const key of TOGGLES) $(key).checked = !!settings[key];
    for (const key of VALUES) $(key).value = settings[key];
    $('maxConcurrent').value = settings.maxConcurrent;
    $('maxConcurrentValue').textContent = settings.maxConcurrent;

    applyTheme(settings.darkMode);
    wireEvents();
    refreshStorageInfo();
  }

  /** Attach change listeners that auto-save each control. */
  function wireEvents() {
    for (const key of TOGGLES) {
      $(key).addEventListener('change', () => save({ [key]: $(key).checked }));
    }
    for (const key of VALUES) {
      $(key).addEventListener('change', () => {
        const patch = { [key]: $(key).value.trim() };
        if (key === 'darkMode') applyTheme(patch.darkMode);
        save(patch);
      });
    }

    // Range slider: live label update, save on release.
    $('maxConcurrent').addEventListener('input', () => {
      $('maxConcurrentValue').textContent = $('maxConcurrent').value;
    });
    $('maxConcurrent').addEventListener('change', () => {
      save({ maxConcurrent: parseInt($('maxConcurrent').value, 10) });
    });

    // Destructive actions.
    $('btn-clear-history').addEventListener('click', async () => {
      if (!confirm('Clear the entire download history? Duplicate detection starts over.')) return;
      await send({ type: 'WAMD_CLEAR_HISTORY' });
      showStatus('History cleared');
      refreshStorageInfo();
    });
    $('btn-reset-stats').addEventListener('click', async () => {
      if (!confirm('Reset all statistics counters to zero?')) return;
      await send({ type: 'WAMD_RESET_STATS' });
      showStatus('Statistics reset');
    });
  }

  /* ============================ Persistence ============================ */

  /**
   * Persist one settings patch and confirm visually.
   *
   * @param {object} patch
   */
  async function save(patch) {
    await storage.saveSettings(patch);
    showStatus('Saved ✓');
  }

  /**
   * Message the background service worker.
   *
   * @param {object} msg
   * @returns {Promise<object|null>}
   */
  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  /* ============================== UI bits ============================== */

  /**
   * Pin or unpin the dark theme on <html> (auto = media query decides).
   *
   * @param {'auto'|'dark'|'light'} mode
   */
  function applyTheme(mode) {
    if (mode === 'dark' || mode === 'light') {
      document.documentElement.dataset.theme = mode;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }

  /** Toast-style save confirmation (bottom center). */
  let statusTimer = null;
  function showStatus(text) {
    const el = $('save-status');
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('visible'), 1600);
  }

  /**
   * Report approximate local storage usage: IndexedDB estimate plus
   * the number of history rows.
   */
  async function refreshStorageInfo() {
    const parts = [];
    try {
      const rows = await send({ type: 'WAMD_COUNT_HISTORY' });
      if (rows && rows.ok) parts.push(`${rows.result} history entries`);
    } catch (_) { /* best-effort */ }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage } = await navigator.storage.estimate();
        if (usage) parts.push(`≈ ${helpers.formatBytes(usage)} used by extension data`);
      }
    } catch (_) { /* best-effort */ }
    $('storage-info').textContent = parts.length
      ? parts.join(' · ')
      : 'Storage usage unavailable in this browser.';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
