importScripts("secret.js", "ollama.js", "memory.js");

const DEFAULTS = { model: "gemini-3.8-flash", lang: "English" };
const MAX_DEBUG_BATCHES = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Panel images are only ever downloaded from Kakao's own hosts, and only the Kakao reader pages may ask.
const IMAGE_HOSTS = ["kakaocdn.net", "daumcdn.net", "kakao.com"];
const READER_HOSTS = ["page.kakao.com", "webtoon.kakao.com"];

function allowedImageUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch (e) {
    return false;
  }
}

// Accepts messages only from this extension's own pages and from its content script on the Kakao reader.
function trustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (sender.url && sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/")) return true;
  if (!sender.tab || !sender.url) return false;
  try {
    const u = new URL(sender.url);
    return u.protocol === "https:" && READER_HOSTS.includes(u.hostname);
  } catch (e) {
    return false;
  }
}

// Makes sure an API key can never end up in an error message or toast.
function scrub(text) {
  return String(text).replace(/AIza[0-9A-Za-z_-]{16,}/g, "[key hidden]");
}

Secrets.migrate().catch((e) => console.warn("Could not move the API key to private storage:", e));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Some image CDNs refuse requests that lack a Kakao referer. This rule adds one
// to requests made by this extension only.
async function installRefererRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2],
      addRules: [
        {
          // Ollama refuses requests that carry a browser extension origin. Dropping that header from this
          // extension's own requests to this computer lets it connect without changing Ollama's settings.
          id: 2,
          priority: 1,
          action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ["localhost", "127.0.0.1"],
            resourceTypes: ["xmlhttprequest"]
          }
        },
        {
          id: 1,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "referer", operation: "set", value: "https://page.kakao.com/" }]
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ["kakaocdn.net", "kakao.com", "daumcdn.net"],
            resourceTypes: ["xmlhttprequest"]
          }
        }
      ]
    });
  } catch (e) {
    console.warn("Referer rule not installed:", e);
  }
}

// Reads Google's 429 reply to tell a per-minute limit (clears by itself) from a daily one (does not).
function quotaInfo(raw) {
  const out = { daily: false, noFreeQuota: false, retryMs: 0 };
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    return out;
  }
  const err = (j && j.error) || {};
  for (const d of err.details || []) {
    if (typeof d.retryDelay === "string") {
      const m = /([\d.]+)s/.exec(d.retryDelay);
      if (m) out.retryMs = Math.round(Number(m[1]) * 1000);
    }
    for (const v of d.violations || []) {
      if (/PerDay/i.test(String(v.quotaId || "") + " " + String(v.quotaMetric || ""))) out.daily = true;
    }
  }
  if (/limit:\s*0\b/.test(String(err.message || ""))) out.noFreeQuota = true;
  return out;
}

// Turns an API failure into a sentence a non-technical reader can act on.
function friendlyError(status, body) {
  if (status === 429) {
    const info = typeof body === "object" && body ? body : quotaInfo(body);
    if (info.noFreeQuota) return "Google says this model has no free quota for your key. Pick another model in the settings, or turn on billing for the key.";
    if (info.daily) return "Google says today's free quota for this model is used up. It resets at midnight Pacific time (3 AM Eastern). You can wait, pick another model in the settings, or turn on billing.";
    return "You hit Google's rate limit (requests per minute). The extension waits and tries again, or raise the batch wait time in the settings.";
  }
  const text = scrub(String(body || "")).toLowerCase();
  if (status === 400 && text.includes("api key")) return "Google did not accept this API key. Check that you copied all of it.";
  if (status === 401 || status === 403) return "Google refused this key. It may be wrong, restricted to another service, or switched off.";
  if (status === 404) return "That model name was not found. Pick a current Gemini Flash model in the settings.";
  if (status === 429) return "You hit Google's rate limit. Wait a minute, or raise the batch wait time in the settings.";
  if (status >= 500) return "Google's service is having trouble. Try again in a minute.";
  return "Google returned an error (" + status + "). " + scrub(String(body || "").slice(0, 120));
}

