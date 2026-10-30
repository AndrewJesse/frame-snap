# FrameSnap

FrameSnap is a local-first Chrome extension (Manifest V3) that captures the current video frame at native resolution, records its timestamp, and keeps a small gallery of snapshots on this device. It does not call external APIs, load remote scripts, or upload images.

The capture picks the video that is playing, or the largest visible `<video>` if none is playing. The frame is encoded as JPEG (quality 0.92) so history can fit in `chrome.storage.local`. From the popup you can seek that timestamp, download the image, copy it, or delete it.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder (the one that contains `manifest.json`).
4. Open a page with an HTML5 video, start playback, and click the FrameSnap toolbar icon.
5. Choose **Capture Current Frame**.

No build step. The manifest points at the JavaScript files directly.

## Permissions

- `activeTab` — message the tab you opened the popup from.
- `storage` — keep snapshot history in `chrome.storage.local` under the key `framesnapHistory` (capped at 30).
- `scripting` — inject the content script again if the tab was already open when the extension was installed.

Downloads use a user-gesture link (`<a download>`) and copy uses `navigator.clipboard.write` from the popup, so the manifest does not request `downloads` or clipboard permissions.

## Limits

**CORS.** If a video is served from another origin and the response does not allow canvas access, the browser taints the canvas and blocks reading pixels. FrameSnap reports that error. Same-document media, including the blob URLs many players create with Media Source Extensions, can still be captured. This is a browser security boundary.

**Iframes.** The content script runs in the top document. A player that lives in a cross-origin iframe is not visible there; open the video on its own page.

**Protected pages.** `chrome://`, `edge://`, extension pages, and the Chrome Web Store cannot be captured.

**Storage.** History is on this device only. The default local quota is about 10 MB. If a new frame does not fit, FrameSnap drops the oldest snapshots or shows an error when even one frame is too large.
