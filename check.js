// Judging a photo on the phone, right after it was taken: what does it show, is it close
// enough, is it sharp. Only advice – the photographer may keep the photo anyway, and the
// processor on the PC decides for itself.

import { MARKER_MM } from "./layout.js";

const MIN_MARKERS_PER_COLUMN = 2; // the processor's rule (board_worker/doors.py)
// A piece of a cork board: the two neighbouring stickers of its edge (layout.js).
const MIN_BOARD_STICKERS = 2;
// The far photo of a whole board: most of its stickers, and 4 of them no 3 of which lie on
// one line (the processor's homography rule: doors._general_four, MIN_OFF_LINE_MM).
const WHOLE_BOARD_SHARE = 0.6;
const MIN_OFF_LINE_MM = 100;
// The first real door photos were 4.6 px/mm and read fine; well under that the small print goes.
export const MIN_PX_PER_MM = 3.5;
// See aruco.sharpness: about 1 / (2.5 · the smear in pixels). Below this the edges are
// spread over 3 pixels or more of the full-size photo.
export const MIN_SHARPNESS = 0.13;

export function allItems(groups) {
  return groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, groupId: group.id, groupName: group.name })),
  );
}

/** Every sticker of a check-list item: a door's columns, a board piece's or a whole board's. */
export function itemStickers(item) {
  if (item.points) return item.points.map(([id]) => id);
  return item.stickers ?? item.columns.flat();
}

function boardPieceSeen(item, seen) {
  return item.stickers.filter((id) => seen.has(id)).length >= MIN_BOARD_STICKERS;
}

/** How far the farthest of three points is from the line through the other two (mm). */
function offLine(a, b, c) {
  const sides = [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]),
    Math.hypot(a[0] - c[0], a[1] - c[1])];
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const longest = Math.max(...sides);
  return longest > 0 ? area2 / longest : 0;
}

/** Are there 4 points no 3 of which lie on a line? */
export function generalFour(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
      const quad = [points[i], points[j], points[k], points[l]];
      const trios = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
      if (trios.every(([a, b, c]) => offLine(quad[a], quad[b], quad[c]) > MIN_OFF_LINE_MM)) {
        return true;
      }
    }
  return false;
}

function wholeBoardSeen(item, seen) {
  const found = item.points.filter(([id]) => seen.has(id)).map(([, x, y]) => [x, y]);
  return found.length >= Math.ceil(WHOLE_BOARD_SHARE * item.points.length) && generalFour(found);
}

function itemSeen(item, seen) {
  if (item.points) return wholeBoardSeen(item, seen);
  if (item.stickers) return boardPieceSeen(item, seen);
  return item.columns.every(
    (column) => column.filter((id) => seen.has(id)).length >= MIN_MARKERS_PER_COLUMN,
  );
}

/** The check-list items a photo with these sticker ids ticks. */
export function coveredItems(ids, groups) {
  const seen = new Set(ids);
  return allItems(groups)
    .filter((item) => itemSeen(item, seen))
    .map((item) => item.id);
}

/**
 * Which half of each item the photo shows: [{id, top, bottom}].
 *
 * A door may be photographed in two closer photos. Its columns have three stickers (top,
 * middle, bottom): a photo reaches the top half if it holds the top sticker and one below
 * it in both columns, and the bottom half likewise. A piece of a cork board is half a
 * board already: a photo that counts for it always shows all of it.
 */
export function coveredParts(ids, groups) {
  const seen = new Set(ids);
  const parts = [];
  for (const item of allItems(groups)) {
    if (item.stickers || item.points) {
      if (itemSeen(item, seen)) parts.push({ id: item.id, top: true, bottom: true });
      continue;
    }
    const levels = item.columns.map((column) =>
      column.map((id, level) => (seen.has(id) ? level : -1)).filter((level) => level >= 0),
    );
    if (levels.some((found) => found.length < MIN_MARKERS_PER_COLUMN)) continue;
    const last = item.columns[0].length - 1;
    const top = levels.every((found) => found[0] === 0);
    const bottom = levels.every((found) => found[found.length - 1] === last);
    // Top half on one side and bottom half on the other: a photo too skewed to count.
    if (top || bottom) parts.push({ id: item.id, top, bottom });
  }
  return parts;
}

