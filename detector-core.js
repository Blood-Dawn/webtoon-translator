// Pure logic for the text detector: how a tall panel is cut into tiles, and how the detector's boxes are
// grouped into bubbles. It has no browser or model code, so it can be tested on its own.
// The model (RT-DETR v2, comic text and bubble detector) reports three classes:
// 0 bubble, 1 text inside a bubble, 2 text outside a bubble.
(function (g) {
  const TEXT_MIN = 0.4;
  const BUBBLE_MIN = 0.5;
  const MAX_REGIONS = 14;

  const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const iou = (a, b) => {
    const i = inter(a, b);
    return i ? i / (area(a) + area(b) - i) : 0;
  };
  const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  const clampBox = (b, W, H) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(W, b[2]), Math.min(H, b[3])];

  // Tall panels are read in overlapping tiles, because the model was trained on near square pictures.
  function tiles(W, H) {
    const size = Math.max(320, Math.round(W * 1.25));
    if (H <= size * 1.3) return [[0, H]];
    const step = Math.round(size * 0.88);
    const out = [];
    for (let y = 0; y < H; y += step) {
      const end = Math.min(H, y + size);
      // A last sliver is folded into the tile before it.
      if (H - end < size * 0.25) {
        out.push([y, H]);
        break;
      }
      out.push([y, end]);
    }
    return out;
  }

  // Detections from overlapping tiles are de-duplicated, and a text found as both classes keeps the better one.
  function dedupe(dets) {
    const sorted = dets.slice().sort((a, b) => b.s - a.s);
    const kept = [];
    for (const d of sorted) {
      const dup = kept.some((k) => {
        const o = iou(k.b, d.b);
        return k.c === d.c ? o > 0.5 : k.c !== 0 && d.c !== 0 && o > 0.6;
      });
      if (!dup) kept.push(d);
    }
    return kept;
  }

  // Groups detections into regions: one per bubble (all its text boxes together), plus loose text.
  // Boxes are [x1, y1, x2, y2] in pixels. Each region has text (the union of its text), bubble (or null) and kind.
  function group(dets, W, H) {
    const clean = dedupe(dets.filter((d) => d.s >= (d.c === 0 ? BUBBLE_MIN : TEXT_MIN)).map((d) => Object.assign({}, d, { b: clampBox(d.b, W, H) })));
    const bubbles = clean.filter((d) => d.c === 0 && area(d.b) > 0);
    const texts = clean.filter((d) => d.c !== 0 && d.b[2] - d.b[0] >= 10 && d.b[3] - d.b[1] >= 8);
    const regions = [];
    const byBubble = new Map();
    const free = [];
    for (const t of texts) {
      let best = null;
      let bestCover = 0;
      for (const bu of bubbles) {
        const cover = inter(t.b, bu.b) / area(t.b);
        if (cover >= 0.6 && (cover > bestCover || (cover === bestCover && best && area(bu.b) < area(best.b)))) {
          best = bu;
          bestCover = cover;
        }
      }
      if (best) {
        if (!byBubble.has(best)) byBubble.set(best, []);
        byBubble.get(best).push(t);
      } else if (t.c === 1) {
        regions.push({ text: t.b, bubble: null, kind: "bubble", score: t.s });
      } else {
        free.push(t);
      }
    }
    for (const [bu, ts] of byBubble) {
      regions.push({ text: ts.map((t) => t.b).reduce(union), bubble: bu.b, kind: "bubble", score: Math.max(...ts.map((t) => t.s)) });
    }
    // Loose text lines that are stacked in one column are one piece of text.
    const parts = free.map((t) => ({ text: t.b, score: t.s })).sort((a, b) => a.text[1] - b.text[1]);
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i].text;
          const b = parts[j].text;
          const ow = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
          const minW = Math.min(a[2] - a[0], b[2] - b[0]);
          const gap = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
          const lineH = Math.max(a[3] - a[1], b[3] - b[1]);
          if (minW > 0 && ow >= minW * 0.5 && gap <= lineH * 0.6) {
            parts[i] = { text: union(a, b), score: Math.max(parts[i].score, parts[j].score) };
            parts.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    for (const p of parts) regions.push({ text: p.text, bubble: null, kind: "free", score: p.score });
    regions.sort((a, b) => a.text[1] - b.text[1] || a.text[0] - b.text[0]);
    return regions.slice(0, MAX_REGIONS);
  }

  // The box the translated text is drawn into. A bubble gets its own outline, slightly inset.
  // Text with no bubble gets its text box with some room around it. Result is [ymin, xmin, ymax, xmax] on a 0 to 1000 scale.
  function overlayBox(r, W, H) {
    let b;
    if (r.bubble) {
      const w = r.bubble[2] - r.bubble[0];
      const h = r.bubble[3] - r.bubble[1];
      b = union([r.bubble[0] + w * 0.08, r.bubble[1] + h * 0.08, r.bubble[2] - w * 0.08, r.bubble[3] - h * 0.08], r.text);
    } else {
      const w = r.text[2] - r.text[0];
      const h = r.text[3] - r.text[1];
      b = [r.text[0] - w * 0.08, r.text[1] - h * 0.15, r.text[2] + w * 0.08, r.text[3] + h * 0.15];
    }
    b = clampBox(b, W, H);
    const s = (v, full) => Math.round(Math.min(1000, Math.max(0, (v / full) * 1000)));
    return [s(b[1], H), s(b[0], W), s(b[3], H), s(b[2], W)];
  }

  // Padding around a text box when it is cropped for the reader, so the whole bubble is visible.
  function cropRect(r, W, H) {
    const w = r.text[2] - r.text[0];
    const h = r.text[3] - r.text[1];
    const px = Math.max(10, w * 0.12);
    const py = Math.max(10, h * 0.15);
    return clampBox([r.text[0] - px, r.text[1] - py, r.text[2] + px, r.text[3] + py], W, H).map(Math.round);
  }

  const api = { tiles, dedupe, group, overlayBox, cropRect, TEXT_MIN, BUBBLE_MIN };
  g.DetectorCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
