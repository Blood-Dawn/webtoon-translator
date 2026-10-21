// Checks the local model (Ollama) support against a fake Ollama server.
// The fake server behaves like the real one in one important way: it refuses requests that carry a
// browser extension origin, which is what a real Ollama does unless OLLAMA_ORIGINS is set.
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const KEY = "AIzaSyCANARY-SECRET-KEY-00000000000000";
const PORT = Number(process.env.PT_PORT || 8443);
const LOG = process.env.PT_LOG || path.join(__dirname, "requests.jsonl");

const ollamaLog = [];
function startFakeOllama() {
  return new Promise((resolve) => {
    const s = http.createServer((req, rsp) => {
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        ollamaLog.push({ url: req.url, method: req.method, origin: req.headers.origin || null, hasImages: body.includes('"images"'), body: body.slice(0, 4000) });
        const send = (code, obj) => {
          rsp.writeHead(code, { "content-type": "application/json" });
          rsp.end(typeof obj === "string" ? obj : JSON.stringify(obj));
        };
        if (req.headers.origin && req.headers.origin.startsWith("chrome-extension://")) return send(403, "forbidden");
        if (req.url === "/api/tags") {
          return send(200, { models: [{ name: "translategemma:12b", size: 8100000000 }, { name: "visionmodel:7b", size: 5000000000 }] });
        }
        if (req.url === "/api/show") {
          return send(200, { capabilities: body.includes("visionmodel") ? ["completion", "vision"] : ["completion"] });
        }
        if (req.url === "/api/chat") {
          if (body.includes('"images"')) {
            const reply = { bubbles: [{ box_2d: [100, 100, 300, 600], original: "안녕", translation: "Hello from local", bg: "#ffffff", fg: "#111111" }], terms: [] };
            return send(200, { message: { content: JSON.stringify(reply) } });
          }
          return send(200, { message: { content: "LOCAL TRANSLATION" } });
        }
        send(404, "not found");
      });
    });
    s.listen(11434, () => resolve(s));
  });
}

// The extension is copied with the localhost permission made required, because a test cannot click
// the browser's permission prompt. Everything else is identical.
function prepareExtension(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-local-ext-"));
  fs.cpSync(src, dir, { recursive: true, filter: (p) => !/security-tests|node_modules|\.git/.test(p) });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  mf.host_permissions = mf.host_permissions.concat(mf.optional_host_permissions || []);
  delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 2));
  return dir;
}

async function launch(ext) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wt-local-prof-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      "--disable-extensions-except=" + ext,
      "--load-extension=" + ext,
      "--ignore-certificate-errors",
      "--host-resolver-rules=MAP * 127.0.0.1:" + PORT + ", EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--no-proxy-server",
      "--no-sandbox"
    ]
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  return { ctx, sw, id: sw.url().split("/")[2] };
}

const cachedTranslations = (sw) =>
  sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith("c:"))
      .flatMap(([, v]) => (Array.isArray(v) ? v.map((b) => b.translation) : []));
  });

const geminiCount = () => fs.readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes('"host":"generativelanguage.googleapis.com"')).length;

