// Judging a photo on the phone, right after it was taken: what does it show, is it close
// enough, is it sharp. Only advice – the photographer may keep the photo anyway, and the
// processor on the PC decides for itself.

import { MARKER_MM } from "./layout.js";

const MIN_MARKERS_PER_COLUMN = 2; // the processor's rule (board_worker/doors.py)
// The first real door photos were 4.6 px/mm and read fine; well under that the small print goes.
export const MIN_PX_PER_MM = 3.5;
// See aruco.sharpness: about 1 / (2.5 · the smear in pixels). Below this the edges are
// spread over 3 pixels or more of the full-size photo.
export const MIN_SHARPNESS = 0.13;

export function allItems(groups) {
  return groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, groupName: group.name })),
  );
}

/** The check-list items a photo with these sticker ids ticks. */
export function coveredItems(ids, groups) {
  const seen = new Set(ids);
  return allItems(groups)
    .filter((item) =>
      item.columns.every(
        (column) => column.filter((id) => seen.has(id)).length >= MIN_MARKERS_PER_COLUMN,
      ),
    )
    .map((item) => item.id);
}

/**
 * Which half of each item the photo shows: [{id, top, bottom}].
 *
 * A door may be photographed in two closer photos. Its columns have three stickers (top,
 * middle, bottom): a photo reaches the top half if it holds the top sticker and one below
 * it in both columns, and the bottom half likewise. A board part has two stickers per
 * column, so a photo that counts for it always shows all of it.
 */
export function coveredParts(ids, groups) {
  const seen = new Set(ids);
  const parts = [];
  for (const item of allItems(groups)) {
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

/**
 * markers: from aruco.detectMarkers, `side` in pixels of the FULL-SIZE photo.
 * sharpness: aruco.sharpness of the sharpest sticker, or null when it could not be measured.
 */
export function judge({ markers, sharpness, groups }) {
  const known = new Set(allItems(groups).flatMap((item) => item.columns.flat()));
  const ours = markers.filter((marker) => known.has(marker.id));
  const parts = coveredParts(ours.map((marker) => marker.id), groups);
  const items = parts.map((part) => part.id);
  const names = new Map(allItems(groups).map((i) => [i.id, `${i.groupName} – ${i.label}`]));
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
  let pxPerMm = null;

  if (ours.length === 0) {
    warnings.push({
      code: "no-markers",
      text: "Nem látok matricát a képen. Úgy fotózz, hogy az ajtó két szélén lévő matricák is rajta legyenek.",
    });
  } else {
    const sides = ours.map((marker) => marker.side).sort((a, b) => a - b);
    pxPerMm = sides[sides.length >> 1] / MARKER_MM;
    if (items.length === 0) {
      warnings.push({
        code: "too-few",
        text: `Csak ${ours.length} matricát látok. Egy ajtóhoz mindkét oldaláról legalább 2–2 kell.`,
      });
    }
    if (pxPerMm < MIN_PX_PER_MM) {
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
