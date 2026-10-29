import assert from "node:assert/strict";
import { test } from "node:test";

import { GROUPS } from "../layout.js";

test("the wall map: cabinets on line 1, boards on line 2, left to right", () => {
  assert.deepEqual(
    GROUPS.map((group) => [group.id, group.line]),
    [["sor-2", 1], ["sor-1", 1], ["oldalfal", 1], ["parafa-1", 2], ["parafa-2", 2]],
  );
});

test("every piece of the map lies inside its group, and the pieces do not overlap", () => {
  for (const group of GROUPS) {
    const { w, h } = group.size;
    assert.ok(w > 0 && h > 0, group.id);
    for (const item of group.items) {
      const box = item.box;
      assert.ok(box.w > 0 && box.h > 0, item.id);
      assert.ok(box.x >= 0 && box.y >= 0, item.id);
      assert.ok(box.x + box.w <= w && box.y + box.h <= h, item.id);
    }
    for (const a of group.items) {
      for (const b of group.items) {
        if (a === b) continue;
        const apart =
          a.box.x + a.box.w <= b.box.x || b.box.x + b.box.w <= a.box.x ||
          a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y;
        assert.ok(apart, `${a.id} / ${b.id}`);
      }
    }
  }
});
