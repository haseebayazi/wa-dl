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

  const { helpers, storage, license, config } = globalThis.WAMD;

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
    refreshLicense();
  }

  /* ============================ Licensing ============================ */

  /** Load the licence status and render the Pro card + feature locks. */
  async function refreshLicense() {
    // Fully-free (v1) build: no paywall — hide the Pro card, unlock settings.
    if (!config.paid) {
      $('pro-card').classList.add('hidden');
      applyProLocks(true);
      return;
    }
    const res = await send({ type: 'WAMD_LICENSE_STATUS' });
    const s = (res && res.ok) ? res.result : { pro: false, used: 0, limit: license.FREE_LIMIT };
    renderLicense(s);
    applyProLocks(s.pro);
  }

  /**
   * Render the Pro card for the given licence status.
   * @param {object} s  licence status snapshot
   */
  function renderLicense(s) {
    const p = license.PRICING;
    $('plan-monthly').textContent = `${p.monthly.price}${p.monthly.period}`;
    $('plan-lifetime').innerHTML = `${p.lifetime.launch} <s>${p.lifetime.price}</s>`;
    $('pro-feature-list').textContent = `${config.proFeaturesLong}.`;

    if (s.pro) {
      $('lic-status').textContent = s.plan === 'monthly'
        ? '✓ Pro active — monthly subscription. Unlimited downloads unlocked.'
        : '✓ Pro active — lifetime licence. Unlimited downloads unlocked.';
      $('lic-status').classList.add('ok');
      $('lic-free').classList.add('hidden');
      $('lic-pro').classList.remove('hidden');
    } else {
      const left = Math.max(0, s.limit - s.used);
      $('lic-status').textContent = `Free plan — ${left} of ${s.limit} downloads left.`;
      $('lic-status').classList.remove('ok');
      $('lic-free').classList.remove('hidden');
      $('lic-pro').classList.add('hidden');
    }
  }

  /**
   * Enable/disable the Pro-only settings (custom naming + folder
   * organisation) based on the licence.
   * @param {boolean} pro
   */
  function applyProLocks(pro) {
    // Custom naming choices are Pro; keep the free date-based default open.
    const naming = $('namingStyle');
    for (const opt of naming.options) {
      if (opt.value !== 'chat_datetime') opt.disabled = !pro;
    }
    if (!pro && naming.value !== 'chat_datetime') {
      naming.value = 'chat_datetime';
      save({ namingStyle: 'chat_datetime' });
    }
    // Folder organisation is Pro.
    $('organizeFolders').disabled = !pro;
    for (const group of document.querySelectorAll('[data-pro]')) {
      group.classList.toggle('locked', !pro);
    }
    for (const badge of document.querySelectorAll('.pro-badge')) {
      badge.style.display = pro ? 'none' : '';
    }
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

    // Licensing actions.
    $('btn-buy').addEventListener('click', () => {
      chrome.tabs.create({ url: license.CONFIG.checkoutUrl });
    });
    $('btn-activate').addEventListener('click', activateKey);
    $('lic-key').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); activateKey(); }
    });
    $('btn-deactivate').addEventListener('click', async () => {
      if (!confirm('Deactivate Pro on this device?')) return;
      await send({ type: 'WAMD_LICENSE_DEACTIVATE' });
      showStatus('Pro deactivated');
      refreshLicense();
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

  /**
   * Verify the pasted licence key with the payment provider and unlock
   * Pro on success.
   */
  async function activateKey() {
    const key = $('lic-key').value.trim();
    const msg = $('lic-msg');
    const btn = $('btn-activate');
    if (!key) { msg.textContent = 'Paste your licence key first.'; msg.className = 'lic-msg small err'; return; }

    btn.disabled = true;
    msg.textContent = 'Checking your licence…';
    msg.className = 'lic-msg small';
    const res = await send({ type: 'WAMD_LICENSE_VERIFY', key });
    btn.disabled = false;

    if (res && res.ok) {
      msg.textContent = '✓ Activated. Enjoy MediaVault Pro!';
      msg.className = 'lic-msg small ok';
      $('lic-key').value = '';
      refreshLicense();
    } else {
      msg.textContent = (res && res.error) ? res.error : 'Could not activate that key.';
      msg.className = 'lic-msg small err';
    }
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