async function testKey(key, model) {
  const k = String(key || "").trim();
  if (!k) return { ok: false, error: "No key to test yet. Paste one and press Save." };
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model || DEFAULTS.model),
      { headers: { "x-goog-api-key": k } }
    );
    if (r.ok) return { ok: true };
    return { ok: false, error: friendlyError(r.status, await r.text()) };
  } catch (e) {
    return { ok: false, error: "Could not reach Google. Check your internet connection." };
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  installRefererRule();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(installRefererRule);
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !trustedSender(sender)) return false;
  if (msg.type === "translate") {
    translate(msg.url, msg.dataUrl, msg.panels, msg.series, msg.region === true)
      .then((r) => sendResponse({ ok: true, boxes: r.boxes, terms: r.terms, warning: r.warning }))
      .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
    return true;
  }
  if (msg.type === "fetchImage") {
    fetchImage(msg.url)
      .then((img) => sendResponse({ ok: true, dataUrl: "data:" + img.mime + ";base64," + img.data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "ollamaModels" || msg.type === "ollamaTest") {
    // Only the extension's own settings page may probe the local server.
    if (!sender.url || !sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/")) return false;
    if (msg.type === "ollamaModels") {
      Ollama.listModels(msg.url)
        .then((models) => sendResponse({ ok: true, models }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
    } else {
      const t0 = Date.now();
      Ollama.translateLines(msg.url, String(msg.model || ""), ["오늘도 늦었네. 또 야근이야?"], String(msg.lang || "English"), "", [""])
        .then((r) => sendResponse({ ok: true, text: r.lines[0], ms: Date.now() - t0 }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
    }
    return true;
  }
  if (msg.type === "summarize") {
    summarize(String(msg.previous || ""), Array.isArray(msg.lines) ? msg.lines.map(String) : [])
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((e) => sendResponse({ ok: false, error: scrub(e.message) }));
    return true;
  }
  if (msg.type === "memoryCount" || msg.type === "memoryClear" || msg.type === "ollamaBatch") {
    // Only the extension's own settings page may use these.
    if (!sender.url || !sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/")) return false;
    if (msg.type === "memoryCount") {
      TM.load().then((l) => sendResponse({ ok: true, count: l.length }));
    } else if (msg.type === "memoryClear") {
      TM.clear().then((n) => sendResponse({ ok: true, count: n }));
    } else {
      const t0 = Date.now();
      const lines = Array.isArray(msg.lines) ? msg.lines.slice(0, 20).map((l) => String(l).slice(0, 300)) : [];
      Ollama.translateLines(msg.url, String(msg.model || ""), lines, String(msg.lang || "English"), "", lines.map(() => ""))
        .then((r) => sendResponse({ ok: true, lines: r.lines, failed: r.failed, ms: Date.now() - t0 }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
    }
    return true;
  }
  if (msg.type === "testKey") {
    // Only the extension's own settings page may run this.
    if (!sender.url || !sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/")) return false;
    testKey(msg.key, msg.model).then(sendResponse);
    return true;
  }
  if (msg.type === "getBatches") {
    chrome.storage.local
      .get("dbgBatches")
      .then((r) => sendResponse({ ok: true, batches: r.dbgBatches || [] }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
  return false;
});

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function fetchImage(url) {
  if (!allowedImageUrl(url)) throw new Error("Blocked: panel images can only come from Kakao hosts.");
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error("Could not download the panel image (" + r.status + ")");
  if (!allowedImageUrl(r.url)) throw new Error("Blocked: the image redirected away from Kakao.");
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("The panel image is too large.");
  let mime = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!mime.startsWith("image/")) mime = "image/jpeg";
  return { mime, data: toBase64(buf) };
}

const MAX_GLOSSARY_IN_PROMPT = 60;
const TERM_TYPES = ["character", "term"];
const GENDERS = ["female", "male", ""];

// Only entries the reader approved are sent. Terms Gemini suggests wait in the review queue first,
// so text inside a comic can never steer later prompts on its own.
function pickGlossary(glossary, series) {
  const list = (Array.isArray(glossary) ? glossary : []).filter(
    (g) => g && g.status === "approved" && typeof g.ko === "string" && typeof g.en === "string" && (g.series === "" || g.series === series)
  );
  list.sort((a, b) => (b.n || 0) - (a.n || 0) || (b.t || 0) - (a.t || 0));
  const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
  return list.slice(0, MAX_GLOSSARY_IN_PROMPT).map((g) => Object.assign({}, g, { ko: oneLine(g.ko), en: oneLine(g.en) }));
}

// Keeps only well formed term suggestions from Gemini's reply.
function cleanTerms(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw.slice(0, 12)) {
    if (!t || typeof t.ko !== "string" || typeof t.en !== "string") continue;
    const ko = t.ko.trim().slice(0, 60);
    const en = t.en.trim().slice(0, 80);
    if (!ko || !en) continue;
    out.push({
      ko,
      en,
      type: TERM_TYPES.includes(t.type) ? t.type : "term",
      gender: GENDERS.includes(t.gender) ? t.gender : ""
    });
  }
  return out;
}

function buildPrompt(lang, notes, corrections, glossary, summary) {
  const lines = [
    "This image is several consecutive sections of a Korean webtoon stacked vertically, separated by thin dark gray bands. Ignore the gray bands. Treat the whole image as one coordinate space.",
    "Find every piece of text a reader is meant to read: speech bubbles, thought bubbles, narration boxes, and clearly legible on-screen text or sound effects.",
    "For each one return:",
    "- box_2d: [ymin, xmin, ymax, xmax] normalized to 0-1000, tightly covering the text inside its bubble or box.",
    "- original: the Korean text.",
    "- translation: a natural " + lang + " translation that keeps the speaker's tone and fits a small bubble. Keep it concise.",
    "- bg: the hex color of the bubble background behind the text (usually #ffffff).",
    "- fg: a hex text color that is readable on that background.",
    "Skip watermarks, site logos, and credits. If the image has no text, return an empty array.",
    "Gender and pronouns: Korean often leaves out the subject and has no gendered pronouns, so decide each character's gender from what is drawn (who is speaking, who is shown, who the narration is about). Never default to male. If the image does not make the gender clear, avoid he, she, him and her by using the character's name, a title, or by rephrasing.",
    "Use the same names, terms and speaking style for the same character everywhere in the image.",
    "Also return a terms array: up to 8 character names, titles and recurring terms you translated in this image. Each has ko, en, type (\"character\" or \"term\") and, for characters, gender (\"female\", \"male\" or \"\" when the image does not make it clear). Leave out anything already listed in the glossary below."
  ];
  // Everything above is identical on every request, so Google can reuse it from its cache.
  // The parts below change per series and go last.
  if (notes) lines.push("Notes from the reader about this series. Follow them exactly:\n" + String(notes).slice(0, 4000));
  if (summary) lines.push("The story so far, for tone and meaning only:\n" + String(summary).slice(0, 1500));
  const chars = glossary.filter((g) => g.type === "character");
  const terms = glossary.filter((g) => g.type !== "character");
  if (chars.length) {
    lines.push(
      "Characters. Always use these English names, and use the pronouns that match the stated gender:\n" +
        chars.map((g) => g.ko + " = " + g.en + (g.gender ? " (" + g.gender + ")" : "")).join("\n")
    );
  }
  if (terms.length) {
    lines.push("Glossary. Always translate these terms this way:\n" + terms.map((g) => g.ko + " = " + g.en).join("\n"));
  }
  const pairs = Object.entries(corrections || {}).slice(-40);
  if (pairs.length) {
    lines.push(
      "The reader corrected these lines before. If the same Korean line appears again, use their wording:\n" +
        pairs.map(([ko, en]) => ko + " => " + en).join("\n")
    );
  }
  return lines.join("\n");
}

async function callGemini(key, model, mime, data, prompt) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  const body = {
    // Instructions first, image last: the fixed instruction text then forms a stable prefix.
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          bubbles: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
                original: { type: "STRING" },
                translation: { type: "STRING" },
                bg: { type: "STRING" },
                fg: { type: "STRING" }
              },
              required: ["box_2d", "original", "translation"]
            }
          },
          terms: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                ko: { type: "STRING" },
                en: { type: "STRING" },
                type: { type: "STRING" },
                gender: { type: "STRING" }
              },
              required: ["ko", "en"]
            }
          }
        },
        required: ["bubbles"]
      }
    }
  };

  let lastInfo = { daily: false, noFreeQuota: false, retryMs: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body)
    });
    if (r.status === 429 || r.status === 503) {
      const info = r.status === 429 ? quotaInfo(await r.text().catch(() => "")) : { retryMs: 0 };
      lastInfo = info;
      // A daily or zero quota will not clear in seconds, so say so right away instead of retrying.
      if (info.daily || info.noFreeQuota) {
        const err = new Error(friendlyError(429, info));
        err.code = "DAILY_QUOTA";
        throw err;
      }
      // Wait as long as Google asks (up to a minute), otherwise back off a little more each time.
      await sleep(Math.min(60000, info.retryMs ? info.retryMs + 500 : 3000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error(friendlyError(r.status, t));
    }
    const j = await r.json();
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("");
    const parsed = JSON.parse(text);
    // Older replies were a bare list of bubbles; newer ones are { bubbles, terms }.
    const bubbles = Array.isArray(parsed) ? parsed : parsed && parsed.bubbles;
    if (!Array.isArray(bubbles)) throw new Error("Unexpected reply format from Gemini");
    return { bubbles, terms: cleanTerms(parsed && parsed.terms) };
  }
  throw new Error(friendlyError(429, lastInfo));
}

