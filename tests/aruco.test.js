import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { detectMarkers, sharpness } from "../aruco.js";
import { DICTIONARY } from "../dictionary.js";

// Generated pictures only (tools/make_data.py) – never a real photo of the wall.
function fixture(name) {
  const base = new URL(`./fixtures/${name}`, import.meta.url);
  const meta = JSON.parse(readFileSync(new URL(`${base}.json`), "utf-8"));
  const gray = new Uint8Array(gunzipSync(readFileSync(new URL(`${base}.gray.gz`))));
  assert.equal(gray.length, meta.width * meta.height);
  return { ...meta, gray };
}

function detect(name) {
  const picture = fixture(name);
  const markers = detectMarkers(picture.gray, picture.width, picture.height, DICTIONARY);
  return { picture, markers, ids: markers.map((m) => m.id).sort((a, b) => a - b) };
}

for (const name of ["door", "board-left", "two-doors-far", "door-sideways", "door-tilted"]) {
  test(`finds exactly the stickers of the picture: ${name}`, () => {
    const { picture, ids } = detect(name);
    assert.deepEqual(ids, picture.ids);
  });
}

test("a picture without stickers gives nothing (papers and text are not stickers)", () => {
  assert.deepEqual(detect("no-stickers").ids, []);
});

test("the size of a sticker tells how close the photo was taken", () => {
  for (const name of ["door", "two-doors-far", "door-tilted"]) {
    const { picture, markers } = detect(name);
    const expected = 35 * picture.px_per_mm; // a sticker is 35 mm wide
    for (const marker of markers) {
      assert.ok(
        Math.abs(marker.side - expected) < expected * 0.15,
        `${name}: sticker ${marker.id} is ${marker.side.toFixed(1)} px, expected ~${expected}`,
      );
    }
  }
});

test("every sticker comes with its four corners inside the picture", () => {
  const { picture, markers } = detect("door");
  for (const marker of markers) {
    assert.equal(marker.corners.length, 4);
    for (const [x, y] of marker.corners) {
      assert.ok(x >= 0 && x < picture.width && y >= 0 && y < picture.height);
    }
  }
});

function crop(picture, marker) {
  const xs = marker.corners.map((c) => c[0]);
  const ys = marker.corners.map((c) => c[1]);
  const pad = marker.side * 0.2;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const x1 = Math.min(picture.width, Math.ceil(Math.max(...xs) + pad));
  const y1 = Math.min(picture.height, Math.ceil(Math.max(...ys) + pad));
  const out = new Uint8Array((x1 - x0) * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    out.set(picture.gray.subarray(y * picture.width + x0, y * picture.width + x1), (y - y0) * (x1 - x0));
  }
  return [out, x1 - x0, y1 - y0];
}

test("a blurred sticker scores clearly lower on sharpness than a sharp one", () => {
  const sharp = detect("door");
  const sharpScores = sharp.markers.map((m) => sharpness(...crop(sharp.picture, m)));
  // The blurred picture may be too soft to read the stickers on: measure at the same places.
  const blurred = fixture("door-blurred");
  const blurredScores = sharp.markers.map((m) => sharpness(...crop(blurred, m)));

  assert.ok(Math.min(...sharpScores) > 0.25, `sharp: ${sharpScores.map((s) => s.toFixed(2))}`);
  // Edges smeared over ~2.6 px (the fixture's blur) score about 1 / (2.5 · 2.6) ≈ 0.15.
  assert.ok(Math.max(...blurredScores) < 0.2, `blurred: ${blurredScores.map((s) => s.toFixed(2))}`);
});

test("a flat crop has no sharpness to speak of", () => {
  assert.equal(sharpness(new Uint8Array(400).fill(128), 20, 20), 0);
});
