const $ = (id) => document.getElementById(id);

function flash(text, ms) {
  $("msg").textContent = text;
  setTimeout(() => ($("msg").textContent = ""), ms || 2500);
}

async function showKeyState() {
  const key = await Secrets.get("apiKey");
  $("keystate").textContent = key
    ? "A key is saved on this computer (ends in " + key.slice(-4) + "). Paste a new key to replace it."
    : "No key saved yet.";
  $("removeKey").style.display = key ? "inline-block" : "none";
}

(async () => {
  // Older versions kept the key in regular extension storage. Move it into private storage.
  await Secrets.migrate().catch(() => {});
  const cfg = await chrome.storage.local.get(["model", "lang", "batchSeconds"]);
  $("model").value = !cfg.model || cfg.model === "gemini-2.5-flash" ? "gemini-3.8-flash" : cfg.model;
  $("lang").value = cfg.lang || "English";
  $("batchSeconds").value = cfg.batchSeconds || 10;
  await showKeyState();
})();

$("save").addEventListener("click", async () => {
  const key = $("apiKey").value.trim();
  if (key) await Secrets.set("apiKey", key);
  $("apiKey").value = "";
  await chrome.storage.local.set({
    model: $("model").value.trim() || "gemini-3.8-flash",
    lang: $("lang").value.trim() || "English",
    batchSeconds: Math.min(60, Math.max(3, Number($("batchSeconds").value) || 10))
  });
  await showKeyState();
  flash("Saved");
});

$("removeKey").addEventListener("click", async () => {
  await Secrets.remove("apiKey");
  await showKeyState();
  flash("Key removed from this computer");
});

$("clear").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:") || k === "dbgBatches");
  await chrome.storage.local.remove(keys);
  flash("Cleared the translation cache and saved debug images", 3500);
});
