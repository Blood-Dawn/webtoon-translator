const $ = (id) => document.getElementById(id);
const BACKUP_KEYS = ["model", "lang", "batchSeconds", "notes", "corrections", "glossary", "provider", "ollamaUrl", "ollamaReader", "translator", "ollamaTranslator", "useMemory", "summaries"];
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/;
const DEFAULT_OLLAMA = "http://localhost:11434";

// The browser must grant access to localhost before the extension can talk to Ollama. Call from a click.
async function ensureLocalPermission(url) {
  const host = /^http:\/\/([^:/]+)/.exec(url)[1];
  const origins = ["http://" + host + "/*"];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

function localUrl() {
  const v = ($("ollamaUrl").value.trim() || DEFAULT_OLLAMA).replace(/\/+$/, "");
  return LOCAL_URL.test(v) ? v : null;
}
let keyTested = false;

function flash(text, ms) {
  $("msg").textContent = text;
  setTimeout(() => ($("msg").textContent = ""), ms || 2500);
}

function setStep(id, done) {
  $(id).classList.toggle("done", !!done);
}

async function showKeyState() {
  const key = await Secrets.get("apiKey");
  $("keystate").textContent = key
    ? "A key is saved on this computer (ends in " + key.slice(-4) + "). Paste a new key to replace it."
    : "No key saved yet.";
  $("removeKey").style.display = key ? "inline-block" : "none";
  if (!key) keyTested = false;
  setStep("step1", !!key);
  setStep("step2", !!key && keyTested);
}

function showTest(ok, text) {
  $("testresult").className = ok ? "ok" : "bad";
  $("testresult").textContent = text;
}

(async () => {
  // Older versions kept the key in regular extension storage. Move it into private storage.
  await Secrets.migrate().catch(() => {});
  const cfg = await chrome.storage.local.get(["model", "lang", "batchSeconds", "keepDebug", "provider", "ollamaUrl", "ollamaReader", "translator", "ollamaTranslator", "useMemory"]);
  $("provider").value = cfg.provider === "ollama" ? "ollama" : "gemini";
  $("translator").value = cfg.translator === "ollama" || cfg.translator === "chrome" ? cfg.translator : "same";
  $("useMemory").checked = cfg.useMemory !== false;
  $("ollamaUrl").value = cfg.ollamaUrl || DEFAULT_OLLAMA;
  $("ollamaReader").value = cfg.ollamaReader || "";
  $("ollamaTranslator").value = cfg.ollamaTranslator || "";
  $("model").value = !cfg.model || cfg.model === "gemini-2.5-flash" ? "gemini-3.8-flash" : cfg.model;
  $("lang").value = cfg.lang || "English";
  $("batchSeconds").value = cfg.batchSeconds || 10;
  $("keepDebug").checked = !!cfg.keepDebug;
  await showKeyState();
})();

$("save").addEventListener("click", async () => {
  const url = localUrl();
  if (!url) {
    flash("The Ollama address must be localhost or 127.0.0.1", 4000);
    return;
  }
  const wantsLocal = $("provider").value === "ollama" || $("translator").value === "ollama";
  if (wantsLocal) {
    // Asked first, because the browser only allows this right after a click.
    const granted = await ensureLocalPermission(url);
    if (!granted) {
      flash("Local models need permission to reach this computer. Press Save again and allow it.", 5000);
      return;
    }
  }
  const key = $("apiKey").value.trim();
  if (key) {
    await Secrets.set("apiKey", key);
    keyTested = false;
  }
  $("apiKey").value = "";
  const keepDebug = $("keepDebug").checked;
  await chrome.storage.local.set({
    model: $("model").value.trim() || "gemini-3.8-flash",
    lang: $("lang").value.trim() || "English",
    batchSeconds: Math.min(60, Math.max(0, $("batchSeconds").value === "" ? 10 : Number($("batchSeconds").value) || 0)),
    keepDebug,
    provider: $("provider").value === "ollama" ? "ollama" : "gemini",
    translator: ["ollama", "chrome"].includes($("translator").value) ? $("translator").value : "same",
    useMemory: $("useMemory").checked,
    ollamaUrl: url,
    ollamaReader: $("ollamaReader").value.trim().slice(0, 100),
    ollamaTranslator: $("ollamaTranslator").value.trim().slice(0, 100)
  });
  if (!keepDebug) await chrome.storage.local.remove("dbgBatches");
  await showKeyState();
  flash("Saved");
});

$("testKey").addEventListener("click", async () => {
  const typed = $("apiKey").value.trim();
  const key = typed || (await Secrets.get("apiKey"));
  showTest(true, "Checking...");
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "testKey", key, model: $("model").value.trim() });
  } catch (e) {
    res = { ok: false, error: "The extension did not answer. Reload it at chrome://extensions." };
  }
  if (res && res.ok) {
    keyTested = true;
    showTest(true, typed ? "This key works. Press Save to keep it." : "Your saved key works.");
    if (!typed) setStep("step2", true);
  } else {
    showTest(false, (res && res.error) || "The test failed.");
  }
});

