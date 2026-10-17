# Webtoon Translator (Gemini)

A Chrome extension that translates Korean webtoon speech bubbles to English while you scroll on Kakao. It reads the page, sends batches of panels to Google's Gemini API, and draws the English text over the original bubbles. You can fix any bubble by hand.

Works on `webtoon.kakao.com` and `page.kakao.com`.

## Install (about 2 minutes)

1. Click the green **Code** button on this page, then **Download ZIP**, and unzip it somewhere permanent (Chrome loads the extension from that folder, so do not delete it afterward).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder, the one that contains `manifest.json`.
5. The settings page opens by itself after install. Follow its three step checklist: paste your Gemini API key, press **Save**, then press **Test my key**. A green message means you are ready. (To open the page later, click the extension's toolbar icon.)

To update later, download the new ZIP, replace the files, and press the reload arrow on the extension card.

## Get a Gemini API key

Create a key at [Google AI Studio](https://aistudio.google.com/apikey). The key is stored only in your browser's extension storage and is sent only to Google's Gemini API. Check Google's current pricing and free tier limits, since you pay for your own usage.

## Using it

1. Open a chapter on Kakao. Use the blue **EN** button (bottom right) or press Alt+T to switch translation on.
2. Scroll normally. Panels you pass in a short window (10 seconds by default) are stitched into one tall image and sent as a single request, which keeps you under rate limits.
3. Translated panels are cached by image content, so scrolling back up or reloading never pays for the same panel twice.

### Fixing a bubble

Click any translated bubble to open the editor.

* Retype the text. The bubble updates live.
* **A-**, **A+** and **Auto** change the font size.
* Drag the bubble to move it. Drag the blue dot at its corner to resize it. The arrow buttons nudge it a little at a time.
* **Make female** and **Make male** swap he/she/his/her wording in one click.
* **Remember this wording** saves your version, and it is used automatically whenever the same Korean line shows up again.
* **Save** keeps your changes. **Close** or Esc throws them away.

### The gear panel

The gear button above EN has four tabs.

* **Status:** turn translation on or off, set the wait time, see stats, clear the cache.
* **Notes:** series notes sent to Gemini with every batch, for example "Han Seo-jin is a woman, use she/her". This is the strongest fix for wrong pronouns, because Korean often leaves gender out.
* **Fixes:** the list of remembered wordings. Delete any you no longer want.
* **Images:** the last few stitched images that were sent to Gemini, with the text boxes it found outlined in red. This is off by default. Turn on **Keep debug images** in the settings page to use it.

### Settings page

* **Test my key** checks that Google accepts your key, without translating anything. Failures come back as plain sentences, such as "You hit Google's rate limit".
* **Export settings** and **Import settings** back up your model, language, wait time, series notes and saved fixes to a file. The file never contains your API key.

## Notes and limits

* Notes and new prompt behavior only apply to panels translated from now on. Use **Clear translation cache** on the Status tab to redo panels you already have.
* AI translation makes mistakes, especially with names, slang and gender. The editor exists for that reason.
* The default model is `gemini-3.8-flash`. Google retires models over time. If you see a "model not found" error, enter a current Gemini Flash model name in the extension options.
* Panel images are sent to Google's Gemini API for translation. Do not use this on content you are not comfortable sending to Google.

## Privacy and security

* **Your Gemini key stays on your computer.** It is stored in the extension's own private storage, which web pages and the script the extension runs on Kakao pages cannot open. It is sent only to `generativelanguage.googleapis.com`, in a request header, with each translation request. The developer never receives it.
* **No server, no analytics.** The only network requests the extension makes go to Google's Gemini API and to Kakao's image hosts.
* **What Google receives:** the stitched panel images, your series notes and your last 40 saved fixes. According to a [third party comparison](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/), Google may use prompts from its free tier to improve its products outside the EU, UK and EEA, so check Google's current terms before sending content you want kept private.
* **What stays local:** translations, your edits and notes. If you turn on **Keep debug images**, the last 5 image batches are kept too. **Clear translation cache** in the extension options removes the cache and those images. The full policy is in [PRIVACY.md](PRIVACY.md).
* **Protect your key.** In Google AI Studio, restrict the key to the Generative Language API and set a spending alert. You can remove the saved key at any time from the extension options.
* **Checked in a real browser.** The `security-tests` folder runs the extension against a simulated site and verifies where a fake key goes. See [SECURITY.md](SECURITY.md) for details and how to report a problem.

## Disclaimer

This project is not affiliated with or endorsed by Kakao or Google. It is meant for reading content you have legitimate access to. It does not unlock, download or bypass anything. You are responsible for following the terms of the sites you use it on.

## License

MIT, see [LICENSE](LICENSE).
