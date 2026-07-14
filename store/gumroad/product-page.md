# Gumroad product page — MediaVault Pro (copy/paste)

Fill each Gumroad field with the matching block below. Images are in this folder.

---

## Name

```
MediaVault Pro — Bulk Download Media + Chat from WhatsApp Web
```

## URL / permalink

Change the product URL slug from `wa-dl` to **`mediavault-pro`** so your page is
`haseebtech0.gumroad.com/l/mediavault-pro`.

> Important: this permalink must match `productPermalink` in `utils/license.js`
> (already set to `mediavault-pro`). If you keep a different slug, update that
> one line and rebuild.

## Cover

Upload `gumroad_cover_1600x900.png` (16:9, sits at the top of the page).

## Thumbnail

Upload `gumroad_thumbnail_1000x1000.png` (square, used in Library / Discover /
Profile).

## Call to action

Select **"I want this!"** (fits a licence/upgrade purchase).

## Summary (short subtitle)

```
Unlock unlimited downloads + whole-chat export, ZIP & filters. One licence key, activate in seconds.
```

---

## Description (rich text — paste into the description box)

```
Save and back up everything you care about on WhatsApp Web — without the endless right-click-and-save. MediaVault Pro unlocks the full power of the MediaVault Chrome extension: unlimited downloads plus every pro feature.

━━━━━━━━━━━━━━━━━━━━
WHAT PRO UNLOCKS
━━━━━━━━━━━━━━━━━━━━
• Unlimited downloads (the free extension stops at 50)
• Download an entire chat or group's media history in one click
• Bulk-download with date-range and per-sender filters
• Save a whole selection as a single ZIP archive
• Export full chat transcripts to a clean, timestamped .txt file
• Auto-scroll a conversation to load and grab older media hands-free
• Auto-organize into tidy folders: WhatsApp / Chat / Images, Videos, …
• Custom file naming (caption or original filename)

Works with images, videos, voice notes, audio, documents, GIFs and stickers.

━━━━━━━━━━━━━━━━━━━━
PRIVATE BY DESIGN
━━━━━━━━━━━━━━━━━━━━
Your messages and media never leave your device. No servers, no analytics, no tracking. Everything is processed locally in your browser. The only network request the extension ever makes is a licence check when you activate Pro — and it sends nothing but your licence key.

━━━━━━━━━━━━━━━━━━━━
HOW IT WORKS (2 minutes)
━━━━━━━━━━━━━━━━━━━━
1. Install the free MediaVault extension from the Chrome Web Store.
   → [PASTE YOUR CHROME WEB STORE LINK HERE once v1 is approved]
2. Buy MediaVault Pro here — you'll instantly get a licence key.
3. In the extension: open Settings → MediaVault Pro → paste your key → Activate.
4. Done. Unlimited downloads and every pro feature unlock immediately.

━━━━━━━━━━━━━━━━━━━━
FAIR, SIMPLE PRICING
━━━━━━━━━━━━━━━━━━━━
One licence, all pro features, free updates. Choose a low monthly plan or pay once for a lifetime licence — your call.

━━━━━━━━━━━━━━━━━━━━
100% RISK-FREE
━━━━━━━━━━━━━━━━━━━━
Not happy? Email within 30 days for a full refund — no questions asked.

━━━━━━━━━━━━━━━━━━━━
GOOD TO KNOW
━━━━━━━━━━━━━━━━━━━━
MediaVault is an independent tool and is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owner, used only to describe compatibility. Please back up your own conversations and respect other people's privacy and WhatsApp's Terms of Service.

Questions before buying? Email me — happy to help.
```

> After your Chrome Web Store listing is approved, replace the bracketed line in
> step 1 with the real store URL.

---

## Additional details (Gumroad "Add detail" rows — label : value)

```
Works on          : Chrome, Edge, Brave (Chromium) on WhatsApp Web
Delivery          : Instant licence key by email
Activation        : Paste key in the extension → Settings → Activate
Updates           : Free updates included
Privacy           : 100% on-device, no tracking
Refunds           : 30-day money-back guarantee
Support           : Email support
```

---

## Pricing — recommended setup

The extension shows **$4.99/month or $24.99 lifetime**. Gumroad can't be both
one-time and recurring in a *single* product, so pick one of these:

**A. Simplest (one product) — recommended to launch fast**
- Make THIS product a one-time **"Lifetime licence"**.
- Set the price to **$24.99** (optionally list $39.99 and add a launch discount).
- Enable **"Generate a unique licence key per sale."**
- Result: one permalink, works with the code as-is.

**B. Full hybrid (two products) — most revenue**
- Keep this one as **Lifetime $24.99** (one-time).
- Create a second **Membership** product **"MediaVault Pro — Monthly" $4.99/mo**.
- Enable licence keys on both.
- Then add the tiny two-permalink loop in `verifyLicense()` (see LAUNCH.md →
  "Two-product handling") so both keys activate.

> You currently have the amount set to **$5**. If you want a single flat price
> that's fine, but $24.99 lifetime (or $4.99/mo) matches the in-app copy and
> earns more. If you keep $5/mo, change `PRICING.monthly.price` in
> `utils/license.js` to `'$5'` so the app matches.

Whatever price you choose: **turn ON "Generate a unique licence key per sale"**
(Gumroad product settings) — MediaVault activates using that key.

---

## Refund policy (Gumroad "Specify a refund policy" field)

```
30-day money-back guarantee. If MediaVault Pro isn't for you, email us within
30 days of purchase for a full refund — no questions asked.
```

---

## Post-purchase content / receipt note (Gumroad "Content" after purchase)

Paste this as the content buyers see after paying (no file needed):

```
Thanks for buying MediaVault Pro! 🎉

Your licence key is shown above / in your receipt email.

To activate:
1. Install the free MediaVault extension from the Chrome Web Store:
   [PASTE YOUR CHROME WEB STORE LINK]
2. Click the MediaVault icon → the gear (Settings) → "MediaVault Pro".
3. Paste your licence key and click "Activate".

That's it — unlimited downloads and all pro features are now unlocked.

Need help? Just reply to your receipt email. Enjoy!
```

---

## Settings checklist (toggles on the Gumroad page)

- [x] **Generate a unique licence key per sale** (required — under the file/settings area)
- [x] Specify a refund policy → paste the text above
- [ ] Require shipping information → **OFF** (digital product)
- [ ] Mark as e-publication for VAT → optional (EU VAT handling)
- [x] Publicly show number of sales → optional (social proof once you have sales)
- [ ] Custom domain → optional
