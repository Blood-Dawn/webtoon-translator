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
  const KT = (window.KT = { ui: null, settings: { batchSeconds: 10, chapterMode: false, font: "comic", textScale: 1 }, corrections: {}, notes: "", glossary: [], editStats: {}, MOVE_LIMIT: 3000 });
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
    cooldownUntil: 0,
    strip: null, // the clean strip view while it is shown
    seq: 0,
    doneAt: 0
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
    lastBatch: "-",
    durations: [] // seconds per panel for recent batches, for the speed and time left estimates
  };
  KT.dbg = dbg;

  const FONTS = {
    comic: '"Comic Neue","Comic Sans MS","Segoe UI",Arial,sans-serif',
    clean: '"Segoe UI",Roboto,Arial,sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    rounded: '"Nunito","Varela Round","Trebuchet MS",Arial,sans-serif'
  };
  const fontStack = () => FONTS[settings.font] || FONTS.comic;

  const safeColor = (c, fallback) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fallback);
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  KT.norm = norm;

  // Bubble looks. Choosing one in the editor fills in the colors, which can then be changed one by one.
  const PRESETS = {
    speech: { label: "Speech", bg: "#ffffff", fg: "#111111", ol: "", radius: "8px", italic: false, upper: false, weight: "700" },
    thought: { label: "Thought", bg: "#ffffff", fg: "#2a2a2a", ol: "", radius: "28px", italic: true, upper: false, weight: "600" },
    shout: { label: "Shout", bg: "#ffffff", fg: "#111111", ol: "", radius: "4px", italic: false, upper: true, weight: "900" },
    narration: { label: "Narration", bg: "#fff4c2", fg: "#222222", ol: "", radius: "2px", italic: false, upper: false, weight: "600" },
    sfx: { label: "Sound effect", bg: "transparent", fg: "#111111", ol: "#ffffff", radius: "0", italic: true, upper: true, weight: "900" }
  };
  KT.PRESETS = PRESETS;

  function styleBox(it) {
    const { b, box, span } = it;
    const P = PRESETS[b.preset] || PRESETS.speech;
    box.style.background = b.bg === "transparent" ? "transparent" : safeColor(b.bg, P.bg === "transparent" ? "#ffffff" : P.bg);
    box.style.color = safeColor(b.fg, P.fg);
    box.style.borderRadius = P.radius;
    box.style.fontWeight = P.weight;
    box.style.fontStyle = P.italic ? "italic" : "normal";
    span.style.textTransform = P.upper ? "uppercase" : "none";
    const ol = safeColor(b.ol, "");
    span.style.textShadow = ol
      ? [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5], [-1, -1], [1, 1], [-1, 1], [1, -1]].map(([x, y]) => x + "px " + y + "px 0 " + ol).join(",")
      : "none";
  }
  KT.restyle = (o, it) => {
    styleBox(it);
    fitItem(o, it);
  };

  // Every bubble on the page in reading order, for next and previous, and for search and replace.
  KT.allItems = () => {
    const out = [];
    for (const o of state.overlays.values()) {
      if (!o.img.isConnected) continue;
      const top = o.img.getBoundingClientRect().top + window.scrollY;
      for (const it of o.items) {
        const g = geometry(it.b) || [0, 0];
        out.push({ y: top + (g[0] / 1000) * o.img.clientHeight, x: g[1], c: { panel: o.panel, b: it.b, box: it.box, span: it.span, o, it } });
      }
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out.map((e) => e.c);
  };

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

  // A short "story so far" per series, written by the reader or drafted by a model, sent with every request.
  KT.summaries = {};
  Object.defineProperty(KT, "summary", { get: () => KT.summaries[KT.seriesKey()] || "" });
  KT.saveSummary = async (text) => {
    const k = KT.seriesKey();
    const t = String(text || "").trim().slice(0, 1500);
    if (t) KT.summaries[k] = t;
    else delete KT.summaries[k];
    const keys = Object.keys(KT.summaries);
    if (keys.length > 40) delete KT.summaries[keys[0]];
    try {
      await chrome.storage.local.set({ summaries: KT.summaries });
    } catch (e) {
      /* ignore */
    }
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
    // Padding stops at the panel edge for boxes inside the panel. A box the reader moved outside the
    // panel keeps its position, so it can sit over the neighbouring panel.
    const padLo = (v) => (v < 0 ? v : Math.max(0, v - pad));
    const padHi = (v) => (v > 1000 ? v : Math.min(1000, v + pad));
    y1 = padLo(y1);
    x1 = padLo(x1);
    y2 = padHi(y2);
    x2 = padHi(x2);
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
      span.style.fontSize = Math.max(6, b.fs * w * settings.textScale) + "px";
      return;
    }
    // Binary search for the largest font that still fits, so a box that is resized always refills well.
    const fits = (s) => {
      span.style.fontSize = s + "px";
      return span.offsetHeight <= maxH && span.scrollWidth <= maxW;
    };
    let hi = Math.max(8, Math.min(maxH * 0.9, Math.max(34, (o.width > 0 ? o.width : o.img.clientWidth) * 0.07)));
    let lo = 7;
    if (fits(hi)) {
      if (settings.textScale !== 1) span.style.fontSize = Math.max(7, hi * settings.textScale) + "px";
      return;
    }
    while (hi - lo > 0.5) {
      const mid = (hi + lo) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    span.style.fontSize = Math.max(7, lo * settings.textScale) + "px";
  }

  // Readers often return a tall, narrow box around a bubble's text. English wraps badly in that shape,
  // so a new box is reshaped once to a wider rectangle around the same center. Boxes the reader has
  // already moved or resized (b.shaped is set by any edit) are left exactly as they are.
  function reshape(o, it) {
    const { b, box, span } = it;
    if (b.shaped || b.fs) return;
    const pw = o.img.clientWidth;
    const ph = o.img.clientHeight;
    const text = String(b.translation || "");
    if (!pw || !ph || !text || !Array.isArray(b.box_2d)) return;
    b.shaped = true;
    const [y1, x1, y2, x2] = b.box_2d.map(Number);
    // Gemini's boxes already follow the bubble. Only tall, narrow boxes from local models are reshaped.
    if (!KT.settings.localReader || ((y2 - y1) / 1000) * ph < ((x2 - x1) / 1000) * pw * 1.0) return;
    const area = Math.max(((x2 - x1) / 1000) * pw * (((y2 - y1) / 1000) * ph), 2500);
    const chars = Math.max(text.length, 4);
    const scale = Math.max(0.6, Math.min(1.6, pw / 700));
    const size = Math.max(11 * scale, Math.min(30 * scale, Math.sqrt(area / (chars * 0.78))));
    const need = chars * 0.78 * size * size;
    let w = Math.min(pw * 0.92, Math.max(size * 6, Math.sqrt(need * 2.2)));
    const saved = { w: box.style.width, h: box.style.height, l: box.style.left, t: box.style.top };
    span.style.fontSize = size + "px";
    let h = 0;
    for (let i = 0; i < 5; i++) {
      box.style.width = w + "px";
      box.style.height = "auto";
      h = box.offsetHeight + 2;
      if (h / w <= 0.62 || w >= pw * 0.92) break;
      w = Math.min(pw * 0.92, w * 1.15);
    }
    box.style.width = saved.w;
    box.style.height = saved.h;
    // Same center as before, nudged back inside the panel, minus the padding that geometry() adds again.
    const cx = ((x1 + x2) / 2 / 1000) * pw;
    const cy = ((y1 + y2) / 2 / 1000) * ph;
    const left = Math.max(0, Math.min(pw - w, cx - w / 2));
    const top = Math.max(0, Math.min(ph - h, cy - h / 2));
    const pad = 6;
    const nb = [(top / ph) * 1000 + pad, (left / pw) * 1000 + pad, ((top + h) / ph) * 1000 - pad, ((left + w) / pw) * 1000 - pad];
    if (nb[2] > nb[0] + 5 && nb[3] > nb[1] + 5) {
      b.box_2d = nb.map(Math.round);
      applyGeometry(it);
    }
  }

  function fit(o) {
    for (const it of o.items) {
      reshape(o, it);
      fitItem(o, it);
    }
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
        fontFamily: fontStack(),
        fontWeight: "700",
        lineHeight: "1.12"
      });
      const span = document.createElement("span");
      Object.assign(span.style, { display: "block", width: "100%", wordBreak: "break-word" });
      span.textContent = b.translation;
      box.title = (b.original || "") + "\nClick to edit, drag to move";
      box.appendChild(span);
      styleBox({ b, box, span });
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
            b.shaped = true;
            if (KT.ui) KT.ui.openEditor({ panel: p, b, box, span, o, it });
            start = b.box_2d.map(Number);
          }
          const ux = (dx / r.width) * 1000;
          const uy = (dy / r.height) * 1000;
          const [y1, x1, y2, x2] = start;
          const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
          if (resizing) {
            b.box_2d = [y1, x1, Math.round(clamp(y2 + uy, y1 + 25, 1000 + KT.MOVE_LIMIT)), Math.round(clamp(x2 + ux, x1 + 40, 1000 + KT.MOVE_LIMIT))];
            KT.relayout(o, it);
          } else {
            const h = y2 - y1;
            const w = x2 - x1;
            // No panel edge limit: the box can go anywhere within a few panel heights of its own panel.
            const ny = clamp(y1 + uy, -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT - h);
            const nx = clamp(x1 + ux, -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT - w);
            b.box_2d = [Math.round(ny), Math.round(nx), Math.round(ny + h), Math.round(nx + w)];
            applyGeometry(it);
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
          if (began) {
            if (KT.ui && KT.ui.record) KT.ui.record();
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
    o.el.style.display = state.enabled && !state.peek ? "" : "none";
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
      // Chapter mode needs the pixels again to build the strip, even for panels that are already translated.
      if (settings.chapterMode) p.keep = px.dataUrl;
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

  const docY = (img) => Math.round(img.getBoundingClientRect().top + window.scrollY);
  const orderCmp = (a, b) => a.pos - b.pos || a.seq - b.seq;

  function enqueue(img) {
    if (img.dataset && img.dataset.ktStrip) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    const known = state.panels.get(src);
    if (known) {
      if (known.strip) return;
      if (known.img !== img && !known.img.isConnected) {
        known.img = img;
        if (known.status === "done" && known.boxes) render(known);
        // A panel that was waiting when its image went away is queued again instead of being forgotten.
        if (known.status === "pending" || known.status === "error") {
          known.status = "pending";
          state.pending.add(known);
          schedule();
        }
      }
      if (known.img.isConnected) known.pos = docY(known.img);
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
    const p = { img, src, status: "prep", key: null, dataUrl: null, source: null, boxes: null, keep: null, pos: docY(img), seq: state.seq++, tries: 0 };
    state.panels.set(src, p);
    preparePanel(p);
  }

  // Chapter mode collects panels first. Nothing is sent until the strip is built.
  const holding = () => !!settings.chapterMode && !state.strip;

  function schedule() {
    if (!state.enabled || state.timer || state.sending || state.pending.size === 0) return;
    if (holding()) return; // chapter mode waits for the reader to press the button
    const now = Date.now();
    // A model on this computer has no request limits, so the wait can go down to nothing.
    const secs = Number(settings.batchSeconds);
    const windowMs = (settings.localReader ? (Number.isFinite(secs) ? Math.max(0, secs) : 0) : Math.max(2, secs || 10)) * 1000;
    const gap = settings.localReader ? 0 : MIN_MS_BETWEEN_REQUESTS;
    const at = Math.max(now + windowMs, state.lastSendAt + gap, state.cooldownUntil);
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
    // A panel whose image is not on the page right now stays queued and is picked up when it is back.
    const list = Array.from(state.pending).filter((p) => p.status === "pending" && p.img.isConnected);
    for (const p of Array.from(state.pending)) if (p.status !== "pending") state.pending.delete(p);
    list.sort((a, b) => dist(a) - dist(b)); // what you are reading goes first
    const chosen = [];
    let height = 0;
    for (const p of list) {
      const h = p.source ? p.source.naturalHeight : p.img.naturalHeight;
      // A local vision model sees a small, fixed size picture, so it gets one panel at a time.
      if (chosen.length >= (settings.localReader ? 1 : MAX_PANELS_PER_BATCH)) break;
      if (chosen.length && height + h + GAP > (settings.localReader ? 3000 : MAX_STITCH_HEIGHT)) continue;
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

  // Optional: Chrome's own on-device translator (Chrome 138 or newer) rewrites each Korean line.
  // It runs inside the browser and sends nothing anywhere. If it is missing or refuses, the reader's wording stays.
  let chromeTr = null;
  let chromeWarned = false;
  async function chromeTranslate(boxes) {
    try {
      if (typeof Translator === "undefined") throw new Error("this Chrome has no built-in translator.");
      if (!chromeTr) {
        const pair = { sourceLanguage: "ko", targetLanguage: "en" };
        if ((await Translator.availability(pair)) === "unavailable") throw new Error("Chrome cannot translate Korean here.");
        chromeTr = await Translator.create(pair);
      }
      for (const b of boxes) {
        if (!/[가-힣]/.test(b.original || "")) continue;
        try {
          const t = await chromeTr.translate(b.original);
          if (t && t.trim()) b.translation = t.trim();
        } catch (e) {
          /* keep the reader's wording for this line */
        }
      }
    } catch (e) {
      if (!chromeWarned) toast("Chrome's built-in translator was not used: " + (e.message || e));
      chromeWarned = true;
    }
  }

  async function flush() {
    if (!state.enabled || state.sending || holding()) return;
    const chosen = pickBatch();
    if (!chosen.length) return;
    state.sending = true;
    state.lastSendAt = Date.now();
    const startedAt = Date.now();
    state.batchStart = startedAt;
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
      dbg.durations.push((Date.now() - startedAt) / 1000 / chosen.length);
      if (dbg.durations.length > 12) dbg.durations.shift();
      if (res.warning) toast(res.warning);
      if (settings.translator === "chrome") await chromeTranslate(res.boxes);
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
        if (!p.strip) p.source = null;
        render(p);
      });
      state.doneAt = Date.now();
      dbg.lastBoxes = res.boxes.length + " text boxes in " + chosen.length + " panels";
      console.log("[webtoon-translator] result:", dbg.lastBoxes);
    } catch (e) {
      dbg.error++;
      dbg.lastErr = e.message || String(e);
      console.warn("[webtoon-translator] batch failed", e);
      // A used-up daily quota will not clear in a minute, so it is reported instead of retried.
      const limited = e.code !== "DAILY_QUOTA" && /rate limit|429|quota/i.test(dbg.lastErr);
      for (const p of chosen) {
        if (p.status !== "sending") continue;
        if (limited) {
          p.status = "pending";
          state.pending.add(p);
        } else if (e.code !== "DAILY_QUOTA" && e.code !== "NO_KEY" && (p.tries || 0) < 2) {
          // One or two more tries for a panel that failed for a passing reason.
          p.tries = (p.tries || 0) + 1;
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

  // ---------- progress: how long until each panel on screen is translated ----------
  const avgSecs = () => (dbg.durations.length ? dbg.durations.reduce((a, b) => a + b, 0) / dbg.durations.length : 0);
  const fmtSecs = (s) => {
    s = Math.max(1, Math.round(s));
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60);
    return m + " min" + (s % 60 ? " " + (s % 60) + " s" : "");
  };

  // Seconds until each queued panel is finished, in the order they will be sent (closest to the middle of the screen first).
  function etaMap() {
    const avg = avgSecs();
    const now = Date.now();
    const mid = window.innerHeight / 2;
    const dist = (p) => {
      const r = p.img.getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - mid);
    };
    const queue = Array.from(state.pending).filter((p) => p.status === "pending" && p.img.isConnected).sort((a, b) => dist(a) - dist(b));
    const rem = state.sending && state.batchStart ? Math.max(0, avg - (now - state.batchStart) / 1000) : 0;
    let wait = 0;
    if (!state.sending && state.flushAt) wait = Math.max(0, (state.flushAt - now) / 1000);
    if (state.cooldownUntil > now) wait = Math.max(wait, (state.cooldownUntil - now) / 1000);
    const m = new Map();
    queue.forEach((p, i) => m.set(p, { pos: i + 1, secs: avg ? rem + wait + (i + 1) * avg : 0 }));
    return { m, avg, rem, queued: queue.length };
  }

  function badgeText(p, info) {
    if (p.status === "done") return "";
    if (p.status === "prep") return "Reading this panel";
    if (p.status === "error") return "Failed, retrying when you scroll back";
    if (p.status === "sending") {
      const avg = avgSecs();
      if (!avg) return "Translating this panel now";
      const left = avg - (Date.now() - state.batchStart) / 1000;
      return left > 1 ? "Translating now, about " + fmtSecs(left) + " left" : "Translating now, almost done";
    }
    if (!state.enabled || holding()) return "";
    const q = info.m.get(p);
    if (!q) return "Waiting";
    if (!info.avg) return "Queued, number " + q.pos + ". Timing starts after the first panel.";
    return "Queued, number " + q.pos + ". Ready in about " + fmtSecs(q.secs);
  }

  const badges = new Map(); // panel -> element
  const pill = document.createElement("div");
  Object.assign(pill.style, {
    position: "fixed", right: "16px", bottom: "72px", width: "250px", padding: "8px 10px", background: "rgba(20,20,20,.92)", color: "#fff",
    font: "12px/1.35 Arial, sans-serif", borderRadius: "8px", zIndex: "2147483647", display: "none", pointerEvents: "none"
  });
  const pillText = document.createElement("div");
  const pillBar = document.createElement("div");
  const pillFill = document.createElement("div");
  Object.assign(pillBar.style, { height: "6px", background: "#444", borderRadius: "3px", marginTop: "6px", overflow: "hidden" });
  Object.assign(pillFill.style, { height: "100%", width: "0%", background: "#4ade80", transition: "width .3s" });
  pillBar.appendChild(pillFill);
  const mkBtn = (label, bg) => {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, { display: "none", width: "100%", marginTop: "6px", padding: "6px 8px", border: "none", borderRadius: "6px", background: bg, color: "#fff", font: "600 12px Arial, sans-serif", cursor: "pointer", pointerEvents: "auto" });
    return b;
  };
  const buildBtn = mkBtn("Build strip and translate", "#1a73e8");
  const exitBtn = mkBtn("Back to the original page", "#555");
  const retryBtn = mkBtn("Retry failed panels", "#b45309");
  const redoBtn = mkBtn("Redo an area", "#2f6f4f");
  buildBtn.addEventListener("click", () => buildStrip());
  exitBtn.addEventListener("click", () => exitStrip());
  retryBtn.addEventListener("click", () => retryFailed());
  redoBtn.addEventListener("click", () => startPick());
  pill.append(pillText, pillBar, buildBtn, retryBtn, redoBtn, exitBtn);

  function progressTick() {
    if (!pill.isConnected) document.documentElement.appendChild(pill);
    if (!state.enabled) {
      pill.style.display = "none";
      for (const el of badges.values()) el.remove();
      badges.clear();
      return;
    }
    const info = etaMap();
    let total = 0;
    let done = 0;
    let working = 0;
    for (const p of state.panels.values()) {
      if (p.strip && !state.strip) continue;
      total++;
      if (p.status === "done") done++;
      else if (p.status !== "error") working++;
    }
    pill.style.display = total ? "block" : "none";
    let failed = 0;
    for (const p of state.panels.values()) if (p.status === "error") failed++;
    const collecting = holding();
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 60;
    const left = working && info.avg ? ", about " + fmtSecs(working * info.avg + info.rem) + " left" : "";
    if (collecting) {
      pillText.textContent = total + " panels collected. " + (atEnd ? "You reached the end of the page. Press the button to build the strip and translate." : "Keep scrolling until the whole chapter has loaded, then press the button.");
      pillFill.style.width = "0%";
    } else {
      pillText.textContent = done + " of " + total + " panels translated" + (info.avg ? ", " + info.avg.toFixed(1) + " s per panel" : ", measuring speed") + left + (state.strip && working === 0 && failed === 0 && total ? ". All done." : "");
      pillFill.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    }
    buildBtn.style.display = collecting && total ? "block" : "none";
    buildBtn.textContent = state.building ? "Building the strip" : "Build strip and translate";
    buildBtn.disabled = !!state.building;
    exitBtn.style.display = state.strip ? "block" : "none";
    retryBtn.style.display = failed ? "block" : "none";
    retryBtn.textContent = "Retry " + failed + " failed panel" + (failed === 1 ? "" : "s");
    redoBtn.style.display = collecting ? "none" : "block";

    const vh = window.innerHeight;
    const live = new Set();
    for (const p of state.panels.values()) {
      if (p.status === "done" || !p.img || !p.img.isConnected) continue;
      const r = p.img.getBoundingClientRect();
      if (r.width < 10 || r.bottom < 40 || r.top > vh - 40) continue;
      const text = badgeText(p, info);
      if (!text) continue;
      live.add(p);
      let el = badges.get(p);
      if (!el) {
        el = document.createElement("div");
        Object.assign(el.style, {
          position: "fixed", padding: "6px 10px", background: "rgba(20,20,20,.88)", color: "#fff", font: "600 13px/1.3 Arial, sans-serif",
          borderRadius: "999px", zIndex: "2147483200", pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,.4)", maxWidth: "70vw"
        });
        document.documentElement.appendChild(el);
        badges.set(p, el);
      }
      el.textContent = text;
      el.style.left = Math.max(8, r.left + 8) + "px";
      el.style.top = Math.max(r.top, 0) + 10 + "px";
    }
    for (const [p, el] of Array.from(badges)) {
      if (!live.has(p)) {
        el.remove();
        badges.delete(p);
      }
    }
  }
  setInterval(progressTick, 400);

  // ---------- chapter mode: collect the whole chapter, build a clean strip, then translate it ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // While collecting, every loaded panel on the page is noted, not only the ones near the screen.
  setInterval(() => {
    if (!state.enabled || !settings.chapterMode || state.strip || state.building) return;
    document.querySelectorAll("img").forEach((img) => {
      if (img.complete && img.naturalWidth && img.clientWidth >= MIN_WIDTH && img.naturalHeight >= MIN_NATURAL_HEIGHT) enqueue(img);
    });
  }, 1500);

  async function buildStrip() {
    if (state.strip || state.building) return;
    state.building = true;
    try {
      while (state.sending) await sleep(300);
      const list = Array.from(state.panels.values()).filter((p) => !p.strip);
      for (const p of list) if (p.img && p.img.isConnected) p.pos = docY(p.img);
      list.sort(orderCmp);
      for (const p of list) {
        if (p.keep) continue;
        try {
          if (p.img && p.img.isConnected) p.keep = (await readPanelPixels(p.img)).dataUrl;
        } catch (e) {
          /* this panel is left out */
        }
      }
      const usable = list.filter((p) => p.keep);
      if (!usable.length) {
        toast("No panels have loaded yet. Scroll down the chapter first.");
        return;
      }
      clearTimeout(state.timer);
      state.timer = null;
      state.flushAt = 0;
      state.pending.clear();
      for (const o of state.overlays.values()) o.el.remove();
      state.overlays.clear();
      state.panels.clear();

      const box = document.createElement("div");
      box.id = "kt-strip";
      Object.assign(box.style, { position: "relative", width: "100%", background: "#1a1a1a", padding: "12px 0 120px", textAlign: "center", lineHeight: "0", minHeight: "100vh" });
      const made = [];
      usable.forEach((old, i) => {
        const img = new Image();
        img.dataset.ktStrip = "1";
        img.src = old.keep;
        Object.assign(img.style, { display: "block", margin: "0 auto", width: "min(760px, 100%)", height: "auto" });
        box.appendChild(img);
        made.push({ old, img, i });
      });
      document.documentElement.appendChild(box);
      document.body.style.setProperty("display", "none", "important");
      state.strip = box;
      await Promise.all(made.map((m) => m.img.decode().catch(() => {})));

      for (const { old, img, i } of made) {
        const key = old.key || "c:h" + hashStr(old.keep);
        const p = { img, src: "kt-strip:" + i, status: "pending", key, dataUrl: null, source: img, boxes: null, keep: old.keep, pos: i, seq: i, tries: 0, strip: true };
        state.panels.set(p.src, p);
        let hit;
        if (old.status === "done" && old.boxes) hit = old.boxes;
        else {
          try {
            hit = (await chrome.storage.local.get(key))[key];
          } catch (e) {
            hit = undefined;
          }
        }
        if (hit !== undefined) {
          p.status = "done";
          p.boxes = hit;
          render(p);
        } else {
          state.pending.add(p);
        }
      }
      window.scrollTo(0, 0);
      schedule();
    } finally {
      state.building = false;
    }
  }

  function exitStrip() {
    if (!state.strip) return;
    clearTimeout(state.timer);
    state.timer = null;
    state.flushAt = 0;
    state.strip.remove();
    state.strip = null;
    document.body.style.removeProperty("display");
    for (const o of state.overlays.values()) o.el.remove();
    state.overlays.clear();
    state.pending.clear();
    state.panels.clear();
    scan();
  }

  function retryFailed() {
    for (const p of state.panels.values()) {
      if (p.status !== "error") continue;
      p.status = "pending";
      p.tries = 0;
      state.pending.add(p);
    }
    schedule();
  }

  KT.buildStrip = buildStrip;
  KT.exitStrip = exitStrip;
  KT.retryFailed = retryFailed;
  KT.setChapterMode = (on) => chrome.storage.local.set({ chapterMode: !!on });

  // ---------- redo tool: drag a box around missed text, or click a panel to redo all of it ----------
  const hitPanel = (x, y, x2, y2) => {
    let best = null;
    let bestA = 0;
    for (const p of state.panels.values()) {
      if (!p.img || !p.img.isConnected) continue;
      const r = p.img.getBoundingClientRect();
      const w = Math.min(r.right, x2) - Math.max(r.left, x);
      const h = Math.min(r.bottom, y2) - Math.max(r.top, y);
      const a = w > 0 && h > 0 ? w * h : 0;
      if (a > bestA) {
        bestA = a;
        best = p;
      }
    }
    return best;
  };

  async function redoPanel(p) {
    if (holding()) {
      toast("Chapter mode is still collecting. Build the strip first, then redo panels.");
      return;
    }
    try {
      const px = await readPanelPixels(p.img);
      p.source = px.source;
      p.dataUrl = px.dataUrl;
    } catch (e) {
      toast("Could not read that panel again: " + (e.message || e));
      return;
    }
    if (p.key) chrome.storage.local.remove(p.key).catch(() => {});
    const o = state.overlays.get(p.src);
    if (o) {
      o.el.remove();
      state.overlays.delete(p.src);
    }
    p.boxes = null;
    p.status = "pending";
    p.tries = 0;
    state.pending.add(p);
    toast("Redoing that whole panel now.");
    schedule();
  }

  async function translateRegion(p, sel) {
    const ir = p.img.getBoundingClientRect();
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const f = {
      x1: clamp01((sel.x1 - ir.left) / ir.width),
      y1: clamp01((sel.y1 - ir.top) / ir.height),
      x2: clamp01((sel.x2 - ir.left) / ir.width),
      y2: clamp01((sel.y2 - ir.top) / ir.height)
    };
    if (f.x2 - f.x1 < 0.02 || f.y2 - f.y1 < 0.01) {
      toast("That box is too small.");
      return;
    }
    toast("Reading that area on this computer. About " + (avgSecs() ? fmtSecs(avgSecs() + 3) : "a few seconds") + ".");
    try {
      const px = await readPanelPixels(p.img);
      const nw = px.source.naturalWidth;
      const nh = px.source.naturalHeight;
      // A little extra around the box helps the reader see the whole bubble.
      const padX = 0.02;
      const padY = 12 / nh;
      const r = { x1: clamp01(f.x1 - padX), y1: clamp01(f.y1 - padY), x2: clamp01(f.x2 + padX), y2: clamp01(f.y2 + padY) };
      const sx = Math.round(r.x1 * nw);
      const sy = Math.round(r.y1 * nh);
      const sw = Math.max(8, Math.round((r.x2 - r.x1) * nw));
      const sh = Math.max(8, Math.round((r.y2 - r.y1) * nh));
      // Small crops are enlarged, because vision models read tiny pictures badly.
      const scale = Math.min(Math.max(1, 448 / Math.min(sw, sh)), 1600 / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.max(8, Math.round(sw * Math.max(scale, 0.1)));
      c.height = Math.max(8, Math.round(sh * Math.max(scale, 0.1)));
      c.getContext("2d").drawImage(px.source, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const res = await chrome.runtime.sendMessage({ type: "translate", url: "region", dataUrl: c.toDataURL("image/jpeg", 0.92), panels: 1, series: KT.seriesKey(), region: true });
      if (!res || !res.ok) throw new Error((res && res.error) || "Translation failed");
      const b = res.boxes && res.boxes[0];
      if (!b || !Array.isArray(b.box_2d) || b.box_2d.length !== 4) throw new Error("The reader found no usable text there.");
      const rw = r.x2 - r.x1;
      const rh = r.y2 - r.y1;
      const [y1, x1, y2, x2] = b.box_2d.map(Number);
      const to = (v, o, span) => Math.round(Math.min(1000, Math.max(0, (o + (v / 1000) * span) * 1000)));
      const nb = Object.assign({}, b, { box_2d: [to(y1, r.y1, rh), to(x1, r.x1, rw), to(y2, r.y1, rh), to(x2, r.x1, rw)], manual: true });
      applyCorrections([nb]);
      learnTerms(res.terms);
      // Anything already drawn inside the chosen area is replaced by the new bubble.
      const keep = (p.boxes || []).filter((e) => {
        if (!Array.isArray(e.box_2d)) return true;
        const cx = (e.box_2d[1] + e.box_2d[3]) / 2000;
        const cy = (e.box_2d[0] + e.box_2d[2]) / 2000;
        return !(cx >= f.x1 && cx <= f.x2 && cy >= f.y1 && cy <= f.y2);
      });
      p.boxes = keep.concat([nb]);
      p.status = "done";
      if (p.key) {
        try {
          await chrome.storage.local.set({ [p.key]: p.boxes });
        } catch (e) {
          /* not saved */
        }
      }
      render(p);
      toast("Done. Click the new bubble to adjust it.");
    } catch (e) {
      toast(e.message || String(e));
    }
  }

  let picker = null;
  function stopPick() {
    if (!picker) return;
    picker.shade.remove();
    picker.rect.remove();
    window.removeEventListener("keydown", picker.onKey, true);
    picker = null;
    redoBtn.textContent = "Redo an area";
  }
  function startPick() {
    if (picker) return stopPick();
    const shade = document.createElement("div");
    Object.assign(shade.style, { position: "fixed", inset: "0", cursor: "crosshair", background: "rgba(0,0,0,.12)", zIndex: "2147483500" });
    const rect = document.createElement("div");
    Object.assign(rect.style, { position: "fixed", border: "2px dashed #4ade80", background: "rgba(74,222,128,.15)", zIndex: "2147483501", display: "none", pointerEvents: "none" });
    document.documentElement.append(shade, rect);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        stopPick();
      }
    };
    window.addEventListener("keydown", onKey, true);
    picker = { shade, rect, onKey };
    redoBtn.textContent = "Cancel";
    toast("Drag a box around the text that was missed. Or click a panel to redo all of it. Esc cancels.");
    let start = null;
    shade.addEventListener("mousedown", (e) => {
      start = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    shade.addEventListener("mousemove", (e) => {
      if (!start) return;
      const x1 = Math.min(start.x, e.clientX);
      const y1 = Math.min(start.y, e.clientY);
      Object.assign(rect.style, { display: "block", left: x1 + "px", top: y1 + "px", width: Math.abs(e.clientX - start.x) + "px", height: Math.abs(e.clientY - start.y) + "px" });
    });
    shade.addEventListener("mouseup", (e) => {
      if (!start) return;
      const sel = { x1: Math.min(start.x, e.clientX), y1: Math.min(start.y, e.clientY), x2: Math.max(start.x, e.clientX), y2: Math.max(start.y, e.clientY) };
      stopPick();
      const click = sel.x2 - sel.x1 < 8 && sel.y2 - sel.y1 < 8;
      const p = click ? hitPanel(sel.x1, sel.y1, sel.x1 + 1, sel.y1 + 1) : hitPanel(sel.x1, sel.y1, sel.x2, sel.y2);
      if (!p) {
        toast("No panel found there.");
        return;
      }
      if (click) redoPanel(p);
      else translateRegion(p, sel);
    });
  }
  KT.startPick = startPick;

  // ---------- status text for the GUI ----------
  KT.statsText = () => {
    let done = 0;
    for (const p of state.panels.values()) if (p.status === "done") done++;
    const now = Date.now();
    let next = "no batch waiting";
    if (state.sending) next = settings.localReader ? "reading on this computer now" : "sending to Gemini now";
    else if (state.flushAt) next = "next send in " + Math.max(0, Math.round((state.flushAt - now) / 1000)) + "s";
    if (state.cooldownUntil > now) next += " (rate limit pause " + Math.round((state.cooldownUntil - now) / 1000) + "s)";
    return (
      "panels found: " + state.panels.size + "   translated: " + done + "\n" +
      "waiting for batch: " + state.pending.size + "   " + next + "\n" +
      "speed: " + (avgSecs() ? avgSecs().toFixed(1) + " s per panel" : "not measured yet") + "\n" +
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
  const setPeek = (on) => {
    state.peek = on;
    for (const o of state.overlays.values()) o.el.style.display = state.enabled && !on ? "" : "none";
  };
  window.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.code === "KeyT") setEnabled(!state.enabled);
    else if (e.code === "KeyR" && state.enabled) KT.startPick();
    else if (e.code === "KeyB" && state.enabled) (state.strip ? KT.exitStrip() : KT.buildStrip());
    else if (e.code === "KeyO" && !e.repeat) setPeek(true); // hold to look at the original
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyO" || e.key === "Alt") setPeek(false);
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.batchSeconds) settings.batchSeconds = Number(changes.batchSeconds.newValue);
      if (changes.provider) settings.localReader = changes.provider.newValue === "ollama";
      if (changes.translator) settings.translator = changes.translator.newValue;
      if (changes.fontFamily || changes.textScale) {
        if (changes.fontFamily) settings.font = changes.fontFamily.newValue || "comic";
        if (changes.textScale) settings.textScale = Math.min(1.4, Math.max(0.6, Number(changes.textScale.newValue) || 1));
        for (const o of state.overlays.values()) {
          for (const it of o.items) it.box.style.fontFamily = fontStack();
          fit(o);
        }
      }
      if (changes.chapterMode) {
        settings.chapterMode = changes.chapterMode.newValue !== false;
        if (!settings.chapterMode && state.strip) KT.exitStrip();
        schedule();
      }
      if (changes.notes) KT.notes = changes.notes.newValue || "";
      if (changes.corrections) KT.corrections = changes.corrections.newValue || {};
      if (changes.glossary) KT.glossary = changes.glossary.newValue || [];
      if (changes.summaries) KT.summaries = changes.summaries.newValue || {};
      if (changes.editStats) KT.editStats = changes.editStats.newValue || {};
    });
  } catch (e) {
    /* ignore */
  }

  (async () => {
    let saved = false;
    try {
      const cfg = await chrome.storage.local.get(["enabled", "batchSeconds", "notes", "corrections", "glossary", "editStats", "provider", "summaries", "translator", "chapterMode", "fontFamily", "textScale"]);
      settings.localReader = cfg.provider === "ollama";
      settings.translator = cfg.translator;
      settings.chapterMode = cfg.chapterMode !== false;
      if (typeof cfg.fontFamily === "string") settings.font = cfg.fontFamily;
      if (Number(cfg.textScale) > 0) settings.textScale = Math.min(1.4, Math.max(0.6, Number(cfg.textScale)));
      KT.summaries = cfg.summaries && typeof cfg.summaries === "object" ? cfg.summaries : {};
      KT.glossary = Array.isArray(cfg.glossary) ? cfg.glossary : [];
      KT.editStats = cfg.editStats || {};
      saved = !!cfg.enabled;
      settings.batchSeconds = cfg.batchSeconds === undefined ? 10 : Number(cfg.batchSeconds);
      KT.notes = cfg.notes || "";
      KT.corrections = cfg.corrections || {};
    } catch (e) {
      /* ignore */
    }
    document.documentElement.appendChild(btn);
    await setEnabled(saved);
  })();
})();
