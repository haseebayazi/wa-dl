# MediaVault — Start-Here Submission Guide

**The simple plan:** ship a **100% free** version to the Chrome Web Store now.
No payments, no license, nothing to configure. Once it's approved and live, we
add the premium version as an update. That's it.

- **Now → Part 1:** publish the free build. ~45 minutes + Google's review.
- **Later → Part 2:** add the paid engine version. Nothing to do today.

Everything you need is in this repo. This document has every field, and where to
find every image.

---

## Part 1 — Publish the FREE version (do this now)

### What you're uploading

**File:** `dist/mediavault-v1-v1.0.0.zip` — built by running `./build.sh v1`
(or `./build.sh` to build both). It's the free, DOM-only build: it only asks for
5 basic permissions on `web.whatsapp.com`, has no paywall, and every feature is
free. This is the lowest-risk thing you can submit.

> Rebuild anytime with `./build.sh v1`. The zip is also attached in chat.

### Step 1 — Create your developer account (one time)

1. Go to **https://chrome.google.com/webstore/devconsole**
2. Pay the **one-time $5** registration fee.
3. Set a **support email** (it shows on the listing).

### Step 2 — Upload & fill the listing

Click **New item → upload `dist/mediavault-v1-v1.0.0.zip`**, then paste:

**Store title** (this comes from the zip automatically, no need to type):
```
MediaVault - WhatsApp Web Media Downloader
```

**Summary / short description** (also auto-filled from the zip; 132-char max):
```
Download & back up images, videos, voice notes, audio, documents, GIFs and stickers from WhatsApp Web. Fast, private, on-device.
```

**Category:** `Productivity`  **Language:** `English`

**Detailed description** — paste this:
```
MediaVault is the fastest, most private way to save and back up your own media from WhatsApp Web — images, videos, voice notes, audio, documents, GIFs and stickers.

No more right-click-save on one photo at a time. Open web.whatsapp.com, click the MediaVault icon, and save everything in the open chat at once — completely free.

★ WHAT YOU CAN DO
• Download images, videos, voice notes, audio, documents, GIFs & stickers
• One-click save from the full-screen media viewer
• Bulk-download the open chat, filtered by date range or by sender
• Auto-scroll a conversation to load and save older media hands-free
• Auto-organize files into tidy folders: WhatsApp / Chat / Images, Videos, …
• Smart duplicate detection so you never save the same file twice
• A live download queue with progress, retry and cancel
• Searchable history and download statistics
• Beautiful light & dark themes

★ WHY MEDIAVAULT
• Private by design — your messages and media never leave your device. No servers, no analytics, no tracking.
• On-device processing — files go straight from your WhatsApp Web tab to your Downloads folder.
• Lightweight, fast, and free — no account required.

★ HOW IT WORKS
1. Install MediaVault and open web.whatsapp.com (log in as usual).
2. Click the MediaVault toolbar icon.
3. Save single items from the viewer, or bulk-download the whole open chat.
4. Files land in your Downloads folder, neatly named and organized.

★ PRIVACY
MediaVault does all its work locally in your browser. It does not upload, read, store or transmit your conversations anywhere. It makes no external network requests.

★ GOOD TO KNOW
MediaVault is an independent tool and is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owner, used only to describe compatibility. Please back up your own conversations and respect other people's privacy and WhatsApp's Terms of Service.
```

**Single-purpose description** — paste this:
```
MediaVault has a single purpose: to let users download and back up their own media (images, videos, audio, voice notes, documents, GIFs, stickers) from WhatsApp Web to their local device.
```

### Step 3 — Graphics (drag-and-drop from these folders)

| What | Where | Size |
|---|---|---|
| Screenshots (upload all 4) | `store/screenshots/screenshot_1..4.png` | 1280×800 |
| Small promo tile | `store/promo/promo_tile_440x280.png` | 440×280 |
| Marquee promo tile | `store/promo/marquee_1400x560.png` | 1400×560 |
| Store icon | already inside the zip (`icon128.png`) | 128×128 |

Optional screenshot captions:
1. Bulk-download any WhatsApp media in one click
2. Every media type, neatly detected
3. Your history, stats & search — all local
4. Private by design — nothing leaves your device

### Step 4 — Permissions justifications

The dashboard asks why you need each permission. Paste these:

