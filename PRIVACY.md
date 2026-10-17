# Privacy policy

Last updated: October 17, 2026

Webtoon Translator (Gemini) is a browser extension that translates Korean webtoon pages while you read them. This policy explains what it does with your data.

## What the extension collects

Nothing is sent to the developer. There is no developer server, no account, no analytics and no tracking.

## What stays on your computer

* Your Gemini API key, in the extension's private storage.
* Your settings, series notes and saved fixes.
* A cache of finished translations, so a panel is never paid for twice.
* Optionally, copies of the last 5 stitched images sent for translation. This is off by default and can be turned on in the settings for troubleshooting.

You can remove the key, clear the cache and delete the debug images from the extension's settings page. Uninstalling the extension removes everything it stored.

## What is sent to other parties

When translation is on, the extension sends the following to Google's Gemini API (`generativelanguage.googleapis.com`) using your own API key:

* The stitched images of the webtoon panels you are reading.
* Your series notes and up to 40 of your saved fixes, as part of the instructions.
* Your API key, in a request header, so Google can authorize the request.

Google handles that data under its own terms and your own Google account or project settings. Google's terms for the free and paid tiers differ, so check them before using the extension on anything you want to keep private.

The extension also downloads panel images from Kakao's image hosts (`kakaocdn.net`, `daumcdn.net`, `kakao.com`), the same images your browser already loads. It sends no personal data to those hosts.

The "Test my key" button sends your key to Google to check that it is valid. It generates no translation.

## What the extension does not do

* It does not send your key, settings, notes or translations to the developer or to any third party other than Google as described above.
* It does not read pages other than `page.kakao.com` and `webtoon.kakao.com`.
* It does not load remote code.

## Contact

Questions or concerns: open an issue at https://github.com/Blood-Dawn/webtoon-translator/issues. To report a security problem privately, use the Security tab of the repository.

## Changes

If this policy changes, the date above changes and the change appears in the repository history.
