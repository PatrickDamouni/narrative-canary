import assert from "node:assert/strict";
import test from "node:test";

import { plantFlaws, scoreLint } from "../src/benchmark.ts";
import { acquisitionScenario } from "../src/fixtures/acquisition.ts";
import { lintScenario } from "../src/lint.ts";
import { scenarioHash } from "../src/scenario.ts";

const cases = plantFlaws(acquisitionScenario);
const byKind = kind => cases.filter(item => item.kind === kind);
const row = (score, kind) => score.byKind.find(item => item.kind === kind);

test("every planted copy is a valid scenario that differs from the clean files", () => {
  assert.ok(cases.length >= 40, `only ${cases.length} cases`);
  const clean = scenarioHash(acquisitionScenario);
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  for (const item of cases) assert.notEqual(scenarioHash(item.scenario), clean, item.id);
  for (const kind of ["anchored-quote-typo", "worksheet-cell-edit", "impossible-deadline", "prose-name-typo", "prose-wrong-value"]) {
    assert.ok(byKind(kind).length > 0, kind);
  }
});

test("planting never changes the clean fixture", () => {
  const before = structuredClone(acquisitionScenario);
  plantFlaws(acquisitionScenario);
  assert.deepEqual(acquisitionScenario, before);
});

test("the clean files raise no alarms", () => {
  assert.equal(scoreLint(acquisitionScenario, cases, lintScenario).cleanFalseAlarms, 0);
});

test("a finding counts only when it points at the planted file and fact", () => {
  const item = byKind("worksheet-cell-edit")[0];
  const misplaced = () => ({ findings: [{ code: "TABLE_VALUE_CONFLICT", armId: item.armId, artifactId: "elsewhere", factId: item.factId }], timelineFindings: [], nearMisses: [] });
  const score = scoreLint(acquisitionScenario, [item], misplaced);
  assert.equal(row(score, "worksheet-cell-edit").caught, 0);
  assert.equal(row(score, "worksheet-cell-edit").strayFindings, 1);
});

test("anchored mistakes are all caught in the right place with no stray alarms", () => {
  const score = scoreLint(acquisitionScenario, cases, lintScenario);
  for (const kind of ["anchored-quote-typo", "worksheet-cell-edit", "impossible-deadline"]) {
    const result = row(score, kind);
    assert.equal(result.caught, result.planted, kind);
    assert.equal(result.strayFindings, 0, kind);
  }
});

test("a misspelled name slipped into unannotated prose is caught in the planted file", () => {
  const result = row(scoreLint(acquisitionScenario, cases, lintScenario), "prose-name-typo");
  assert.equal(result.caught, result.planted);
  assert.equal(result.strayFindings, 0);
});

test("a different but plausible value in prose remains a recorded blind spot", () => {
  const result = row(scoreLint(acquisitionScenario, cases, lintScenario), "prose-wrong-value");
  assert.ok(result.planted > 0);
  assert.equal(result.caught, 0, "the lint does not understand meaning; this must stay visible as a miss");
});