function showLocal(ok, text) {
  $("localresult").className = ok ? "ok" : "bad";
  $("localresult").textContent = text;
}

$("findModels").addEventListener("click", async () => {
  const url = localUrl();
  if (!url) return showLocal(false, "The Ollama address must be localhost or 127.0.0.1.");
  if (!(await ensureLocalPermission(url))) return showLocal(false, "Permission to reach this computer was not granted.");
  showLocal(true, "Looking...");
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "ollamaModels", url });
  } catch (e) {
    res = { ok: false, error: "The extension did not answer. Reload it at chrome://extensions." };
  }
  if (!res || !res.ok) return showLocal(false, (res && res.error) || "Could not list models.");
  const list = $("localModels");
  list.textContent = "";
  res.models.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.name;
    list.appendChild(o);
  });
  showLocal(
    true,
    res.models.length
      ? res.models.map((m) => m.name + "  (" + m.sizeGB + " GB" + (m.vision ? ", reads images" : "") + ")").join("\n")
      : "Ollama is running but has no models yet. Download one, for example: ollama pull translategemma:12b"
  );
});

$("testLocal").addEventListener("click", async () => {
  const url = localUrl();
  const model = $("ollamaTranslator").value.trim() || $("ollamaReader").value.trim();
  if (!url) return showLocal(false, "The Ollama address must be localhost or 127.0.0.1.");
  if (!model) return showLocal(false, "Type a model name first, or press Find my models.");
  if (!(await ensureLocalPermission(url))) return showLocal(false, "Permission to reach this computer was not granted.");
  showLocal(true, "Translating a sample line with " + model + "... the first request loads the model and can take a while.");
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "ollamaTest", url, model, lang: $("lang").value.trim() || "English" });
  } catch (e) {
    res = { ok: false, error: "The extension did not answer. Reload it at chrome://extensions." };
  }
  if (res && res.ok) showLocal(true, "오늘도 늦었네. 또 야근이야?\n=> " + res.text + "\n(" + (res.ms / 1000).toFixed(1) + " seconds)");
  else showLocal(false, (res && res.error) || "The test failed.");
});

$("removeKey").addEventListener("click", async () => {
  await Secrets.remove("apiKey");
  $("testresult").textContent = "";
  await showKeyState();
  flash("Key removed from this computer");
});

$("clear").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:") || k === "dbgBatches");
  await chrome.storage.local.remove(keys);
  flash("Cleared the translation cache and saved debug images", 3500);
});