// Keeps the last few images that were sent, so the GUI can show exactly what Gemini saw.
async function saveBatch(entry) {
  try {
    const r = await chrome.storage.local.get("dbgBatches");
    const list = r.dbgBatches || [];
    list.unshift(entry);
    await chrome.storage.local.set({ dbgBatches: list.slice(0, MAX_DEBUG_BATCHES) });
  } catch (e) {
    console.warn("Could not keep a debug copy:", e);
  }
}

// Notes, characters and glossary as plain text for a translation model that is not given the image.
function contextBlock(notes, glossary, summary) {
  const parts = [];
  if (notes) parts.push("Notes about this series. Follow them:\n" + String(notes).slice(0, 2000));
  if (summary) parts.push("The story so far:\n" + String(summary).slice(0, 1500));
  const chars = glossary.filter((g) => g.type === "character");
  const terms = glossary.filter((g) => g.type !== "character");
  if (chars.length) parts.push("Characters:\n" + chars.map((g) => g.ko + " = " + g.en + (g.gender ? " (" + g.gender + ")" : "")).join("\n"));
  if (terms.length) parts.push("Glossary:\n" + terms.map((g) => g.ko + " = " + g.en).join("\n"));
  return parts.join("\n\n");
}

// Drafts an updated "story so far" from the English lines on the page. A local model is used when the
// reader has set one up, otherwise Gemini. The reader edits the result, it is never applied silently.
async function summarize(previous, lines) {
  const text = lines.map((l) => l.trim()).filter(Boolean).join("\n").slice(0, 6000);
  if (!text) throw new Error("There are no translated lines to summarize yet.");
  const prompt =
    "You keep a short plot summary of a Korean webtoon so its translators understand the story. Update the summary using the new English lines from the latest pages. " +
    "Write plain prose under 120 words. Only use what the lines show and do not invent anything. Output only the summary.\n\n" +
    "Summary so far:\n" + (previous.trim().slice(0, 1500) || "(none yet)") + "\n\nNew lines:\n" + text;
  const cfg = await chrome.storage.local.get(["provider", "ollamaUrl", "ollamaReader", "translator", "ollamaTranslator", "model"]);
  if (cfg.translator === "ollama" && cfg.ollamaTranslator) return (await Ollama.ask(cfg.ollamaUrl, cfg.ollamaTranslator, prompt)).slice(0, 1500);
  if (cfg.provider === "ollama" && cfg.ollamaReader) return (await Ollama.ask(cfg.ollamaUrl, cfg.ollamaReader, prompt)).slice(0, 1500);
  const key = await Secrets.get("apiKey");
  if (!key) throw new Error("Add a Gemini key or set up a local model first.");
  const model = !cfg.model || cfg.model === "gemini-2.5-flash" ? DEFAULTS.model : cfg.model;
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 400 } })
  });
  if (!r.ok) throw new Error(friendlyError(r.status, await r.text()));
  const j = await r.json();
  const out = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  const s = Array.isArray(out) ? out.map((p) => p.text || "").join("").trim() : "";
  if (!s) throw new Error("The model gave no summary. Try again.");
  return s.slice(0, 1500);
}

