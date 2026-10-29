import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_PX_PER_MM, MIN_SHARPNESS, allItems, coveredItems, judge } from "../check.js";
import * as checkModule from "../check.js";
import { GROUPS } from "../layout.js";

const marker = (id, side = 200) => ({ id, side, corners: [] });
const judged = (ids, extra = {}) =>
  judge({ markers: ids.map((id) => marker(id)), sharpness: 0.4, groups: GROUPS, ...extra });

test("the wall is listed left to right: two cabinet rows, the side wall, the board pieces", () => {
  assert.deepEqual(GROUPS.map((g) => [g.name, g.items.length]), [
    ["Bal szekrénysor", 6],
    ["Jobb szekrénysor", 6],
    ["Oldalfal", 1],
    ["Nagy parafatábla", 9],
    ["Kis parafatábla", 7],
  ]);
  assert.equal(allItems(GROUPS).length, 29);
  // A board piece = two neighbouring stickers of the top or the bottom edge; the board's
  // last item is its far photo.
  assert.deepEqual(GROUPS.slice(3).map((g) => g.items.at(-1).id), ["parafa-1-egesz", "parafa-2-egesz"]);
  const small = GROUPS[4].items.filter((i) => !i.whole);
  assert.deepEqual(small.map((i) => i.stickers), [
    [63, 64], [64, 65], [65, 66], [67, 68], [68, 69], [69, 70],
  ]);
  assert.deepEqual(small.map((i) => i.label).slice(0, 4), [
    "felső sor, 1. rész", "felső sor, 2. rész", "felső sor, 3. rész", "alsó sor, 1. rész",
  ]);
});

test("the side wall is a door: 2 + 2 stickers, and it can be reported empty", () => {
  const [side] = GROUPS[2].items;
  assert.deepEqual(side.columns, [[44, 45, 46], [47, 48, 49]]);
  assert.equal(side.canBeEmpty, true);
  assert.deepEqual(coveredItems([44, 45, 47, 48], GROUPS), ["oldalfal"]);
  assert.deepEqual(coveredItems([44, 45, 46, 47], GROUPS), []);
});

test("a door is ticked by two stickers from each of its sides", () => {
  assert.deepEqual(coveredItems([0, 1, 2, 3, 4, 5], GROUPS), ["sor-1-ajto-1"]);
  assert.deepEqual(coveredItems([0, 2, 3, 5], GROUPS), ["sor-1-ajto-1"]);
  assert.deepEqual(coveredItems([0, 1, 2, 3], GROUPS), []); // 3 + 1
  assert.deepEqual(coveredItems([0, 1, 2], GROUPS), []);
});

test("one photo can tick two doors, and a part of a cork board", () => {
  assert.deepEqual(coveredItems([0, 1, 2, 3, 4, 5, 6, 7, 8], GROUPS), [
    "sor-1-ajto-1",
    "sor-1-ajto-2",
  ]);
  assert.deepEqual(coveredItems([51, 52], GROUPS), ["parafa-1-felso-2"]);
  assert.deepEqual(coveredItems([50, 51, 52, 61], GROUPS), [
    "parafa-1-felso-1",
    "parafa-1-felso-2",
  ]);
  assert.deepEqual(coveredItems([69, 70, 72], GROUPS), ["parafa-2-also-3"]);
  assert.deepEqual(coveredItems([50, 52], GROUPS), []); // not neighbours: no piece
  assert.deepEqual(coveredItems([50, 61], GROUPS), []); // a corner and the side: no piece
});

test("a board piece photo has no warnings and is named", () => {
  const result = judged([64, 65]);
  assert.deepEqual(result.items, ["parafa-2-felso-2"]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.labels, ["Kis parafatábla – felső sor, 2. rész"]);
  assert.deepEqual(judged([64]).warnings.map((w) => w.code), ["too-few"]);
});

