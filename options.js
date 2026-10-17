const $ = (id) => document.getElementById(id);
const BACKUP_KEYS = ["model", "lang", "batchSeconds", "notes", "corrections"];
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
  const cfg = await chrome.storage.local.get(["model", "lang", "batchSeconds", "keepDebug"]);
  $("model").value = !cfg.model || cfg.model === "gemini-2.5-flash" ? "gemini-3.8-flash" : cfg.model;
  $("lang").value = cfg.lang || "English";
  $("batchSeconds").value = cfg.batchSeconds || 10;
  $("keepDebug").checked = !!cfg.keepDebug;
  await showKeyState();
})();

$("save").addEventListener("click", async () => {
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
    batchSeconds: Math.min(60, Math.max(3, Number($("batchSeconds").value) || 10)),
    keepDebug
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
  if (typeof s.batchSeconds === "number") out.batchSeconds = Math.min(60, Math.max(3, Math.round(s.batchSeconds)));
  if (typeof s.notes === "string") out.notes = s.notes.slice(0, 4000);
  if (s.corrections && typeof s.corrections === "object" && !Array.isArray(s.corrections)) {
    const c = {};
    for (const [ko, en] of Object.entries(s.corrections).slice(0, 2000)) {
      if (typeof en === "string" && ko.length <= 500) c[ko] = en.slice(0, 500);
    }
    out.corrections = c;
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
    await chrome.storage.local.set(clean);
    if (clean.model) $("model").value = clean.model;
    if (clean.lang) $("lang").value = clean.lang;
    if (clean.batchSeconds) $("batchSeconds").value = clean.batchSeconds;
    flash("Settings imported", 3500);
  } catch (err) {
    flash("That file is not a Webtoon Translator backup", 4000);
  }
});
