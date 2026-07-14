# MediaVault — Privacy Policy

_Last updated: 2026-07-14_

MediaVault ("the extension", "we") is a browser extension that helps you
download and back up your own media and chat transcripts from WhatsApp Web to
your local device. Privacy is the core of the product. This policy explains
exactly what the extension does and does not do with your data.

## The short version

- **We do not collect, sell, or share your personal data.**
- **Your messages and media never leave your device.**
- **There are no analytics, no tracking, and no advertising.**
- The **only** network request the extension makes is a licence check when you
  choose to activate MediaVault Pro — and it sends nothing but your licence key.

## What the extension accesses

MediaVault runs only on `https://web.whatsapp.com`. To do its job it reads, in
your browser and only while you use it:

- the media (images, videos, audio, voice notes, documents, GIFs, stickers)
  that WhatsApp Web has already loaded in your open chats;
- basic message metadata used for naming and filtering (sender name, timestamp,
  message id, caption);
- the chat/group names shown in your chat list.

All of this is processed **locally, in memory, in your browser**. It is used
solely to build the files you asked to download and is never transmitted to us
or any third party.

## What we store, and where

Everything is stored locally on your device:

- **Settings** and **licence status** — in the browser's extension storage
  (`chrome.storage.sync`), which may sync across your own signed-in browsers via
  Google's account sync. This contains preferences and, if you buy Pro, your
  licence key and plan — never message content.
- **Download history and statistics** — in your browser's local IndexedDB and
  `chrome.storage.local`, used for duplicate detection, search and counters.

You can clear all of this at any time from the extension's Settings page, or by
removing the extension.

## The one network request: licence verification

If you purchase MediaVault Pro and click **Activate**, the extension sends your
**licence key** to the payment provider's public verification endpoint
(by default, Gumroad: `https://api.gumroad.com/v2/licenses/verify`) to confirm
the purchase is valid. This request contains only the licence key and the
product identifier. No message content, media, browsing data, or personal
information is included. The provider's handling of that request is governed by
their own privacy policy.

If you never activate Pro, the extension makes no network requests at all.

## Payments

Payments are handled entirely by the third-party payment provider (e.g. Gumroad
and its payment processor). MediaVault never sees or stores your card details.

## Permissions

Each browser permission maps to a feature and nothing more: `downloads` (to save
files), `storage` (settings/history/licence), `activeTab`/`tabs` and `scripting`
(to read media from your open WhatsApp Web tab), and `notifications` (optional
download alerts). Host access is limited to `web.whatsapp.com` (the only site it
reads from) and `api.gumroad.com` (licence checks only).

## Children

MediaVault is a general-purpose utility and is not directed at children under 13.

## Not affiliated with WhatsApp

MediaVault is an independent tool and is not affiliated with, endorsed by, or
sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of
its respective owner.

## Changes

If this policy changes, the "Last updated" date above will change and the new
version will be published at the same URL.

## Contact

Questions about privacy? Contact us at the support email listed on the Chrome
Web Store page for MediaVault.