(async () => {
  const ext = prepareExtension(path.resolve(process.argv[2] || path.join(__dirname, "..")));
  const fake = await startFakeOllama();
  const results = [];
  const check = (name, ok) => results.push([name, !!ok]);

  // ---- Phase A: Gemini reads, a local model translates ----
  let a = await launch(ext);
  await a.sw.evaluate((k) => Secrets.set("apiKey", k), KEY);
  const options = await a.ctx.newPage();
  await options.goto("chrome-extension://" + a.id + "/options.html");
  await options.click("#findModels");
  await options.waitForTimeout(1500);
  const found = await options.textContent("#localresult");
  check("Find my models lists the installed models and marks the one that reads images",
    /translategemma:12b/.test(found) && /visionmodel:7b.*reads images/.test(found) && !/translategemma:12b.*reads images/.test(found));
  await options.fill("#ollamaTranslator", "translategemma:12b");
  await options.click("#testLocal");
  await options.waitForTimeout(2000);
  const tested = await options.textContent("#localresult");
  check("Test local translation shows the model's answer, so the extension origin is not refused", /LOCAL TRANSLATION/.test(tested));
  await options.close();

  await a.sw.evaluate(() =>
    chrome.storage.local.set({ enabled: true, batchSeconds: 3, keepDebug: true, translator: "ollama", ollamaTranslator: "translategemma:12b", ollamaUrl: "http://localhost:11434" })
  );
  // One earlier line of this series is already remembered, and the series has a story summary.
  await a.sw.evaluate(() =>
    chrome.storage.local.set({
      tm: [{ s: "webtoon.kakao.com:any", ko: "안녕하세요 여러분", en: "Hello everyone MEMORYCANARY" }],
      summaries: { "webtoon.kakao.com:any": "STORYCANARY the hero starts work at a bank." }
    })
  );
  const geminiBefore = geminiCount();
  const pageA = await a.ctx.newPage();
  await pageA.goto("https://webtoon.kakao.com/viewer/test");
  await pageA.waitForTimeout(20000);
  // Both test panels are identical images and share one cache entry, so the kept debug copy of the batch is read instead.
  const tA = await a.sw.evaluate(async () => ((await chrome.storage.local.get("dbgBatches")).dbgBatches || []).flatMap((b) => (b.boxes || []).map((x) => x.translation)));
  check("with Gemini as the reader, the local model's wording is what gets shown", tA.includes("LOCAL TRANSLATION"));
  check("Gemini was still used to read the panels in that mode", geminiCount() > geminiBefore);
  const textChats = ollamaLog.filter((e) => e.url === "/api/chat" && !e.hasImages);
  check("the local translator received Korean text and no image", textChats.length >= 1 && textChats.every((e) => !e.body.includes("base64")));
  check("a similar earlier line and the story summary reach the local translator",
    textChats.some((e) => e.body.includes("MEMORYCANARY") && e.body.includes("STORYCANARY")));
  const remembered = await a.sw.evaluate(async () => (await TM.load()).filter((e) => e.ko === "안녕하세요").map((e) => e.en));
  check("the new translation is added to the memory", remembered.includes("LOCAL TRANSLATION"));
  await a.ctx.close();

  // ---- Phase B: everything local, no Gemini key at all ----
  ollamaLog.length = 0;
  const b = await launch(ext);
  await b.sw.evaluate(() =>
    chrome.storage.local.set({ enabled: true, batchSeconds: 3, provider: "ollama", ollamaReader: "visionmodel:7b", translator: "same", ollamaUrl: "http://localhost:11434" })
  );
  const geminiBeforeB = geminiCount();
  const pageB = await b.ctx.newPage();
  await pageB.goto("https://webtoon.kakao.com/viewer/test");
  await pageB.waitForTimeout(22000);
  const tB = await cachedTranslations(b.sw);
  check("with a local reader, translation works with no API key and no Gemini request", tB.includes("Hello from local") && geminiCount() === geminiBeforeB);
  const imageChats = ollamaLog.filter((e) => e.url === "/api/chat" && e.hasImages);
  check("panel images went to the local server", imageChats.length >= 1);
  check("no request to the local server carried a browser origin", ollamaLog.length > 0 && ollamaLog.every((e) => e.origin === null));

  // ---- Phase C: only this computer is allowed ----
  const guard = await b.sw.evaluate(() => {
    const bad = ["http://evil.example:11434", "http://127.0.0.1.evil.example", "http://localhost:11434@evil.example", "https://localhost:11434", "http://192.168.1.5:11434", "ftp://localhost"];
    const good = ["http://localhost:11434", "http://127.0.0.1:11434/"];
    const refused = bad.map((u) => { try { Ollama.baseUrl(u); return false; } catch (e) { return true; } });
    const accepted = good.map((u) => { try { Ollama.baseUrl(u); return true; } catch (e) { return false; } });
    return { refused, accepted };
  });
  const units = await b.sw.evaluate(() => {
    const list = [{ s: "x:1", ko: "안녕하세요 여러분", en: "Hello everyone" }, { s: "other:2", ko: "안녕하세요 여러분", en: "WRONG SERIES" }, { s: "x:1", ko: "전혀 다른 문장입니다", en: "Unrelated" }];
    const found = TM.find(list, { "안녕하세요 여러분들": "Hello friends (reader)" }, "x:1", "안녕하세요 여러분!", 3);
    return {
      first: found[0] && found[0].en,
      count: found.length,
      sameSeriesOnly: found.every((f) => f.en !== "WRONG SERIES" && f.en !== "Unrelated"),
      hunyuan: Ollama.styleFor("hunyuan-mt-7b") + "," + Ollama.styleFor("hy-mt2:7b") + "," + Ollama.styleFor("translategemma:12b"),
      prompt: buildPrompt("English", "", {}, [], "SUMMARYCANARY").includes("SUMMARYCANARY") && contextBlock("", [], "SUMMARYCANARY").includes("SUMMARYCANARY")
    };
  });
  check("memory finds similar lines of the same series, the reader's own corrections first", units.first === "Hello friends (reader)" && units.count === 2 && units.sameSeriesOnly);
  check("Hunyuan models get their own prompt style, and the summary joins both prompt builders", units.hunyuan === "hunyuan,hunyuan,translategemma" && units.prompt);
  check("addresses outside this computer are refused, local ones accepted", guard.refused.every(Boolean) && guard.accepted.every(Boolean));
  await b.ctx.close();
  fake.close();

  let failed = 0;
  for (const [name, ok] of results) {
    console.log((ok ? "PASS  " : "FAIL  ") + name);
    if (!ok) failed++;
  }
  console.log(failed ? "\n" + failed + " local model check(s) failed" : "\nAll local model checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("TEST ERROR", e);
  process.exit(2);
});
