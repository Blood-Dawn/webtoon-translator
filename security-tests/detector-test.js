// The detector first pipeline in a real browser, with a fake Ollama. A synthetic panel with two speech bubbles is
// served. The detector must find both, each bubble must be cropped and read on its own, and the translated
// bubbles must be placed where the bubbles are.
const { chromium } = require("playwright");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PT_PORT || 8443);
const log = [];

function startFakeOllama() {
  let ocrCalls = 0;
  return new Promise((resolve) => {
    const s = http.createServer((req, rsp) => {
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        const send = (obj) => {
          rsp.writeHead(200, { "content-type": "application/json" });
          rsp.end(JSON.stringify(obj));
        };
        if (req.headers.origin && req.headers.origin.startsWith("chrome-extension://")) {
          rsp.writeHead(403);
          return rsp.end("forbidden");
        }
        if (req.url === "/api/chat") {
          const j = JSON.parse(body);
          const prompt = (j.messages && j.messages[0] && j.messages[0].content) || "";
          const hasImage = !!(j.messages && j.messages[0] && j.messages[0].images);
          log.push({ hasImage, ocr: prompt.includes("Read all of the Korean text"), format: !!j.format });
          if (hasImage) {
            if (prompt.includes("Read all of the Korean text")) {
              ocrCalls++;
              return send({ message: { content: ocrCalls % 2 === 1 ? "비밀유지가\n깨질지도 몰라요" : "그래서 뭐?\n무슨 말을 하려고?" } });
            }
            return send({ message: { content: JSON.stringify({ bubbles: [], terms: [] }) } });
          }
          if (prompt.includes("These are the lines of one comic panel")) return send({ message: { content: "1. The secret might be broken.\n2. So what? What are you trying to say?" } });
          return send({ message: { content: prompt.includes("비밀유지가") ? "The secret might be broken." : "So what? What are you trying to say?" } });
        }
        if (req.url === "/api/tags") return send({ models: [{ name: "translategemma:12b", size: 8100000000 }, { name: "visionmodel:7b", size: 5000000000 }] });
        rsp.writeHead(404);
        rsp.end("not found");
      });
    });
    s.listen(11434, () => resolve(s));
  });
}

function prepareExtension(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-detector-ext-"));
  fs.cpSync(src, dir, { recursive: true, filter: (p) => !/security-tests|node_modules|\.git/.test(p) });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  mf.host_permissions = mf.host_permissions.concat(mf.optional_host_permissions || []);
  delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 2));
  return dir;
}

(async () => {
  const fake = await startFakeOllama();
  const ext = prepareExtension(path.resolve(process.argv[2] || path.join(__dirname, "..")));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wt-detector-prof-"));
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
  await sw.evaluate(() =>
    chrome.storage.local.set({
      enabled: true, chapterMode: false, batchSeconds: 0, provider: "ollama", ollamaReader: "visionmodel:7b", translator: "ollama",
      ollamaTranslator: "translategemma:12b", ollamaUrl: "http://localhost:11434", secondRead: false
    })
  );
  const results = [];
  const check = (name, ok) => { results.push([name, !!ok]); console.log((ok ? "ok    " : "FAIL  ") + name); };

  const page = await ctx.newPage();
  page.on("console", (m) => { if (/detector|offscreen|webtoon-translator/i.test(m.text())) console.log("  page:", m.text().slice(0, 200)); });
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto("https://webtoon.kakao.com/viewer/bubbles");
  await page.waitForTimeout(25000);

  const ocr = log.filter((l) => l.ocr);
  check("each bubble was cropped and read on its own (two reads, not a whole panel read)", ocr.length === 2 && log.filter((l) => l.hasImage && !l.ocr).length === 0);
  const cached = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all).filter(([k]) => k.startsWith("c:h")).map(([, v]) => v);
  });
  const boxes = cached.flat();
  check("two bubbles were stored", boxes.length === 2);
  const sorted = boxes.slice().sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  // Boxes use a 0 to 1000 scale. The panel is 900 tall, the first bubble spans y 80 to 330 and the second y 520 to 760.
  const inRange = (v, lo, hi) => v >= lo && v <= hi;
  check("the first bubble's box sits on the first bubble", sorted[0] && inRange(sorted[0].box_2d[0], 80, 170) && inRange(sorted[0].box_2d[2], 320, 390));
  check("the second bubble's box sits on the second bubble", sorted[1] && inRange(sorted[1].box_2d[0], 560, 650) && inRange(sorted[1].box_2d[2], 780, 870));
  check("the Korean was read in full and kept", sorted[0] && sorted[0].original === "비밀유지가 깨질지도 몰라요");
  check("the translation model's wording is what is shown", sorted[0] && /secret might be broken/.test(sorted[0].translation));
  check("a bubble color was estimated from the picture", sorted[0] && /^#f/i.test(sorted[0].bg) && sorted[0].fg === "#111111");
  const shown = await page.locator('[title*="Click to edit"]').count();
  check("both translated bubbles appear on the page", shown === 2);

  await ctx.close();
  fake.close();
  const failed = results.filter((r) => !r[1]);
  if (failed.length) {
    console.log("\n" + failed.length + " detector check(s) failed");
    process.exit(1);
  }
  console.log("\nAll detector checks passed");
})();
