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
* Drag the bubble to move it anywhere, even past its own panel. Drag the blue dot at its corner to resize it, and the text refills the box with the largest font that fits. The arrow buttons nudge it a little at a time.
* **Look** picks a style: speech, thought, shout, narration or sound effect. Then change the fill color (or tick **none** for no fill), the text color, and add an outline in any color. Sound effects without a bubble use no fill and an outline.
* **Undo** and **Redo** step back and forward through every change to the bubble you are editing, including typing, moves, size and look. Ctrl+Z and Ctrl+Y do the same.
* **Prev** and **Next** (or Alt+Left and Alt+Right) move to the neighbouring bubble in reading order. Ctrl+Enter saves this bubble and goes on to the next, so you can proofread a whole chapter from the keyboard.
* **Make female** and **Make male** swap he/she/his/her wording in one click.
* **Remember this wording** saves your version, and it is used automatically whenever the same Korean line shows up again.
* **Save** keeps your changes. **Close** or Esc throws them away.

### The gear panel

The gear button above EN has six tabs.

* **Status:** turn translation on or off, set the wait time, see stats, clear the cache.
* **Notes:** series notes sent with every batch, for example "Han Seo-jin is a woman, use she/her". This is the strongest fix for wrong pronouns, because Korean often leaves gender out. Under it is an optional **Story so far** box for a few sentences of plot. **Update from this chapter** drafts one from the English lines on the page, using your local model if you have one and Gemini otherwise. Read it before you rely on it.
* **Glossary:** names and terms the extension learns as you read. Gemini suggests them and they wait in a review list. Approve, edit or delete each one. Only approved entries are sent back with later batches, so a wrong guess never sticks on its own. Characters can have a gender, which fixes wrong pronouns. You can also add entries yourself, for one series or for all of them. The Status tab shows how many edits you made in recent chapters, which should go down as the glossary grows.
* **Fixes:** the list of remembered wordings. Delete any you no longer want.
* **Find:** search the English of the chapter and replace it everywhere at once, with options for match case and whole word. Click a result to jump to that bubble. Replacements are saved with the chapter.
* **Images:** the last few stitched images that were sent to Gemini, with the text boxes it found outlined in red. This is off by default. Turn on **Keep debug images** in the settings page to use it.

### Settings page

* **Test my key** checks that Google accepts your key, without translating anything. Failures come back as plain sentences, such as "You hit Google's rate limit".
* **Export settings** and **Import settings** back up your model, language, wait time, series notes and saved fixes to a file. The file never contains your API key.

## Local models with Ollama (optional)

You can run a model on your own computer with [Ollama](https://ollama.com). Install it, then download a model, for example `ollama pull translategemma:12b` (8.1 GB, fits in 16 GB of video memory). Open the extension's settings page and use the **Local models** section.

There are two ways to use it.

* **Gemini reads, your computer translates (recommended).** Gemini still finds the bubbles and reads the Korean, and the local model writes the English line by line. This works well because finding bubbles in tall panels is the hard part. Gemini still sees the panels in this mode.
* **Everything local (experimental).** A vision model on your computer finds the bubbles and translates them. No API key is needed and nothing leaves your computer, but small models are much weaker at locating bubbles, so expect misses. Panels are sent one at a time in this mode.

Steps: press **Find my models** to list what Ollama has (it marks the ones that can read images), pick a model, then press **Test local translation** to see a sample line and how long it took. The browser asks once for permission to reach `localhost`. Only your own computer is allowed, and any other address is refused.

**Translation memory.** The extension remembers every Korean line it translates, on your computer only. When a local translation model works on a new line, it is shown up to three similar earlier lines from the same series (your own corrections first) so names and phrasing stay the same, along with the story summary. A line you corrected before is used exactly as you wrote it. Turn this off or clear it on the settings page.

**Other translation models.** The "Who writes the English" list also has Chrome's built-in translator (Chrome 138 or newer, Korean to English, a small language pack downloads the first time). Models whose names contain `hunyuan` or `hy-mt` are given the prompt style they were trained on. Everything else gets the TranslateGemma style, which general chat models follow well.

**Quality test.** On the settings page, **Run quality test** sends 50 typical webtoon lines to your local translation model and scores the wording against a human translation, with the time per line. Run it once per model to compare them on your own hardware. The score is a character overlap measure against a single reference, so it ranks models against each other and is not an absolute grade.

If a local step fails, the page keeps the reader's own translation and shows a short message, so a local problem never blanks a panel. If Ollama says it refused the request, set the `OLLAMA_ORIGINS` environment variable to `chrome-extension://*` and restart Ollama.

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
