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
    const payload = { model, messages, stream: false, options: { temperature: 0.2, num_ctx: 8192 } };
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
            box_2d: { type: "array", items: { type: "integer" } },
            original: { type: "string" },
            translation: { type: "string" },
            bg: { type: "string" },
            fg: { type: "string" }
          },
          required: ["box_2d", "original", "translation"]
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
  async function read(rawUrl, model, base64, prompt) {
    const content = await chat(baseUrl(rawUrl), model, [{ role: "user", content: prompt, images: [base64] }], READER_FORMAT);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error("The local model did not return usable JSON. Try a larger or newer vision model.");
    }
    const bubbles = Array.isArray(parsed) ? parsed : parsed && parsed.bubbles;
    if (!Array.isArray(bubbles)) throw new Error("The local model's reply had no bubbles in it.");
    return { bubbles, terms: parsed && parsed.terms };
  }

  // Translation only, one line per request, so a translation model sees plain Korean text.
  async function translateOne(base, model, text, lang, context) {
    const prompt =
      "You are a professional Korean (ko) to " + lang + " translator. Your goal is to accurately convey the meaning and nuances of the original Korean text while adhering to " + lang + " grammar, vocabulary, and cultural sensitivities.\n" +
      "Produce only the " + lang + " translation, without any additional explanations or commentary." +
      (context ? "\n\n" + context : "") +
      "\n\nPlease translate the following Korean text into " + lang + ":\n\n\n" + text;
    const content = await chat(base, model, [{ role: "user", content: prompt }]);
    return content.trim();
  }

  // Returns one translation per input line. A line that fails keeps its fallback.
  async function translateLines(rawUrl, model, lines, lang, context, fallback) {
    const base = baseUrl(rawUrl);
    const out = [];
    let failed = 0;
    for (let i = 0; i < lines.length; i++) {
      const text = String(lines[i] || "").trim();
      if (!text) {
        out.push(fallback[i]);
        continue;
      }
      try {
        const t = await translateOne(base, model, text, lang, context);
        out.push(t || fallback[i]);
        if (!t) failed++;
      } catch (e) {
        // A connection or model problem will hit every line, so stop and report it.
        if (i === 0) throw e;
        out.push(fallback[i]);
        failed++;
      }
    }
    return { lines: out, failed };
  }

  g.Ollama = { DEFAULT_URL, baseUrl, permissionPattern, listModels, read, translateLines };
})(self);
