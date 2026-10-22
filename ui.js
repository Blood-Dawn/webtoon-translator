(() => {
  if (window.__ktUiInjected || !window.KT) return;
  window.__ktUiInjected = true;
  const KT = window.KT;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Everything lives in a shadow root so the site's CSS cannot break it.
  const host = document.createElement("div");
  host.id = "kt-ui-host";
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
<style>
  * { box-sizing: border-box; font-family: "Segoe UI", Arial, sans-serif; }
  .fab { position: fixed; right: 16px; bottom: 68px; width: 44px; height: 44px; border-radius: 50%; border: none;
         background: #333; color: #fff; font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  .panel { position: fixed; right: 16px; bottom: 124px; width: 380px; max-height: 72vh; overflow: auto; background: #1e1f22;
           color: #eee; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.5); display: none; font-size: 13px; }
  .panel.open { display: block; }
  .tabs { display: flex; position: sticky; top: 0; background: #2b2d31; z-index: 1; }
  .tabs button { flex: 1; padding: 10px 2px; background: none; border: none; color: #bbb; cursor: pointer; font-size: 12px;
                 border-bottom: 2px solid transparent; }
  .tabs button.on { color: #fff; border-bottom-color: #4c8dff; }
  .pane { display: none; padding: 12px; }
  .pane.on { display: block; }
  label { display: block; margin: 10px 0 4px; color: #bbb; }
  .g { border-bottom: 1px solid #33353a; padding: 7px 0; }
  .g input[type=text], .add input[type=text], select { background: #111214; color: #eee; border: 1px solid #3a3c41; border-radius: 6px; padding: 5px 6px; font-size: 12px; }
  .g input[type=text] { width: 100%; margin: 4px 0; }
  .add input[type=text] { flex: 1; min-width: 0; }
  .tag { font-size: 11px; color: #9aa0a6; margin-left: 6px; }
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
    <button data-tab="glossary">Glossary</button>
    <button data-tab="fixes">Fixes</button>
    <button data-tab="find">Find</button>
    <button data-tab="images">Images</button>
  </div>

  <div class="pane on" data-pane="status">
    <div class="row"><button class="b primary" id="toggle">Turn on</button></div>
    <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" id="chapter" style="margin-top:3px"><span>Chapter mode. Collect the whole chapter first, build one clean strip, then translate it all.</span></label>
    <div class="row"><button class="b" id="buildstrip">Build strip and translate</button><button class="b" id="redoarea">Redo an area</button></div>
    <label for="secs">Seconds to wait before sending a batch</label>
    <input type="number" id="secs" min="0" max="60" step="0.5">
    <div class="stat" id="stats" style="margin-top:10px"></div>
    <div class="row"><button class="b danger" id="clearcache">Clear translation cache</button></div>
    <div class="hint">Tip: click any translated bubble on the page to edit its text, font size or box size.</div>
  </div>

  <div class="pane" data-pane="notes">
    <label for="notes">Series notes (sent to Gemini with every batch)</label>
    <textarea id="notes" style="min-height:170px" placeholder="Examples:&#10;The rookie agent with the prosthetic leg is a woman (she/her).&#10;Gwajang-nim = Section Chief.&#10;Keep honorifics out of the English."></textarea>
    <div class="row"><button class="b primary" id="savenotes">Save notes</button><span id="notesmsg" class="hint"></span></div>
    <div class="hint">This is the best way to stop wrong genders. Name the character and say he or she. It applies to panels translated from now on. Clear the cache to redo panels you already have.</div>
    <label for="summary">Story so far (optional, this series)</label>
    <textarea id="summary" style="min-height:90px" placeholder="A few sentences on the plot so far. It helps the model pick the right tone and meaning."></textarea>
    <div class="row"><button class="b primary" id="savesummary">Save</button><button class="b" id="makesummary">Update from this chapter</button><span id="summsg" class="hint"></span></div>
    <div class="hint">Update reads the English lines on this page and asks a model to fold them into the summary. It uses your local model if one is set, otherwise Gemini. Check what it wrote before relying on it.</div>
  </div>

  <div class="pane" data-pane="glossary">
    <div class="hint" id="glosscount"></div>
    <div id="glosspending"></div>
    <div id="glossapproved"></div>
    <label>Add an entry</label>
    <div class="row add"><input type="text" id="gko" placeholder="Korean"><input type="text" id="gen" placeholder="English"></div>
    <div class="row add">
      <select id="gtype"><option value="character">Character</option><option value="term">Term</option></select>
      <select id="ggender"><option value="">Gender unknown</option><option value="female">Female</option><option value="male">Male</option></select>
      <select id="gscope"><option value="series">This series</option><option value="all">All series</option></select>
      <button class="b primary" id="gadd">Add</button>
    </div>
    <div class="hint">Gemini suggests names and terms as you read. They wait here until you approve them, and only approved entries are sent back to Gemini. Characters with a gender fix wrong pronouns. Entries that appear in a chapter are used first, up to 60 per request.</div>
  </div>

  <div class="pane" data-pane="fixes">
    <div class="hint" id="fixcount"></div>
    <div id="fixlist"></div>
    <div class="hint">When one of these Korean lines comes up again, your wording is used instead of Gemini's.</div>
  </div>

  <div class="pane" data-pane="find">
    <label for="fq">Find in this chapter's English</label>
    <input type="text" id="fq" placeholder="Text to find">
    <label for="fr">Replace with</label>
    <input type="text" id="fr" placeholder="Replacement">
    <label class="chk"><input type="checkbox" id="fcase"> Match case</label>
    <label class="chk"><input type="checkbox" id="fword"> Whole word</label>
    <div class="row"><button class="b primary" id="fgo">Find</button><button class="b" id="freplace">Replace all</button></div>
    <div class="hint" id="fmsg"></div>
    <div id="flist"></div>
    <div class="hint">Replace all changes every matching bubble on the page and saves them. Open a bubble and press Reset text to go back to the original wording.</div>
  </div>

  <div class="pane" data-pane="images">
    <div class="row"><button class="b primary" id="loadbatches">Show last images sent to the reader</button></div>
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
    <span class="lbl">Look</span>
    <select id="preset"></select>
    <span class="lbl" title="Fill color">Fill</span><input type="color" id="bgc" style="width:34px;height:26px;padding:0;border:0;background:none">
    <label class="chk" style="margin:0"><input type="checkbox" id="nofill"> none</label>
  </div>
  <div class="row">
    <span class="lbl">Text</span><input type="color" id="fgc" style="width:34px;height:26px;padding:0;border:0;background:none">
    <label class="chk" style="margin:0 0 0 8px"><input type="checkbox" id="olon"> Outline</label>
    <input type="color" id="olc" value="#ffffff" style="width:34px;height:26px;padding:0;border:0;background:none">
  </div>
  <div class="row">
    <button class="b" id="fem">Make female</button><button class="b" id="mal">Make male</button>
  </div>
  <div class="row">
    <button class="b" id="undo" title="Ctrl+Z">Undo</button><button class="b" id="redo" title="Ctrl+Y">Redo</button>
    <button class="b" id="prev" title="Alt+Left">&#9664; Prev</button><button class="b" id="next" title="Alt+Right, or Ctrl+Enter to save and go on">Next &#9654;</button>
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
    $("chapter").checked = !!KT.settings.chapterMode;
    $("notes").value = KT.notes || "";
    $("summary").value = KT.summary || "";
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
      if (t.dataset.tab === "glossary") renderGlossary();
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

  $("chapter").addEventListener("change", () => KT.setChapterMode($("chapter").checked));
  $("buildstrip").addEventListener("click", () => {
    panel.classList.remove("open");
    if (!KT.settings.chapterMode) KT.setChapterMode(true);
    KT.buildStrip();
  });
  $("redoarea").addEventListener("click", () => {
    panel.classList.remove("open");
    KT.startPick();
  });

  $("secs").addEventListener("change", async () => {
    const v = clamp(Number($("secs").value) >= 0 && $("secs").value !== "" ? Number($("secs").value) : 10, 0, 60);
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

  // ---------- find and replace in the chapter ----------
  function findRegex() {
    const q = $("fq").value;
    if (!q) return null;
    let s = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if ($("fword").checked) s = "\\b" + s + "\\b";
    return new RegExp(s, $("fcase").checked ? "g" : "gi");
  }

  function doFind() {
    const re = findRegex();
    const list = $("flist");
    list.textContent = "";
    if (!re) {
      $("fmsg").textContent = "Type something to find.";
      return [];
    }
    const hits = KT.allItems().filter((c) => {
      re.lastIndex = 0;
      return re.test(c.b.translation);
    });
    $("fmsg").textContent = hits.length ? hits.length + " bubble" + (hits.length === 1 ? "" : "s") + " match." : "No matches on the page so far.";
    hits.slice(0, 40).forEach((c) => {
      const row = document.createElement("button");
      row.className = "b";
      row.style.cssText = "display:block;width:100%;text-align:left;margin:3px 0;white-space:normal";
      row.textContent = c.b.translation.length > 90 ? c.b.translation.slice(0, 90) + "..." : c.b.translation;
      row.addEventListener("click", () => reveal(c));
      list.appendChild(row);
    });
    return hits;
  }

  $("fgo").addEventListener("click", doFind);
  $("fq").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doFind();
  });
  $("freplace").addEventListener("click", async () => {
    const re = findRegex();
    if (!re) return doFind();
    const rep = $("fr").value;
    const changedPanels = new Set();
    let n = 0;
    for (const c of KT.allItems()) {
      re.lastIndex = 0;
      if (!re.test(c.b.translation)) continue;
      re.lastIndex = 0;
      if (c.b.geminiText === undefined) c.b.geminiText = c.b.translation;
      c.b.translation = c.b.translation.replace(re, () => rep);
      changedPanels.add(c.panel);
      n++;
    }
    for (const p of changedPanels) {
      await KT.commitPanel(p);
      KT.rerender(p);
    }
    $("flist").textContent = "";
    $("fmsg").textContent = n ? "Changed " + n + " bubble" + (n === 1 ? "" : "s") + "." : "No matches on the page so far.";
  });

  // ---------- story so far ----------
  $("savesummary").addEventListener("click", async () => {
    await KT.saveSummary($("summary").value);
    $("summsg").textContent = "Saved";
    setTimeout(() => ($("summsg").textContent = ""), 2000);
  });
  $("makesummary").addEventListener("click", async () => {
    const lines = KT.allItems().map((c) => c.b.translation).filter(Boolean);
    if (!lines.length) {
      $("summsg").textContent = "Nothing translated on this page yet.";
      return;
    }
    $("summsg").textContent = "Working...";
    try {
      const r = await chrome.runtime.sendMessage({ type: "summarize", previous: $("summary").value, lines: lines.slice(0, 200), series: KT.seriesKey() });
      if (!r || !r.ok) throw new Error((r && r.error) || "No answer");
      $("summary").value = r.summary;
      await KT.saveSummary(r.summary);
      $("summsg").textContent = "Updated. Please read it over.";
    } catch (e) {
      $("summsg").textContent = String(e.message || e).slice(0, 140);
    }
  });

  // ---------- glossary ----------
  function mkBtn(label, cls, fn) {
    const b = document.createElement("button");
    b.className = "b " + (cls || "");
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function glossRow(g) {
    const row = document.createElement("div");
    row.className = "g";
    const head = document.createElement("div");
    const ko = document.createElement("span");
    ko.className = "ko";
    ko.textContent = g.ko;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = (g.type === "character" ? "character" : "term") + (g.series === "" ? ", all series" : "");
    head.appendChild(ko);
    head.appendChild(tag);
    const en = document.createElement("input");
    en.type = "text";
    en.value = g.en;
    en.maxLength = 80;
    en.addEventListener("change", () => {
      g.en = KT.norm(en.value) || g.en;
      en.value = g.en;
      KT.saveGlossary();
    });
    row.appendChild(head);
    row.appendChild(en);
    const actions = document.createElement("div");
    actions.className = "row";
    if (g.type === "character") {
      const sel = document.createElement("select");
      [["", "Gender unknown"], ["female", "Female"], ["male", "Male"]].forEach(([v, l]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = l;
        sel.appendChild(o);
      });
      sel.value = g.gender || "";
      sel.addEventListener("change", () => {
        g.gender = sel.value;
        KT.saveGlossary();
      });
      actions.appendChild(sel);
    }
    if (g.status === "pending") {
      actions.appendChild(
        mkBtn("Approve", "primary", () => {
          g.status = "approved";
          KT.saveGlossary();
          renderGlossary();
        })
      );
    }
    actions.appendChild(
      mkBtn("Delete", "danger", () => {
        KT.glossary.splice(KT.glossary.indexOf(g), 1);
        KT.saveGlossary();
        renderGlossary();
      })
    );
    row.appendChild(actions);
    return row;
  }

  function renderGlossary() {
    const series = KT.seriesKey();
    const mine = KT.glossary.filter((g) => g.series === series || g.series === "");
    const pending = mine.filter((g) => g.status === "pending");
    const approved = mine.filter((g) => g.status === "approved");
    $("glosscount").textContent = approved.length + " approved, " + pending.length + " waiting for your review";
    const pBox = $("glosspending");
    const aBox = $("glossapproved");
    pBox.textContent = "";
    aBox.textContent = "";
    if (pending.length) {
      const h = document.createElement("label");
      h.textContent = "Waiting for review";
      pBox.appendChild(h);
      const all = mkBtn("Approve all", "", () => {
        pending.forEach((g) => (g.status = "approved"));
        KT.saveGlossary();
        renderGlossary();
      });
      pBox.appendChild(all);
      pending.forEach((g) => pBox.appendChild(glossRow(g)));
    }
    if (approved.length) {
      const h = document.createElement("label");
      h.textContent = "Approved";
      aBox.appendChild(h);
      approved.forEach((g) => aBox.appendChild(glossRow(g)));
    }
  }

  $("gadd").addEventListener("click", () => {
    const ko = KT.norm($("gko").value);
    const en = KT.norm($("gen").value);
    if (!ko || !en) return;
    const series = $("gscope").value === "all" ? "" : KT.seriesKey();
    const type = $("gtype").value === "term" ? "term" : "character";
    const gender = type === "character" ? $("ggender").value : "";
    const old = KT.glossary.find((g) => g.ko === ko && g.series === series);
    if (old) {
      old.en = en;
      old.type = type;
      old.gender = gender;
      old.status = "approved";
    } else {
      KT.glossary.push({ ko, en, type, gender, status: "approved", series, n: 0, t: Date.now() });
    }
    KT.saveGlossary();
    $("gko").value = "";
    $("gen").value = "";
    renderGlossary();
  });

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
      box.textContent =
        "No images are kept. Turn on \"Keep debug images\" in the extension settings, then translate a few panels.";
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
    record();
  }

  function scaleBox(f) {
    ctx.b.shaped = true;
    const [y1, x1, y2, x2] = ctx.b.box_2d;
    const cy = (y1 + y2) / 2;
    const cx = (x1 + x2) / 2;
    const hh = ((y2 - y1) / 2) * f;
    const hw = ((x2 - x1) / 2) * f;
    ctx.b.box_2d = [
      clamp(Math.round(cy - hh), -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT),
      clamp(Math.round(cx - hw), -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT),
      clamp(Math.round(cy + hh), -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT),
      clamp(Math.round(cx + hw), -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT)
    ];
    KT.relayout(ctx.o, ctx.it);
    record();
  }

  function nudge(dy, dx) {
    ctx.b.shaped = true;
    const [y1, x1, y2, x2] = ctx.b.box_2d.map(Number);
    const h = y2 - y1;
    const w = x2 - x1;
    const ny = clamp(y1 + dy, -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT - h);
    const nx = clamp(x1 + dx, -KT.MOVE_LIMIT, 1000 + KT.MOVE_LIMIT - w);
    ctx.b.box_2d = [Math.round(ny), Math.round(nx), Math.round(ny + h), Math.round(nx + w)];
    KT.relayout(ctx.o, ctx.it);
    position(ctx.box);
    record();
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
      backup: { translation: c.b.translation, fs: c.b.fs, box_2d: c.b.box_2d.slice(), preset: c.b.preset, bg: c.b.bg, fg: c.b.fg, ol: c.b.ol, shaped: c.b.shaped },
      peek: false
    });
    $("orig").textContent = c.b.original || "(no Korean text was recorded for this bubble)";
    $("txt").value = c.b.translation;
    $("peek").textContent = "Show Korean";
    editor.classList.add("open");
    hist = [];
    hi = -1;
    record();
    position(c.box);
    $("txt").focus();
  }

  // ---------- undo and redo, look controls ----------
  let hist = [];
  let hi = -1;
  let typeTimer = null;
  const hex = (v, fallback) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

  function capture() {
    const b = ctx.b;
    return { text: $("txt").value, fs: b.fs, box: b.box_2d.slice(), preset: b.preset, bg: b.bg, fg: b.fg, ol: b.ol };
  }

  function syncLook() {
    if (!ctx) return;
    const P = KT.PRESETS[ctx.b.preset] || KT.PRESETS.speech;
    $("preset").value = KT.PRESETS[ctx.b.preset] ? ctx.b.preset : "speech";
    const noFill = ctx.b.bg === "transparent";
    $("nofill").checked = noFill;
    $("bgc").value = hex(noFill ? "" : ctx.b.bg, hex(P.bg, "#ffffff"));
    $("fgc").value = hex(ctx.b.fg, hex(P.fg, "#111111"));
    const ol = hex(ctx.b.ol, "");
    $("olon").checked = !!ol;
    if (ol) $("olc").value = ol;
    $("undo").disabled = hi <= 0;
    $("redo").disabled = hi >= hist.length - 1;
  }

  function record() {
    if (!ctx) return;
    clearTimeout(typeTimer);
    const s = capture();
    if (hi >= 0 && JSON.stringify(hist[hi]) === JSON.stringify(s)) {
      syncLook();
      return;
    }
    hist = hist.slice(0, hi + 1);
    hist.push(s);
    if (hist.length > 60) hist.shift();
    hi = hist.length - 1;
    syncLook();
  }

  function applyState(s) {
    const b = ctx.b;
    for (const k of ["fs", "preset", "bg", "fg", "ol"]) {
      if (s[k] === undefined) delete b[k];
      else b[k] = s[k];
    }
    b.box_2d = s.box.slice();
    b.shaped = true;
    $("txt").value = s.text;
    ctx.span.textContent = s.text;
    KT.relayout(ctx.o, ctx.it);
    KT.restyle(ctx.o, ctx.it);
    syncLook();
    position(ctx.box);
  }

  function undo() {
    if (!ctx) return;
    clearTimeout(typeTimer);
    record();
    if (hi <= 0) return;
    hi--;
    applyState(hist[hi]);
  }

  function redo() {
    if (!ctx || hi >= hist.length - 1) return;
    hi++;
    applyState(hist[hi]);
  }

  function applyLook(change) {
    if (!ctx) return;
    change(ctx.b);
    KT.restyle(ctx.o, ctx.it);
    record();
  }

  Object.entries(KT.PRESETS).forEach(([k, P]) => {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = P.label;
    $("preset").appendChild(o);
  });
  $("preset").addEventListener("change", () =>
    applyLook((b) => {
      const P = KT.PRESETS[$("preset").value];
      b.preset = $("preset").value;
      b.bg = P.bg;
      b.fg = P.fg;
      if (P.ol) b.ol = P.ol;
      else delete b.ol;
    })
  );
  $("bgc").addEventListener("input", () => {
    $("nofill").checked = false;
    applyLook((b) => (b.bg = $("bgc").value));
  });
  $("nofill").addEventListener("change", () => applyLook((b) => (b.bg = $("nofill").checked ? "transparent" : $("bgc").value)));
  $("fgc").addEventListener("input", () => applyLook((b) => (b.fg = $("fgc").value)));
  $("olon").addEventListener("change", () =>
    applyLook((b) => {
      if ($("olon").checked) b.ol = $("olc").value;
      else delete b.ol;
    })
  );
  $("olc").addEventListener("input", () => {
    $("olon").checked = true;
    applyLook((b) => (b.ol = $("olc").value));
  });
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);

  // Next and previous bubble in reading order. Unchanged bubbles close without being saved again.
  async function go(dir) {
    if (!ctx) return;
    const items = KT.allItems();
    const n = items.findIndex((x) => x.b === ctx.b) + dir;
    if (n < 0 || n >= items.length) {
      KT.toast(dir > 0 ? "That was the last bubble on the page so far." : "That was the first bubble on the page.");
      return;
    }
    const dirty = JSON.stringify(capture()) !== JSON.stringify(hist[0]);
    if (dirty) {
      await save();
      const again = KT.allItems()[n];
      if (again) reveal(again);
    } else {
      const target = items[n];
      discard(true);
      reveal(target);
    }
  }

  function reveal(c) {
    c.box.scrollIntoView({ block: "center", behavior: "auto" });
    setTimeout(() => openEditor(c), 80);
  }
  $("next").addEventListener("click", () => go(1));
  $("prev").addEventListener("click", () => go(-1));

  // Throw away unsaved changes and put the bubble back as it was.
  function discard(soft) {
    if (!ctx) return;
    const c = ctx;
    ctx = null;
    c.b.translation = c.backup.translation;
    if (c.backup.fs === undefined) delete c.b.fs;
    else c.b.fs = c.backup.fs;
    c.b.box_2d = c.backup.box_2d;
    for (const k of ["preset", "bg", "fg", "ol", "shaped"]) {
      if (c.backup[k] === undefined) delete c.b[k];
      else c.b[k] = c.backup[k];
    }
    c.it.editing = false;
    if (c.it.grip) c.it.grip.style.opacity = "0";
    editor.classList.remove("open");
    if (soft === true) {
      c.span.textContent = c.b.translation;
      c.box.style.opacity = "1";
      KT.relayout(c.o, c.it);
      KT.restyle(c.o, c.it);
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
    clearTimeout(typeTimer);
    typeTimer = setTimeout(record, 600);
  });
  $("fplus").addEventListener("click", () => ctx && setFontPx(liveSize() * 1.1));
  $("fminus").addEventListener("click", () => ctx && setFontPx(liveSize() / 1.1));
  $("fauto").addEventListener("click", () => {
    if (!ctx) return;
    delete ctx.b.fs;
    KT.refit(ctx.o, ctx.it);
    record();
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

  // Keyboard flow: Ctrl+Z and Ctrl+Y undo and redo, Ctrl+Enter saves and goes to the next bubble,
  // Alt+Left and Alt+Right move between bubbles.
  editor.addEventListener("keydown", (e) => {
    if (!ctx) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && k === "enter") {
      e.preventDefault();
      go(1);
    } else if (e.altKey && k === "arrowright") {
      e.preventDefault();
      go(1);
    } else if (e.altKey && k === "arrowleft") {
      e.preventDefault();
      go(-1);
    }
  });

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
    record,
    reposition() {
      if (ctx) position(ctx.box);
    }
  };
})();
