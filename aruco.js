// Finding ArUco stickers (4×4 codes with a black border) on a grey picture – a small,
// dependency-free detector. It only has to answer "which stickers are on this photo and
// how big are they": the exact straightening is the processor's job (OpenCV, on the PC).
//
// How: adaptive threshold → connected dark patches → a patch whose outline is a
// quadrilateral → read the 6×6 cells through the perspective → look the code up.

const CELLS = 6; // 4×4 code + the black border
const MIN_SIDE_PX = 14; // smaller than this cannot be read reliably
const MAX_BORDER_ERRORS = 1;
const MIN_CELL_CONTRAST = 40;

function integralImage(gray, width, height) {
  const sums = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  return sums;
}

/** 1 where the pixel is clearly darker than its neighbourhood. */
function darkMask(gray, width, height) {
  const sums = integralImage(gray, width, height);
  const radius = Math.max(8, Math.round(Math.min(width, height) / 30));
  const mask = new Uint8Array(width * height);
  const stride = width + 1;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum =
        sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (gray[y * width + x] < mean - 12) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** The corners of the patch if its outline is a (convex) quadrilateral, clockwise. */
function quadOf(pixels, count, width) {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < count; i++) {
    cx += pixels[i] % width;
    cy += (pixels[i] / width) | 0;
  }
  cx /= count;
  cy /= count;

  const farthestFrom = (px, py) => {
    let best = -1;
    let at = 0;
    for (let i = 0; i < count; i++) {
      const dx = (pixels[i] % width) - px;
      const dy = ((pixels[i] / width) | 0) - py;
      const d = dx * dx + dy * dy;
      if (d > best) {
        best = d;
        at = pixels[i];
      }
    }
    return [at % width, (at / width) | 0];
  };
  const a = farthestFrom(cx, cy);
  const c = farthestFrom(a[0], a[1]);
  // The other two corners: the farthest points on either side of the diagonal a–c.
  const nx = c[1] - a[1];
  const ny = a[0] - c[0];
  let most = 0;
  let least = 0;
  let b = null;
  let d = null;
  for (let i = 0; i < count; i++) {
    const x = pixels[i] % width;
    const y = (pixels[i] / width) | 0;
    const side = (x - a[0]) * nx + (y - a[1]) * ny;
    if (side > most) {
      most = side;
      b = [x, y];
    } else if (side < least) {
      least = side;
      d = [x, y];
    }
  }
  if (!b || !d) return null;

  let quad = [a, b, c, d];
  const area = (q) => {
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = q[i];
      const [x1, y1] = q[(i + 1) % 4];
      sum += x0 * y1 - x1 * y0;
    }
    return sum / 2;
  };
  let signed = area(quad);
  if (signed < 0) {
    quad = [a, d, c, b];
    signed = -signed;
  }
  // A square sticker: its dark pixels fill most of the quadrilateral, and the sides are alike.
  if (count < signed * 0.45 || count > signed * 1.15) return null;
  const sides = quad.map((p, i) => Math.hypot(p[0] - quad[(i + 1) % 4][0], p[1] - quad[(i + 1) % 4][1]));
  const shortest = Math.min(...sides);
  if (shortest < MIN_SIDE_PX || Math.max(...sides) > shortest * 2.5) return null;
  return { quad, side: sides.reduce((s, v) => s + v, 0) / 4 };
}

/** The projective map of the unit square onto the quadrilateral. */
function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-9) return null;
  const g = (sx * dy2 - dx2 * sy) / det;
  const h = (dx1 * sy - sx * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
  };
}

function readCells(gray, width, height, quad) {
  const map = squareToQuad(quad);
  if (!map) return null;
  const cells = new Float32Array(CELLS * CELLS);
  for (let row = 0; row < CELLS; row++) {
    for (let col = 0; col < CELLS; col++) {
      let sum = 0;
      let n = 0;
      for (const dv of [0.35, 0.5, 0.65]) {
        for (const du of [0.35, 0.5, 0.65]) {
          const [x, y] = map((col + du) / CELLS, (row + dv) / CELLS);
          const xi = Math.round(x);
          const yi = Math.round(y);
          if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
          sum += gray[yi * width + xi];
          n++;
        }
      }
      cells[row * CELLS + col] = sum / n;
    }
  }
  const low = Math.min(...cells);
  const high = Math.max(...cells);
  if (high - low < MIN_CELL_CONTRAST) return null;
  const threshold = (low + high) / 2;

  let borderErrors = 0;
  let code = 0;
  for (let row = 0; row < CELLS; row++) {
    for (let col = 0; col < CELLS; col++) {
      const white = cells[row * CELLS + col] > threshold;
      if (row === 0 || col === 0 || row === CELLS - 1 || col === CELLS - 1) {
        if (white) borderErrors++;
      } else {
        code = (code << 1) | (white ? 1 : 0);
      }
    }
  }
  return borderErrors > MAX_BORDER_ERRORS ? null : code;
}

