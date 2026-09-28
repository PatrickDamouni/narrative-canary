import assert from "node:assert/strict";
import test from "node:test";

import { acquisitionScenario } from "../src/fixtures/acquisition.ts";
import { parseFixtureTable } from "../src/ui/table.js";

test("every curated CSV artifact renders as a rectangular table", () => {
  for (const arm of Object.values(acquisitionScenario.arms)) {
    for (const artifact of arm.artifacts.filter(item => item.title.endsWith(".csv"))) {
      const rows = parseFixtureTable(artifact.body);
      assert.ok(rows, `${arm.id}/${artifact.id} must parse as a table`);
      assert.ok(rows.length > 1);
      assert.ok(rows.every(row => row.length === rows[0].length));
    }
  }
});

test("restricted tables preserve every cell across generated dimensions and values", () => {
  const values = ["A", "2026-10-09", "Northstar Labs", "0", "In review", "Maya Chen"];
  for (let height = 2; height <= 6; height += 1) {
    for (let width = 2; width <= 7; width += 1) {
      for (let offset = 0; offset < values.length; offset += 1) {
        const expected = Array.from({ length: height }, (_, row) =>
          Array.from({ length: width }, (_, column) => values[(row * width + column + offset) % values.length]));
        assert.deepEqual(parseFixtureTable(expected.map(row => row.join(",")).join("\n")), expected);
      }
    }
  }
});

test("malformed fixture tables are not misrepresented as valid tables", () => {
  for (const body of ["", "single,row", "A,B\nonly-one", "A,B\n1,", "A,B\n1,2,3"]) {
    assert.equal(parseFixtureTable(body), null);
  }
});
