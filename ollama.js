// Talks to an Ollama server running on this computer. Nothing in this file can reach any other address:
// the server address is checked to be a loopback address before every request.
(function (g) {
  const DEFAULT_URL = "http://localhost:11434";
  const CHAT_TIMEOUT_MS = 180000;

  // Only localhost, 127.0.0.1 and ::1 are accepted, so a typo or a hand edited settings file
  // can never send panel images to a remote server.
  function baseUrl(raw) {
    const s = String(raw || DEFAULT_URL).trim().replace(/\/+$/, "");
    let u;
    try {
      u = new URL(s);
    } catch (e) {
      throw new Error("The Ollama address is not valid. Use something like " + DEFAULT_URL);
    }
    const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "http:" || !loopback || u.username || u.password || (u.pathname !== "/" && u.pathname !== "")) {
      throw new Error("Only an Ollama server on this computer is allowed (localhost or 127.0.0.1).");
    }
    return u.origin;
  }

  // The match pattern the browser needs permission for, for example http://localhost/*
  function permissionPattern(raw) {
    const u = new URL(baseUrl(raw));
    return u.protocol + "//" + u.hostname + "/*";
  }

  function explain(status, text, model) {
    const t = String(text || "").toLowerCase();
    if (status === 403) return "Ollama refused the request. Set the OLLAMA_ORIGINS variable to chrome-extension://* and restart Ollama.";
    if (status === 404 || t.includes("not found")) return 'Ollama does not have the model "' + model + '". Download it with: ollama pull ' + model;
    if (t.includes("image")) return "This model cannot read images. Pick a vision model, or let Gemini read the panels.";
    if (t.includes("memory")) return "The model did not fit in memory. Try a smaller model.";
    return "Ollama returned an error (" + status + ").";
  }

  async function request(base, path, method, body, model, timeoutMs) {
    let r;
    try {
      r = await fetch(base + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs || 15000)
      });
    } catch (e) {
      if (e && e.name === "TimeoutError") throw new Error("Ollama took too long to answer. A smaller model may help.");
      throw new Error("Could not reach Ollama at " + base + ". Make sure the Ollama app is running and that this extension has permission for it.");
    }
    if (!r.ok) throw new Error(explain(r.status, await r.text().catch(() => ""), model));
    return r.json();
  }

  async function chat(base, model, messages, format) {
    // keep_alive holds the model in GPU memory between panels, which is most of the speed difference.
    const payload = { model, messages, stream: false, keep_alive: "30m", options: { temperature: 0.2, num_ctx: 8192 } };
    if (format) payload.format = format;
    const j = await request(base, "/api/chat", "POST", payload, model, CHAT_TIMEOUT_MS);
    return (j.message && j.message.content) || "";
  }

  // Lists installed models and whether each one can read images.
  async function listModels(rawUrl) {
    const base = baseUrl(rawUrl);
    const tags = await request(base, "/api/tags", "GET", null, "");
    const models = (tags.models || []).slice(0, 40);
    return Promise.all(
      models.map(async (m) => {
        let vision = false;
        try {
          const info = await request(base, "/api/show", "POST", { model: m.name }, m.name);
          vision = Array.isArray(info.capabilities) && info.capabilities.includes("vision");
        } catch (e) {
          /* capabilities unknown */
        }
        return { name: m.name, sizeGB: Math.round((m.size || 0) / 1e8) / 10, vision };
      })
    );
  }

  const READER_FORMAT = {
    type: "object",
    properties: {
      bubbles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bbox_2d: { type: "array", items: { type: "integer" } },
            original: { type: "string" },
            translation: { type: "string" },
            bg: { type: "string" },
            fg: { type: "string" }
          },
          required: ["bbox_2d", "original", "translation"]
        }
      },
      terms: {
        type: "array",
        items: {
          type: "object",
          properties: { ko: { type: "string" }, en: { type: "string" }, type: { type: "string" }, gender: { type: "string" } },
          required: ["ko", "en"]
        }
      }
    },
    required: ["bubbles"]
  };

  // The local vision model finds the bubbles and translates them in one request.
  // Local vision models (Qwen-VL in particular) answer with pixel boxes as [x1, y1, x2, y2] on the image
  // they were shown, not with Gemini's 0 to 1000 [y1, x1, y2, x2]. They also see the image rounded to
  // a multiple of 28 pixels. This turns their boxes into the extension's own scale.
  function toPageScale(box, w, h) {
    if (!Array.isArray(box) || box.length !== 4) return null;
    const n = box.map(Number);
    if (n.some((v) => Number.isNaN(v))) return null;
    const rw = Math.max(28, Math.round(w / 28) * 28);
    const rh = Math.max(28, Math.round(h / 28) * 28);
    const [x1, y1, x2, y2] = n;
    const c = (v) => Math.max(0, Math.min(1000, Math.round(v)));
    const out = [c((Math.min(y1, y2) / rh) * 1000), c((Math.min(x1, x2) / rw) * 1000), c((Math.max(y1, y2) / rh) * 1000), c((Math.max(x1, x2) / rw) * 1000)];
    return out[2] > out[0] && out[3] > out[1] ? out : null;
  }

  async function read(rawUrl, model, base64, prompt, size) {
    const content = await chat(baseUrl(rawUrl), model, [{ role: "user", content: prompt, images: [base64] }], READER_FORMAT);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error("The local model did not return usable JSON. Try a larger or newer vision model.");
    }
    const bubbles = Array.isArray(parsed) ? parsed : parsed && parsed.bubbles;
    if (!Array.isArray(bubbles)) throw new Error("The local model's reply had no bubbles in it.");
    const fixed = [];
    for (const b of bubbles) {
      if (!b || typeof b !== "object") continue;
      const box = size ? toPageScale(b.bbox_2d || b.box_2d, size.w, size.h) : b.box_2d;
      if (!box) continue;
      fixed.push(Object.assign({}, b, { box_2d: box }));
    }
    return { bubbles: fixed, terms: parsed && parsed.terms };
  }

  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
  const CHATTER = /(provide|share|send|paste|give me)\b[^.\n]{0,40}\b(korean|text)|i (need|will|can) (the|do|help|translate)|absolutely[.!]|korean text you/i;

  // A local reader often returns one box per line of a bubble. Translating the lines apart gives broken wording,
  // so boxes that are stacked in the same bubble are joined into one before translation. Boxes use the
  // 0 to 1000 [ymin, xmin, ymax, xmax] scale.
  function mergeFragments(bubbles) {
    const list = bubbles.filter((b) => Array.isArray(b.box_2d) && b.box_2d.length === 4).map((b) => Object.assign({}, b, { box_2d: b.box_2d.map(Number) }));
    const rest = bubbles.filter((b) => !(Array.isArray(b.box_2d) && b.box_2d.length === 4));
    const joinable = (a, b) => {
      if (!HANGUL.test(a.original || "") || !HANGUL.test(b.original || "")) return false;
      const [ay1, ax1, ay2, ax2] = a.box_2d;
      const [by1, bx1, by2, bx2] = b.box_2d;
      const ow = Math.min(ax2, bx2) - Math.max(ax1, bx1);
      const minW = Math.min(ax2 - ax1, bx2 - bx1);
      if (minW <= 0 || ow < minW * 0.5) return false;
      const gap = Math.max(ay1, by1) - Math.min(ay2, by2);
      const lineH = Math.max(ay2 - ay1, by2 - by1);
      return gap <= lineH * 0.6;
    };
    let changed = true;
    while (changed) {
      changed = false;
      list.sort((a, b) => a.box_2d[0] - b.box_2d[0]);
      for (let i = 0; i < list.length && !changed; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (!joinable(list[i], list[j])) continue;
          const a = list[i];
          const b = list[j];
          const first = a.box_2d[0] <= b.box_2d[0] ? a : b;
          const second = first === a ? b : a;
          const join = (x, y) => [x, y].map((t) => String(t || "").trim()).filter(Boolean).join(" ");
          list[i] = Object.assign({}, first, {
            original: join(first.original, second.original),
            translation: join(first.translation, second.translation),
            box_2d: [Math.min(a.box_2d[0], b.box_2d[0]), Math.min(a.box_2d[1], b.box_2d[1]), Math.max(a.box_2d[2], b.box_2d[2]), Math.max(a.box_2d[3], b.box_2d[3])]
          });
          list.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
    return list.concat(rest);
  }

  // Second pass: the translation model reads the whole panel's lines together, in order, and fixes any line
  // that does not make sense in context. It must answer with exactly one numbered line per input line,
  // otherwise the first draft is kept.
  async function polish(rawUrl, model, items, lang, context) {
    if (!Array.isArray(items) || items.length < 2) return items.map((i) => i.en);
    const base = baseUrl(rawUrl);
    const body = items.map((it, n) => (n + 1) + ". Korean: " + it.ko + "\n   Draft: " + it.en).join("\n");
    const prompt =
      "These are the lines of one comic panel, in reading order. Each has the Korean original and a draft " + lang + " translation.\n" +
      "Check every draft against the Korean and the lines around it. Fix any line that is wrong, stiff, or does not make sense in the conversation. Keep lines that are already good exactly as they are. Keep names consistent.\n" +
      (context ? context + "\n" : "") +
      "Answer with exactly " + items.length + " lines in the form \"N. text\", and nothing else.\n\n" + body;
    const out = await chat(base, model, [{ role: "user", content: prompt }]);
    const got = new Array(items.length).fill(null);
    for (const line of out.split(/\n+/)) {
      const m = line.match(/^\s*(\d+)[.)]\s*(.+)$/);
      if (!m) continue;
      const idx = Number(m[1]) - 1;
      const t = m[2].replace(/^(korean|draft|english)\s*:\s*/i, "").trim();
      if (idx >= 0 && idx < items.length && t && !CHATTER.test(t) && got[idx] === null) got[idx] = t;
    }
    // A reply that did not cover every line is not trusted at all.
    if (got.some((t) => t === null)) return items.map((i) => i.en);
    return got.map((t, i) => (HANGUL.test(items[i].ko) ? t : items[i].en));
  }

  // Different translation models expect different instructions. Hunyuan-MT models are trained on a short
  // plain request, TranslateGemma on a longer professional translator template. Anything else gets the
  // longer template too, which general chat models follow well.
  function styleFor(model) {
    return /hunyuan|hy-mt/i.test(String(model)) ? "hunyuan" : "translategemma";
  }

  function translationPrompt(model, text, lang, context) {
    if (styleFor(model) === "hunyuan") {
      return (context ? context + "\n\n" : "") + "Translate the following segment into " + lang + ", without additional explanation.\n\n" + text;
    }
    return (
      "You are a professional Korean (ko) to " + lang + " translator. Your goal is to accurately convey the meaning and nuances of the original Korean text while adhering to " + lang + " grammar, vocabulary, and cultural sensitivities.\n" +
      "Produce only the " + lang + " translation, without any additional explanations or commentary." +
      (context ? "\n\n" + context : "") +
      "\n\nPlease translate the following Korean text into " + lang + ":\n\n\n" + text
    );
  }

  // Translation only, one line per request, so a translation model sees plain Korean text.
  async function translateOne(base, model, text, lang, context) {
    const content = await chat(base, model, [{ role: "user", content: translationPrompt(model, text, lang, context) }]);
    // Some models list several options ("Or:" between them). A bubble gets the first one only.
    return content.split(/\n+\s*(?:or|alternatively)\s*[:,]?\s*\n/i)[0].trim();
  }

  // A plain question to a local model, for things like drafting a story summary.
  async function ask(rawUrl, model, prompt) {
    return (await chat(baseUrl(rawUrl), model, [{ role: "user", content: prompt }])).trim();
  }

  // Returns one translation per input line. A line that fails keeps its fallback.
  async function translateLines(rawUrl, model, lines, lang, context, fallback) {
    const base = baseUrl(rawUrl);
    const out = [];
    let failed = 0;
    for (let i = 0; i < lines.length; i++) {
      const text = String(lines[i] || "").trim();
      // Sound effects, symbols and numbers have no Korean words in them. A chat model asked to translate
      // those tends to answer with a request for text, so they keep the reader's wording.
      if (!text || !HANGUL.test(text)) {
        out.push(fallback[i]);
        continue;
      }
      try {
        const t = await translateOne(base, model, text, lang, typeof context === "function" ? context(text) : context);
        // A reply that talks to the reader instead of translating is thrown away.
        const chatter = CHATTER.test(t);
        out.push(t && !chatter ? t : fallback[i]);
        if (!t || chatter) failed++;
      } catch (e) {
        // A connection or model problem will hit every line, so stop and report it.
        if (i === 0) throw e;
        out.push(fallback[i]);
        failed++;
      }
    }
    return { lines: out, failed };
  }

  g.Ollama = { DEFAULT_URL, baseUrl, permissionPattern, listModels, read, translateLines, ask, styleFor, mergeFragments, polish };
})(self);
