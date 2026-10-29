import assert from "node:assert/strict";
import { test } from "node:test";

import { GROUPS } from "../layout.js";

test("the wall map: left row, right row, then side wall + boards", () => {
  assert.deepEqual(
    GROUPS.map((group) => [group.id, group.line]),
    [["sor-2", 1], ["sor-1", 2], ["oldalfal", 3], ["parafa-1", 3], ["parafa-2", 3]],
  );
});

test("every piece of the map lies inside its group, and the pieces do not overlap", () => {
  for (const group of GROUPS) {
    const { w, h } = group.size;
    assert.ok(w > 0 && h > 0, group.id);
    const drawn = group.items.filter((item) => !item.whole); // the far photo has no box
    for (const item of drawn) {
      const box = item.box;
      assert.ok(box.w > 0 && box.h > 0, item.id);
      assert.ok(box.x >= 0 && box.y >= 0, item.id);
      assert.ok(box.x + box.w <= w && box.y + box.h <= h, item.id);
    }
    for (const a of drawn) {
      for (const b of drawn) {
        if (a === b) continue;
        const apart =
          a.box.x + a.box.w <= b.box.x || b.box.x + b.box.w <= a.box.x ||
          a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y;
        assert.ok(apart, `${a.id} / ${b.id}`);
      }
    }
  }
});
