# Chrome Web Store submission notes

Text and answers to paste into the Chrome Web Store developer dashboard. Nothing here ships inside the extension.

## Listing

**Name:** Webtoon Translator (Gemini)

**Summary (132 characters max):** Translates Korean webtoon speech bubbles on Kakao as you scroll, using your own Gemini API key.

**Description:**

Read Korean webtoons on Kakao in English. Turn translation on and scroll. The extension reads the panels you pass, sends them in small batches to Google's Gemini API, and draws the English text over the original bubbles.

* Bring your own free Gemini API key. Nothing goes through the developer's servers.
* Click any bubble to fix the wording, resize it, move it or swap the gender of the pronouns.
* Save a corrected line once and it is reused whenever the same Korean line appears again.
* Add series notes, such as "Han Seo-jin is a woman", so names and pronouns stay right.
* Translated panels are cached, so scrolling back never pays twice.
* Bubble looks (speech, thought, shout, narration, sound effect), colors and outlines, undo and redo, and keyboard shortcuts for proofreading a whole chapter.
* Find and replace across a chapter, and a translation memory that keeps names and phrasing consistent.
* Optional local models through Ollama or Chrome's built-in translator, so a translation can stay on your computer.
* Back up your settings and fixes to a file.

Requires your own Gemini API key from Google AI Studio. AI translation can make mistakes, and the editor is there to fix them. Not affiliated with Kakao or Google.

**Category:** Productivity (or Entertainment).

**Language:** English.

## Single purpose

Translate the Korean text in webtoon panels on Kakao into English and display it over the original speech bubbles.

## Permission justifications

* `storage`: saves the reader's settings, series notes, saved fixes and the translation cache on their computer.
* `unlimitedStorage`: the translation cache can grow past the default storage quota during long reading sessions.
* `declarativeNetRequest`: adds a Kakao referer header to the extension's own image requests, because Kakao's image servers refuse downloads without one. The rule applies only to requests made by this extension and only to Kakao image hosts.
* Host `https://page.kakao.com/*` and `https://webtoon.kakao.com/*`: the sites where the extension reads panels and shows translations.
* Host `https://*.kakaocdn.net/*` and `https://*.daumcdn.net/*`: Kakao's image hosts, used as a fallback to download a panel that the page could not hand over directly.
* Host `https://generativelanguage.googleapis.com/*`: Google's Gemini API, where translation requests are sent.
* Host `https://graphql.anilist.co/*`: AniList's public API, used only when the reader presses Import in the Glossary tab. Only the series title they typed is sent.
* `offscreen`: runs the bundled text detector (a small model and the ONNX runtime, both shipped inside the package) in a hidden extension page. It runs on the reader's computer, downloads nothing and sends nothing.
* Optional hosts `http://localhost/*` and `http://127.0.0.1/*`: requested only when the reader turns on a local Ollama model, so the extension can talk to that server on the reader's own computer. Never requested otherwise.

## Remote code

The extension does not load or run remote code. All scripts, the ONNX runtime (WebAssembly) and the detector model ship inside the package. The extension page policy allows `wasm-unsafe-eval` only so the bundled runtime can run.

## Data usage disclosures

Tick these in the Privacy practices tab:

* Website content: yes (the comic panel images are sent to Google for translation, at the reader's request).
* Authentication information: yes (the reader's own API key is stored locally and sent to Google to authorize requests).
* Everything else (personal communications, location, health, financial, web history, user activity): no.

Certify that the data is not sold, not used for unrelated purposes and not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/Blood-Dawn/webtoon-translator/blob/main/PRIVACY.md

## Screenshots to prepare (1280x800 or 640x400)

1. A Kakao chapter with translated bubbles.
2. The bubble editor open on one bubble.
3. The gear panel on the Notes tab.
4. The settings page with the first run checklist.

## Before submitting

* The developer account registration is a one time fee paid to Google.
* Zip the extension files only (manifest.json at the top level), without `security-tests`, `.git` and the markdown files if you want a smaller package.
* Review can take days. Updates after approval are reviewed again.
