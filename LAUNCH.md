# MediaVault — Launch, Submission & Monetization Roadmap

> **Just want to publish?** Start with **[`SUBMISSION.md`](SUBMISSION.md)** — the
> short, do-this-now guide for shipping the free version. This file is the deeper
> reference for the paid v2 rollout and payment options.


A step-by-step runbook to take MediaVault from this repo to a **paid, published**
Chrome Web Store extension, using a **two-phase** rollout that minimises the risk
of rejection.

The code, branding, store copy, graphics, paywall and Gumroad wiring are all
done. What's left is the part an automated agent can't do for you: creating
accounts, setting prices, and clicking "Submit". Budget ~1–2 hours of work plus
Google's review time (a few business days per submission).

---

## The two-phase strategy (and why)

| | **Phase 1 — v1** | **Phase 2 — v2** |
|---|---|---|
| Build | `./build.sh v1` (DOM-only) | `./build.sh v2` (adds engine) |
| Version | 1.0.0 | 2.0.0 |
| Features | Viewer + bulk downloads, auto-scroll, filters, folders, custom naming | Everything in v1 **plus** whole-chat history export, Save-as-ZIP, chat-text (.txt) export |
| Uses WhatsApp internal APIs? | **No** — only the rendered DOM | **Yes** (`@wppconnect/wa-js`) |
| Permissions | no `scripting`, no web-accessible resources | `scripting` + web-accessible resources |
| Review risk | **Low** | Higher (internal APIs draw scrutiny; possible ToS friction) |

**Same store item, two uploads.** v1 and v2 are **not** two separate listings —
they are the same extension, updated from 1.0.0 → 2.0.0. This keeps your reviews,
ratings, install base and URL intact, and means v1 stays live as a safe fallback
if v2 ever gets pulled.

**My recommendation:**

1. **Ship v1 first, exactly as built.** It's clean, useful, monetised, and very
   likely to pass review. It starts earning and accumulating reviews immediately.
2. **Only advertise what v1 does.** Use the "v1 description" in `store/listing.md`
   — don't mention whole-chat export / ZIP before they're in the shipped build,
   or a reviewer may flag the mismatch. The paywall copy inside the extension
   already adapts automatically (the v1 build hides the engine card and drops
   engine features from the Pro pitch).
3. **Let v1 bake for ~2–4 weeks** and gather a few ratings before you submit v2.
   A published item with real reviews tends to get a smoother update review.
4. **Submit v2 as an update.** Expect a deeper review. Keep the v1 zip archived
   so you can re-publish it fast if v2 is rejected or later removed.
5. **Consider shipping v2 with the engine OFF by default** (opt-in in Settings)
   if you want to further reduce the "automated interaction" surface a reviewer
   sees on first launch. (Not required; the current build has it on.)

Realistic expectation: v1 ≈ high approval odds; v2 = worth doing for the premium
value, but treat it as an experiment layered on top of a stable v1 — never bet
the whole product on v2 staying live.

---

## Phase 0 — Prerequisites (once)

- A Google account for the Chrome Web Store **Developer** dashboard.
- A **$5** one-time card payment for developer registration.
- A **Gumroad** account (free) for payments + licence keys.
- A place to host one public page for the **privacy policy** (`PRIVACY.md`) —
  GitHub Pages, a rendered Gist, or your own site.
- A **support email** to show on the listing.

---

## Phase 1 — Set up Gumroad (payments + licence keys)

MediaVault ships wired for **Gumroad** because its licence-verify API is public
(no secret key ends up inside the extension) and it supports **both** a
subscription and a one-time product with per-sale licence keys.

1. Sign up at https://gumroad.com and complete payout/tax details (needed before
   you can sell).
2. Create the **Lifetime** product:
   - **Products → New product → "Digital product"** (a one-time sale).
   - Name: `MediaVault Pro — Lifetime`.
   - Price: set the list price to **$39.99** and add a **discount code / launch
     price of $24.99** (or just set it to $24.99 to start).
   - **Enable "Generate a unique licence key per sale."** ← required; this is the
     key buyers paste into MediaVault.
   - Publish. Copy the URL — the part after `gumroad.com/l/` is the **permalink**
     (e.g. `mediavault-pro`).
3. Create the **Monthly** product:
   - **New product → "Membership"** (a recurring subscription).
   - Name: `MediaVault Pro — Monthly`, price **$4.99/month**.
   - **Enable "Generate a unique licence key per sale."**
   - Publish and copy its permalink too.
4. Decide which product the extension's **"Get MediaVault Pro" / "Upgrade"**
   buttons should open. Simplest: point them at one product page that links to
   both, or at the lifetime page. That URL is your `checkoutUrl`.

> **Two products, one verify call:** Gumroad's verify endpoint checks a key
> against a **single** `product_permalink`. If you sell two separate products,
> set `productPermalink` to whichever you want to verify against, or (cleaner)
> create **one product with two tiers/variants** so both keys verify against the
> same permalink. See "Two-product handling" at the bottom.

---

## Phase 2 — Wire the extension to your product

Edit **`utils/license.js`** → the `CONFIG` object (this is the only code change
required):

```js
const CONFIG = {
  provider: 'gumroad',
  productPermalink: 'YOUR-GUMROAD-PERMALINK',              // e.g. 'mediavault-pro'
  checkoutUrl: 'https://YOURNAME.gumroad.com/l/YOUR-PERMALINK',
  verifyUrl: 'https://api.gumroad.com/v2/licenses/verify', // leave as-is
  recheckInterval: 24 * 60 * 60 * 1000
};
```

Also in `utils/license.js`, if you change prices on Gumroad, mirror them in the
`PRICING` object, and adjust the free allowance via `FREE_LIMIT` (currently 50).

