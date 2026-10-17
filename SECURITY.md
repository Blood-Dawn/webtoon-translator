# Security

## What this extension does with your data

* **Your Gemini API key** is stored on your computer in the extension's own private IndexedDB database. Web pages, and the script the extension runs on Kakao pages, cannot open it. Only the extension's background worker and options page can.
* The key is sent to exactly one place, `generativelanguage.googleapis.com`, in the `x-goog-api-key` request header. It is never put in a URL.
* The extension has no server, analytics or telemetry. Its only network requests go to Google's Gemini API and to Kakao image hosts (`kakaocdn.net`, `daumcdn.net`, `kakao.com`).
* Each request to Gemini contains the stitched panel images, your series notes and your last 40 saved fixes.
* Translations, edits, notes and the last 5 image batches (for the Images tab) stay in the browser's extension storage. The Clear translation cache button in the options page removes the cache and the saved images.

## Hardening in the code

* Only the extension's own pages and its content script on `page.kakao.com` and `webtoon.kakao.com` can message the background worker.
* Panel images are downloaded only from https Kakao hosts, without cookies, with a redirect check and a 20 MB cap. A web page cannot make the extension fetch other addresses.
* Image data is validated as base64 JPEG, PNG or WebP before it is sent anywhere.
* The extension panel lives in a closed shadow root, so page scripts cannot read your notes or fixes.
* Error messages are scrubbed of anything shaped like a Google API key.
* Host permissions are limited to the two reader sites, the Kakao image CDNs and the Gemini API.
* There is no `eval`, no remote code and no dependency on third party scripts.

## Known limits

* The key is stored unencrypted in the browser profile, like most extensions that hold a key. Software or people with access to your user account could read it. Restrict the key to the Generative Language API in Google AI Studio and set a spending alert.
* On Google's free tier, prompts can be used to improve Google's products in some regions. Do not send content you need kept private.
* The automated test in `security-tests/` is a focused check on a simulated site. It is not a professional penetration test.

## Reporting a problem

Please report vulnerabilities privately through this repository's Security tab (Report a vulnerability). Do not post working exploits or leaked keys in public issues. If a key was exposed, delete it in Google AI Studio first.

Only the latest release is supported.

## Testing it yourself

`security-tests/` runs the extension in Chromium against a local server that pretends to be Kakao and Google, using a fake key. It checks that the key appears only in the Gemini request header, that the Kakao-page script cannot read it, that a hostile page cannot read the panel or steer the extension's downloads, and that an old stored key is migrated. See `security-tests/README.md`.
