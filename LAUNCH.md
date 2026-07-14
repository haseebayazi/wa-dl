# MediaVault — Launch & Monetization Checklist

This is the short, do-it-once runbook to take MediaVault from this repo to a
paid, published Chrome Web Store extension. The code, branding, store copy and
graphics are done — the steps below are the parts that require **your**
accounts and payments (an automated agent can't create those for you).

Estimated time: ~1–2 hours of clicking, plus Google's review (a few days).

---

## 0. One honest heads-up first

MediaVault's whole-history "engine" mode uses WhatsApp Web's internal APIs.
That's powerful, but it can conflict with WhatsApp's Terms of Service and
Google may scrutinise WhatsApp-related extensions. The listing is written to
stay on the safe side (positioned as exporting **your own** data), but there is
a real, non-zero chance of rejection or later takedown. If you want to minimise
risk, you can ship with only the DOM-based features enabled first. Your call.

---

## 1. Set up the payment provider (Gumroad — recommended default)

The extension ships wired for **Gumroad** because its licence-verify API is
public (no secret key in the extension) and it supports **both** a subscription
and a one-time product with licence keys.

1. Create a Gumroad account → https://gumroad.com
2. Create **two** products (or one product with two tiers):
   - **MediaVault Pro — Monthly**: a *membership/subscription*, **$4.99/month**.
   - **MediaVault Pro — Lifetime**: a *one-time* product, **$24.99** (set the
     regular price to $39.99 and use a launch discount to show the deal).
3. For each product: **Settings → enable "Generate a unique licence key per
   sale"**. This is what buyers paste into MediaVault to unlock Pro.
4. Note the product **permalink** — the slug after `gumroad.com/l/…`
   (e.g. `mediavault-pro`).
5. Note the public **checkout URL** you want the "Upgrade / Get Pro" buttons to
   open (your Gumroad product page).

> Prefer Stripe subscriptions with a hosted licence flow instead? Use
> **ExtensionPay** (https://extensionpay.com) or **Lemon Squeezy**. See
> "Switching providers" at the bottom.

## 2. Point the extension at your product

Edit **`utils/license.js`** → the `CONFIG` object:

```js
const CONFIG = {
  provider: 'gumroad',
  productPermalink: 'YOUR-GUMROAD-PERMALINK',        // e.g. 'mediavault-pro'
  checkoutUrl: 'https://YOURNAME.gumroad.com/l/YOUR-PERMALINK',
  verifyUrl: 'https://api.gumroad.com/v2/licenses/verify',
  recheckInterval: 24 * 60 * 60 * 1000
};
```

Prices shown in the UI live in the same file (`PRICING`) — change them there if
you adjust your Gumroad prices. Free-tier size is `FREE_LIMIT` (currently 50).

That's the only code change required.

## 3. Build the package

```bash
./build.sh
```

This writes `dist/mediavault-v1.0.0.zip` with only the runtime files.

## 4. Create your Chrome Web Store developer account

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay the **one-time $5** registration fee.
3. Set up your publisher profile and a **support email** (shown on the listing).

## 5. Create the listing

1. **Upload** `dist/mediavault-v1.0.0.zip`.
2. Copy every field from **`store/listing.md`**:
   - Title, Summary, Detailed description, Category (Productivity), Language.
   - Single-purpose description.
   - Permission justifications (the console asks per permission).
3. **Graphics** (in `store/`):
   - Screenshots: `store/screenshots/screenshot_1..5.png` (1280×800).
   - Small promo tile: `store/promo/promo_tile_440x280.png`.
   - Marquee: `store/promo/marquee_1400x560.png`.
4. **Privacy policy URL:** publish `PRIVACY.md` somewhere public (GitHub Pages,
   your site, or a Gist rendered page) and paste the URL.
5. **Privacy practices tab:** answer using the "Data-use / privacy disclosures"
   section of `store/listing.md` (no data collected; no remote code; declare the
   Gumroad licence call as the only external request).

## 6. Submit for review

Submit. Reviews usually take a few days. If rejected, the email cites the
policy — most common fixes are trademark wording in the title (try an
alternative from `store/listing.md`) or a permission justification. Adjust and
resubmit.

## 7. After you're live

- Test the real purchase → licence-key → **Activate** flow end-to-end once.
- Watch reviews; reply to the first few — early ratings matter a lot for ranking.
- Consider a time-boxed launch discount on the lifetime plan to drive reviews.
- Iterate on the free limit (`FREE_LIMIT`) and prices based on conversion.

---

## Monetization model (what's implemented)

| | Free | Pro |
|---|---|---|
| Lifetime downloads | 50, then upgrade | Unlimited |
| Single + basic bulk saving | ✅ | ✅ |
| Whole-chat history export (engine) | 🔒 | ✅ |
| Save-as-ZIP | 🔒 | ✅ |
| Chat text (.txt) export | 🔒 | ✅ |
| Date & sender filters | 🔒 | ✅ |
| Auto-scroll loader | 🔒 | ✅ |
| Folder organization + custom naming | 🔒 | ✅ |

Pricing: **$4.99/month** (cancel anytime) **or $24.99 lifetime** (launch price;
$39.99 regular). The 50-download free quota is enforced in the service worker
(`background.js`) and cannot be bypassed from the UI; feature locks are in the
popup and options pages.

## Switching providers

The verification call lives in one place — `verifyLicense()` in
`background.js` — and reads `CONFIG` from `utils/license.js`. To use a different
provider:

- **Lemon Squeezy:** point `verifyUrl` at
  `https://api.lemonsqueezy.com/v1/licenses/validate`, send `license_key`, and
  treat `valid === true` as success. Update the host permission in
  `manifest.json` accordingly.
- **ExtensionPay (Stripe subscriptions):** add `ExtPay.js`, call
  `ExtPay('your-id').startBackground()` in `background.js`, and set Pro from
  `extpay.getUser().paid`. Replace the licence-key UI with ExtPay's hosted
  flow. Update host permissions to `https://extensionpay.com/*`.

Whichever you pick, keep the `WAMD.license` quota/state API unchanged so the UI
keeps working.
