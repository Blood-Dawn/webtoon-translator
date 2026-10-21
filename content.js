(() => {
  if (window.__ktInjected) return;
  window.__ktInjected = true;

  const MIN_WIDTH = 300;
  const MIN_NATURAL_HEIGHT = 100;
  const GAP = 30; // gray band between stitched panels
  const MAX_PANELS_PER_BATCH = 8;
  const MAX_STITCH_HEIGHT = 9000;
  const MIN_MS_BETWEEN_REQUESTS = 6000;
  const RATE_LIMIT_COOLDOWN_MS = 65000;
  const MAX_CORRECTIONS = 300;

  // Shared with ui.js (same isolated world).
  const MAX_GLOSSARY = 500;
  const MAX_PENDING = 100;
  const MAX_CHAPTERS_TRACKED = 30;
  const KT = (window.KT = { ui: null, settings: { batchSeconds: 10 }, corrections: {}, notes: "", glossary: [], editStats: {} });
  const settings = KT.settings;

  const state = {
    enabled: false,
    panels: new Map(), // src -> panel { img, src, status, key, dataUrl, source, boxes }
    pending: new Set(), // panels waiting for the next batch
    overlays: new Map(), // src -> { img, el, items, width, height, panel }
    sending: false,
    timer: null,
    flushAt: 0,
    lastSendAt: 0,
    cooldownUntil: 0
  };
  KT.state = state;

  const dbg = {
    tooSmall: 0,
    notLoaded: 0,
    cacheHits: 0,
    batches: 0,
    panelsSent: 0,
    error: 0,
    lastErr: "",
    lastBoxes: "-",
    lastBatch: "-"
  };
  KT.dbg = dbg;

  const safeColor = (c, fallback) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fallback);
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  KT.norm = norm;

  // Panels are cached by a fingerprint of their pixels, so the same panel is never
  // sent twice, even after a reload (blob: URLs change on every page load).
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 7) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36) + "-" + s.length;
  }

  // ---------- saved corrections (Korean line -> the reader's wording) ----------
  async function saveCorrections() {
    try {
      await chrome.storage.local.set({ corrections: KT.corrections });
    } catch (e) {
      console.warn("[webtoon-translator] could not save corrections", e);
    }
  }

  KT.addCorrection = (ko, en) => {
    const k = norm(ko);
    if (!k) return;
    delete KT.corrections[k];
    KT.corrections[k] = en;
    const keys = Object.keys(KT.corrections);
    if (keys.length > MAX_CORRECTIONS) delete KT.corrections[keys[0]];
    saveCorrections();
  };

  KT.removeCorrection = (ko) => {
    const k = norm(ko);
    if (k in KT.corrections) {
      delete KT.corrections[k];
      saveCorrections();
    }
  };

  function applyCorrections(list) {
    for (const b of list) {
      const fix = KT.corrections[norm(b.original)];
      if (fix && fix !== b.translation) {
        if (b.geminiText === undefined) b.geminiText = b.translation;
        b.translation = fix;
      }
    }
  }

  // ---------- glossary: names and terms the extension learns as you read ----------
  // Entries are grouped by the series id found in the page address. Reading is grouped by chapter path.
  KT.seriesKey = () => {
    const path = location.pathname;
    const m = path.match(/\/(?:content|title)\/(\d+)/) || path.match(/(\d{4,})/);
    return location.hostname + ":" + (m ? m[1] : "any");
  };
  KT.chapterKey = () => location.pathname;

  async function saveGlossary() {
    try {
      await chrome.storage.local.set({ glossary: KT.glossary });
    } catch (e) {
      console.warn("[webtoon-translator] could not save glossary", e);
    }
  }
  KT.saveGlossary = saveGlossary;

  // Gemini's suggestions wait here for the reader's review. They are never sent back until approved.
  function learnTerms(terms) {
    const series = KT.seriesKey();
    let added = 0;
    for (const t of terms || []) {
      const ko = norm(t.ko);
      if (!ko) continue;
      if (KT.glossary.some((g) => g.ko === ko && (g.series === series || g.series === ""))) continue;
      KT.glossary.push({ ko, en: norm(t.en), type: t.type === "character" ? "character" : "term", gender: t.gender || "", status: "pending", series, n: 0, t: Date.now() });
      added++;
    }
    if (!added) return;
    const pending = KT.glossary.filter((g) => g.status === "pending");
    if (pending.length > MAX_PENDING) {
      const drop = new Set(pending.slice(0, pending.length - MAX_PENDING));
      KT.glossary = KT.glossary.filter((g) => !drop.has(g));
    }
    if (KT.glossary.length > MAX_GLOSSARY) KT.glossary = KT.glossary.filter((g) => g.status === "approved").concat(KT.glossary.filter((g) => g.status !== "approved")).slice(0, MAX_GLOSSARY);
    saveGlossary();
  }

  // An approved entry counts as used when its Korean text shows up in a batch, which ranks it for later prompts.
  function countUsage(bubbles) {
    const text = bubbles.map((b) => b.original || "").join("\n");
    const series = KT.seriesKey();
    let changed = false;
    for (const g of KT.glossary) {
      if (g.status === "approved" && (g.series === series || g.series === "") && text.includes(g.ko)) {
        g.n = (g.n || 0) + 1;
        g.t = Date.now();
        changed = true;
      }
    }
    if (changed) saveGlossary();
  }

  // The reader's own edits per chapter. Fewer edits over time is the sign that the glossary is working.
  KT.noteEdit = async () => {
    const k = KT.chapterKey();
    KT.editStats[k] = (KT.editStats[k] || 0) + 1;
    const keys = Object.keys(KT.editStats);
    if (keys.length > MAX_CHAPTERS_TRACKED) delete KT.editStats[keys[0]];
    try {
      await chrome.storage.local.set({ editStats: KT.editStats });
    } catch (e) {
      /* ignore */
    }
  };

  KT.learnText = () => {
    const series = KT.seriesKey();
    const mine = KT.glossary.filter((g) => g.series === series || g.series === "");
    const approved = mine.filter((g) => g.status === "approved").length;
    const pending = mine.filter((g) => g.status === "pending").length;
    const edits = Object.values(KT.editStats).slice(-4);
    return (
      "glossary: " + approved + " approved, " + pending + " waiting for review\n" +
      "your edits in the last chapters (newest last): " + (edits.length ? edits.join(", ") : "none yet") + "\n" +
      "this chapter: " + (KT.editStats[KT.chapterKey()] || 0) + " edits"
    );
  };

  KT.commitPanel = async (p) => {
    if (!p || !p.key) return;
    KT.noteEdit();
    try {
      await chrome.storage.local.set({ [p.key]: p.boxes });
    } catch (e) {
      console.warn("[webtoon-translator] could not save panel edits", e);
    }
  };

  KT.clearCache = async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("c:"));
    await chrome.storage.local.remove(keys);
    return keys.length;
  };

  // ---------- UI ----------
  const btn = document.createElement("button");
  btn.textContent = "EN";
  btn.title = "Translate webtoon (Alt+T)";
  Object.assign(btn.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "none",
    font: "700 14px Arial, sans-serif",
    cursor: "pointer",
    zIndex: "2147483647",
    boxShadow: "0 2px 8px rgba(0,0,0,.4)",
    color: "#fff"
  });

  function paintButton() {
    btn.style.background = state.enabled ? "#1a73e8" : "#555";
    btn.style.opacity = state.enabled ? "1" : "0.7";
  }

  let toastTimer;
  function toast(msg) {
    let t = document.getElementById("kt-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "kt-toast";
      Object.assign(t.style, {
        position: "fixed",
        right: "16px",
        bottom: "124px",
        maxWidth: "320px",
        padding: "10px 12px",
        background: "rgba(20,20,20,.92)",
        color: "#fff",
        font: "13px/1.3 Arial, sans-serif",
        borderRadius: "8px",
        zIndex: "2147483647",
        display: "none"
      });
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.style.display = "none"), 6000);
  }
  KT.toast = toast;

  // ---------- overlay rendering ----------
  // box_2d is [ymin, xmin, ymax, xmax] on a 0-1000 scale relative to the panel.
  function geometry(b) {
    if (!Array.isArray(b.box_2d) || b.box_2d.length !== 4) return null;
    let [y1, x1, y2, x2] = b.box_2d.map(Number);
    if ([y1, x1, y2, x2].some((n) => Number.isNaN(n))) return null;
    const pad = 6;
    y1 = Math.max(0, y1 - pad);
    x1 = Math.max(0, x1 - pad);
    y2 = Math.min(1000, y2 + pad);
    x2 = Math.min(1000, x2 + pad);
    if (y2 <= y1 || x2 <= x1) return null;
    return [y1, x1, y2, x2];
  }

  function applyGeometry(it) {
    const g = geometry(it.b);
    if (!g) return;
    const [y1, x1, y2, x2] = g;
    it.box.style.left = x1 / 10 + "%";
    it.box.style.top = y1 / 10 + "%";
    it.box.style.width = (x2 - x1) / 10 + "%";
    it.box.style.height = (y2 - y1) / 10 + "%";
  }

  // b.fs is a manual font size, stored as a fraction of the panel width so it scales.
  function fitItem(o, it) {
    const { b, box, span } = it;
    box.style.overflow = b.fs ? "visible" : "hidden";
    const maxH = box.clientHeight - 2;
    const maxW = box.clientWidth - 2;
    if (maxH <= 0 || maxW <= 0) return;
    if (b.fs) {
      const w = o.width > 0 ? o.width : o.img.clientWidth;
      span.style.fontSize = Math.max(6, b.fs * w) + "px";
      return;
    }
    let size = Math.min(maxH * 0.8, 34);
    span.style.fontSize = size + "px";
    while (size > 7 && (span.offsetHeight > maxH || span.scrollWidth > maxW)) {
      size -= 1;
      span.style.fontSize = size + "px";
    }
  }

  function fit(o) {
    for (const it of o.items) fitItem(o, it);
  }

  KT.refit = (o, it) => fitItem(o, it);
  KT.relayout = (o, it) => {
    applyGeometry(it);
    fitItem(o, it);
  };

  function render(p) {
    const { img, src, boxes } = p;
    const old = state.overlays.get(src);
    if (old) old.el.remove();

    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", pointerEvents: "none", zIndex: "2147483000" });
    const o = { img, el, items: [], width: -1, height: -1, panel: p };

    for (const b of boxes) {
      if (!b.translation || !geometry(b)) continue;
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute",
        background: safeColor(b.bg, "#ffffff"),
        color: safeColor(b.fg, "#111111"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        overflow: "hidden",
        boxSizing: "border-box",
        padding: "1px 3px",
        borderRadius: "8px",
        pointerEvents: "auto",
        cursor: "pointer",
        fontFamily: '"Comic Neue","Comic Sans MS","Segoe UI",Arial,sans-serif',
        fontWeight: "700",
        lineHeight: "1.12"
      });
      const span = document.createElement("span");
      Object.assign(span.style, { display: "block", width: "100%", wordBreak: "break-word" });
      span.textContent = b.translation;
      box.title = (b.original || "") + "\nClick to edit, drag to move";
      box.appendChild(span);
      const grip = document.createElement("div");
      Object.assign(grip.style, {
        position: "absolute",
        right: "-5px",
        bottom: "-5px",
        width: "14px",
        height: "14px",
        background: "#2f6df6",
        border: "2px solid #fff",
        borderRadius: "50%",
        cursor: "nwse-resize",
        opacity: "0",
        boxShadow: "0 0 3px rgba(0,0,0,.6)"
      });
      grip.title = "Drag to resize";
      box.appendChild(grip);
      box.style.touchAction = "none";
      const it = { b, box, span, grip, editing: false };
      applyGeometry(it);
      box.addEventListener("mouseenter", () => (grip.style.opacity = "1"));
      box.addEventListener("mouseleave", () => {
        if (!it.editing) grip.style.opacity = "0";
      });

      // Drag the bubble to move it, or drag the blue dot to resize it.
      let dragged = false;
      box.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || !Array.isArray(b.box_2d)) return;
        const resizing = ev.target === grip;
        const sx = ev.clientX;
        const sy = ev.clientY;
        let start = null;
        let began = false;
        const move = (e) => {
          const dx = e.clientX - sx;
          const dy = e.clientY - sy;
          if (!began) {
            if (Math.abs(dx) + Math.abs(dy) < 5) return;
            began = true;
            dragged = true;
            if (KT.ui) KT.ui.openEditor({ panel: p, b, box, span, o, it });
            start = b.box_2d.map(Number);
          }
          const ux = (dx / r.width) * 1000;
          const uy = (dy / r.height) * 1000;
          const [y1, x1, y2, x2] = start;
          const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
          if (resizing) {
            b.box_2d = [y1, x1, Math.round(clamp(y2 + uy, y1 + 25, 1000)), Math.round(clamp(x2 + ux, x1 + 40, 1000))];
            KT.relayout(o, it);
          } else {
            const h = y2 - y1;
            const w = x2 - x1;
            const ny = clamp(y1 + uy, 0, 1000 - h);
            const nx = clamp(x1 + ux, 0, 1000 - w);
            b.box_2d = [Math.round(ny), Math.round(nx), Math.round(ny + h), Math.round(nx + w)];
            applyGeometry(it);
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
          if (began) {
            if (KT.ui && KT.ui.reposition) KT.ui.reposition();
            setTimeout(() => (dragged = false), 0);
          }
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
        ev.preventDefault();
        ev.stopPropagation();
      });
      box.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (dragged) return;
        if (ev.target === grip) return;
        if (KT.ui) KT.ui.openEditor({ panel: p, b, box, span, o, it });
      });
      el.appendChild(box);
      o.items.push(it);
    }

    document.documentElement.appendChild(el);
    state.overlays.set(src, o);
    place(o);
  }
  KT.rerender = (p) => {
    if (p && p.boxes) render(p);
  };

  function place(o) {
    const img = o.img;
    if (!img.isConnected) {
      o.el.remove();
      for (const [k, v] of state.overlays) if (v === o) state.overlays.delete(k);
      return;
    }
    const r = img.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) {
      o.el.style.display = "none";
      return;
    }
    o.el.style.display = state.enabled ? "" : "none";
    o.el.style.left = r.left + window.scrollX + "px";
    o.el.style.top = r.top + window.scrollY + "px";
    o.el.style.width = r.width + "px";
    o.el.style.height = r.height + "px";
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w !== o.width || h !== o.height) {
      o.width = w;
      o.height = h;
      fit(o);
    }
  }

  setInterval(() => {
    if (!state.enabled) return;
    for (const o of state.overlays.values()) place(o);
  }, 300);

  // ---------- reading panel pixels ----------
  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not decode the panel image"));
      i.src = dataUrl;
    });
  }

  async function readPanelPixels(img) {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return { dataUrl: c.toDataURL("image/jpeg", 0.92), source: img };
    } catch (e) {
      // Cross-origin image: let the extension download it with the right headers.
      const res = await chrome.runtime.sendMessage({ type: "fetchImage", url: img.currentSrc || img.src });
      if (!res || !res.ok) throw new Error((res && res.error) || "Could not read the panel image");
      return { dataUrl: res.dataUrl, source: await loadImageFromDataUrl(res.dataUrl) };
    }
  }

  // ---------- batching pipeline ----------
  async function preparePanel(p) {
    try {
      const px = await readPanelPixels(p.img);
      p.dataUrl = px.dataUrl;
      p.source = px.source;
      p.key = "c:h" + hashStr(px.dataUrl);
      const hit = (await chrome.storage.local.get(p.key))[p.key];
      if (hit !== undefined) {
        // Already translated before: show it for free, never send it again.
        p.status = "done";
        p.boxes = hit;
        p.dataUrl = null;
        p.source = null;
        dbg.cacheHits++;
        render(p);
        return;
      }
      p.status = "pending";
      state.pending.add(p);
      schedule();
    } catch (e) {
      p.status = "error";
      dbg.error++;
      dbg.lastErr = e.message || String(e);
      console.warn("[webtoon-translator] prepare failed", e);
    }
  }

  function enqueue(img) {
    const src = img.currentSrc || img.src;
    if (!src) return;
    const known = state.panels.get(src);
    if (known) {
      if (known.img !== img && !known.img.isConnected) {
        known.img = img;
        if (known.status === "done" && known.boxes) render(known);
      }
      return;
    }
    if (!img.complete || !img.naturalWidth) {
      dbg.notLoaded++;
      img.addEventListener("load", () => observeImg(img), { once: true });
      return;
    }
    if (img.clientWidth < MIN_WIDTH || img.naturalHeight < MIN_NATURAL_HEIGHT) {
      dbg.tooSmall++;
      return;
    }
    const p = { img, src, status: "prep", key: null, dataUrl: null, source: null, boxes: null };
    state.panels.set(src, p);
    preparePanel(p);
  }

  function schedule() {
    if (!state.enabled || state.timer || state.sending || state.pending.size === 0) return;
    const now = Date.now();
    const windowMs = Math.max(2, Number(settings.batchSeconds) || 10) * 1000;
    const at = Math.max(now + windowMs, state.lastSendAt + MIN_MS_BETWEEN_REQUESTS, state.cooldownUntil);
    state.flushAt = at;
    state.timer = setTimeout(() => {
      state.timer = null;
      state.flushAt = 0;
      flush();
    }, at - now);
  }

  function pickBatch() {
    const mid = window.innerHeight / 2;
    const dist = (p) => {
      const r = p.img.getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - mid);
    };
    const list = Array.from(state.pending).filter((p) => p.status === "pending" && p.img.isConnected);
    for (const p of Array.from(state.pending)) if (!list.includes(p)) state.pending.delete(p);
    list.sort((a, b) => dist(a) - dist(b)); // what you are reading goes first
    const chosen = [];
    let height = 0;
    for (const p of list) {
      const h = p.source ? p.source.naturalHeight : p.img.naturalHeight;
      if (chosen.length >= MAX_PANELS_PER_BATCH) break;
      if (chosen.length && height + h + GAP > MAX_STITCH_HEIGHT) continue;
      chosen.push(p);
      height += h + GAP;
    }
    chosen.sort((a, b) => (a.img.compareDocumentPosition(b.img) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return chosen;
  }

  function stitch(list) {
    const items = list.map((p) => ({ p, w: p.source.naturalWidth, h: p.source.naturalHeight }));
    const W = Math.max(...items.map((i) => i.w));
    const H = items.reduce((s, i) => s + i.h, 0) + GAP * (items.length - 1);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#5a5a5a";
    g.fillRect(0, 0, W, H);
    const layout = [];
    let y = 0;
    for (const it of items) {
      const x = Math.round((W - it.w) / 2);
      g.drawImage(it.p.source, x, y);
      layout.push({ p: it.p, x0: x, y0: y, w: it.w, h: it.h });
      y += it.h + GAP;
    }
    return { dataUrl: c.toDataURL("image/jpeg", 0.9), layout, W, H };
  }

  // Turns boxes in stitched-image coordinates back into per-panel coordinates.
  function splitBoxes(boxes, layout, W, H) {
    const out = layout.map(() => []);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    for (const b of boxes) {
      if (!Array.isArray(b.box_2d) || b.box_2d.length !== 4 || !b.translation) continue;
      const [ymin, xmin, ymax, xmax] = b.box_2d.map(Number);
      if ([ymin, xmin, ymax, xmax].some((n) => Number.isNaN(n))) continue;
      const Y1 = (ymin / 1000) * H;
      const Y2 = (ymax / 1000) * H;
      const X1 = (xmin / 1000) * W;
      const X2 = (xmax / 1000) * W;
      const cy = (Y1 + Y2) / 2;
      let best = 0;
      let bestD = Infinity;
      layout.forEach((L, i) => {
        const d = cy < L.y0 ? L.y0 - cy : cy > L.y0 + L.h ? cy - (L.y0 + L.h) : 0;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const L = layout[best];
      const ly1 = ((clamp(Y1, L.y0, L.y0 + L.h) - L.y0) / L.h) * 1000;
      const ly2 = ((clamp(Y2, L.y0, L.y0 + L.h) - L.y0) / L.h) * 1000;
      const lx1 = ((clamp(X1, L.x0, L.x0 + L.w) - L.x0) / L.w) * 1000;
      const lx2 = ((clamp(X2, L.x0, L.x0 + L.w) - L.x0) / L.w) * 1000;
      if (ly2 - ly1 < 4 || lx2 - lx1 < 4) continue;
      out[best].push(Object.assign({}, b, { box_2d: [Math.round(ly1), Math.round(lx1), Math.round(ly2), Math.round(lx2)] }));
    }
    return out;
  }

  async function flush() {
    if (!state.enabled || state.sending) return;
    const chosen = pickBatch();
    if (!chosen.length) return;
    state.sending = true;
    state.lastSendAt = Date.now();
    for (const p of chosen) {
      p.status = "sending";
      state.pending.delete(p);
    }
    try {
      const { dataUrl, layout, W, H } = stitch(chosen);
      dbg.lastBatch = chosen.length + " panels, " + W + "x" + H + "px";
      console.log("[webtoon-translator] sending batch:", dbg.lastBatch);
      const res = await chrome.runtime.sendMessage({
        type: "translate",
        url: "batch-" + chosen.length,
        dataUrl,
        panels: chosen.length,
        series: KT.seriesKey()
      });
      if (!res || !res.ok) {
        const err = new Error((res && res.error) || "Translation failed");
        err.code = res && res.code;
        throw err;
      }
      dbg.batches++;
      dbg.panelsSent += chosen.length;
      countUsage(res.boxes);
      learnTerms(res.terms);
      const perPanel = splitBoxes(res.boxes, layout, W, H);
      perPanel.forEach(applyCorrections); // the reader's saved wording wins over Gemini's
      const toStore = {};
      layout.forEach((L, i) => {
        toStore[L.p.key] = perPanel[i];
      });
      try {
        await chrome.storage.local.set(toStore);
      } catch (e) {
        console.warn("[webtoon-translator] could not save cache", e);
      }
      layout.forEach((L, i) => {
        const p = L.p;
        p.status = "done";
        p.boxes = perPanel[i];
        p.dataUrl = null;
        p.source = null;
        render(p);
      });
      dbg.lastBoxes = res.boxes.length + " text boxes in " + chosen.length + " panels";
      console.log("[webtoon-translator] result:", dbg.lastBoxes);
    } catch (e) {
      dbg.error++;
      dbg.lastErr = e.message || String(e);
      console.warn("[webtoon-translator] batch failed", e);
      const limited = /rate limit|429|quota/i.test(dbg.lastErr);
      for (const p of chosen) {
        if (p.status !== "sending") continue;
        if (limited) {
          p.status = "pending";
          state.pending.add(p);
        } else {
          p.status = "error";
        }
      }
      if (limited) {
        state.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        toast("Gemini is rate limiting. Retrying on its own in about a minute.");
      } else {
        toast(dbg.lastErr);
      }
      if (e.code === "NO_KEY") chrome.runtime.sendMessage({ type: "openOptions" });
    } finally {
      state.sending = false;
      schedule();
    }
  }

  // ---------- observing images as they scroll into range ----------
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && state.enabled) enqueue(e.target);
      }
    },
    { rootMargin: "600px 0px 1800px 0px" } // look further ahead of the scroll direction
  );

  function observeImg(img) {
    io.unobserve(img);
    io.observe(img);
  }

  function scan() {
    document.querySelectorAll("img").forEach(observeImg);
  }

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes" && m.target.tagName === "IMG") {
        observeImg(m.target);
        continue;
      }
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === "IMG") observeImg(n);
        else if (n.querySelectorAll) n.querySelectorAll("img").forEach(observeImg);
      });
    }
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });

  // ---------- status text for the GUI ----------
  KT.statsText = () => {
    let done = 0;
    for (const p of state.panels.values()) if (p.status === "done") done++;
    const now = Date.now();
    let next = "no batch waiting";
    if (state.sending) next = "sending to Gemini now";
    else if (state.flushAt) next = "next send in " + Math.max(0, Math.round((state.flushAt - now) / 1000)) + "s";
    if (state.cooldownUntil > now) next += " (rate limit pause " + Math.round((state.cooldownUntil - now) / 1000) + "s)";
    return (
      "panels found: " + state.panels.size + "   translated: " + done + "\n" +
      "waiting for batch: " + state.pending.size + "   " + next + "\n" +
      "from cache (free): " + dbg.cacheHits + "\n" +
      "requests sent: " + dbg.batches + "   panels sent: " + dbg.panelsSent + "\n" +
      "last batch: " + dbg.lastBatch + "\n" +
      "last result: " + dbg.lastBoxes + "\n" +
      "errors: " + dbg.error + "   last error: " + (dbg.lastErr || "none") + "\n" +
      KT.learnText()
    );
  };

  // ---------- on / off ----------
  async function setEnabled(on) {
    state.enabled = on;
    try {
      await chrome.storage.local.set({ enabled: on });
    } catch (e) {
      /* extension was reloaded; ignore */
    }
    paintButton();
    for (const o of state.overlays.values()) o.el.style.display = on ? "" : "none";
    if (on) {
      // Panels that failed earlier get another go; finished ones stay finished.
      for (const [k, p] of Array.from(state.panels)) if (p.status === "error") state.panels.delete(k);
      scan();
      schedule();
    } else {
      clearTimeout(state.timer);
      state.timer = null;
      state.flushAt = 0;
    }
  }
  KT.setEnabled = setEnabled;

  btn.addEventListener("click", () => setEnabled(!state.enabled));
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyT") setEnabled(!state.enabled);
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.batchSeconds) settings.batchSeconds = Number(changes.batchSeconds.newValue) || 10;
      if (changes.notes) KT.notes = changes.notes.newValue || "";
      if (changes.corrections) KT.corrections = changes.corrections.newValue || {};
      if (changes.glossary) KT.glossary = changes.glossary.newValue || [];
      if (changes.editStats) KT.editStats = changes.editStats.newValue || {};
    });
  } catch (e) {
    /* ignore */
  }

  (async () => {
    let saved = false;
    try {
      const cfg = await chrome.storage.local.get(["enabled", "batchSeconds", "notes", "corrections", "glossary", "editStats"]);
      KT.glossary = Array.isArray(cfg.glossary) ? cfg.glossary : [];
      KT.editStats = cfg.editStats || {};
      saved = !!cfg.enabled;
      settings.batchSeconds = Number(cfg.batchSeconds) || 10;
      KT.notes = cfg.notes || "";
      KT.corrections = cfg.corrections || {};
    } catch (e) {
      /* ignore */
    }
    document.documentElement.appendChild(btn);
    await setEnabled(saved);
  })();
})();
