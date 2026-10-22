# Research notes: what similar tools do

These notes come from public store listings, product pages and open source READMEs. Nothing here is copied from another tool's code. Claims about commercial tools come from their own marketing and are unverified.

## Madomi (Pawaka Labs)

- Chrome and Firefox extension, plus Android and iOS apps, with one shared account.
- Translates on the page as you scroll. Draw a box over any panel to translate only that area, on any site.
- Korean, Japanese and Chinese sources. Free tier is credit based (one credit per image), with a paid unlimited tier.
- Caches translated pages so rereading is free.
- Per series glossary of character names and genders, with import from AniList.
- Reader features on mobile: reading modes, downloads, tracker sync. These are outside this extension's scope.
- It does not publish which model does the OCR or the translation.

## Open source pipelines (manga-image-translator, BallonsTranslator, comic-translate)

- Stages: text detection, OCR, translation, text removal (inpainting), typesetting.
- Detection: a trained detector finds bubbles and free text. One public model (Apache 2.0, about 43M parameters) has three classes: bubble, text inside a bubble, text outside a bubble.
- OCR: Korean has dedicated models (Pororo, PaddleOCR, a 48px model). They are small and fast compared with a vision language model.
- Translation: sending the whole page's text to a language model, with neighbouring lines as context, beats translating each bubble alone.
- Replacement dictionaries before and after translation, regular expression filters for text to skip, and per series glossaries.
- Manual fallback: select an area, redo OCR and translation for it, edit text, search and replace, undo.
- Webtoon support through very tall images.

## Already in this extension

Local reader and translator, translation memory, story summaries, glossary with review, caching, drag to redo an area, chapter strip, per panel time estimates, merged bubble lines, context check, second read, editor with looks, undo and find and replace.

## Added in 1.2.0 from this research

- Skip lines that match patterns (laughter, sound effects).
- Fix the Korean before translating, and the English after, with pattern rules.
- The last lines translated for a story are given to the translator so the next panel continues the conversation.
- Bubble font and global text size.
- Import character names and genders from AniList into the glossary, for review.
- Shortcuts: Alt+R redo an area, Alt+B build or leave the strip, hold Alt+O to see the original.

## Roadmap

1. Detector first pipeline: done in 1.3.0. A bubble and text detector runs in the browser through ONNX Runtime Web, and each detected bubble is read on its own. Possible follow ups: the larger detector files for higher accuracy, and WebGPU for speed.
2. Dedicated Korean OCR instead of the vision model for reading, with the vision model only for hard cases.
3. Text removal so the original lettering does not show behind a bubble. Bubbles are opaque boxes today, which hides it but covers art.
4. Export a translated chapter as images or a PDF.
5. Save a sample (panel, reader output, final text) as local files for checking quality.
6. Reading statistics and a chapter list.

## Sources

- https://chromewebstore.google.com/detail/madomi-manga-translator/jdlbndkeipfnbognkgbkggcemacaoami
- https://pawakalabs.com/products/madomi/
- https://github.com/zyddnys/manga-image-translator
- https://github.com/shuoshuo1234/BallonsTranslator/blob/master/README_EN.md
- https://huggingface.co/ogkalu/comic-text-and-bubble-detector
