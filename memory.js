// Translation memory. Every Korean line the extension has translated is kept on this computer, so a later
// line that looks similar can be shown to the local translation model as an example of the wording to reuse.
// Nothing here is sent anywhere by itself. It only joins the prompt of a request the reader already made.
(function (g) {
  const KEY = "tm";
  const MAX = 3000;
  const HANGUL = /[가-힣]/;

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // Character pairs of the line, without spaces and punctuation. Similar lines share many of them.
  function grams(s) {
    const t = String(s || "").replace(/[\s.,!?~…'"“”‘’]/g, "");
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    if (t.length === 1) out.add(t);
    return out;
  }

  function similarity(a, b) {
    if (!a.size || !b.size) return 0;
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    return n / (a.size + b.size - n);
  }

  async function load() {
    try {
      const r = await chrome.storage.local.get(KEY);
      return Array.isArray(r[KEY]) ? r[KEY] : [];
    } catch (e) {
      return [];
    }
  }

  // pairs: [{ko, en}]. A line seen before in the same series keeps its newest wording.
  async function add(series, pairs) {
    const list = await load();
    const index = new Map(list.map((e, i) => [e.s + "|" + e.ko, i]));
    let changed = false;
    for (const p of pairs) {
      const ko = squash(p && p.ko).slice(0, 200);
      const en = squash(p && p.en).slice(0, 300);
      if (!ko || !en || !HANGUL.test(ko)) continue;
      const k = series + "|" + ko;
      if (index.has(k)) {
        if (list[index.get(k)].en !== en) {
          list[index.get(k)].en = en;
          changed = true;
        }
      } else {
        index.set(k, list.length);
        list.push({ s: series, ko, en });
        changed = true;
      }
    }
    if (!changed) return;
    try {
      await chrome.storage.local.set({ [KEY]: list.length > MAX ? list.slice(list.length - MAX) : list });
    } catch (e) {
      /* ignore, memory is a convenience */
    }
  }

  // Up to k earlier lines of this series (and the reader's own corrections) that resemble this one.
  // The reader's corrections come first, since those are wordings they chose themselves.
  function find(list, corrections, series, ko, k) {
    const q = squash(ko);
    const want = grams(q);
    if (!want.size) return [];
    const scored = [];
    for (const e of list) {
      if (e.s !== series || e.ko === q) continue;
      const s = similarity(want, grams(e.ko));
      if (s >= 0.5) scored.push({ ko: e.ko, en: e.en, s, user: 0 });
    }
    for (const [cko, cen] of Object.entries(corrections || {})) {
      if (cko === q) continue;
      const s = similarity(want, grams(cko));
      if (s >= 0.5) scored.push({ ko: cko, en: cen, s, user: 1 });
    }
    scored.sort((a, b) => b.user - a.user || b.s - a.s);
    const seen = new Set();
    const out = [];
    for (const e of scored) {
      if (seen.has(e.ko)) continue;
      seen.add(e.ko);
      out.push({ ko: e.ko, en: e.en });
      if (out.length >= k) break;
    }
    return out;
  }

  async function clear() {
    const n = (await load()).length;
    await chrome.storage.local.remove(KEY);
    return n;
  }

  g.TM = { load, add, find, clear, similarity, grams };
})(typeof self !== "undefined" ? self : this);
