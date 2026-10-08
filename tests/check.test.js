import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_PX_PER_MM, MIN_SHARPNESS, allItems, coveredItems, judge } from "../check.js";
import * as checkModule from "../check.js";
import { GROUPS } from "../layout.js";

const marker = (id, side = 200) => ({ id, side, corners: [] });
const judged = (ids, extra = {}) =>
  judge({ markers: ids.map((id) => marker(id)), sharpness: 0.4, groups: GROUPS, ...extra });

test("the wall is listed left to right: two cabinet rows, then the parts of the boards", () => {
  assert.deepEqual(GROUPS.map((g) => [g.name, g.items.length]), [
    ["Bal szekrénysor", 6],
    ["Jobb szekrénysor", 6],
    ["Nagy parafatábla", 3],
    ["Kis parafatábla", 2],
  ]);
  assert.equal(allItems(GROUPS).length, 17);
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
  assert.deepEqual(coveredItems([42, 43, 44, 45], GROUPS), ["parafa-1-resz-1"]);
  assert.deepEqual(coveredItems([44, 45, 46, 47, 48, 49], GROUPS), [
    "parafa-1-resz-2",
    "parafa-1-resz-3",
  ]);
  assert.deepEqual(coveredItems([42, 43, 46, 47], GROUPS), []); // not neighbours: no part
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

test("a part of a cork board is always whole", () => {
  const { coveredParts } = checkModule;
  assert.deepEqual(coveredParts([42, 43, 44, 45], GROUPS), [{ id: "parafa-1-resz-1", top: true, bottom: true }]);
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
