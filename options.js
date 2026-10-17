const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["apiKey", "model", "lang", "batchSeconds"]).then((cfg) => {
  $("apiKey").value = cfg.apiKey || "";
  $("model").value = !cfg.model || cfg.model === "gemini-2.5-flash" ? "gemini-3.8-flash" : cfg.model;
  $("lang").value = cfg.lang || "English";
  $("batchSeconds").value = cfg.batchSeconds || 10;
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "gemini-3.8-flash",
    lang: $("lang").value.trim() || "English",
    batchSeconds: Math.min(60, Math.max(3, Number($("batchSeconds").value) || 10))
  });
  $("msg").textContent = "Saved";
  setTimeout(() => ($("msg").textContent = ""), 2000);
});

$("clear").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:"));
  await chrome.storage.local.remove(keys);
  $("msg").textContent = "Cleared " + keys.length + " cached panels";
  setTimeout(() => ($("msg").textContent = ""), 3000);
});
