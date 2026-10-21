// Loads the extension in Chromium, enters a fake API key the way a user would, opens a
// simulated Kakao chapter and checks where the key and the user's data end up.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const KEY = "AIzaSyCANARY-SECRET-KEY-00000000000000";
const PORT = Number(process.env.PT_PORT || 8443);
const LOG = process.env.PT_LOG || path.join(__dirname, "requests.jsonl");

(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wt-pentest-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      "--disable-extensions-except=" + ext,
      "--load-extension=" + ext,
      // Every host name resolves to the local test server, and its certificate is accepted.
      // These flags apply to this throwaway browser only.
      "--ignore-certificate-errors",
      "--host-resolver-rules=MAP * 127.0.0.1:" + PORT + ", EXCLUDE localhost",
      "--no-proxy-server",
      "--no-sandbox"
    ]
  });

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const id = sw.url().split("/")[2];

  // An install upgraded from an older version has its key in regular storage. It must be moved.
  const migration = await sw.evaluate(async () => {
    if (typeof Secrets === "undefined") return { available: false };
    await chrome.storage.local.set({ apiKey: "LEGACY-KEY-123456" });
    await Secrets.migrate();
    const moved = await Secrets.get("apiKey");
    const left = (await chrome.storage.local.get("apiKey")).apiKey;
    return { available: true, moved: moved === "LEGACY-KEY-123456", leftBehind: left !== undefined };
  });

  // Enter the key through the options page, like a real user.
  const options = await ctx.newPage();
  await options.goto("chrome-extension://" + id + "/options.html");
  await options.fill("#apiKey", KEY);
  await options.click("#save");
  await options.waitForTimeout(800);
  await options.click("#testKey");
  await options.waitForTimeout(1500);
  const testResult = await options.textContent("#testresult");
  const step2Done = await options.evaluate(() => document.getElementById("step2").classList.contains("done"));

  // A hand-edited settings file must not be able to add keys or touch the API key.
  const hostile = path.join(profile, "hostile.json");
  fs.writeFileSync(
    hostile,
    JSON.stringify({ app: "webtoon-translator", version: 1, settings: { model: "imported-model", apiKey: "HACKED", evil: 1, corrections: { "안녕": "Hi", bad: { x: 1 } } } })
  );
  await options.setInputFiles("#importFile", hostile);
  await options.waitForTimeout(800);
  const imported = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return { model: all.model, evil: all.evil, apiKey: all.apiKey, corrections: all.corrections, privateKey: await Secrets.get("apiKey") };
  });

  // Glossary: one approved entry for every series, one still waiting for review, one for another series.
  await sw.evaluate(() =>
    chrome.storage.local.set({
      glossary: [
        { ko: "한서진", en: "Han Seo-jin", type: "character", gender: "female", status: "approved", series: "", n: 3, t: 1 },
        { ko: "대기용어", en: "PendingOnly", type: "term", gender: "", status: "pending", series: "", n: 0, t: 1 },
        { ko: "다른작품", en: "OtherSeries", type: "term", gender: "", status: "approved", series: "other.example:9", n: 0, t: 1 }
      ]
    })
  );
  await sw.evaluate(() => chrome.storage.local.set({ enabled: true, batchSeconds: 3, model: "gemini-3.8-flash", notes: "CANARY-NOTES private series notes" }));
  await options.close();

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const worlds = [];
  cdp.on("Runtime.executionContextCreated", (e) => worlds.push(e.context));
  await cdp.send("Runtime.enable");
  await page.goto("https://webtoon.kakao.com/viewer/test");
  await page.waitForTimeout(22000);

  // What can the extension's script on the Kakao page read from storage?
  let contentScriptKeys = null;
  const world = worlds.find((w) => w.origin && w.origin.startsWith("chrome-extension://" + id));
  if (world) {
    const r = await cdp.send("Runtime.evaluate", {
      contextId: world.id,
      awaitPromise: true,
      returnByValue: true,
      expression: "chrome.storage.local.get(null).then(o => Object.keys(o).filter(k => JSON.stringify(o[k]).includes('CANARY-SECRET') || k === 'apiKey'))"
    });
    contentScriptKeys = r.result && r.result.value;
  }
  // Quota handling: a daily limit is reported at once, a per-minute limit waits as long as Google asks and then succeeds.
  const quota = await sw.evaluate(async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const out = {};
    let t0 = Date.now();
    try {
      await callGemini("AIzaDAILYQUOTA00000000000000000000", "gemini-3.8-flash", "image/png", png, "x");
      out.daily = { threw: false };
    } catch (e) {
      out.daily = { threw: true, code: e.code, msg: e.message, ms: Date.now() - t0 };
    }
    t0 = Date.now();
    try {
      const r = await callGemini("AIzaRETRYONCE00000000000000000000", "gemini-3.8-flash", "image/png", png, "x");
      out.retry = { ok: Array.isArray(r.bubbles), ms: Date.now() - t0 };
    } catch (e) {
      out.retry = { ok: false, msg: e.message };
    }
    return out;
  });
  const keptImages = await sw.evaluate(async () => (await chrome.storage.local.get("dbgBatches")).dbgBatches);
  const learned = await sw.evaluate(async () => (await chrome.storage.local.get("glossary")).glossary || []);
  await ctx.close();

  const log = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const withKey = log.filter((e) => JSON.stringify(e).includes("CANARY-SECRET"));
  const geminiCalls = log.filter((e) => e.host === "generativelanguage.googleapis.com");
  const extensionFetchedBait = log.filter((e) => e.host === "evil.example" && e.url.startsWith("/bait") && String(e.headers.origin || "").startsWith("chrome-extension://"));
  const probeRaw = log.filter((e) => e.url.startsWith("/exfil")).map((e) => e.body)[0];
  const probe = probeRaw ? JSON.parse(probeRaw) : null;

  const checks = [
    ["the key appears only in requests to Google (key test and translation), in the x-goog-api-key header only",
      withKey.length >= 1 && withKey.every((e) => e.host === "generativelanguage.googleapis.com" &&
        String(e.headers["x-goog-api-key"] || "").includes("CANARY-SECRET") &&
        !e.url.includes("CANARY-SECRET") && !e.body.includes("CANARY-SECRET"))],
    ["Test my key reports success and ticks the checklist", /works/i.test(testResult || "") && step2Done],
    ["importing a hostile settings file adds no unknown keys and leaves the API key alone",
      imported.model === "imported-model" && imported.evil === undefined && imported.apiKey === undefined &&
      imported.privateKey === KEY && imported.corrections && imported.corrections["안녕"] === "Hi" && imported.corrections.bad === undefined],
    ["debug copies of the comic pages are not kept unless the reader turns them on", keptImages === undefined],
    ["a used-up daily quota is reported at once with the reset time, not retried",
      quota.daily.threw && quota.daily.code === "DAILY_QUOTA" && /midnight Pacific/.test(quota.daily.msg) && quota.daily.ms < 2000],
    ["a per-minute limit waits as long as Google asks, then succeeds", quota.retry.ok && quota.retry.ms >= 1000 && quota.retry.ms < 15000],
    ["only approved glossary entries for this series reach Gemini",
      geminiCalls.some((e) => e.body.includes("Han Seo-jin") && e.body.includes("female")) &&
      geminiCalls.every((e) => !e.body.includes("PendingOnly") && !e.body.includes("OtherSeries"))],
    ["the fixed instructions come before the image in the request",
      geminiCalls.every((e) => { const i = e.body.indexOf("inline_data"); return i === -1 || e.body.indexOf("Korean webtoon") < i; })],
    ["a term Gemini suggests lands in the review queue as pending, not approved",
      learned.some((g) => g.ko === "테스트용어" && g.status === "pending")],
    ["translation still works (a request reached the Gemini endpoint)", geminiCalls.length >= 1],
    ["the script on the Kakao page cannot read the key from storage", Array.isArray(contentScriptKeys) && contentScriptKeys.length === 0],
    ["the extension did not fetch a web address chosen by the page", extensionFetchedBait.length === 0],
    ["a hostile page cannot read the extension panel", !!probe && probe.shadowReadable === false && probe.notesRead === null],
    ["the key is not visible in the page's HTML or JavaScript", !!probe && probe.keyInDom === false && probe.keyInWindow === false],
    ["a key left by an older version is moved to private storage and removed from regular storage", migration.available && migration.moved && !migration.leftBehind]
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? "PASS  " : "FAIL  ") + name);
    if (!ok) failed++;
  }
  console.log(failed ? "\n" + failed + " check(s) failed" : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("TEST ERROR", e);
  process.exit(2);
});
