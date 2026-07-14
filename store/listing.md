# MediaVault — Chrome Web Store listing

Everything you paste into the Chrome Web Store developer dashboard. Copy each
section into the matching field. Character counts are noted where the store
enforces a limit.

---

## Store title (max 45 chars)

```
MediaVault - WhatsApp Media & Chat Downloader
```

> This is the `name` in `manifest.json` and becomes the store title. Keep them
> identical.

### Alternative titles (if you want to A/B or the first is rejected)

- `MediaVault - Save & Export for WhatsApp Web` (43)
- `MediaVault - WhatsApp Media Saver & Backup` (42)
- `MediaVault - Download Media from WhatsApp Web` (45)

---

## Summary / short description (max 132 chars)

```
Download & back up images, videos, voice notes, documents and full chat transcripts from WhatsApp Web. Fast, private, on-device.
```

(127 chars — matches `manifest.json` `description`.)

---

## Category

**Productivity**

## Language

English (add more locales later for reach).

---

> **Two-phase submission.** Submit the **v1 (DOM-only)** package first with the
> **v1 description** below (it doesn't advertise the engine-only features that
> aren't in the v1 build — reviewers flag listing/feature mismatches). When the
> **v2** package is approved as an update, swap in the full description that
> follows. Everything else in this file (title, permissions, privacy) is the
> same for both.

## Detailed description — v1 (DOM-only, first submission)

```
MediaVault is the fastest, most private way to save and back up your own media from WhatsApp Web — images, videos, voice notes, audio, documents, GIFs and stickers.

No more right-click-save on one photo at a time. Open web.whatsapp.com, click the MediaVault icon, and grab everything in the open chat at once.

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
• Lightweight and fast — no account required to start.

★ FREE & PRO
MediaVault is free to start: your first 50 downloads are on us. Upgrade to Pro for unlimited downloads plus power features — auto-scroll history loading, date & sender filters, folder organization and custom file naming. Pro is $4.99/month (cancel anytime) or a one-time $24.99 lifetime licence.

★ PRIVACY
MediaVault does all its work locally in your browser. It does not upload, read, store or transmit your conversations anywhere. The only network request it makes is a licence check when you activate Pro — and that sends nothing but your licence key.

★ GOOD TO KNOW
MediaVault is an independent tool and is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owner, used here only to describe compatibility. Please back up your own conversations and respect other people's privacy and WhatsApp's Terms of Service.
```

## Detailed description — v2 (full, use after v2 is approved)

> Paste as-is. Front-loads keywords for search while staying honest and
> policy-safe (positioned as exporting *your own* data).

```
MediaVault is the fastest, most private way to save and back up your own media and conversations from WhatsApp Web — images, videos, voice notes, audio, documents, GIFs and stickers — plus full chat transcripts as clean text files.

No more right-click-save on one photo at a time. Open web.whatsapp.com, click the MediaVault icon, and export a whole conversation's media in one go.

★ WHAT YOU CAN DO
• Download images, videos, voice notes, audio, documents, GIFs & stickers
• Save an entire chat or group's media history in one click — no endless scrolling
• Bulk-download the open chat and filter by date range or by sender
• Export a full chat transcript to a clean, timestamped .txt file
• Save a whole selection as a single ZIP archive
• Auto-organize files into tidy folders: WhatsApp / Chat / Images, Videos, …
• Smart duplicate detection so you never save the same file twice
• A live download queue with progress, retry and cancel
• Searchable history and download statistics
• Beautiful light & dark themes

★ WHY MEDIAVAULT
• Private by design — your messages and media never leave your device. No servers, no analytics, no tracking.
• On-device processing — files go straight from your WhatsApp Web tab to your Downloads folder.
• Lightweight and fast — no bloat, no account required to start.

★ FREE & PRO
MediaVault is free to start: your first 50 downloads are on us. Upgrade to Pro for unlimited downloads plus every power feature — whole-chat history export, Save-as-ZIP, chat text (.txt) export, date & sender filters, auto-scroll loading, folder organization and custom file naming.

Pro is a fair deal: $4.99/month (cancel anytime) or a one-time $24.99 lifetime licence — pay once, yours forever.

★ HOW IT WORKS
1. Install MediaVault and open web.whatsapp.com (log in as usual).
2. Click the MediaVault toolbar icon.
3. Pick a chat and choose what to save — single items, a bulk batch, a whole history, a ZIP or a text transcript.
4. Files land in your Downloads folder, neatly named and organized.

★ PRIVACY
MediaVault does all its work locally in your browser. It does not upload, read, store or transmit your conversations anywhere. The only network request it ever makes is a licence check when you activate Pro — and that sends nothing but your licence key.

★ GOOD TO KNOW
• MediaVault is an independent tool and is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owner, used here only to describe compatibility.
• Please use MediaVault to back up your own conversations and respect other people's privacy and WhatsApp's Terms of Service.
• WhatsApp removes older media from its servers over time; expired media can no longer be downloaded by any tool.

Questions or feedback? We read every message — reach us at the support email on this listing.
```

---

## Single-purpose description (required by Chrome)

```
MediaVault has a single purpose: to let users download and back up their own media (images, videos, audio, voice notes, documents, GIFs, stickers) and chat transcripts from WhatsApp Web to their local device.
```

---

## Permission justifications (required per permission)

| Permission | Justification to paste |
|---|---|
| `downloads` | Save the user's selected media to their computer through the browser's download manager (target folder, conflict handling, cancel). |
| `storage` | Persist the user's settings, download history/statistics and licence status locally in the browser. |
| `activeTab` / `tabs` | Locate the user's open WhatsApp Web tab so the popup can request media from it. |
| `scripting` | Inject, on demand and only into the WhatsApp Web tab, the helper that reads a chat's media so a whole history can be exported without manual scrolling. |
| `notifications` | Show optional desktop notifications when downloads complete, fail, are skipped as duplicates, or a batch finishes. |
| Host `https://web.whatsapp.com/*` | The only site the extension reads media from; it runs nowhere else. |
| Host `https://api.gumroad.com/*` | Verify a Pro licence key with the payment provider when the user activates Pro (sends only the licence key). |

> **v1 note:** the DOM-only build does **not** request `scripting` and has no
> `web_accessible_resources`, so the dashboard won't ask you to justify them.
> Those rows apply only to the v2 upload.

---

## Data-use / privacy disclosures (Chrome dashboard "Privacy practices" tab)

Answer the certification form as follows:

- **What user data do you collect?** None of the listed categories. MediaVault
  processes media locally and does not collect, transmit or store personal or
  user data on any server.
- **Are you selling or transferring user data to third parties?** No.
- **Are you using data for purposes unrelated to the item's single purpose?** No.
- **Are you using data to determine creditworthiness / for lending?** No.
- **Remote code:** No. All code is bundled in the package; nothing is fetched
  and executed at runtime. (The Gumroad request is a data API call, not code.)
- **Privacy policy URL:** host `PRIVACY.md` (e.g. on GitHub Pages) and paste the
  public URL here. See `LAUNCH.md`.

---

## Assets checklist

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `assets/icons/icon128.png` (packaged) |
| Screenshots (1–5) | 1280×800 | `store/screenshots/screenshot_1..5.png` |
| Small promo tile | 440×280 | `store/promo/promo_tile_440x280.png` |
| Marquee promo tile | 1400×560 | `store/promo/marquee_1400x560.png` |

Screenshot captions (optional, add in the dashboard):
1. Save an entire WhatsApp chat in one click
2. Bulk-download with smart date & sender filters
3. Every media type, neatly detected
4. Private by design — nothing leaves your device
5. Start free, go unlimited when you're ready

---

## SEO keywords (for your own reference — Chrome has no keywords field)

whatsapp media downloader, download whatsapp images, save whatsapp videos,
whatsapp web downloader, export whatsapp chat, backup whatsapp media, bulk
download whatsapp, save whatsapp voice notes, whatsapp status downloader,
whatsapp chat to text, save whatsapp documents, whatsapp media saver
