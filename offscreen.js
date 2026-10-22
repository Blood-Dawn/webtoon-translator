// Runs the text detector on this computer. The model file ships inside the extension and nothing is downloaded or sent anywhere.
// Only the extension's own service worker can ask this page for work.
const MODEL_FILE = "models/detector-v4-s_int8.onnx";
const SIZE = 640;
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
      // One thread, so the page does not need the cross-origin isolation that threads would require.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const buf = await (await fetch(chrome.runtime.getURL(MODEL_FILE))).arrayBuffer();
      return ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
    })();
    sessionPromise.catch(() => {
      sessionPromise = null; // try again on the next request
    });
  }
  return sessionPromise;
}

async function detectTile(session, bmp, y0, y1) {
  const W = bmp.width;
  const th = y1 - y0;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, y0, W, th, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = px[i * 4] / 255;
    data[plane + i] = px[i * 4 + 1] / 255;
    data[2 * plane + i] = px[i * 4 + 2] / 255;
  }
  const out = await session.run({
    images: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]),
    orig_target_sizes: new ort.Tensor("int64", BigInt64Array.from([BigInt(W), BigInt(th)]), [1, 2])
  });
  const labels = out.labels.data;
  const boxes = out.boxes.data;
  const scores = out.scores.data;
  const dets = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < 0.3) continue;
    dets.push({ c: Number(labels[i]), s: Number(scores[i]), b: [boxes[i * 4], boxes[i * 4 + 1] + y0, boxes[i * 4 + 2], boxes[i * 4 + 3] + y0] });
  }
  return dets;
}

async function detect(dataUrl) {
  const session = await getSession();
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    let dets = [];
    for (const [y0, y1] of DetectorCore.tiles(bmp.width, bmp.height)) dets = dets.concat(await detectTile(session, bmp, y0, y1));
    return { W: bmp.width, H: bmp.height, dets };
  } finally {
    bmp.close();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen" || sender.id !== chrome.runtime.id) return false;
  if (msg.type === "ping") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "detect") {
    if (typeof msg.dataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(msg.dataUrl.slice(0, 40))) {
      sendResponse({ ok: false, error: "bad image" });
      return false;
    }
    detect(msg.dataUrl)
      .then((r) => sendResponse({ ok: true, W: r.W, H: r.H, dets: r.dets }))
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }
  return false;
});
