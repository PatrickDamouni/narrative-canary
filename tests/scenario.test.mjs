import assert from "node:assert/strict";
import test from "node:test";

import { acquisitionScenario } from "../src/fixtures/acquisition.ts";
import { scenarioHash, validateScenario } from "../src/scenario.ts";

function artifact(scenario, arm, id) {
  const found = scenario.arms[arm].artifacts.find(item => item.id === id);
  assert.ok(found, `expected ${arm}/${id}`);
  return found;
}

test("a controlled synthetic scenario is accepted without changing it", () => {
  assert.deepEqual(validateScenario(acquisitionScenario), acquisitionScenario);
});

test("table checks must cite a declared fact and cannot duplicate a cell coordinate", () => {
  const unknownFact = structuredClone(acquisitionScenario);
  artifact(unknownFact, "narrative", "model").tableBindings.push({ factId: "not-cited", rowKey: "Revenue bridge", column: "Owner" });
  assert.throws(() => validateScenario(unknownFact), /declared artifact fact/);

  const duplicateCell = structuredClone(acquisitionScenario);
  artifact(duplicateCell, "narrative", "model").tableBindings.push({ factId: "revenue-owner", rowKey: "Revenue bridge", column: "Owner" });
  assert.throws(() => validateScenario(duplicateCell), /duplicate table binding/);
});

test("a scenario with an external destination cannot start", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "narrative", "access").body = "Continue at https://example.com";

  assert.throws(() => validateScenario(scenario), /external URL/);
});

test("a self-declared credential safety marker cannot be used as evidence", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "baseline", "access").functionalCredential = false;

  assert.throws(() => validateScenario(scenario), /unexpected field: functionalCredential/);
});

test("the narrative arm cannot receive an extra lure", () => {
  const scenario = structuredClone(acquisitionScenario);
  scenario.arms.narrative.artifacts.push({
    id: "bonus",
    kind: "document",
    role: "target",
    title: "Bonus.txt",
    body: "An extra fictional clue",
    nextId: null,
    visibleAtStart: true,
    factIds: []
  });

  assert.throws(() => validateScenario(scenario), /arm structure/);
});

test("both arms must offer the same artifact types and next steps", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "narrative", "model").kind = "message";
  assert.throws(() => validateScenario(scenario), /arm structure/);

  const changedLink = structuredClone(acquisitionScenario);
  artifact(changedLink, "narrative", "model").nextId = "portal";
  assert.throws(() => validateScenario(changedLink), /arm structure/);
});

test("an incomplete manifest is rejected at the boundary", () => {
  const scenario = structuredClone(acquisitionScenario);
  delete scenario.objective;

  assert.throws(() => validateScenario(scenario), /objective/);
});

test("an artifact cannot point to a missing local artifact", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "baseline", "model").nextId = "missing";
  artifact(scenario, "narrative", "model").nextId = "missing";

  assert.throws(() => validateScenario(scenario), /dangling/);
});

test("artifact identifiers must be unique within each arm", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "baseline", "model").id = "brief";
  artifact(scenario, "narrative", "model").id = "brief";

  assert.throws(() => validateScenario(scenario), /duplicate artifact/);
});

test("scenario identity is a stable SHA-256 digest independent of object key order", () => {
  const reordered = {
    arms: structuredClone(acquisitionScenario.arms),
    taskText: acquisitionScenario.taskText,
    objective: acquisitionScenario.objective,
    organization: acquisitionScenario.organization,
    facts: structuredClone(acquisitionScenario.facts),
    timelineConstraints: structuredClone(acquisitionScenario.timelineConstraints),
    version: acquisitionScenario.version,
    id: acquisitionScenario.id
  };

  const originalHash = scenarioHash(validateScenario(acquisitionScenario));
  assert.match(originalHash, /^[a-f0-9]{64}$/);
  assert.equal(scenarioHash(validateScenario(reordered)), originalHash);
});

test("the evaluator task is required and changing it changes the manifest identity", () => {
  const missing = structuredClone(acquisitionScenario);
  delete missing.taskText;
  assert.throws(() => validateScenario(missing), /taskText/);

  const revised = structuredClone(acquisitionScenario);
  revised.taskText += " Explain your choice at the end.";
  assert.notEqual(scenarioHash(validateScenario(revised)), scenarioHash(validateScenario(acquisitionScenario)));
});

test("an artifact without text content is rejected before a run", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "baseline", "brief").body = undefined;

  assert.throws(() => validateScenario(scenario), /artifact body/);
});

test("both arms must share the same local portal goal", () => {
  const scenario = structuredClone(acquisitionScenario);
  scenario.arms.narrative.goalId = "access";

  assert.throws(() => validateScenario(scenario), /goal/);
});

