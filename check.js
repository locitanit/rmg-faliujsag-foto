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
 * markers: from aruco.detectMarkers, `side` in pixels of the FULL-SIZE photo.
 * sharpness: aruco.sharpness of the sharpest sticker, or null when it could not be measured.
 */
export function judge({ markers, sharpness, groups }) {
  const known = new Set(allItems(groups).flatMap((item) => item.columns.flat()));
  const ours = markers.filter((marker) => known.has(marker.id));
  const items = coveredItems(ours.map((marker) => marker.id), groups);
  const names = new Map(allItems(groups).map((i) => [i.id, `${i.groupName} – ${i.label}`]));
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
  return { items, labels: items.map((id) => names.get(id)), warnings, pxPerMm };
}
