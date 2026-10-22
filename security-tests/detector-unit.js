// The detector's grouping logic on its own, with no browser or model.
const D = require("../detector-core.js");
let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log((ok ? "ok    " : "FAIL  ") + name); };

check("a short panel is one tile, a tall one is several overlapping tiles",
  D.tiles(760, 500).length === 1 && D.tiles(760, 3000).length >= 3 && D.tiles(760, 3000).every(([a, b]) => b > a) && D.tiles(760, 3000).slice(-1)[0][1] === 3000);

const dets = [
  { c: 0, s: 0.92, b: [212, 376, 685, 635] }, // bubble
  { c: 1, s: 0.77, b: [225, 442, 650, 520] }, // line one of its text
  { c: 1, s: 0.75, b: [230, 525, 640, 583] }, // line two of its text
  { c: 0, s: 0.3, b: [900, 900, 1000, 1000] }, // weak bubble, ignored
  { c: 2, s: 0.5, b: [1212, 897, 1313, 915] }, // loose text, stacked
  { c: 2, s: 0.5, b: [1215, 920, 1310, 940] },
  { c: 2, s: 0.5, b: [10, 10, 14, 12] } // far too small
];
const r = D.group(dets, 1418, 1079);
check("two text lines inside one bubble become one region", r.length === 2 && r.filter((x) => x.kind === "bubble").length === 1);
check("the region's text box covers both lines", r[0].text[1] === 442 && r[0].text[3] === 583);
check("stacked loose text lines are merged into one region", r.filter((x) => x.kind === "free").length === 1);
check("duplicate detections from overlapping tiles collapse", D.dedupe([{ c: 1, s: 0.9, b: [0, 0, 100, 50] }, { c: 1, s: 0.6, b: [2, 2, 101, 52] }]).length === 1);
const ob = D.overlayBox(r[0], 1418, 1079);
check("the overlay box is on a 0 to 1000 scale and inside the bubble", ob.every((v) => v >= 0 && v <= 1000) && ob[0] < ob[2] && ob[1] < ob[3]);
const cr = D.cropRect(r[0], 1418, 1079);
check("the crop is a bit larger than the text and stays inside the image", cr[0] < 225 && cr[2] > 650 && cr[0] >= 0 && cr[3] <= 1079);
check("at most 14 regions are returned", D.group(Array.from({ length: 30 }, (_, i) => ({ c: 1, s: 0.9, b: [20, i * 60, 300, i * 60 + 40] })), 1000, 2000).length === 14);
if (bad) { console.log("\n" + bad + " grouping check(s) failed"); process.exit(1); }
console.log("\nAll grouping checks passed");
