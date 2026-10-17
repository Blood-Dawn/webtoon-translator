(() => {
  if (window.__ktUiInjected || !window.KT) return;
  window.__ktUiInjected = true;
  const KT = window.KT;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Everything lives in a shadow root so the site's CSS cannot break it.
  const host = document.createElement("div");
  host.id = "kt-ui-host";
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
<style>
  * { box-sizing: border-box; font-family: "Segoe UI", Arial, sans-serif; }
  .fab { position: fixed; right: 16px; bottom: 68px; width: 44px; height: 44px; border-radius: 50%; border: none;
         background: #333; color: #fff; font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  .panel { position: fixed; right: 16px; bottom: 124px; width: 380px; max-height: 72vh; overflow: auto; background: #1e1f22;
           color: #eee; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.5); display: none; font-size: 13px; }
  .panel.open { display: block; }
  .tabs { display: flex; position: sticky; top: 0; background: #2b2d31; z-index: 1; }
  .tabs button { flex: 1; padding: 10px 4px; background: none; border: none; color: #bbb; cursor: pointer; font-size: 13px;
                 border-bottom: 2px solid transparent; }
  .tabs button.on { color: #fff; border-bottom-color: #4c8dff; }
  .pane { display: none; padding: 12px; }
  .pane.on { display: block; }
  label { display: block; margin: 10px 0 4px; color: #bbb; }
  textarea, input[type=number] { width: 100%; background: #111214; color: #eee; border: 1px solid #3a3c41; border-radius: 6px;
                                  padding: 6px; font-size: 13px; }
  textarea { resize: vertical; min-height: 90px; }
  .b { background: #3a3c41; color: #eee; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
  .b:hover { background: #4a4d54; }
  .primary { background: #2f6fed; }
  .primary:hover { background: #4580ff; }
  .danger { background: #8a2f2f; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
  .stat { font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; background: #111214; padding: 8px; border-radius: 6px; }
  .hint { color: #9aa0a6; font-size: 12px; margin-top: 6px; line-height: 1.4; }
  .corr { display: flex; gap: 8px; align-items: flex-start; border-bottom: 1px solid #33353a; padding: 7px 0; }
  .corr .t { flex: 1; word-break: break-word; }
  .ko { color: #8ab4ff; }
  .batch { margin: 10px 0 16px; }
  .cap { color: #bbb; font-size: 12px; margin-bottom: 4px; }
  .holder { max-height: 240px; overflow: auto; border: 1px solid #3a3c41; border-radius: 6px; cursor: zoom-in; }
  .stack { position: relative; }
  .stack img { display: block; width: 100%; }
  .ov { position: absolute; inset: 0; pointer-events: none; }
  .ov div { position: absolute; border: 2px solid #ff4d4d; background: rgba(255,77,77,.12); }
  .editor { position: fixed; width: 340px; background: #1e1f22; color: #eee; border-radius: 12px; padding: 12px; display: none;
            box-shadow: 0 8px 30px rgba(0,0,0,.55); font-size: 13px; }
  .editor.open { display: block; }
  .orig { background: #111214; border-radius: 6px; padding: 6px 8px; color: #8ab4ff; margin-bottom: 8px; max-height: 70px; overflow: auto; }
  .editor textarea { min-height: 80px; font-size: 14px; }
  .chk { display: flex; gap: 6px; align-items: center; margin: 8px 0; color: #ddd; }
  .lbl { color: #bbb; font-size: 12px; margin-right: 2px; }
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.75); display: none; align-items: flex-start; justify-content: center;
           padding: 24px; overflow: auto; }
  .modal.open { display: flex; }
  .mbody { background: #1e1f22; color: #eee; border-radius: 12px; padding: 14px; width: min(860px, 94vw); }
  pre { white-space: pre-wrap; word-break: break-word; background: #111214; padding: 8px; border-radius: 6px; font-size: 11px; max-height: 300px; overflow: auto; }
</style>

<button class="fab" id="fab" title="Translator panel: notes, fixes, images sent">&#9881;</button>

<div class="panel" id="panel">
  <div class="tabs">
    <button data-tab="status" class="on">Status</button>
    <button data-tab="notes">Notes</button>
    <button data-tab="fixes">Fixes</button>
    <button data-tab="images">Images</button>
  </div>

  <div class="pane on" data-pane="status">
    <div class="row"><button class="b primary" id="toggle">Turn on</button></div>
    <label for="secs">Seconds to wait before sending a batch</label>
    <input type="number" id="secs" min="3" max="60">
    <div class="stat" id="stats" style="margin-top:10px"></div>
    <div class="row"><button class="b danger" id="clearcache">Clear translation cache</button></div>
    <div class="hint">Tip: click any translated bubble on the page to edit its text, font size or box size.</div>
  </div>

  <div class="pane" data-pane="notes">
    <label for="notes">Series notes (sent to Gemini with every batch)</label>
    <textarea id="notes" style="min-height:170px" placeholder="Examples:&#10;The rookie agent with the prosthetic leg is a woman (she/her).&#10;Gwajang-nim = Section Chief.&#10;Keep honorifics out of the English."></textarea>
    <div class="row"><button class="b primary" id="savenotes">Save notes</button><span id="notesmsg" class="hint"></span></div>
    <div class="hint">This is the best way to stop wrong genders. Name the character and say he or she. It applies to panels translated from now on. Clear the cache to redo panels you already have.</div>
  </div>

  <div class="pane" data-pane="fixes">
    <div class="hint" id="fixcount"></div>
    <div id="fixlist"></div>
    <div class="hint">When one of these Korean lines comes up again, your wording is used instead of Gemini's.</div>
  </div>

  <div class="pane" data-pane="images">
    <div class="row"><button class="b primary" id="loadbatches">Show last images sent to Gemini</button></div>
    <div class="hint">The red outlines are the text boxes Gemini found. Click an image to see it larger.</div>
    <div id="batches"></div>
  </div>
</div>

<div class="editor" id="editor">
  <div class="orig" id="orig"></div>
  <textarea id="txt" spellcheck="true"></textarea>
  <div class="row">
    <span class="lbl">Font</span>
    <button class="b" id="fminus">A-</button><button class="b" id="fplus">A+</button><button class="b" id="fauto">Auto</button>
    <span class="lbl" style="margin-left:8px">Box</span>
    <button class="b" id="bminus">-</button><button class="b" id="bplus">+</button>
  </div>
  <div class="row">
    <span class="lbl">Move</span>
    <button class="b" id="mleft">&#8592;</button><button class="b" id="mup">&#8593;</button><button class="b" id="mdown">&#8595;</button><button class="b" id="mright">&#8594;</button>
    <span class="lbl" style="margin-left:8px">or drag the bubble</span>
  </div>
  <div class="row">
    <button class="b" id="fem">Make female</button><button class="b" id="mal">Make male</button>
  </div>
  <label class="chk"><input type="checkbox" id="remember" checked> Remember this wording for this Korean line</label>
  <div class="row">
    <button class="b primary" id="save">Save</button>
    <button class="b" id="resetText">Reset text</button>
    <button class="b" id="peek">Show Korean</button>
    <button class="b" id="close">Close</button>
  </div>
</div>

<div class="modal" id="modal"><div class="mbody" id="mbody"></div></div>
`;

  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);

  // ---------- panel ----------
  const panel = $("panel");

  function syncPanel() {
    $("secs").value = KT.settings.batchSeconds || 10;
    $("notes").value = KT.notes || "";
    $("toggle").textContent = KT.state.enabled ? "Turn translating off" : "Turn translating on";
    $("stats").textContent = KT.statsText();
  }

  $("fab").addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) syncPanel();
  });

  const tabButtons = root.querySelectorAll(".tabs button");
  tabButtons.forEach((t) =>
    t.addEventListener("click", () => {
      tabButtons.forEach((x) => x.classList.toggle("on", x === t));
      root.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === t.dataset.tab));
      if (t.dataset.tab === "fixes") renderFixes();
    })
  );

  setInterval(() => {
    if (!panel.classList.contains("open")) return;
    $("stats").textContent = KT.statsText();
    $("toggle").textContent = KT.state.enabled ? "Turn translating off" : "Turn translating on";
  }, 1000);

  $("toggle").addEventListener("click", async () => {
    await KT.setEnabled(!KT.state.enabled);
    syncPanel();
  });

  $("secs").addEventListener("change", async () => {
    const v = clamp(Number($("secs").value) || 10, 3, 60);
    $("secs").value = v;
    KT.settings.batchSeconds = v;
    try {
      await chrome.storage.local.set({ batchSeconds: v });
    } catch (e) {
      /* ignore */
    }
  });

  let clearArmed = false;
  $("clearcache").addEventListener("click", async () => {
    if (!clearArmed) {
      clearArmed = true;
      $("clearcache").textContent = "Click again to confirm";
      setTimeout(() => {
        clearArmed = false;
        $("clearcache").textContent = "Clear translation cache";
      }, 4000);
      return;
    }
    clearArmed = false;
    const n = await KT.clearCache();
    $("clearcache").textContent = "Cleared " + n + " panels. Reload the page.";
  });

  $("savenotes").addEventListener("click", async () => {
    KT.notes = $("notes").value.trim();
    try {
      await chrome.storage.local.set({ notes: KT.notes });
      $("notesmsg").textContent = "Saved";
    } catch (e) {
      $("notesmsg").textContent = "Could not save";
    }
    setTimeout(() => ($("notesmsg").textContent = ""), 2000);
  });

  function renderFixes() {
    const list = $("fixlist");
    list.textContent = "";
    const entries = Object.entries(KT.corrections).reverse();
    $("fixcount").textContent = entries.length
      ? entries.length + " saved correction" + (entries.length === 1 ? "" : "s")
      : "No saved corrections yet. Edit a bubble and keep the Remember box ticked.";
    entries.forEach(([ko, en]) => {
      const row = document.createElement("div");
      row.className = "corr";
      const t = document.createElement("div");
      t.className = "t";
      const k = document.createElement("div");
      k.className = "ko";
      k.textContent = ko;
      const e = document.createElement("div");
      e.textContent = en;
      t.appendChild(k);
      t.appendChild(e);
      const del = document.createElement("button");
      del.className = "b danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        KT.removeCorrection(ko);
        renderFixes();
      });
      row.appendChild(t);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  // ---------- images sent to Gemini ----------
  function buildStack(bt) {
    const stack = document.createElement("div");
    stack.className = "stack";
    const im = document.createElement("img");
    im.src = bt.dataUrl;
    stack.appendChild(im);
    const ov = document.createElement("div");
    ov.className = "ov";
    (bt.boxes || []).forEach((b) => {
      if (!Array.isArray(b.box_2d) || b.box_2d.length !== 4) return;
      const [y1, x1, y2, x2] = b.box_2d.map(Number);
      const d = document.createElement("div");
      d.style.left = x1 / 10 + "%";
      d.style.top = y1 / 10 + "%";
      d.style.width = Math.max(0, x2 - x1) / 10 + "%";
      d.style.height = Math.max(0, y2 - y1) / 10 + "%";
      ov.appendChild(d);
    });
    stack.appendChild(ov);
    return stack;
  }

  function openModal(bt) {
    const body = $("mbody");
    body.textContent = "";
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = new Date(bt.t).toLocaleString() + "  |  " + bt.panels + " panels  |  " + (bt.boxes || []).length + " text boxes  |  " + bt.model;
    body.appendChild(cap);
    body.appendChild(buildStack(bt));
    const row = document.createElement("div");
    row.className = "row";
    const jsonBtn = document.createElement("button");
    jsonBtn.className = "b";
    jsonBtn.textContent = "Show Gemini's text";
    const pre = document.createElement("pre");
    pre.style.display = "none";
    pre.textContent = (bt.boxes || []).map((b, i) => i + 1 + ". " + (b.original || "") + "\n    " + (b.translation || "")).join("\n");
    jsonBtn.addEventListener("click", () => {
      pre.style.display = pre.style.display === "none" ? "block" : "none";
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "b";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => $("modal").classList.remove("open"));
    row.appendChild(jsonBtn);
    row.appendChild(closeBtn);
    body.appendChild(row);
    body.appendChild(pre);
    $("modal").classList.add("open");
  }

  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) $("modal").classList.remove("open");
  });

  $("loadbatches").addEventListener("click", async () => {
    const box = $("batches");
    box.textContent = "Loading...";
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: "getBatches" });
    } catch (e) {
      /* ignore */
    }
    if (!res || !res.ok || !res.batches.length) {
      box.textContent = "Nothing has been sent to Gemini yet. Turn translating on and scroll for a few seconds.";
      return;
    }
    box.textContent = "";
    res.batches.forEach((bt) => {
      const wrap = document.createElement("div");
      wrap.className = "batch";
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = new Date(bt.t).toLocaleTimeString() + "  |  " + bt.panels + " panels  |  " + (bt.boxes || []).length + " text boxes";
      const holder = document.createElement("div");
      holder.className = "holder";
      holder.appendChild(buildStack(bt));
      holder.addEventListener("click", () => openModal(bt));
      wrap.appendChild(cap);
      wrap.appendChild(holder);
      box.appendChild(wrap);
    });
  });

  // ---------- bubble editor ----------
  const editor = $("editor");
  let ctx = null;

  function matchCase(src, rep) {
    if (src.length > 1 && src === src.toUpperCase()) return rep.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return rep[0].toUpperCase() + rep.slice(1);
    return rep;
  }

  const TO_FEMALE = {
    he: "she", him: "her", his: "her", himself: "herself",
    man: "woman", men: "women", boy: "girl", boys: "girls", guy: "girl", sir: "ma'am", mr: "ms",
    gentleman: "lady", father: "mother", brother: "sister", son: "daughter", husband: "wife"
  };
  const TO_MALE = {
    she: "he", her: "his", hers: "his", herself: "himself",
    woman: "man", women: "men", girl: "boy", girls: "boys", "ma'am": "sir", ms: "mr",
    lady: "gentleman", mother: "father", sister: "brother", daughter: "son", wife: "husband"
  };

  function swapGender(text, toFemale) {
    const map = toFemale ? TO_FEMALE : TO_MALE;
    const re = new RegExp("\\b(" + Object.keys(map).join("|") + ")\\b", "gi");
    return text.replace(re, (m, _w, off, str) => {
      const k = m.toLowerCase();
      let rep = map[k];
      if (!toFemale && k === "her") {
        // "her" is "him" at the end of a clause or before a preposition, otherwise "his".
        const rest = str.slice(off + m.length);
        rep = /^\s*([.,!?;:)]|$)|^\s+(to|at|in|on|for|with|from|by|of|about|and|but|or)\b/i.test(rest) ? "him" : "his";
      }
      return matchCase(m, rep);
    });
  }
  KT.swapGender = swapGender;

  function position(boxEl) {
    const r = boxEl.getBoundingClientRect();
    const w = 340;
    const h = editor.offsetHeight || 340;
    const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - 8) top = r.top - h - 10;
    top = clamp(top, 8, Math.max(8, window.innerHeight - h - 8));
    editor.style.left = left + "px";
    editor.style.top = top + "px";
  }

  function liveSize() {
    return parseFloat(ctx.span.style.fontSize) || 16;
  }

  function setFontPx(px) {
    ctx.b.fs = clamp(px, 6, 200) / (ctx.o.width > 0 ? ctx.o.width : ctx.o.img.clientWidth);
    KT.refit(ctx.o, ctx.it);
  }

  function scaleBox(f) {
    const [y1, x1, y2, x2] = ctx.b.box_2d;
    const cy = (y1 + y2) / 2;
    const cx = (x1 + x2) / 2;
    const hh = ((y2 - y1) / 2) * f;
    const hw = ((x2 - x1) / 2) * f;
    ctx.b.box_2d = [
      clamp(Math.round(cy - hh), 0, 1000),
      clamp(Math.round(cx - hw), 0, 1000),
      clamp(Math.round(cy + hh), 0, 1000),
      clamp(Math.round(cx + hw), 0, 1000)
    ];
    KT.relayout(ctx.o, ctx.it);
  }

  function nudge(dy, dx) {
    const [y1, x1, y2, x2] = ctx.b.box_2d.map(Number);
    const h = y2 - y1;
    const w = x2 - x1;
    const ny = clamp(y1 + dy, 0, 1000 - h);
    const nx = clamp(x1 + dx, 0, 1000 - w);
    ctx.b.box_2d = [Math.round(ny), Math.round(nx), Math.round(ny + h), Math.round(nx + w)];
    KT.relayout(ctx.o, ctx.it);
    position(ctx.box);
  }

  function openEditor(c) {
    if (ctx && ctx.b === c.b) {
      $("txt").focus();
      return;
    }
    if (ctx) discard(true);
    c.it.editing = true;
    if (c.it.grip) c.it.grip.style.opacity = "1";
    ctx = Object.assign({}, c, {
      backup: { translation: c.b.translation, fs: c.b.fs, box_2d: c.b.box_2d.slice() },
      peek: false
    });
    $("orig").textContent = c.b.original || "(no Korean text was recorded for this bubble)";
    $("txt").value = c.b.translation;
    $("peek").textContent = "Show Korean";
    editor.classList.add("open");
    position(c.box);
    $("txt").focus();
  }

  // Throw away unsaved changes and put the bubble back as it was.
  function discard(soft) {
    if (!ctx) return;
    const c = ctx;
    ctx = null;
    c.b.translation = c.backup.translation;
    if (c.backup.fs === undefined) delete c.b.fs;
    else c.b.fs = c.backup.fs;
    c.b.box_2d = c.backup.box_2d;
    c.it.editing = false;
    if (c.it.grip) c.it.grip.style.opacity = "0";
    editor.classList.remove("open");
    if (soft === true) {
      c.span.textContent = c.b.translation;
      c.box.style.opacity = "1";
      KT.relayout(c.o, c.it);
    } else {
      KT.rerender(c.panel);
    }
  }

  async function save() {
    if (!ctx) return;
    const c = ctx;
    const text = $("txt").value.trim();
    if (!text) return;
    const changed = text !== c.backup.translation;
    if (changed && c.b.geminiText === undefined) c.b.geminiText = c.backup.translation;
    c.b.translation = text;
    ctx = null;
    editor.classList.remove("open");
    if (changed && $("remember").checked && c.b.original) {
      if (c.b.geminiText !== undefined && text === c.b.geminiText) KT.removeCorrection(c.b.original);
      else KT.addCorrection(c.b.original, text);
    }
    await KT.commitPanel(c.panel);
    KT.rerender(c.panel);
  }

  $("txt").addEventListener("input", () => {
    if (!ctx) return;
    ctx.span.textContent = $("txt").value;
    KT.refit(ctx.o, ctx.it);
  });
  $("fplus").addEventListener("click", () => ctx && setFontPx(liveSize() * 1.1));
  $("fminus").addEventListener("click", () => ctx && setFontPx(liveSize() / 1.1));
  $("fauto").addEventListener("click", () => {
    if (!ctx) return;
    delete ctx.b.fs;
    KT.refit(ctx.o, ctx.it);
  });
  $("bplus").addEventListener("click", () => ctx && scaleBox(1.08));
  $("bminus").addEventListener("click", () => ctx && scaleBox(1 / 1.08));
  $("mleft").addEventListener("click", () => ctx && nudge(0, -6));
  $("mright").addEventListener("click", () => ctx && nudge(0, 6));
  $("mup").addEventListener("click", () => ctx && nudge(-6, 0));
  $("mdown").addEventListener("click", () => ctx && nudge(6, 0));
  const setText = (v) => {
    $("txt").value = v;
    $("txt").dispatchEvent(new Event("input"));
  };
  $("fem").addEventListener("click", () => ctx && setText(swapGender($("txt").value, true)));
  $("mal").addEventListener("click", () => ctx && setText(swapGender($("txt").value, false)));
  $("resetText").addEventListener("click", () => {
    if (!ctx) return;
    setText(ctx.b.geminiText !== undefined ? ctx.b.geminiText : ctx.backup.translation);
  });
  $("peek").addEventListener("click", () => {
    if (!ctx) return;
    ctx.peek = !ctx.peek;
    ctx.box.style.opacity = ctx.peek ? "0" : "1";
    $("peek").textContent = ctx.peek ? "Show English" : "Show Korean";
  });
  $("save").addEventListener("click", save);
  $("close").addEventListener("click", discard);

  // Keep keystrokes inside the editor away from the site's own shortcuts.
  ["keydown", "keyup", "keypress"].forEach((ev) => editor.addEventListener(ev, (e) => e.stopPropagation()));
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if ($("modal").classList.contains("open")) $("modal").classList.remove("open");
      else if (ctx) discard();
    },
    true
  );

  KT.ui = {
    openEditor,
    reposition() {
      if (ctx) position(ctx.box);
    }
  };
})();
