// Looking at a freshly taken photo in the browser: find the stickers on a reduced copy,
// measure the sharpness on full-size crops of a few stickers, and judge (check.js).
// Nothing leaves the phone here, and nothing is logged.

import { detectMarkers, sharpness } from "./aruco.js";
import { judge } from "./check.js";
import { DICTIONARY } from "./dictionary.js";
import { GROUPS } from "./layout.js";

const SEARCH_SIDE = 1400; // the longer side of the copy the stickers are searched on
const SHARPNESS_SAMPLES = 3;
const MAX_CROP_SIDE = 600;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("A fotót nem tudtam megnyitni az ellenőrzéshez."));
    };
    image.src = url;
  });
}

/** A part of the image (sx, sy, sw, sh) drawn at w × h, as grey bytes. */
function grayOf(image, sx, sy, sw, sh, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  const rgba = context.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  }
  canvas.width = canvas.height = 0; // give the memory back at once (iPhone)
  return gray;
}

/** {items, labels, warnings, pxPerMm} for a photo file – see check.judge. */
export async function inspect(file) {
  const image = await loadImage(file);
  const fullW = image.naturalWidth;
  const fullH = image.naturalHeight;
  const shrink = Math.min(1, SEARCH_SIDE / Math.max(fullW, fullH));
  const w = Math.round(fullW * shrink);
  const h = Math.round(fullH * shrink);

  const found = detectMarkers(grayOf(image, 0, 0, fullW, fullH, w, h), w, h, DICTIONARY);
  const markers = found.map((marker) => ({
    id: marker.id,
    side: marker.side / shrink,
    corners: marker.corners.map(([x, y]) => [x / shrink, y / shrink]),
  }));

  // Sharpness: on the photo's own pixels, around the biggest stickers; the best one counts
  // (a sticker at the edge may be soft while the papers in the middle are fine).
  let best = null;
  const biggest = [...markers].sort((a, b) => b.side - a.side).slice(0, SHARPNESS_SAMPLES);
  for (const marker of biggest) {
    const xs = marker.corners.map((corner) => corner[0]);
    const ys = marker.corners.map((corner) => corner[1]);
    const pad = marker.side * 0.2;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
    const x1 = Math.min(fullW, Math.ceil(Math.max(...xs) + pad));
    const y1 = Math.min(fullH, Math.ceil(Math.max(...ys) + pad));
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 8 || ch < 8 || Math.max(cw, ch) > MAX_CROP_SIDE) continue;
    const score = sharpness(grayOf(image, x0, y0, cw, ch, cw, ch), cw, ch);
    best = best === null ? score : Math.max(best, score);
  }

  return judge({ markers, sharpness: best, groups: GROUPS });
}