async function translate(url, dataUrl, panels, series, region) {
  const cfg = await chrome.storage.local.get([
    "model", "lang", "notes", "corrections", "keepDebug", "glossary",
    "provider", "ollamaUrl", "ollamaReader", "translator", "ollamaTranslator", "summaries", "useMemory", "contextCheck"
  ]);
  const seriesKey = String(series || "").slice(0, 80);
  const summary = cfg.summaries && typeof cfg.summaries === "object" ? String(cfg.summaries[seriesKey] || "") : "";
  const useMemory = cfg.useMemory !== false;
  // The reader finds the bubbles. It is Gemini unless the reader was switched to a local vision model.
  const localReader = cfg.provider === "ollama";
  let apiKey = null;
  if (localReader) {
    if (!cfg.ollamaReader) throw new Error("Pick a local vision model in the extension settings first.");
  } else {
    apiKey = await Secrets.get("apiKey");
    if (!apiKey) {
      const err = new Error("Add your Gemini API key in the extension settings first.");
      err.code = "NO_KEY";
      throw err;
    }
  }
  // gemini-2.5-flash was retired for new API users, so an old saved value falls back to the default.
  const model = !cfg.model || cfg.model === "gemini-2.5-flash" ? DEFAULTS.model : cfg.model;
  const lang = cfg.lang || DEFAULTS.lang;

  let img;
  if (dataUrl) {
    // Panels are read from the page (blob: images) and stitched by the content script.
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m || m[2].length > MAX_IMAGE_BYTES * 1.4) throw new Error("The panel image was not in a supported format.");
    img = { mime: m[1], data: m[2] };
  } else {
    img = await fetchImage(url);
  }

  const glossary = pickGlossary(cfg.glossary, String(series || "").slice(0, 80));
  let prompt = buildPrompt(lang, cfg.notes, cfg.corrections, glossary, summary);
  // Fully local mode: the vision model only reads. The translation model does the English afterwards,
  // so the reader is told to copy the Korean into the translation field and spend its effort on accuracy.
  let size = null;
  if (localReader) {
    // Local vision models report boxes in pixels of the image they see, so the size is needed.
    try {
      const bmp = await createImageBitmap(await (await fetch("data:" + img.mime + ";base64," + img.data)).blob());
      size = { w: bmp.width, h: bmp.height };
      bmp.close();
    } catch (e) {
      size = { w: 760, h: 1000 };
    }
    const alsoTranslate = !(cfg.translator === "ollama" && cfg.ollamaTranslator);
    prompt =
      "This image is " + size.w + " pixels wide and " + size.h + " pixels tall. Find every piece of Korean text in it: speech bubbles, narration boxes and sound effects. " +
      "For each one give bbox_2d as [x1, y1, x2, y2] in pixels, the tight box around the whole bubble's text, and copy the Korean exactly into original. " +
      (alsoTranslate
        ? "Translate it into " + lang + " in translation. " + contextBlock(cfg.notes, glossary, summary) + " "
        : "Copy the same Korean into translation, which is translated later. ") +
      "Keep line breaks as spaces. Skip logos and watermarks. Give bg and fg as hex colors for the bubble background and the text.";
  }
  // A region the reader drew a box around is one bubble, so the model is told to answer with one.
  if (region && localReader) prompt = "This image is a crop around one speech bubble or text area. Return all of its Korean text as ONE bubble, in reading order. " + prompt;
  const read = localReader
    ? await Ollama.read(cfg.ollamaUrl, cfg.ollamaReader, img.data, prompt, size)
    : await callGemini(apiKey, model, img.mime, img.data, prompt);
  let bubbles = localReader ? Ollama.mergeFragments(read.bubbles) : read.bubbles;
  if (region) {
    if (!bubbles.length) throw new Error("No Korean text was found in that area. Try drawing the box a little larger.");
    // Everything found inside a chosen area becomes a single bubble, so the sentence is translated whole.
    const sorted = bubbles.slice().sort((x, y) => (x.box_2d ? x.box_2d[0] : 0) - (y.box_2d ? y.box_2d[0] : 0) || (x.box_2d ? x.box_2d[1] : 0) - (y.box_2d ? y.box_2d[1] : 0));
    const joined = (k) => sorted.map((x) => String(x[k] || "").trim()).filter(Boolean).join(" ");
    const boxes = sorted.map((x) => x.box_2d).filter((x) => Array.isArray(x) && x.length === 4);
    const box = boxes.length ? [Math.min(...boxes.map((x) => x[0])), Math.min(...boxes.map((x) => x[1])), Math.max(...boxes.map((x) => x[2])), Math.max(...boxes.map((x) => x[3]))] : [0, 0, 1000, 1000];
    bubbles = [Object.assign({}, sorted[0], { original: joined("original"), translation: joined("translation"), box_2d: box })];
  }
  const terms = cleanTerms(read.terms);
  let warning = "";

  // Optional second step: a translation model on this computer rewrites each line from the Korean text.
  // If it fails, the reader's own translation stays, so a local problem never blanks the page.
  if (cfg.translator === "ollama" && cfg.ollamaTranslator && bubbles.length) {
    try {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const fixes = cfg.corrections || {};
      const tmList = useMemory ? await TM.load() : [];
      const base = contextBlock(cfg.notes, glossary, summary);
      // A line the reader already corrected is used as they wrote it. The model sees only the other lines,
      // each with a few similar earlier lines as examples of the wording to keep.
      const source = bubbles.map((b) => (Object.prototype.hasOwnProperty.call(fixes, norm(b.original)) ? "" : b.original));
      const fallback = bubbles.map((b) => (Object.prototype.hasOwnProperty.call(fixes, norm(b.original)) ? fixes[norm(b.original)] : b.translation));
      const r = await Ollama.translateLines(
        cfg.ollamaUrl,
        cfg.ollamaTranslator,
        source,
        lang,
        (ko) => {
          const ex = useMemory ? TM.find(tmList, fixes, seriesKey, ko, 3) : [];
          const block = ex.length ? "Earlier lines from this story. Keep the wording consistent with them:\n" + ex.map((e) => e.ko + " => " + e.en).join("\n") : "";
          return [base, block].filter(Boolean).join("\n\n");
        },
        fallback
      );
      bubbles = bubbles.map((b, i) => Object.assign({}, b, { translation: r.lines[i] }));
      // Context check: the panel's lines are read together and any line that does not fit the conversation is reworded.
      if (cfg.contextCheck !== false && bubbles.length > 1) {
        try {
          const ordered = bubbles.map((b, i) => ({ i, y: Array.isArray(b.box_2d) ? b.box_2d[0] : 0 })).sort((a, b) => a.y - b.y);
          const fixed = await Ollama.polish(cfg.ollamaUrl, cfg.ollamaTranslator, ordered.map((o) => ({ ko: bubbles[o.i].original, en: bubbles[o.i].translation })), lang, base);
          ordered.forEach((o, n) => {
            if (!Object.prototype.hasOwnProperty.call(fixes, norm(bubbles[o.i].original))) bubbles[o.i] = Object.assign({}, bubbles[o.i], { translation: fixed[n] });
          });
        } catch (e) {
          /* the first draft stays */
        }
      }
      if (r.failed) warning = r.failed + " line(s) could not be translated locally and keep the reader's wording.";
    } catch (e) {
      warning = "The local translator did not work, so the reader's own translation is shown. " + e.message;
    }
  }

  // Remember what was said, so later similar lines can reuse the wording. Stays on this computer.
  if (useMemory && seriesKey) await TM.add(seriesKey, bubbles.map((b) => ({ ko: b.original, en: b.translation })));

  // Kept only when the reader turned on "keep debug images", since they are copies of the comic pages.
  if (cfg.keepDebug) saveBatch({ t: Date.now(), model: localReader ? cfg.ollamaReader : model, panels: panels || 1, dataUrl: "data:" + img.mime + ";base64," + img.data, boxes: bubbles });
  return { boxes: bubbles, terms, warning };
}