$("export").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(BACKUP_KEYS);
  const blob = new Blob([JSON.stringify({ app: "webtoon-translator", version: 1, settings: data }, null, 2)], {
    type: "application/json"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "webtoon-translator-settings.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("import").addEventListener("click", () => $("importFile").click());

// Only known keys with the right types are accepted, so a hand-edited or hostile file cannot add anything else.
function cleanBackup(obj) {
  const s = obj && obj.app === "webtoon-translator" && obj.settings;
  if (!s || typeof s !== "object") return null;
  const out = {};
  if (typeof s.model === "string") out.model = s.model.slice(0, 80);
  if (typeof s.lang === "string") out.lang = s.lang.slice(0, 40);
  if (typeof s.batchSeconds === "number") out.batchSeconds = Math.min(60, Math.max(0, s.batchSeconds));
  if (typeof s.notes === "string") out.notes = s.notes.slice(0, 4000);
  if (s.provider === "gemini" || s.provider === "ollama") out.provider = s.provider;
  if (s.translator === "same" || s.translator === "ollama" || s.translator === "chrome") out.translator = s.translator;
  if (typeof s.useMemory === "boolean") out.useMemory = s.useMemory;
  if (s.summaries && typeof s.summaries === "object" && !Array.isArray(s.summaries)) {
    const m = {};
    for (const [k, v] of Object.entries(s.summaries).slice(0, 40)) if (typeof v === "string" && k.length <= 80) m[k] = v.slice(0, 1500);
    out.summaries = m;
  }
  if (typeof s.ollamaUrl === "string" && LOCAL_URL.test(s.ollamaUrl)) out.ollamaUrl = s.ollamaUrl.replace(/\/+$/, "");
  if (typeof s.ollamaReader === "string") out.ollamaReader = s.ollamaReader.slice(0, 100);
  if (typeof s.ollamaTranslator === "string") out.ollamaTranslator = s.ollamaTranslator.slice(0, 100);
  if (s.corrections && typeof s.corrections === "object" && !Array.isArray(s.corrections)) {
    const c = {};
    for (const [ko, en] of Object.entries(s.corrections).slice(0, 2000)) {
      if (typeof en === "string" && ko.length <= 500) c[ko] = en.slice(0, 500);
    }
    out.corrections = c;
  }
  if (Array.isArray(s.glossary)) {
    const g = [];
    for (const e of s.glossary.slice(0, 500)) {
      if (!e || typeof e.ko !== "string" || typeof e.en !== "string" || !e.ko.trim() || !e.en.trim()) continue;
      g.push({
        ko: e.ko.trim().slice(0, 60),
        en: e.en.trim().slice(0, 80),
        type: e.type === "character" ? "character" : "term",
        gender: e.gender === "female" || e.gender === "male" ? e.gender : "",
        status: e.status === "approved" ? "approved" : "pending",
        series: typeof e.series === "string" ? e.series.slice(0, 80) : "",
        n: Number.isFinite(e.n) ? Math.max(0, Math.round(e.n)) : 0,
        t: Number.isFinite(e.t) ? e.t : 0
      });
    }
    out.glossary = g;
  }
  return out;
}

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("big");
    const clean = cleanBackup(JSON.parse(await file.text()));
    if (!clean) throw new Error("shape");
    const existing = await chrome.storage.local.get("corrections");
    if (clean.corrections) clean.corrections = Object.assign({}, existing.corrections || {}, clean.corrections);
    if (clean.glossary) {
      const have = (await chrome.storage.local.get("glossary")).glossary || [];
      const key = (x) => x.series + "\u0000" + x.ko;
      const merged = new Map(have.map((x) => [key(x), x]));
      clean.glossary.forEach((x) => merged.set(key(x), x));
      clean.glossary = Array.from(merged.values()).slice(-500);
    }
    await chrome.storage.local.set(clean);
    if (clean.model) $("model").value = clean.model;
    if (clean.lang) $("lang").value = clean.lang;
    if (clean.batchSeconds) $("batchSeconds").value = clean.batchSeconds;
    flash("Settings imported", 3500);
  } catch (err) {
    flash("That file is not a Webtoon Translator backup", 4000);
  }
});


// ---------- translation memory ----------
async function showMemoryCount() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "memoryCount" });
    $("memorycount").textContent = r && r.ok ? r.count + " lines remembered" : "";
  } catch (e) {
    $("memorycount").textContent = "";
  }
}
showMemoryCount();
$("clearMemory").addEventListener("click", async () => {
  const r = await chrome.runtime.sendMessage({ type: "memoryClear" });
  $("memorycount").textContent = r && r.ok ? "Cleared " + r.count + " lines" : "Could not clear";
});

