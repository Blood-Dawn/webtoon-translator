// Drives the on-page editor in a real browser: moving a bubble anywhere, looks, undo and redo,
// next and previous, and find and replace. The extension is copied with its interface made inspectable,
// because a test cannot look inside a closed shadow root. Everything else is identical.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PT_PORT || 8443);

function prepare(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-editor-ext-"));
  fs.cpSync(src, dir, { recursive: true, filter: (p) => !/security-tests|node_modules|\.git/.test(p) });
  const f = path.join(dir, "ui.js");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('mode: "closed"', 'mode: "open"'));
  return dir;
}

(async () => {
  const ext = prepare(path.resolve(process.argv[2] || path.join(__dirname, "..")));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wt-editor-prof-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      "--disable-extensions-except=" + ext,
      "--load-extension=" + ext,
      "--ignore-certificate-errors",
      "--host-resolver-rules=MAP * 127.0.0.1:" + PORT + ", EXCLUDE localhost",
      "--no-proxy-server",
      "--no-sandbox"
    ]
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(() => Secrets.set("apiKey", "AIzaSyEDITORTEST0000000000000000000"));
  await sw.evaluate(() => chrome.storage.local.set({ enabled: true, chapterMode: false, batchSeconds: 3, model: "gemini-3.8-flash" }));

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1100, height: 2600 });
  await page.goto("https://webtoon.kakao.com/viewer/test");
  await page.waitForTimeout(20000);

  const results = [];
  const check = (name, ok) => { results.push([name, !!ok]); console.log((ok ? "ok    " : "FAIL  ") + name); };
  const boxes = page.locator('[title*="Click to edit"]');
  const n = await boxes.count();
  check("two translated bubbles appear on the page", n >= 2);

  const css = (i, prop) => boxes.nth(i).evaluate((el, p) => getComputedStyle(el)[p], prop);
  const spanCss = (i, prop) => boxes.nth(i).evaluate((el, p) => getComputedStyle(el.firstElementChild)[p], prop);
  const textOf = (i) => boxes.nth(i).evaluate((el) => el.firstElementChild.textContent);

  // Move the first bubble far down, well past the bottom of its own panel.
  const startBox = await boxes.nth(0).boundingBox();
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2 + 400, { steps: 8 });
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2 + 1400, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const topPct = parseFloat(await boxes.nth(0).evaluate((el) => el.style.top));
  check("a bubble can be dragged past the bottom edge of its panel", topPct > 100);
  await page.click("#undo");
  await page.waitForTimeout(300);
  const topBack = parseFloat(await boxes.nth(0).evaluate((el) => el.style.top));
  check("Undo puts a dragged bubble back", topBack < 50);

  // Looks.
  await page.selectOption("#preset", "sfx");
  await page.waitForTimeout(200);
  check("the sound effect look makes the fill clear, uppercase and outlined",
    (await css(0, "backgroundColor")) === "rgba(0, 0, 0, 0)" && (await spanCss(0, "textTransform")) === "uppercase" && (await spanCss(0, "textShadow")) !== "none");
  await page.click("#undo");
  await page.waitForTimeout(200);
  check("Undo restores the previous look", (await spanCss(0, "textTransform")) === "none" && (await css(0, "backgroundColor")) !== "rgba(0, 0, 0, 0)");
  await page.click("#redo");
  await page.waitForTimeout(200);
  check("Redo brings the look back", (await spanCss(0, "textTransform")) === "uppercase");
  await page.selectOption("#preset", "narration");
  await page.waitForTimeout(150);
  check("the narration look has a pale yellow fill", (await css(0, "backgroundColor")) === "rgb(255, 244, 194)");
  await page.fill("#fgc", "#ff0000");
  await page.waitForTimeout(150);
  check("the text color can be changed", (await css(0, "color")) === "rgb(255, 0, 0)");

  // Text, with next and previous.
  await page.fill("#txt", "Edited first");
  await page.waitForTimeout(800);
  await page.click("#undo");
  await page.waitForTimeout(150);
  check("Undo also steps back through typing", (await page.inputValue("#txt")) === "Hello there");
  await page.fill("#txt", "Edited first");
  await page.waitForTimeout(800);
  await page.click("#next");
  await page.waitForTimeout(900);
  const allText = async () => boxes.evaluateAll((els) => els.map((e) => e.firstElementChild.textContent));
  check("Next saves this bubble and opens the following one", (await page.inputValue("#txt")) === "Second line" && (await allText()).includes("Edited first"));
  const stored = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.values(all).filter(Array.isArray).flat().filter((b) => b && b.preset).map((b) => b.preset);
  });
  check("the chosen look is saved with the bubble", stored.includes("narration"));
  await page.click("#prev");
  await page.waitForTimeout(900);
  check("Previous goes back to the first bubble", (await page.inputValue("#txt")) === "Edited first");
  await page.focus("#txt");
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(900);
  check("Ctrl+Enter goes on to the next bubble", (await page.inputValue("#txt")) === "Second line");
  await page.click("#close");

  // Find and replace.
  const panelOpen = () => page.evaluate(() => document.getElementById("kt-ui-host").shadowRoot.getElementById("panel").classList.contains("open"));
  if (!(await panelOpen())) await page.click("#fab");
  await page.waitForTimeout(400);
  await page.click('button[data-tab="find"]');
  await page.fill("#fq", "second");
  await page.fill("#fr", "third");
  await page.click("#fgo");
  const found = await page.textContent("#fmsg");
  await page.click("#freplace");
  await page.waitForTimeout(800);
  const msg = await page.textContent("#fmsg");
  const all = await boxes.evaluateAll((els) => els.map((e) => e.firstElementChild.textContent));
  check("find counts matches, ignoring case", /\d+ bubbles? match/.test(found));
  check("replace all changes the bubble text and reports it", /Changed \d+/.test(msg) && all.includes("third line") && !all.includes("Second line"));
  const saved = await sw.evaluate(async () => Object.values(await chrome.storage.local.get(null)).filter(Array.isArray).flat().some((b) => b && b.translation === "third line"));
  check("the replaced wording is saved with the chapter", saved);

  await ctx.close();
  let failed = 0;
  for (const [name, ok] of results) {
    console.log((ok ? "PASS  " : "FAIL  ") + name);
    if (!ok) failed++;
  }
  console.log(failed ? "\n" + failed + " editor check(s) failed" : "\nAll editor checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("TEST ERROR", e);
  process.exit(2);
});
