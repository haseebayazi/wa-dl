/**
 * utils/license.js
 * ------------------------------------------------------------------
 * MediaVault licensing + the free-tier download quota.
 *
 * Business model (hybrid): a generous-but-capped free tier, then a
 * paid "Pro" unlock offered as a low monthly subscription OR a
 * one-time lifetime purchase.
 *
 *   FREE  → up to FREE_LIMIT lifetime downloads, basic single/bulk
 *           saving on the open chat, date-based naming.
 *   PRO   → unlimited downloads + every power feature: whole-history
 *           engine export, Save-as-ZIP, chat .txt export, date/sender
 *           filters, auto-scroll, folder organization, custom naming.
 *
 * State lives in chrome.storage.sync (key `license`) so the quota and
 * an activated licence roam with the user's browser profile and cannot
 * be reset by a simple reinstall.
 *
 * Payment + licence verification are provider-agnostic. Out of the box
 * this is wired for Gumroad licence keys (public verify endpoint, no
 * secret needed) which supports BOTH subscriptions and one-time sales.
 * Fill in CONFIG below with your product, or swap in ExtensionPay /
 * Lemon Squeezy — see LAUNCH.md.
 *
 * Attaches to `globalThis.WAMD.license`.
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  root.WAMD = root.WAMD || {};

  /** Lifetime free-download allowance before Pro is required. */
  const FREE_LIMIT = 50;

  /** Marketing copy for the paywall UI (single source of truth). */
  const PRICING = {
    monthly: { id: 'monthly', label: 'Monthly', price: '$4.99', period: '/month' },
    lifetime: {
      id: 'lifetime', label: 'Lifetime', price: '$39.99',
      launch: '$24.99', note: 'One-time · yours forever'
    }
  };

  /**
   * Owner configuration — REPLACE the placeholders before publishing.
   * See LAUNCH.md for the step-by-step. Until `productPermalink` is set
   * to a real value, licence-key activation is disabled and the buttons
   * simply open CHECKOUT_URL.
   */
  const CONFIG = {
    provider: 'gumroad',
    // Gumroad product permalink (the slug after gumroad.com/l/). This MUST
    // match the permalink of your Gumroad product. Recommended: 'mediavault-pro'
    // (rename the product's URL on Gumroad from the default 'wa-dl' to match).
    productPermalink: 'mediavault-pro',
    // Where "Upgrade" / "Buy" buttons send the user to pay.
    checkoutUrl: 'https://haseebtech0.gumroad.com/l/mediavault-pro',
    // Gumroad's public licence-verify endpoint (no secret key required).
    verifyUrl: 'https://api.gumroad.com/v2/licenses/verify',
    // Re-check an active subscription licence at most this often (ms).
    recheckInterval: 24 * 60 * 60 * 1000
  };

  const DEFAULT_LICENSE = {
    pro: false,
    plan: null,          // 'monthly' | 'lifetime' | null
    key: '',             // activated licence key (if any)
    downloadsUsed: 0,    // lifetime count against FREE_LIMIT
    activatedAt: null,   // epoch ms
    verifiedAt: 0        // epoch ms of last successful provider check
  };

  /**
   * Read the merged licence record.
   * @returns {Promise<object>}
   */
  async function get() {
    const stored = await chrome.storage.sync.get('license');
    return { ...DEFAULT_LICENSE, ...(stored.license || {}) };
  }

  /**
   * Persist a partial patch over the current licence record.
   * @param {object} patch
   * @returns {Promise<object>} the resulting record
   */
  async function save(patch) {
    const next = { ...(await get()), ...patch };
    await chrome.storage.sync.set({ license: next });
    return next;
  }

  /**
   * UI-friendly status snapshot.
   * @returns {Promise<{pro:boolean, plan:?string, used:number,
   *   limit:number, remaining:number, key:string, unlimited:boolean}>}
   */
  async function getStatus() {
    const l = await get();
    const remaining = Math.max(0, FREE_LIMIT - (l.downloadsUsed || 0));
    return {
      pro: !!l.pro,
      plan: l.plan,
      used: l.downloadsUsed || 0,
      limit: FREE_LIMIT,
      remaining,
      key: l.key || '',
      unlimited: !!l.pro
    };
  }

  /** @returns {Promise<boolean>} whether Pro is unlocked. */
  async function isPro() {
    return (await get()).pro === true;
  }

  /**
   * Reserve one download against the free quota. Pro users are always
   * allowed and never counted. Free users are allowed until the quota
   * is exhausted. Call this the moment an item is accepted for download
   * (see background.js), and refund() it if that download ultimately
   * fails.
   *
   * @returns {Promise<{ok:boolean, pro:boolean, used:number,
   *   remaining:number, limit:number, reason?:string}>}
   */
  async function reserve() {
    const l = await get();
    if (l.pro) return { ok: true, pro: true, used: 0, remaining: Infinity, limit: FREE_LIMIT };
    const used = l.downloadsUsed || 0;
    if (used >= FREE_LIMIT) {
      return { ok: false, pro: false, used, remaining: 0, limit: FREE_LIMIT, reason: 'quota' };
    }
    const next = used + 1;
    await save({ downloadsUsed: next });
    return { ok: true, pro: false, used: next, remaining: FREE_LIMIT - next, limit: FREE_LIMIT };
  }

  /**
   * Give back one reserved slot (used when a reserved download fails or
   * is canceled). No-op for Pro users.
   * @returns {Promise<void>}
   */
  async function refund() {
    const l = await get();
    if (l.pro) return;
    const used = Math.max(0, (l.downloadsUsed || 0) - 1);
    await save({ downloadsUsed: used });
  }

  /**
   * Whether a free user still has quota (for cheap UI checks that must
   * not consume a slot).
   * @returns {Promise<boolean>}
   */
  async function canDownload() {
    const l = await get();
    return l.pro || (l.downloadsUsed || 0) < FREE_LIMIT;
  }

  /**
   * Mark Pro as unlocked (called after a successful provider check).
   * @param {'monthly'|'lifetime'} plan
   * @param {string} key
   * @returns {Promise<object>}
   */
  async function activate(plan, key) {
    return save({
      pro: true, plan: plan || 'lifetime', key: key || '',
      activatedAt: Date.now(), verifiedAt: Date.now()
    });
  }

  /**
   * Revert to the free tier (keeps the download counter as-is).
   * @returns {Promise<object>}
   */
  async function deactivate() {
    return save({ pro: false, plan: null, key: '', verifiedAt: 0 });
  }

  root.WAMD.license = {
    FREE_LIMIT,
    PRICING,
    CONFIG,
    DEFAULT_LICENSE,
    get,
    save,
    getStatus,
    isPro,
    reserve,
    refund,
    canDownload,
    activate,
    deactivate
  };
})(globalThis);
