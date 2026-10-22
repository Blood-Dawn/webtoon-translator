// Chapter mode and the redo tool, in a real browser. Panels are collected without sending anything,
// the strip is built on request, everything is translated, and a chosen area can be redone.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PT_PORT || 8443);
const LOG = process.env.PT_LOG || path.join(__dirname, "requests.jsonl");

(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "wt-chapter-ext-"));
  fs.cpSync(ext, copy, { recursive: true, filter: (p) => !/security-tests|node_modules|\.git/.test(p) });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wt-chapter-prof-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      "--disable-extensions-except=" + copy,
      "--load-extension=" + copy,
      "--ignore-certificate-errors",
      "--host-resolver-rules=MAP * 127.0.0.1:" + PORT + ", EXCLUDE localhost",
      "--no-proxy-server",
      "--no-sandbox"
    ]
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(() => Secrets.set("apiKey", "AIzaSyCHAPTERTEST000000000000000000"));
  await sw.evaluate(() => chrome.storage.local.set({ enabled: true, chapterMode: true, batchSeconds: 3, model: "gemini-3.8-flash" }));

  const geminiCalls = () => fs.readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes("generativelanguage.googleapis.com")).length;
  const results = [];
  const check = (name, ok) => { results.push([name, !!ok]); console.log((ok ? "ok    " : "FAIL  ") + name); };

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1100, height: 2600 });
  const before = geminiCalls();
  await page.goto("https://webtoon.kakao.com/viewer/test");
  await page.waitForTimeout(9000);

  const pillBtn = (label) => page.locator("button", { hasText: label });
  check("nothing is sent while the chapter is being collected", geminiCalls() === before);
  check("the build button is offered", (await pillBtn("Build strip and translate").count()) > 0);

  await pillBtn("Build strip and translate").first().click();
  await page.waitForTimeout(20000);
  check("the clean strip is on the page", (await page.locator("#kt-strip img").count()) >= 2);
  check("the original page is hidden", (await page.evaluate(() => getComputedStyle(document.body).display)) === "none");
  check("translating started after the strip was built", geminiCalls() > before);
  const boxes = page.locator('[title*="Click to edit"]');
  const total = await boxes.count();
  check("translated bubbles appear on the strip", total >= 2);

  // Redo an area: drag over the whole first panel, which should leave one bubble where there were two.
  const first = await page.locator("#kt-strip img").first().boundingBox();
  const callsBefore = geminiCalls();
  await pillBtn("Redo an area").first().click();
  await page.mouse.move(first.x + 10, first.y + 10);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 10, first.y + first.height - 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(8000);
  check("the chosen area was sent to the model once", geminiCalls() === callsBefore + 1);
  const inFirst = await boxes.evaluateAll((els, r) => els.filter((e) => { const b = e.getBoundingClientRect(); const cx = b.left + b.width / 2 + window.scrollX; const cy = b.top + b.height / 2 + window.scrollY; return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h; }).length, { x: first.x, y: first.y, w: first.width, h: first.height });
  check("exactly one bubble sits in the redone panel", inFirst === 1);

  await pillBtn("Back to the original page").first().click();
  await page.waitForTimeout(1500);
  check("the strip is removed", (await page.locator("#kt-strip").count()) === 0);
  check("the original page is back", (await page.evaluate(() => getComputedStyle(document.body).display)) !== "none");

  await ctx.close();
  const failed = results.filter((r) => !r[1]);
  if (failed.length) {
    console.log("\n" + failed.length + " chapter check(s) failed");
    process.exit(1);
  }
  console.log("\nAll chapter checks passed");
})();
