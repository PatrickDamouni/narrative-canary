import assert from "node:assert/strict";
import test from "node:test";

import { summarize } from "../src/story/summarize.ts";

const check = (status, codes = []) => ({
  issues: codes.map(code => ({ code, severity: code === "UNSAFE_CONTENT" ? "unsafe" : "contradiction" })),
  status,
  hasContradiction: status === "contradiction",
  counts: {}
});
const row = (overrides) => ({
  condition: "free-form", seedId: "s", failure: null, check: check("consistent"),
  repairAttempted: false, repairFailure: null, repaired: null, fallbackCalls: 0, costUsd: 0.1, ...overrides
});

test("rates have a clear denominator and failures never count as clean stories", () => {
  const [free] = summarize([
    row({ check: check("consistent") }),
    row({ check: check("incomplete") }),
    row({ failure: "refusal", check: null }),
    row({ failure: "api_error:529", check: null, costUsd: 0 })
  ]);
  assert.equal(free.attempted, 4);
  assert.equal(free.failed, 2);
  assert.equal(free.checked, 2);
  assert.deepEqual(free.byStatus, { consistent: 1, incomplete: 1, contradiction: 0, unsafe: 0 });
});

test("a story counts once per problem type, so sheet runs are not double-counted", () => {
  const [, sheet] = summarize([
    row({}),
    row({ condition: "fact-sheet", check: check("contradiction", ["CROSS_DOC_CONFLICT", "SHEET_CONFLICT", "SHEET_CONFLICT", "SHEET_CONFLICT"]) })
  ]);
  assert.deepEqual(sheet.storiesWithCode, { CROSS_DOC_CONFLICT: 1, SHEET_CONFLICT: 1 });
});

test("failed repairs stay in the repair denominator and new problem types after repair are counted", () => {
  const [free] = summarize([
    row({ check: check("contradiction", ["CROSS_DOC_CONFLICT"]), repairAttempted: true, repaired: check("consistent") }),
    row({ check: check("contradiction", ["CROSS_DOC_CONFLICT"]), repairAttempted: true, repaired: check("contradiction", ["TIMELINE_ORDER"]) }),
    row({ check: check("contradiction", ["NEAR_MISS_NAME"]), repairAttempted: true, repairFailure: "refusal", repaired: null })
  ]);
  assert.equal(free.repairAttempted, 3);
  assert.equal(free.repairFailed, 1);
  assert.equal(free.repairedClean, 1);
  assert.equal(free.repairIntroducedNew, 1);
});

test("calls served by a fallback model and total cost are reported", () => {
  const [free] = summarize([row({ fallbackCalls: 1, costUsd: 0.25 }), row({ costUsd: 0.5 })]);
  assert.equal(free.fallbackCalls, 1);
  assert.equal(free.costUsd, 0.75);
});

test("a condition with no runs is left out rather than reported as zero", () => {
  assert.deepEqual(summarize([]), []);
});
