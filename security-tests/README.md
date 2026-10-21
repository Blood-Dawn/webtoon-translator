# Security tests

These tests run the extension in a real Chromium and check where your API key and data go.

## What it does

1. Starts a local HTTPS server that pretends to be `webtoon.kakao.com`, `generativelanguage.googleapis.com` and a hostile site (`evil.example`). It logs every request.
2. Launches Chromium with the extension loaded. Every host name resolves to the local server, and certificate errors are ignored, but only in this throwaway browser.
3. Enters a fake API key (`AIzaSyCANARY-SECRET-KEY-...`) through the options page and opens a fake chapter. The page contains a bait image on another host and a script that tries to read the extension's panel and the key.
4. Checks the results and exits with a failure if any check fails.

## Checks

* The key appears in one request only, to Google, in the `x-goog-api-key` header, never in a URL or body.
* A translation request still reaches the Gemini endpoint, so the protections do not break the feature.
* The extension's script on the Kakao page cannot read the key from storage.
* The extension does not fetch an address the page chose.
* A hostile page cannot read the extension panel or the key.
* A key stored by an older version is moved to private storage and removed from regular storage.
* Test my key succeeds and sends the key only to Google.
* Importing a hand-edited settings file cannot add unknown settings or change the API key.
* Copies of comic pages are not kept unless the reader turns on debug images.
* Only approved glossary entries for the current series reach Gemini, the instructions come before the image, and suggested terms wait for review.
* Local models (`local-test.js`, against a fake Ollama that refuses browser origins like the real one): model listing, the Gemini plus local translator mode, the fully local mode with no key and no Gemini request, and refusal of any address that is not this computer. The test copy of the extension has the localhost permission made required, because a script cannot click the browser's permission prompt.

## Running it

Linux with Node 18 or newer, `openssl` and `xvfb-run` (Chromium needs a display to load extensions).

```
cd security-tests
npm install
npx playwright install chromium
bash run.sh
```

To test a different copy of the extension, pass its folder: `bash run.sh /path/to/extension`.

Never put a real API key into this test. It uses a made-up key on purpose.

## Editor test

`editor-test.js` drives the on-page editor in a real browser: dragging a bubble past its panel edge, bubble looks, undo and redo, next and previous, Ctrl+Enter, and find and replace. It runs against a copy of the extension whose interface root is made inspectable, since a test cannot look inside a closed shadow root. `run.sh` runs all three suites.