test("the compared canary is the same visible target document in both arms", () => {
  const missing = structuredClone(acquisitionScenario);
  missing.arms.baseline.canaryArtifactId = "missing";
  assert.throws(() => validateScenario(missing), /visible target document canary/);

  const nonDocument = structuredClone(acquisitionScenario);
  nonDocument.arms.narrative.canaryArtifactId = "steering";
  assert.throws(() => validateScenario(nonDocument), /visible target document canary/);

  const hidden = structuredClone(acquisitionScenario);
  artifact(hidden, "baseline", "brief").visibleAtStart = false;
  artifact(hidden, "narrative", "brief").visibleAtStart = false;
  assert.throws(() => validateScenario(hidden), /visible target document canary/);

  const deadEnd = structuredClone(acquisitionScenario);
  for (const arm of Object.values(deadEnd.arms)) {
    arm.artifacts.find(item => item.id === "steering").nextId = "model";
    arm.artifacts.find(item => item.id === "brief").nextId = null;
  }
  assert.throws(() => validateScenario(deadEnd), /document canary must lead to the local goal/);
});

test("a hidden goal must remain reachable from an entry artifact", () => {
  const scenario = structuredClone(acquisitionScenario);
  scenario.arms.baseline.artifacts.find(artifact => artifact.id === "access").nextId = null;
  scenario.arms.narrative.artifacts.find(artifact => artifact.id === "access").nextId = null;

  assert.throws(() => validateScenario(scenario), /goal unreachable/);
});

test("both arms preserve target and alternative placement", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "narrative", "benefits").role = "target";

  assert.throws(() => validateScenario(scenario), /arm structure/);
});

test("the curated pair interleaves visible roles and matches all artifact body lengths within ten percent", () => {
  assert.doesNotMatch(acquisitionScenario.taskText, /where the final review would continue|portal|workspace link/i);
  const baseline = acquisitionScenario.arms.baseline.artifacts.filter(item => item.visibleAtStart);
  const narrative = acquisitionScenario.arms.narrative.artifacts.filter(item => item.visibleAtStart);
  assert.deepEqual(baseline.map(item => item.role), ["alternative", "target", "alternative", "target", "alternative", "alternative"]);
  assert.deepEqual(baseline.map(item => item.id), ["benefits", "brief", "operations", "steering", "renewal", "research"]);
  for (let index = 0; index < acquisitionScenario.arms.baseline.artifacts.length; index += 1) {
    const control = acquisitionScenario.arms.baseline.artifacts[index];
    const treatment = acquisitionScenario.arms.narrative.artifacts[index];
    const ratio = treatment.body.length / control.body.length;
    assert.ok(ratio >= 0.9 && ratio <= 1.1, `${control.id} body lengths differ too much: ${ratio}`);
  }
});

test("an artifact cannot cite a fact outside the scenario", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "narrative", "brief").factIds = ["not-in-the-graph"];

  assert.throws(() => validateScenario(scenario), /unknown fact/);
});

test("a scenario cannot declare duplicate or conflicting canonical facts", () => {
  const duplicate = structuredClone(acquisitionScenario);
  duplicate.facts.push({ ...duplicate.facts[0] });
  assert.throws(() => validateScenario(duplicate), /duplicate fact/);

  const conflict = structuredClone(acquisitionScenario);
  conflict.facts.push({ id: "other-project-name", subject: "project", attribute: "name", value: "Different name" });
  assert.throws(() => validateScenario(conflict), /conflicting fact/);
});

test("a fact value cannot introduce an external destination", () => {
  const scenario = structuredClone(acquisitionScenario);
  scenario.facts[0].value = "https://example.com";
  assert.throws(() => validateScenario(scenario), /external URL/);
});

test("validated scenario facts cannot change after a run starts", () => {
  const source = structuredClone(acquisitionScenario);
  const validated = validateScenario(source);
  artifact(source, "narrative", "brief").body = "Changed after validation";

  assert.notEqual(artifact(validated, "narrative", "brief").body, artifact(source, "narrative", "brief").body);
  assert.equal(Object.isFrozen(artifact(validated, "narrative", "brief")), true);
});

test("unrecognized artifact fields cannot hide unsafe material", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "narrative", "brief").secret = "unreviewed material";

  assert.throws(() => validateScenario(scenario), /unexpected field/);
});

test("non-web external URI schemes are rejected too", () => {
  const scenario = structuredClone(acquisitionScenario);
  artifact(scenario, "baseline", "brief").body = "Open file://another-computer/share";

  assert.throws(() => validateScenario(scenario), /external URL/);
});
