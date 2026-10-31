# Upload FrameSnap to the Chrome Web Store

FrameSnap is a local-only Manifest V3 extension from [Free-Utils](https://free-utils.com). This folder is the store submission kit. It is not part of the extension package.

## Package

Upload this zip in the [developer dashboard](https://chrome.google.com/webstore/devconsole):

`chrome-web-store/framesnap-1.0.0.zip`

The zip root is the unpacked extension. It contains only:

- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `popup.html`
- `popup.js`
- `popup.css`
- `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`, `icons/brand-logo.webp`

It does not contain this folder, the README, or any build tooling. Unzip it and the manifest is at the top level, so Chrome can load that folder unpacked as a check before you upload.

## Listing

| Field | Value |
| --- | --- |
Paste the title, summary, description, category, language, and URLs from `chrome-web-store/LISTING.md`. The summary is the manifest description, so “Summary from package” matches the zip.

## Icons

The mark is the Free-Utils capybara from [https://free-utils.com](https://free-utils.com), resized for the toolbar and the store. No other artwork is used.

| Use | File | Size |
| --- | --- | --- |
| Package / toolbar | `icons/icon16.png` | 16×16 |
| Package / popup | `icons/icon48.png` | 48×48 |
| Package | `icons/icon128.png` | 128×128 |
| Store icon | `chrome-web-store/icons/store-icon-128.png` | 128×128 |

Upload `chrome-web-store/icons/store-icon-128.png` as the store icon.

## Screenshots

These are screenshots of the real extension popup (empty state, and a capture from a local video), placed on the popup’s own dark background so they match the Chrome Web Store pixel sizes. They are not a separate mockup.

| File | Size | Use |
| --- | --- | --- |
| `chrome-web-store/screenshots/screenshot-1280x800.jpg` | 1280×800 | Primary screenshot. Real popup after a capture. |
| `chrome-web-store/screenshots/screenshot-empty-1280x800.jpg` | 1280×800 | Second screenshot. Real popup before the first capture. |
| `chrome-web-store/screenshots/small-promo-440x280.jpg` | 440×280 | Small promo tile. |
| `chrome-web-store/screenshots/marquee-1400x560.jpg` | 1400×560 | Marquee promo tile. |

These are JPEG files, so they have no alpha channel. The store icon is a 128×128 PNG with no alpha channel.

## Single purpose

FrameSnap’s only purpose is to capture one video frame from the tab the user is watching and let them keep, copy, or remove that snapshot on the device.

## Privacy

FrameSnap does not use remote code, analytics, accounts, or a server. Scripts, styles, and icons are files in the zip. The only outbound link is a user click to https://free-utils.com. The extension itself does not request that site.

Data the extension stores:

- JPEG data URLs, timestamps, page title, and page URL for up to 30 snapshots
- Stored only in `chrome.storage.local` under `framesnapHistory`
- Not sent off the device

Permissions, and why each one is there:

- `activeTab` — when the user opens the popup, read the active tab in the browser window so FrameSnap can message that page and refuse `chrome://`, `edge://`, extension pages, and the Chrome Web Store.
- `storage` — save and delete the local snapshot history.
- `scripting` — if the tab was already open when the extension was installed, inject `content.js` once so capture and seek can run. No other code is injected.

`content_scripts` matches `<all_urls>` so the extension can see an HTML5 `<video>` on a normal page. The script does nothing until the popup sends a capture or seek message. It does not read the page on a timer and it does not make network requests. Downloads use a user-gesture `<a download>`. Copy uses `navigator.clipboard.write` in the popup. Those actions do not need the `downloads` or clipboard permissions.

In the privacy form, say that the extension does not collect or sell user data and that it does not use remote code.

## Review notes (CORS)

Paste this if the reviewer asks why some videos fail:

> Canvas capture follows the browser’s same-origin rule. If a video is served from another origin and the response does not allow canvas access, the canvas is tainted and Chrome blocks reading the pixels. FrameSnap reports that error. It is a browser security boundary, not a bug. Video the page itself provides, including blob URLs created with Media Source Extensions, can still be captured. `chrome://` and other browser pages are refused before capture.

A fair manual check is a same-origin HTML5 video (the frame should save) and a cross-origin file without CORS headers (the popup should show the tainted-canvas message).
