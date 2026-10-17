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
  await sw.evaluate(() => chrome.storage.local.set({ enabled: true, batchSeconds: 3, notes: "CANARY-NOTES private series notes" }));
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
  await ctx.close();

  const log = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const withKey = log.filter((e) => JSON.stringify(e).includes("CANARY-SECRET"));
  const geminiCalls = log.filter((e) => e.host === "generativelanguage.googleapis.com");
  const extensionFetchedBait = log.filter((e) => e.host === "evil.example" && e.url.startsWith("/bait") && String(e.headers.origin || "").startsWith("chrome-extension://"));
  const probeRaw = log.filter((e) => e.url.startsWith("/exfil")).map((e) => e.body)[0];
  const probe = probeRaw ? JSON.parse(probeRaw) : null;

  const checks = [
    ["the key appears in exactly one request, to Google, in the x-goog-api-key header only",
      withKey.length === 1 && withKey[0].host === "generativelanguage.googleapis.com" &&
      String(withKey[0].headers["x-goog-api-key"] || "").includes("CANARY-SECRET") &&
      !withKey[0].url.includes("CANARY-SECRET") && !withKey[0].body.includes("CANARY-SECRET")],
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
