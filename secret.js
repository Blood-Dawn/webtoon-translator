// Keeps the API key in this extension's own IndexedDB database.
// Web pages and the content script that runs on them cannot open it, because IndexedDB
// is scoped to the extension origin. Only the background worker and the options page can.
(function (g) {
  const DB_NAME = "wt-secrets";
  const STORE = "kv";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request ? request.result : undefined);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  g.Secrets = {
    get: (key) => run("readonly", (s) => s.get(key)),
    set: (key, value) => run("readwrite", (s) => s.put(value, key)),
    remove: (key) => run("readwrite", (s) => s.delete(key)),
    // Versions before 0.6.0 kept the key in chrome.storage.local, which content scripts can read.
    // Copy it into the private store first, and only then delete the old copy.
    async migrate() {
      const old = await chrome.storage.local.get("apiKey");
      if (old.apiKey) {
        await g.Secrets.set("apiKey", old.apiKey);
        await chrome.storage.local.remove("apiKey");
      }
    }
  };
})(self);