| Permission | Justification |
|---|---|
| `downloads` | Save the user's selected media to their computer via the browser's download manager. |
| `storage` | Store the user's settings and local download history/statistics. |
| `activeTab` / `tabs` | Find the user's open WhatsApp Web tab so the popup can request media from it. |
| `notifications` | Optional desktop alerts when downloads complete, fail or a batch finishes. |
| Host `https://web.whatsapp.com/*` | The only site the extension reads media from; it runs nowhere else. |

> The free build asks for **nothing else** — no `scripting`, no payment host, no
> remote code.

### Step 5 — Privacy

1. **Privacy policy URL** (required): publish `PRIVACY.md` on a public page and
   paste the link. Easiest options:
   - GitHub Pages: Settings → Pages → enable, then link to the rendered file; or
   - paste `PRIVACY.md` into a public GitHub Gist and use its URL.
2. **Privacy practices tab** — answer:
   - Data collected? **None.** MediaVault processes media locally and sends
     nothing to any server.
   - Selling/transferring data to third parties? **No.**
   - Using data unrelated to the single purpose? **No.**
   - Remote code? **No** — all code is in the package.

### Step 6 — Submit

Click **Submit for review**. Reviews take a few business days.

If it's rejected, the email cites the exact policy. The two most common fixes:
trademark wording in the title (alternatives are in `store/listing.md`) or a
permission justification. Tweak and resubmit — no code change needed.

**✅ That's the whole free launch. You're done until it's approved.**

---

## Part 2 — Add the paid version (LATER, after v1 is live)

Nothing to do now. When you're ready to earn from it:

1. I build the paid version: `./build.sh v2` → `dist/mediavault-v2-v2.0.0.zip`.
   It adds whole-chat history export, ZIP, chat-text (.txt) export, and a simple
   paywall (some downloads free, then a one-time or monthly upgrade).
2. You upload it as an **update to the same store item** (Package → new version),
   and switch the listing to the v2 description/screenshots (archived for you in
   `store/screenshots-v2/` and `store/listing.md`).
3. You connect a payment provider (below). I wire it — it's a small change.

### Payment gateway — the two easy options

You don't need Gumroad's complicated setup. Pick **one** when the time comes:

**Option A — ExtensionPay  (easiest for your customers)**
- The customer clicks "Upgrade" **inside the extension**, pays, and it unlocks
  instantly. **No license keys to copy or paste.**
- Built specifically for Chrome extensions, so it's the least code for me to wire.
- You connect a Stripe account; you're the merchant (you handle your own tax —
  fine at small scale).
- Best if you want the smoothest possible customer experience.

**Option B — Dodo Payments  (easiest for you, zero tax hassle)**
- A "Merchant of Record" — **Dodo handles global sales tax/VAT for you**, so you
  never deal with tax compliance.
- Simple hosted checkout link + a licence key the customer pastes once in
  Settings (already built in the paid build).
- Modern, developer-friendly API; similar to Lemon Squeezy/Paddle.
- Best if you want to sell worldwide with zero paperwork.

**My recommendation:** start with **ExtensionPay** for the frictionless customer
flow (no keys). If handling tax yourself ever becomes a worry as sales grow,
switch to **Dodo Payments** — the code is written so swapping providers is a
small, isolated change.

> When you're ready, just tell me "wire ExtensionPay" (or Dodo) and which price
> (e.g. one-time $24.99, or $4.99/month). I'll do the rest and rebuild.

---

## File map (everything, at a glance)

```
dist/mediavault-v1-v1.0.0.zip     ← FREE build — upload this now
dist/mediavault-v2-v2.0.0.zip     ← PAID build — for later

store/screenshots/                ← v1 screenshots (upload these now)
store/promo/                      ← v1 promo tile + marquee (now)
store/screenshots-v2/  · promo-v2/← v2 graphics (for the update later)
store/listing.md                  ← all listing copy (v1 + v2 variants)
store/gumroad/                    ← Gumroad page assets (only if you use Gumroad)

PRIVACY.md                        ← privacy policy (host it, link it)
assets/icons/                     ← 16/32/48/128/512 icons
build.sh                          ← ./build.sh v1  |  v2  |  (both)
```

Build commands:
```bash
./build.sh v1     # free build  → dist/mediavault-v1-v1.0.0.zip
./build.sh v2     # paid build  → dist/mediavault-v2-v2.0.0.zip
./build.sh        # both
```