test("a good photo has no warnings and says what it shows", () => {
  const result = judged([0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.items, ["sor-1-ajto-1"]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.labels, ["Jobb szekrénysor – 1. ajtó"]);
  assert.equal(result.pxPerMm, 200 / 35);
});

test("no sticker at all, or too few for anything, is a warning", () => {
  assert.deepEqual(judged([]).warnings.map((w) => w.code), ["no-markers"]);
  const few = judged([0, 1, 2]);
  assert.deepEqual(few.warnings.map((w) => w.code), ["too-few"]);
  assert.match(few.warnings[0].text, /3 matric/);
});

test("stickers this app does not know are not counted", () => {
  assert.deepEqual(judged([90, 91, 92, 93]).warnings.map((w) => w.code), ["no-markers"]);
  // 73 and up are printed on the sheets but not used on the wall.
  assert.deepEqual(judged([150, 151, 200, 201]).warnings.map((w) => w.code), ["no-markers"]);
});

test("small stickers mean the photo was taken from too far", () => {
  const side = 35 * (MIN_PX_PER_MM - 0.5);
  const far = judge({
    markers: [0, 1, 2, 3, 4, 5].map((id) => marker(id, side)),
    sharpness: 0.4,
    groups: GROUPS,
  });
  assert.deepEqual(far.items, ["sor-1-ajto-1"]);
  assert.deepEqual(far.warnings.map((w) => w.code), ["too-far"]);
  assert.match(far.warnings[0].text, /közelebb/);
});

test("a blurred photo is a warning; an unknown sharpness is not", () => {
  const soft = judged([0, 1, 2, 3, 4, 5], { sharpness: MIN_SHARPNESS - 0.02 });
  assert.deepEqual(soft.warnings.map((w) => w.code), ["blurred"]);
  assert.deepEqual(judged([0, 1, 2, 3, 4, 5], { sharpness: null }).warnings, []);
});

// Door 1 of the right row: left column 0 (top), 1 (middle), 2 (bottom), right column 3, 4, 5.
test("a door photographed in two halves: each photo says which half it shows", () => {
  const { coveredParts } = checkModule;
  assert.deepEqual(coveredParts([0, 1, 3, 4], GROUPS), [{ id: "sor-1-ajto-1", top: true, bottom: false }]);
  assert.deepEqual(coveredParts([1, 2, 4, 5], GROUPS), [{ id: "sor-1-ajto-1", top: false, bottom: true }]);
  assert.deepEqual(coveredParts([0, 1, 2, 3, 4, 5], GROUPS), [{ id: "sor-1-ajto-1", top: true, bottom: true }]);
  // The four corners without the middle stickers: the whole door.
  assert.deepEqual(coveredParts([0, 2, 3, 5], GROUPS), [{ id: "sor-1-ajto-1", top: true, bottom: true }]);
  // Top on one side, bottom on the other: neither half.
  assert.deepEqual(coveredParts([0, 1, 4, 5], GROUPS), []);
});

test("a piece of a cork board is always whole", () => {
  const { coveredParts } = checkModule;
  assert.deepEqual(coveredParts([55, 57], GROUPS), [{ id: "parafa-1-also-1", top: true, bottom: true }]);
});

test("a far photo of a whole board: most of its stickers, not all on one line", () => {
  // Big board: 12 stickers – 8 are needed, and 4 of them off one line.
  assert.ok(coveredItems([50, 51, 52, 53, 54, 55, 57, 58], GROUPS).includes("parafa-1-egesz"));
  assert.ok(!coveredItems([50, 51, 52, 53, 54, 55, 57], GROUPS).includes("parafa-1-egesz"));
  // Small board: 10 stickers – 6 are needed.
  assert.ok(coveredItems([63, 64, 65, 66, 67, 70], GROUPS).includes("parafa-2-egesz"));
  // Only the top edge and one side sticker: 3 of every 4 on one line.
  assert.ok(!checkModule.generalFour([[0, 0], [500, 0], [1000, 0], [1500, 0], [0, 50]]));
  assert.ok(checkModule.generalFour([[0, 0], [1000, 0], [0, 900], [1000, 900]]));
});

test("a far photo of a board is no 'too far': it ticks the board, not its close pieces", () => {
  const ids = [50, 51, 52, 53, 54, 55, 57, 58, 59, 60, 61, 62];
  const side = 35 * 1.2; // ~3 m away
  const far = judge({ markers: ids.map((id) => marker(id, side)), sharpness: 0.4, groups: GROUPS });
  assert.deepEqual(far.items, ["parafa-1-egesz"]);
  assert.deepEqual(far.marks, ["parafa-1-egesz:top", "parafa-1-egesz:bottom"]);
  assert.deepEqual(far.labels, ["Nagy parafatábla – egész tábla (távoli)"]);
  assert.deepEqual(far.warnings, []);

  // Close enough to read: the pieces count too.
  const near = judged(ids);
  assert.ok(near.items.includes("parafa-1-felso-1") && near.items.includes("parafa-1-egesz"));

  // A far photo of a door is still too far.
  const door = judge({ markers: [0, 1, 2, 3, 4, 5].map((id) => marker(id, side)), sharpness: 0.4, groups: GROUPS });
  assert.deepEqual(door.warnings.map((w) => w.code), ["too-far"]);
});

test("Befejezés reminds of a board with close photos but no far photo", () => {
  const { missingFarPhotos } = checkModule;
  assert.deepEqual(missingFarPhotos([], GROUPS), []);
  assert.deepEqual(missingFarPhotos(["sor-1-ajto-1:top"], GROUPS), []);
  assert.deepEqual(missingFarPhotos(["parafa-1-felso-1:top", "parafa-2-also-2:top"], GROUPS), [
    "Nagy parafatábla", "Kis parafatábla",
  ]);
  assert.deepEqual(
    missingFarPhotos(["parafa-1-felso-1:top", "parafa-1-egesz:top", "parafa-1-egesz:bottom"], GROUPS),
    [],
  );
});

test("the verdict carries a mark per half, and names the half in its label", () => {
  const top = judged([0, 2, 3, 4]);
  assert.deepEqual(top.marks, ["sor-1-ajto-1:top"]);
  assert.deepEqual(top.labels, ["Jobb szekrénysor – 1. ajtó (a teteje)"]);
  assert.deepEqual(top.warnings, []);

  const bottom = judged([2, 1, 4, 5]);
  assert.deepEqual(bottom.marks, ["sor-1-ajto-1:bottom"]);
  assert.deepEqual(bottom.labels, ["Jobb szekrénysor – 1. ajtó (az alja)"]);

  const whole = judged([0, 1, 2, 3, 4, 5]);
  assert.deepEqual(whole.marks, ["sor-1-ajto-1:top", "sor-1-ajto-1:bottom"]);
  assert.deepEqual(whole.labels, ["Jobb szekrénysor – 1. ajtó"]);
});