// ---------- quality test ----------
// chrF: how many character pieces (1 to 6 long) a translation shares with the reference, weighted toward
// recall. It rewards matching wording, so it ranks models against each other rather than grading one alone.
function chrf(hyp, ref) {
  const prep = (t) => String(t).toLowerCase().replace(/\s+/g, "");
  const h = prep(hyp);
  const r = prep(ref);
  if (!h || !r) return 0;
  const beta2 = 4;
  let pSum = 0;
  let rSum = 0;
  let used = 0;
  for (let n = 1; n <= 6; n++) {
    const count = (t) => {
      const m = new Map();
      for (let i = 0; i + n <= t.length; i++) m.set(t.slice(i, i + n), (m.get(t.slice(i, i + n)) || 0) + 1);
      return m;
    };
    const hm = count(h);
    const rm = count(r);
    if (!hm.size || !rm.size) continue;
    let match = 0;
    let hTot = 0;
    let rTot = 0;
    for (const v of hm.values()) hTot += v;
    for (const v of rm.values()) rTot += v;
    for (const [k, v] of hm) match += Math.min(v, rm.get(k) || 0);
    pSum += match / hTot;
    rSum += match / rTot;
    used++;
  }
  if (!used) return 0;
  const p = pSum / used;
  const rec = rSum / used;
  return p + rec === 0 ? 0 : ((1 + beta2) * p * rec) / (beta2 * p + rec);
}

$("runEval").addEventListener("click", async () => {
  const model = $("ollamaTranslator").value.trim();
  const url = localUrl();
  const set = window.WT_EVAL || [];
  if (!model || !url) {
    $("evalprogress").textContent = "Type a local translation model above first.";
    return;
  }
  if (!(await ensureLocalPermission(url))) {
    $("evalprogress").textContent = "Allow access to this computer, then press the button again.";
    return;
  }
  $("runEval").disabled = true;
  $("evalresult").textContent = "";
  const outputs = [];
  const t0 = Date.now();
  try {
    for (let i = 0; i < set.length; i += 5) {
      const chunk = set.slice(i, i + 5);
      $("evalprogress").textContent = "Translating " + Math.min(i + 5, set.length) + " of " + set.length + "...";
      const r = await chrome.runtime.sendMessage({ type: "ollamaBatch", url, model, lang: $("lang").value.trim() || "English", lines: chunk.map((c) => c.ko) });
      if (!r || !r.ok) throw new Error((r && r.error) || "No answer");
      r.lines.forEach((t) => outputs.push(t));
    }
  } catch (e) {
    $("evalprogress").textContent = "Stopped: " + e.message;
    $("runEval").disabled = false;
    return;
  }
  const seconds = (Date.now() - t0) / 1000;
  const scores = set.map((c, i) => chrf(outputs[i] || "", c.en) * 100);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const byKind = {};
  set.forEach((c, i) => {
    (byKind[c.kind] = byKind[c.kind] || []).push(scores[i]);
  });
  const lines = ["Score " + avg.toFixed(1) + " out of 100, " + (seconds / set.length).toFixed(1) + " seconds per line (the first line includes loading the model)."];
  lines.push(Object.entries(byKind).map(([k, v]) => k + " " + (v.reduce((a, b) => a + b, 0) / v.length).toFixed(0)).join("   "));
  const worst = scores.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]).slice(0, 4);
  lines.push("Weakest lines:");
  worst.forEach(([, i]) => lines.push(set[i].ko + "\n  model: " + outputs[i] + "\n  reference: " + set[i].en));
  $("evalprogress").textContent = "Done.";
  $("evalresult").style.whiteSpace = "pre-wrap";
  $("evalresult").textContent = lines.join("\n");
  try {
    const prev = (await chrome.storage.local.get("evalResults")).evalResults || {};
    prev[model] = { score: Math.round(avg * 10) / 10, secPerLine: Math.round((seconds / set.length) * 10) / 10 };
    await chrome.storage.local.set({ evalResults: prev });
    $("evalresult").textContent += "\n\nAll models tested so far:\n" + Object.entries(prev).map(([m, v]) => m + ": " + v.score + " (" + v.secPerLine + " s per line)").join("\n");
  } catch (e) {
    /* the score is still shown */
  }
  $("runEval").disabled = false;
});
