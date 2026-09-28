import assert from "node:assert/strict";
import test from "node:test";

import { acquisitionScenario } from "../src/fixtures/acquisition.ts";
import { flawedScenario } from "../src/fixtures/flawed.ts";
import { lintScenario } from "../src/lint.ts";
import { validateScenario } from "../src/scenario.ts";

const lint = draft => lintScenario(validateScenario(draft));

test("the deliberately flawed fixture yields specific, traceable conflicts", () => {
  const report = lintScenario(flawedScenario);
  assert.deepEqual(report.findings.map(item => `${item.code}:${item.armId}/${item.artifactId}/${item.factId}`), [
    "CLAIM_VALUE_CONFLICT:narrative/brief/project-lead",
    "TABLE_VALUE_CONFLICT:narrative/model/revenue-owner",
    "CLAIM_VALUE_CONFLICT:narrative/steering/checkpoint-date"
  ]);
  assert.deepEqual(report.timelineFindings.map(item => item.constraintId), ["revenue-before-handoff", "cost-before-handoff", "risk-before-handoff"]);
  assert.equal(report.blocking, true);
});

test("a quoted claim that disagrees with its canonical fact names the file, fact, and related files", () => {
  const draft = structuredClone(acquisitionScenario);
  const brief = draft.arms.narrative.artifacts.find(item => item.id === "brief");
  brief.body = brief.body.replace("Maya Chen", "Maya Chan");
  brief.literalClaims = [{ factId: "project-lead", quote: "Maya Chan" }];
  assert.deepEqual(lint(draft).findings, [{
    code: "CLAIM_VALUE_CONFLICT", armId: "narrative", artifactId: "brief", factId: "project-lead",
    sourceText: "Maya Chan", canonicalValue: "Maya Chen", relatedArtifactIds: ["access", "steering"]
  }]);
});

test("a correct annotated quote does not verify conflicting surrounding prose", () => {
  const draft = structuredClone(acquisitionScenario);
  draft.arms.narrative.artifacts.find(item => item.id === "brief").body += " A later note incorrectly calls the coordinator Maya Chan.";
  const report = lint(draft);
  assert.equal(report.findings.length, 0);
  assert.equal(report.blocking, false);
});

test("the curated campaign has real anchors, no known conflict, and lists what is unchecked", () => {
  const report = lintScenario(acquisitionScenario);
  assert.ok(report.literalChecks >= 5);
  assert.equal(report.tableChecks, 12);
  assert.equal(report.timelineChecks, 3);
  assert.deepEqual([...report.findings, ...report.timelineFindings], []);
  assert.deepEqual(report.uncheckedReferences.map(item => `${item.armId}/${item.artifactId}/${item.factId}`), [
    "baseline/brief/project-purpose", "baseline/brief/project-status", "baseline/steering/project-status", "baseline/access/project-status",
    "narrative/brief/project-purpose", "narrative/brief/project-status", "narrative/model/project-name",
    "narrative/steering/project-name", "narrative/steering/project-status", "narrative/access/project-lead", "narrative/access/project-status"
  ]);
});

test("a changed worksheet cell is found even when the original value still appears elsewhere", () => {
  const draft = structuredClone(acquisitionScenario);
  const model = draft.arms.narrative.artifacts.find(item => item.id === "model");
  model.body = model.body.replace("Revenue bridge,Maya Chen", "Revenue bridge,Maya Chan");
  assert.deepEqual(lint(draft).findings.filter(item => item.code === "TABLE_VALUE_CONFLICT"), [{
    code: "TABLE_VALUE_CONFLICT", armId: "narrative", artifactId: "model", factId: "revenue-owner",
    sourceText: "Maya Chan", canonicalValue: "Maya Chen", relatedArtifactIds: []
  }]);
});

test("a missing or ambiguous table coordinate cannot count as a verified fact", () => {
  const draft = structuredClone(acquisitionScenario);
  draft.arms.narrative.artifacts.find(item => item.id === "model").body += "\nRevenue bridge,Maya Chen,In review,2026-10-09,Cohort check";
  assert.deepEqual(lint(draft).findings.filter(item => item.code === "TABLE_BINDING_MISSING").map(item => item.factId), ["revenue-owner", "revenue-due"]);
});

test("an impossible handoff timeline is reported with its declared dependency cells", () => {
  const draft = structuredClone(acquisitionScenario);
  draft.facts.find(fact => fact.id === "handoff-due").value = "2026-10-08";
  for (const arm of Object.values(draft.arms)) {
    const table = arm.artifacts.find(item => item.id === "model");
    table.body = table.body.replace("2026-10-16", "2026-10-08");
  }
  const report = lint(draft);
  assert.equal(report.findings.length, 0);
  assert.deepEqual(report.timelineFindings[0], {
    code: "TIMELINE_ORDER_CONFLICT", constraintId: "revenue-before-handoff",
    beforeFactId: "revenue-due", beforeValue: "2026-10-09", afterFactId: "handoff-due", afterValue: "2026-10-08",
    sourceCells: [
      { armId: "baseline", artifactId: "model", rowKey: "Final handoff", column: "Dependency", sourceText: "All workstreams" },
      { armId: "narrative", artifactId: "model", rowKey: "Lantern handoff", column: "Dependency", sourceText: "All workstreams" }
    ]
  });
});

test("a same-day prerequisite does not satisfy a declared before-handoff rule", () => {
  const draft = structuredClone(acquisitionScenario);
  draft.facts.find(fact => fact.id === "risk-due").value = "2026-10-16";
  for (const arm of Object.values(draft.arms)) {
    const table = arm.artifacts.find(item => item.id === "model");
    table.body = table.body.replace("2026-10-14", "2026-10-16");
  }
  assert.deepEqual(lint(draft).timelineFindings.map(item => item.constraintId), ["risk-before-handoff"]);
});

test("timeline declarations must name dated facts and an exact source cell", () => {
  const missingFact = structuredClone(acquisitionScenario);
  missingFact.timelineConstraints[0].beforeFactId = "missing";
  assert.throws(() => validateScenario(missingFact), /unknown fact/);
  const invalidDate = structuredClone(acquisitionScenario);
  invalidDate.facts.find(fact => fact.id === "revenue-due").value = "2026-02-30";
  assert.throws(() => validateScenario(invalidDate), /valid ISO date/);
  const falseSource = structuredClone(acquisitionScenario);
  falseSource.timelineConstraints[0].sourceCells[0].sourceText = "Invented dependency";
  assert.throws(() => validateScenario(falseSource), /source cell/);
});