/** The 16-bit code turned a quarter clockwise. */
function rotate(code) {
  let out = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      // new[row][col] = old[3 - col][row]
      const bit = (code >> (15 - ((3 - col) * 4 + row))) & 1;
      out = (out << 1) | bit;
    }
  }
  return out;
}

let lookupFor = null;
let lookup = null;

function idOf(code, dictionary) {
  if (lookupFor !== dictionary) {
    lookup = new Map();
    dictionary.forEach((entry, id) => {
      let turned = entry;
      for (let i = 0; i < 4; i++) {
        lookup.set(turned, id);
        turned = rotate(turned);
      }
    });
    lookupFor = dictionary;
  }
  return lookup.get(code);
}

/**
 * The stickers on a grey picture (Uint8Array, row by row).
 * Returns [{id, corners: [[x, y] × 4], side}] – `side` is the sticker's width in pixels.
 */
export function detectMarkers(gray, width, height, dictionary) {
  const mask = darkMask(gray, width, height);
  const stack = new Int32Array(width * height);
  const maxSide = Math.min(width, height) / 2;
  const found = new Map();

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    // Flood fill; the stack doubles as the list of the patch's pixels.
    let count = 0;
    let read = 0;
    stack[count++] = start;
    mask[start] = 2;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (read < count) {
      const at = stack[read++];
      const x = at % width;
      const y = (at / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[at - 1] === 1) (mask[at - 1] = 2), (stack[count++] = at - 1);
      if (x < width - 1 && mask[at + 1] === 1) (mask[at + 1] = 2), (stack[count++] = at + 1);
      if (y > 0 && mask[at - width] === 1) (mask[at - width] = 2), (stack[count++] = at - width);
      if (y < height - 1 && mask[at + width] === 1) (mask[at + width] = 2), (stack[count++] = at + width);
    }
    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (boxW < MIN_SIDE_PX || boxH < MIN_SIDE_PX || boxW > maxSide || boxH > maxSide) continue;
    if (boxW > boxH * 3 || boxH > boxW * 3) continue;

    const shape = quadOf(stack, count, width);
    if (!shape) continue;
    const code = readCells(gray, width, height, shape.quad);
    if (code === null) continue;
    const id = idOf(code, dictionary);
    if (id === undefined) continue;
    const earlier = found.get(id);
    if (!earlier || earlier.side < shape.side) {
      found.set(id, { id, corners: shape.quad, side: shape.side });
    }
  }
  return [...found.values()];
}

/**
 * How crisp the edges of a crop are: the steepest brightness steps compared with the
 * crop's contrast. About 0.5 for a perfect black–white edge, near 0 for a smeared one.
 * Meant for the crop of one sticker at the photo's full resolution.
 */
export function sharpness(gray, width, height) {
  if (width < 3 || height < 3) return 0;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
  const percentile = (counts, total, share) => {
    let seen = 0;
    for (let value = 0; value < counts.length; value++) {
      seen += counts[value];
      if (seen >= total * share) return value;
    }
    return counts.length - 1;
  };
  const contrast = percentile(histogram, gray.length, 0.95) - percentile(histogram, gray.length, 0.05);
  if (contrast < MIN_CELL_CONTRAST) return 0;

  const steps = new Uint32Array(256);
  let total = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      const gx = Math.abs(gray[at + 1] - gray[at - 1]) / 2;
      const gy = Math.abs(gray[at + width] - gray[at - width]) / 2;
      steps[Math.min(255, Math.round(Math.max(gx, gy)))]++;
      total++;
    }
  }
  return percentile(steps, total, 0.97) / contrast;
}
