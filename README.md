# WA Media Downloader Pro

A professional, privacy-first Chrome extension for downloading media from
[WhatsApp Web](https://web.whatsapp.com) — images, videos, voice notes, audio,
documents, GIFs, stickers, status media and profile pictures (where technically
possible).

**100% local. No analytics. No tracking. No external servers.**

---

## Table of contents

- [Installation](#installation)
- [Permissions](#permissions)
- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [How it works](#how-it-works)
- [Features](#features)
- [Development](#development)
- [Build](#build)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Maintenance after WhatsApp updates](#maintenance-after-whatsapp-updates)
- [Privacy](#privacy)
- [License](#license)

---

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle, top right).
4. Click **Load unpacked** and select the repository folder (the one
   containing `manifest.json`).
5. Open [https://web.whatsapp.com](https://web.whatsapp.com) and log in.
6. Pin the extension icon for quick access to the popup.

Requires Chrome 116 or newer (Manifest V3 with promise-based APIs).

## Permissions

The extension follows least privilege — every permission maps to a feature:

| Permission | Why it is needed |
|---|---|
| `downloads` | Save media through the browser download manager (folders, conflict handling, cancel). |
| `storage` | Persist settings (`sync`) and statistics (`local`). |
| `activeTab` / `tabs` | Find the WhatsApp Web tab so the popup can talk to it. |
| `scripting` | Reserved for programmatic (re)injection of the content script after extension updates. |
| `notifications` | Desktop notifications for completed/failed/duplicate downloads and queue completion. |
| Host: `https://web.whatsapp.com/*` | The only site the content script runs on. |

No other host is ever contacted.

## Architecture

```
┌─────────────────────────────  web.whatsapp.com tab  ─────────────────────────────┐
│                                                                                  │
│  inject.js (page context)      content.js (isolated world)                       │
│  blob-fetch fallback bridge ◄──► orchestrator: MutationObserver, viewer FAB,     │
│        CustomEvents             toasts, bulk downloads                           │
│                                    │ uses                                        │
│                                    ▼                                             │
│                utils/selectors.js  – ALL WhatsApp DOM selectors (config)         │
│                utils/dom.js        – DOM reading (chat, messages, media)         │
│                utils/download.js   – blob fetch, hashing, naming rules           │
│                utils/helpers.js    – pure utilities                              │
│                utils/storage.js    – settings / stats / IndexedDB history        │
└───────────────────────────────────┬──────────────────────────────────────────────┘
                                    │ chrome.runtime messaging (serializable payloads)
                                    ▼
                       background.js (MV3 service worker)
                       download queue · concurrency · retry · cancel
                       duplicate detection (IndexedDB) · statistics
                       chrome.downloads · chrome.notifications
                                    ▲
                                    │ messaging
                     popup/ (media browser, bulk UI, queue, search)
                     options/ (settings page)
```

Design rules:

- **DOM logic is separated from business logic.** `utils/dom.js` is the only
  module that reads WhatsApp's DOM; `utils/selectors.js` is the only place
  selectors are defined. Everything else works on plain data.
- **The service worker owns anything that must outlive the page** (queue,
  history, stats, notifications).
- All shared modules are classic scripts attached to a single
  `globalThis.WAMD` namespace so the same files run unchanged in the content
  script, service worker (`importScripts`), popup and options page.

## Folder structure

```
wa-media-downloader/
├── manifest.json          Manifest V3 definition
├── background.js          Service worker: queue, dedupe, stats, notifications
├── content.js             Content script orchestrator (observer, FAB, bulk)
├── inject.js              Tiny page-context bridge (blob fetch fallback only)
├── popup/
│   ├── popup.html         Popup markup
│   ├── popup.js           Popup controller
│   └── popup.css          Glassmorphism popup styles (dark-mode aware)
├── options/
│   ├── options.html       Settings page markup
│   ├── options.js         Settings controller (auto-save)
│   └── options.css        Settings styles
├── assets/
│   └── icons/             16/32/48/128 px generated icons
├── utils/
│   ├── selectors.js       ★ ALL WhatsApp Web selectors + fallbacks
│   ├── dom.js             DOM reading layer
│   ├── download.js        Download preparation business logic
│   ├── helpers.js         Pure utility functions
│   └── storage.js         Settings / stats / IndexedDB history
├── styles/
│   └── content.css        In-page FAB + toast styles
└── README.md
```

## How it works

1. **Detection.** WhatsApp Web decrypts media client-side and exposes it as
   `blob:` URLs on `<img>`, `<video>` and `<audio>` elements. A single
   debounced `MutationObserver` on `document.body` schedules re-scans; the
   scan classifies every media element (image / video / audio / voice /
   sticker / document) and reads sender, timestamp and message id from the
   bubble's public attributes (`data-id`, `data-pre-plain-text`).
2. **Single download.** Opening media in WhatsApp's full-screen viewer shows a
   floating **Download** button (bottom-right). Clicking it fetches the blob,
   hashes it (SHA-256), builds the filename from your naming rules and hands a
   serializable payload to the service worker.
3. **Queue.** The service worker runs a concurrency-limited queue over
   `chrome.downloads` with automatic retries (exponential backoff), cancel and
   per-item status, and pushes live snapshots to the popup.
4. **Duplicate detection.** Completed downloads are recorded in IndexedDB
   keyed by content hash; re-downloads are skipped (configurable).
5. **Bulk download.** The popup asks the content script to scan the open chat,
   filter by type/scope and enqueue everything as a batch — one summary
   notification when the batch settles.
6. **Documents** are not exposed as blobs in the message list, so bulk
   document download triggers WhatsApp's own download control on each bubble
   (WhatsApp's default filename applies on that path).
7. **Oversized media** (> ~44 MB, larger than the messaging limit once
   base64-encoded) is saved directly from the page via a temporary anchor —
   it lands in the default download folder but still counts in history/stats.

## Features

- Floating, animated, dark-mode-compatible download button in the media viewer
  (also works for status media and enlarged profile photos).
- Chat media browser in the popup: current chat name + per-type counts.
- Bulk download: images / videos / documents / audio / everything, scoped to
  everything loaded, last 50 or last 100.
- Two naming styles: `ChatName_YYYY-MM-DD_HH-MM-SS.ext` or
  `Sender_MessageID.ext`.
- Optional folder organization: `WhatsApp/<Chat>/<Images|Videos|…>/`.
- Duplicate detection via SHA-256 content hashes (IndexedDB history).
- Download queue with progress bar, retry, cancel and clear-finished.
- Full-text search over the download history.
- Statistics: totals per type, bytes downloaded, last download.
- Desktop notifications (per-file and batch summaries), all optional.
- Settings synced through `chrome.storage.sync`.

## Development

No build step, no framework, no dependencies — plain ES2023.

```bash
git clone <this repo>
# edit files, then reload the extension:
# chrome://extensions → WA Media Downloader Pro → ⟳ (Reload)
```

Conventions:

- Every function carries a doc comment.
- Shared modules attach to `globalThis.WAMD.<module>`; never duplicate logic
  across contexts — add it to a `utils/` module instead.
- New WhatsApp selectors go into `utils/selectors.js` **only**, as an ordered
  fallback list.

## Build

For a store-ready zip:

```bash
zip -r wa-media-downloader.zip . \
  -x '.git/*' -x 'README.md' -x '*.zip'
```

Upload the zip in the Chrome Web Store developer dashboard.

## Testing

Manual test checklist (there is deliberately no test framework dependency):

1. **Load & boot** — extension loads without errors in
   `chrome://extensions`; no console errors on web.whatsapp.com.
2. **Viewer button** — open an image full screen → FAB appears bottom-right;
   click → toast "Download queued ✓" → file lands in
   `Downloads/WhatsApp/<Chat>/Images/`.
3. **Video / voice note / sticker** — same flow per type (voice notes must be
   played once so WhatsApp loads the blob).
4. **Bulk** — popup → *Download everything* with a media-heavy chat open;
   verify batch summary notification and queue rendering.
5. **Duplicates** — download the same image twice → second attempt reports
   "Duplicate skipped".
6. **Retry/cancel** — disconnect the network mid-batch → items fail after 3
   attempts → retry works after reconnecting.
7. **Naming styles & folders** — flip settings and confirm resulting paths.
8. **Dark mode** — popup and options in both themes, plus "match system".
9. **Selector health** — in DevTools, rename a `data-testid` on the viewer
   node → extension degrades without throwing, popup shows the layout-change
   warning.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Popup says "WhatsApp still loading" | The tab was open before installing the extension — reload the WhatsApp Web tab. |
| Counts show items "not loaded" | WhatsApp only decrypts media you've viewed. Scroll the chat (and open videos/voice notes once) to load more. |
| Voice note won't download | Press play once so WhatsApp creates the audio blob, then retry. |
| Documents get WhatsApp's default filename | Expected — document bytes aren't exposed to the page, so bulk download clicks WhatsApp's own control. |
| Large video went to the default folder | Files over ~44 MB bypass the queue (messaging size limit) and are saved in-page. |
| Everything stopped working after a WhatsApp update | See [Maintenance](#maintenance-after-whatsapp-updates). |
| "Download interrupted" errors | Check disk space and Chrome's download settings; the queue retries 3× automatically. |

## Maintenance after WhatsApp updates

WhatsApp Web's DOM is not a public API. This project isolates that risk:

- **`utils/selectors.js` is the only file that knows WhatsApp's markup.**
  Every role (chat title, message bubble, media viewer, …) is an ordered list
  of candidate selectors — add a new first candidate when WhatsApp changes,
  keep the old ones as fallbacks.
- Likely to need updating after a redesign: `chatTitle`, `mediaViewer`,
  `documentBubble`, `voiceNoteBubble`, `statusViewer`, `profilePhotoLarge`.
- Relatively stable (public message attributes): `data-id`,
  `data-pre-plain-text`, `blob:` media sources.
- The extension **degrades gracefully**: unmatched selectors simply disable
  the corresponding feature, `selectors.healthReport()` feeds a warning banner
  in the popup, and no code path throws on a missing element.
- No undocumented WhatsApp internals (webpack modules, Store objects) are
  used anywhere — only the rendered DOM.

## Privacy

- All processing happens inside your browser.
- Media goes straight from the WhatsApp tab to your disk.
- Settings live in Chrome's storage; history/statistics in local IndexedDB.
- No analytics, no telemetry, no external requests, no remote code.

This tool is for downloading **your own** conversations' media. Respect other
people's privacy and WhatsApp's Terms of Service.

## License

MIT — see below.

```
MIT License

Copyright (c) 2026 WA Media Downloader Pro contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
