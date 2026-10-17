importScripts("secret.js");

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
      removeRuleIds: [1],
      addRules: [
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

chrome.runtime.onInstalled.addListener(installRefererRule);
chrome.runtime.onStartup.addListener(installRefererRule);
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !trustedSender(sender)) return false;
  if (msg.type === "translate") {
    translate(msg.url, msg.dataUrl, msg.panels)
      .then((boxes) => sendResponse({ ok: true, boxes }))
      .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
    return true;
  }
  if (msg.type === "fetchImage") {
    fetchImage(msg.url)
      .then((img) => sendResponse({ ok: true, dataUrl: "data:" + img.mime + ";base64," + img.data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
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

function buildPrompt(lang, notes, corrections) {
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
    "Use the same names, terms and speaking style for the same character everywhere in the image."
  ];
  if (notes) lines.push("Notes from the reader about this series. Follow them exactly:\n" + String(notes).slice(0, 4000));
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
    contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
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
      }
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body)
    });
    if (r.status === 429 || r.status === 503) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error("Gemini error " + r.status + ": " + scrub(t.slice(0, 200)));
    }
    const j = await r.json();
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Unexpected reply format from Gemini");
    return parsed;
  }
  throw new Error("Gemini is rate limiting requests. Wait a minute and toggle the button off and on.");
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

async function translate(url, dataUrl, panels) {
  const cfg = await chrome.storage.local.get(["model", "lang", "notes", "corrections"]);
  const apiKey = await Secrets.get("apiKey");
  if (!apiKey) {
    const err = new Error("Add your Gemini API key in the extension settings first.");
    err.code = "NO_KEY";
    throw err;
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

  const prompt = buildPrompt(lang, cfg.notes, cfg.corrections);
  const boxes = await callGemini(apiKey, model, img.mime, img.data, prompt);
  saveBatch({ t: Date.now(), model, panels: panels || 1, dataUrl: "data:" + img.mime + ";base64," + img.data, boxes });
  return boxes;
}
