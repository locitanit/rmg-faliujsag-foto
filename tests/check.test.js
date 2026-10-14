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
    ["Nagy parafatábla", 8],
    ["Kis parafatábla", 6],
  ]);
  assert.equal(allItems(GROUPS).length, 27);
  // A board piece = two neighbouring stickers of the top or the bottom edge.
  const small = GROUPS[4].items;
  assert.deepEqual(small.map((i) => i.stickers), [
    [60, 61], [61, 62], [62, 63], [64, 65], [65, 66], [66, 67],
  ]);
  assert.deepEqual(small.map((i) => i.label).slice(0, 4), [
    "felső sor, 1. rész", "felső sor, 2. rész", "felső sor, 3. rész", "alsó sor, 1. rész",
  ]);
});

test("the side wall is a door: 2 + 2 stickers, and it can be reported empty", () => {
  const [side] = GROUPS[2].items;
  assert.deepEqual(side.columns, [[42, 43, 44], [45, 46, 47]]);
  assert.equal(side.canBeEmpty, true);
  assert.deepEqual(coveredItems([42, 43, 45, 46], GROUPS), ["oldalfal"]);
  assert.deepEqual(coveredItems([42, 43, 44, 45], GROUPS), []);
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
  assert.deepEqual(coveredItems([49, 50], GROUPS), ["parafa-1-felso-2"]);
  assert.deepEqual(coveredItems([48, 49, 50, 58], GROUPS), [
    "parafa-1-felso-1",
    "parafa-1-felso-2",
  ]);
  assert.deepEqual(coveredItems([66, 67, 69], GROUPS), ["parafa-2-also-3"]);
  assert.deepEqual(coveredItems([48, 50], GROUPS), []); // not neighbours: no piece
  assert.deepEqual(coveredItems([48, 58], GROUPS), []); // a corner and the side: no piece
});

test("a board piece photo has no warnings and is named", () => {
  const result = judged([61, 62]);
  assert.deepEqual(result.items, ["parafa-2-felso-2"]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.labels, ["Kis parafatábla – felső sor, 2. rész"]);
  assert.deepEqual(judged([61]).warnings.map((w) => w.code), ["too-few"]);
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
  // 70 and up are printed on the sheets but not used on the wall.
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

// Door 1 of the right row: left column 0 (top), 2 (middle), 1 (bottom) – two of them are
// swapped on the wall –, right column 3, 4, 5.
test("a door photographed in two halves: each photo says which half it shows", () => {
  const { coveredParts } = checkModule;
  assert.deepEqual(coveredParts([0, 2, 3, 4], GROUPS), [{ id: "sor-1-ajto-1", top: true, bottom: false }]);
  assert.deepEqual(coveredParts([2, 1, 4, 5], GROUPS), [{ id: "sor-1-ajto-1", top: false, bottom: true }]);
  assert.deepEqual(coveredParts([0, 1, 2, 3, 4, 5], GROUPS), [{ id: "sor-1-ajto-1", top: true, bottom: true }]);
  // The four corners without the middle stickers: the whole door.
  assert.deepEqual(coveredParts([0, 1, 3, 5], GROUPS), [{ id: "sor-1-ajto-1", top: true, bottom: true }]);
  // Top on one side, bottom on the other: neither half.
  assert.deepEqual(coveredParts([0, 2, 4, 5], GROUPS), []);
});

test("a piece of a cork board is always whole", () => {
  const { coveredParts } = checkModule;
  assert.deepEqual(coveredParts([53, 54], GROUPS), [{ id: "parafa-1-also-1", top: true, bottom: true }]);
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