That's it — activation, the free-quota gate, and the upgrade buttons all read
from here.

### How the licence flow works (already implemented)

1. Buyer purchases on Gumroad → receives a licence key by email.
2. In MediaVault → **Settings → MediaVault Pro**, they paste the key and click
   **Activate**.
3. The service worker POSTs `{ product_permalink, license_key }` to
   `api.gumroad.com/v2/licenses/verify` (key only — no personal data).
4. On `success: true` (and not refunded / subscription-ended), Pro unlocks:
   `pro = true`, plan detected from the response, stored in `chrome.storage.sync`.
5. The 50-download free counter stops applying; all Pro features unlock.

---

## Phase 3 — Build the package

```bash
./build.sh v1     # → dist/mediavault-v1-v1.0.0.zip   (submit this first)
```

(Run `./build.sh v2` later for the update, or `./build.sh` to build both now and
archive the v2 zip for Phase 6.)

---

## Phase 4 — Create the developer account & submit v1

1. Go to https://chrome.google.com/webstore/devconsole and pay the **$5**
   one-time registration fee.
2. Fill your **publisher profile** and **support email**.
3. **New item → upload** `dist/mediavault-v1-v1.0.0.zip`.
4. Fill every field from **`store/listing.md`**:
   - Title, Summary, **v1 detailed description**, Category (Productivity), Language.
   - Single-purpose description.
   - Per-permission justifications (v1 won't ask about `scripting`).
5. **Graphics** (in `store/`):
   - Screenshots `store/screenshots/screenshot_1..5.png` (1280×800).
   - Small promo tile `store/promo/promo_tile_440x280.png`.
   - Marquee `store/promo/marquee_1400x560.png`.
6. **Privacy policy URL:** publish `PRIVACY.md` publicly and paste the URL.
7. **Privacy practices tab:** answer per the "Data-use / privacy disclosures"
   section of `store/listing.md` (no data collected; no remote code; Gumroad
   licence call is the only external request).
8. **Submit for review.** If rejected, the email cites the policy — usual fixes
   are trademark wording in the title (try an alternative in `store/listing.md`)
   or a permission justification. Adjust and resubmit.

---

## Phase 5 — After v1 is live

- Do one real **end-to-end purchase test**: buy on Gumroad → paste the key →
  **Activate** → confirm Pro unlocks and the quota disappears. Refund yourself
  after (refunds are honoured by the verify check).
- Reply to your first reviews — early ratings drive ranking.
- Run a time-boxed launch discount on the lifetime plan to drive reviews.
- Watch conversion; tune `FREE_LIMIT` and prices in `utils/license.js`.

---

## Phase 6 — Ship v2 (engine mode) as an update

Once v1 is stable and you're ready for the premium tier:

1. `./build.sh v2` → `dist/mediavault-v2-v2.0.0.zip`.
2. In the dashboard, open the **same item → Package → upload new version**.
3. Update the listing to the **v2 detailed description** (adds whole-chat export,
   ZIP, chat-text export). Add/adjust screenshots if you like.
4. You'll now need to justify the **`scripting`** permission — use the wording in
   `store/listing.md`.
5. Submit. Expect a more thorough review. **Keep the v1 zip** so you can revert
   the listing to 1.x quickly if v2 is rejected.

> If v2 is rejected on ToS/policy grounds, you have options: (a) ship v2 with the
> engine opt-in and off by default; (b) keep v1 as the public build and offer v2
> as a self-hosted / unlisted download for power users; (c) stay on v1. v1
> keeps earning either way.

---

## Monetization model (implemented)

| | Free | Pro |
|---|---|---|
| Lifetime downloads | 50, then upgrade | Unlimited |
| Single + basic bulk saving | ✅ | ✅ |
| Auto-scroll history loader | 🔒 | ✅ |
| Date & sender filters | 🔒 | ✅ |
| Folder organization + custom naming | 🔒 | ✅ |
| Whole-chat history export *(v2)* | 🔒 | ✅ |
| Save-as-ZIP *(v2)* | 🔒 | ✅ |
| Chat text (.txt) export *(v2)* | 🔒 | ✅ |

Pricing: **$4.99/month** (cancel anytime) **or $24.99 lifetime** (launch price;
$39.99 regular). The 50-download free quota is enforced in the service worker
(`background.js`) and can't be bypassed from the UI; feature locks live in the
popup and options pages and adapt to the v1/v2 build automatically.

---

## Two-product handling (Gumroad)

Gumroad's verify endpoint validates a key against one `product_permalink`. Two
clean options:

- **Recommended — one product, two tiers.** Create a single Gumroad "Membership"
  product with a monthly tier and a "lifetime/one-time" option, so every key
  verifies against the same permalink. Put that permalink in `CONFIG`.
- **Two products.** Keep `productPermalink` set to one, and in
  `verifyLicense()` (`background.js`) try the second permalink if the first
  returns `success: false`. It's a ~5-line change — loop over an array of
  permalinks and accept the first that verifies.

---

## Switching payment providers

The verification call lives in one place — `verifyLicense()` in `background.js` —
and reads `CONFIG` from `utils/license.js`. To switch:

- **Lemon Squeezy:** point `verifyUrl` at
  `https://api.lemonsqueezy.com/v1/licenses/validate`, send `license_key`, treat
  `valid === true` as success, and update the host permission in `manifest.json`.
- **ExtensionPay (Stripe subscriptions, hosted flow):** add `ExtPay.js`, call
  `ExtPay('your-id').startBackground()` in `background.js`, set Pro from
  `extpay.getUser().paid`, and replace the licence-key UI with ExtPay's flow.
  Update host permissions to `https://extensionpay.com/*`.

Whatever you choose, keep the `WAMD.license` quota/state API unchanged so the UI
keeps working, and rebuild with `./build.sh`.