export const TOP = "top";
export const BOTTOM = "bottom";
export const markOf = (id, half) => `${id}:${half}`;

/** The boards (names) a batch has close photos of but no far photo of the whole board. */
export function missingFarPhotos(marks, groups) {
  const have = new Set(marks.map((mark) => mark.split(":")[0]));
  return groups
    .filter((group) => {
      const far = group.items.find((item) => item.whole);
      if (!far || have.has(far.id)) return false;
      return group.items.some((item) => !item.whole && have.has(item.id));
    })
    .map((group) => group.name);
}

/**
 * markers: from aruco.detectMarkers, `side` in pixels of the FULL-SIZE photo.
 * sharpness: aruco.sharpness of the sharpest sticker, or null when it could not be measured.
 */
export function judge({ markers, sharpness, groups }) {
  const known = new Set(allItems(groups).flatMap(itemStickers));
  const ours = markers.filter((marker) => known.has(marker.id));
  const sides = ours.map((marker) => marker.side).sort((a, b) => a - b);
  const pxPerMm = ours.length ? sides[sides.length >> 1] / MARKER_MM : null;
  const far = pxPerMm !== null && pxPerMm < MIN_PX_PER_MM;
  const byId = new Map(allItems(groups).map((i) => [i.id, i]));
  let parts = coveredParts(ours.map((marker) => marker.id), groups);
  // A far photo of a whole board is meant to be far: it ticks the whole board, but not the
  // board's close pieces (their small print would not be readable on it).
  const wholeBoards = new Set(
    parts.filter((part) => byId.get(part.id).whole).map((part) => byId.get(part.id).groupId),
  );
  if (far) {
    parts = parts.filter((part) => {
      const item = byId.get(part.id);
      return item.whole || !wholeBoards.has(item.groupId);
    });
  }
  const items = parts.map((part) => part.id);
  const names = new Map([...byId.values()].map((i) => [i.id, `${i.groupName} – ${i.label}`]));
  // What the round remembers (rounds.js): one mark per half that was photographed.
  const marks = parts.flatMap((part) => [
    ...(part.top ? [markOf(part.id, TOP)] : []),
    ...(part.bottom ? [markOf(part.id, BOTTOM)] : []),
  ]);
  const labels = parts.map((part) => {
    const half = part.top && part.bottom ? "" : part.top ? " (a teteje)" : " (az alja)";
    return names.get(part.id) + half;
  });
  const warnings = [];

  if (ours.length === 0) {
    warnings.push({
      code: "no-markers",
      text: "Nem látok matricát a képen. Úgy fotózz, hogy az ajtó két szélén lévő matricák is rajta legyenek.",
    });
  } else {
    if (items.length === 0) {
      warnings.push({
        code: "too-few",
        text: `Csak ${ours.length} matricát látok. Egy ajtóhoz mindkét oldaláról legalább 2–2 kell, a parafatáblánál a szélén 2 szomszédos.`,
      });
    }
    const onlyWhole = items.length > 0 && items.every((id) => byId.get(id).whole);
    if (far && !onlyWhole) {
      warnings.push({
        code: "too-far",
        text: "Túl messziről készült, az apró betű nem lesz olvasható. Menj közelebb: egy fotó = egy ajtó.",
      });
    }
    if (sharpness !== null && sharpness < MIN_SHARPNESS) {
      warnings.push({
        code: "blurred",
        text: "Életlen lett. Próbáld újra, és tartsd nyugodtan a telefont.",
      });
    }
  }
  return { items, marks, labels, warnings, pxPerMm };
}
