import assert from "node:assert/strict";
import test from "node:test";

import { acquisitionScenario } from "../src/fixtures/acquisition.ts";
import { flawedScenario } from "../src/fixtures/flawed.ts";
import { tripwirePlans } from "../src/fixtures/tripwire-plans.ts";
import { attackerRead, lurePath, TRADECRAFT_PROFILES, validateTripwirePlan, walkLure } from "../src/tradecraft.ts";

const plan = id => tripwirePlans.find(item => item.id === id);
const profile = id => TRADECRAFT_PROFILES.find(item => item.id === id);
const outcomes = report => Object.fromEntries(report.walks.map(walk => [walk.profileId, walk.fired]));

test("the lure path follows the designed chain from the unlinked visible entry to the goal", () => {
  assert.deepEqual(lurePath(acquisitionScenario, "narrative"), ["steering", "brief", "model", "access", "portal"]);
  assert.deepEqual(lurePath(acquisitionScenario, "baseline"), ["steering", "brief", "model", "access", "portal"]);
});

test("an Office reader fires the conventional document beacon before anything else", () => {
  const walk = walkLure(acquisitionScenario, plan("vendor-pattern"), profile("office-render"));
  assert.equal(walk.detected, true);
  assert.equal(walk.firstAlert, "brief-beacon");
  assert.deepEqual(walk.fired, ["brief-beacon", "portal-visit"]);
});

test("an offline viewer suppresses the beacon, leaving one tripwire to catch them", () => {
  const walk = walkLure(acquisitionScenario, plan("vendor-pattern"), profile("offline-viewer"));
  assert.deepEqual(walk.fired, ["portal-visit"]);
  assert.equal(walk.singlePointOfDetection, true);
  assert.ok(walk.steps.some(step => step.kind === "suppressed" && step.tripwireId === "brief-beacon"));
});

test("package inspection sees the auto-fetch beacon and ends the walk before any other tripwire", () => {
  const walk = walkLure(acquisitionScenario, plan("vendor-pattern"), profile("package-scan"));
  assert.equal(walk.detected, false);
  assert.deepEqual(walk.stoppedBy, { kind: "tell", tripwireId: "brief-beacon", surface: "document-package", artifactId: "brief", response: "abandon" });
});

test("the same beacon costs the narrative plan every inspecting profile under the abandon assumption", () => {
  const withBeacon = attackerRead(acquisitionScenario, plan("narrative-with-beacon"));
  const withoutBeacon = attackerRead(acquisitionScenario, plan("narrative-no-beacon"));
  assert.deepEqual(withBeacon.coverage, { detected: 2, total: 5 });
  assert.deepEqual(withoutBeacon.coverage, { detected: 5, total: 5 });
  assert.deepEqual(outcomes(withoutBeacon), {
    "office-render": ["portal-visit", "lead-account"],
    "offline-viewer": ["portal-visit", "lead-account"],
    "package-scan": ["portal-visit", "lead-account"],
    "package-and-directory": ["portal-visit", "lead-account"],
    "cross-checker": ["portal-visit", "lead-account"]
  });
  assert.deepEqual(withoutBeacon.walks.filter(walk => walk.singlePointOfDetection).map(walk => walk.profileId), []);
});

test("stopping at a tell instead of abandoning changes the beacon trade-off rather than hiding it", () => {
  const abandon = walkLure(acquisitionScenario, plan("narrative-with-beacon"), profile("package-scan"), { onTell: "abandon" });
  const stopPath = walkLure(acquisitionScenario, plan("narrative-with-beacon"), profile("package-scan"), { onTell: "stop-path" });
  assert.equal(abandon.detected, false);
  assert.deepEqual(stopPath.fired, ["lead-account"]);
  assert.equal(stopPath.stoppedBy.response, "stop-path");
});

test("vetting the honey account is itself watched, so the careful attacker trips it while backing away", () => {
  const walk = walkLure(acquisitionScenario, plan("narrative-no-beacon"), profile("package-and-directory"));
  assert.deepEqual(walk.fired, ["portal-visit", "lead-account"]);
  assert.ok(walk.steps.some(step => step.kind === "fired" && step.tripwireId === "lead-account" && /vetting/.test(step.reason)));
  const unwatched = { ...plan("narrative-no-beacon"), tripwires: plan("narrative-no-beacon").tripwires.map(item => ({ ...item, watchesInspection: undefined })) };
  assert.deepEqual(walkLure(acquisitionScenario, unwatched, profile("package-and-directory")).fired, ["portal-visit"]);
  assert.deepEqual(walk.stoppedBy, { kind: "tell", tripwireId: "lead-account", surface: "directory-object", artifactId: null, response: "abandon" });
});

test("a visible inconsistency ends the careful reader's walk with a source-linked root cause", () => {
  const walk = walkLure(flawedScenario, plan("narrative-no-beacon"), profile("cross-checker"));
  assert.equal(walk.detected, false);
  assert.equal(walk.stoppedBy.kind, "contradiction");
  assert.equal(walk.stoppedBy.factId, "project-lead");
  assert.deepEqual(walk.stoppedBy.observations, [
    { artifactId: "steering", value: "Maya Chen" },
    { artifactId: "brief", value: "Maya Chan" }
  ]);
  const clean = walkLure(acquisitionScenario, plan("narrative-no-beacon"), profile("cross-checker"));
  assert.equal(clean.detected, true);
});

test("a reader-visible timeline contradiction is reported from the worksheet cells the reader saw", () => {
  const readerOnly = { id: "reader-only", label: "Cross-checks only", rendersWithNetwork: false, inspects: [], crossChecksFacts: true, basis: [{ strength: "assumption", source: "test", supports: "test" }] };
  const portalOnly = { id: "portal-only", label: "Portal only", armId: "baseline", tripwires: [{ id: "portal-visit", label: "Portal request", trigger: "visit", artifactId: "portal", exposedTo: null }] };
  const walk = walkLure(flawedScenario, portalOnly, readerOnly);
  assert.equal(walk.detected, false);
  assert.equal(walk.stoppedBy.kind, "contradiction");
  assert.equal(walk.stoppedBy.constraintId, "revenue-before-handoff");
  assert.equal(walk.stoppedBy.artifactId, "model");
});

test("files that cite the watched fact are split into wrong-value lures and partial mentions", () => {
  const partial = { code: "LURE_OMITS_WATCHED_VALUE", tripwireId: "lead-account", artifactId: "access", factId: "project-lead",
    watchedValue: "Maya Chen", shownText: null };
  const flawed = attackerRead(flawedScenario, plan("narrative-no-beacon"));
  assert.deepEqual(flawed.lureFindings, [{
    code: "LURE_TEACHES_OTHER_VALUE", tripwireId: "lead-account", artifactId: "brief", factId: "project-lead",
    watchedValue: "Maya Chen", shownText: "Maya Chan"
  }, partial]);
  // The clean handoff note says only "Maya": it never teaches the account name the sensor watches.
  assert.deepEqual(attackerRead(acquisitionScenario, plan("narrative-no-beacon")).lureFindings, [partial]);
});

test("every built-in profile states its basis and the model states its assumptions", () => {
  assert.equal(TRADECRAFT_PROFILES.length, 5);
  for (const item of TRADECRAFT_PROFILES) {
    assert.ok(item.basis.length > 0, item.id);
    assert.ok(item.basis.every(basis => ["vendor-documentation", "public-tool", "public-report", "assumption"].includes(basis.strength)));
  }
  assert.ok(profile("cross-checker").basis.some(basis => basis.strength === "assumption"));
  const report = attackerRead(acquisitionScenario, plan("vendor-pattern"));
  assert.ok(report.assumptions.length >= 5);
  assert.match(report.assumptions.join(" "), /no alert/i);
});

test("plan validation rejects unknown references and tripwires the walk cannot reach", () => {
  const base = plan("narrative-no-beacon");
  assert.throws(() => validateTripwirePlan(acquisitionScenario, { ...base, tripwires: [{ id: "x", label: "x", trigger: "render", artifactId: "missing", exposedTo: "document-package" }] }), /unknown artifact/);
  assert.throws(() => validateTripwirePlan(acquisitionScenario, { ...base, tripwires: [{ id: "x", label: "x", trigger: "use-value", factId: "missing", exposedTo: null }] }), /unknown fact/);
  assert.throws(() => validateTripwirePlan(acquisitionScenario, { ...base, tripwires: [{ id: "x", label: "x", trigger: "render", artifactId: "benefits", exposedTo: "document-package" }] }), /lure path/);
  assert.throws(() => validateTripwirePlan(acquisitionScenario, { ...base, tripwires: [{ id: "x", label: "x", trigger: "render", artifactId: "portal", exposedTo: "document-package" }] }), /render/);
  assert.throws(() => validateTripwirePlan(acquisitionScenario, { ...base, tripwires: [...base.tripwires, base.tripwires[0]] }), /duplicate/);
  assert.throws(() => validateTripwirePlan(acquisitionScenario, { ...base, extra: true }), /unexpected field/);
});

test("reading the lure never mutates the scenario, plan, or profiles", () => {
  const before = structuredClone({ scenario: acquisitionScenario, plans: tripwirePlans, profiles: TRADECRAFT_PROFILES });
  for (const item of tripwirePlans) attackerRead(item.armId === "baseline" ? flawedScenario : acquisitionScenario, item, TRADECRAFT_PROFILES, { onTell: "stop-path" });
  assert.deepEqual({ scenario: acquisitionScenario, plans: tripwirePlans, profiles: TRADECRAFT_PROFILES }, before);
});

test("challenging the link assumption: an inspectable portal link costs the careful profiles", () => {
  const base = plan("narrative-no-beacon");
  const linkIsTell = { ...base, tripwires: base.tripwires.map(item => item.id === "portal-visit" ? { ...item, exposedTo: "document-package" } : item) };
  const report = attackerRead(acquisitionScenario, linkIsTell);
  assert.deepEqual(report.coverage, { detected: 2, total: 5 });
  const scan = report.walks.find(walk => walk.profileId === "package-scan");
  assert.deepEqual(scan.stoppedBy, { kind: "tell", tripwireId: "portal-visit", surface: "document-package", artifactId: "portal", response: "abandon" });
  assert.deepEqual(outcomes(report)["offline-viewer"], ["portal-visit", "lead-account"]);
});

test("leave-one-out value shows which tripwire carries the plan and which adds nothing", () => {
  const linkIsTell = { ...plan("narrative-no-beacon"), tripwires: plan("narrative-no-beacon").tripwires.map(item => item.id === "portal-visit" ? { ...item, exposedTo: "document-package" } : item) };
  const report = attackerRead(acquisitionScenario, linkIsTell);
  assert.deepEqual(report.tripwireValue, [
    { tripwireId: "portal-visit", uniqueCatches: [] },
    { tripwireId: "lead-account", uniqueCatches: [] }
  ]);
  const vendor = attackerRead(acquisitionScenario, plan("vendor-pattern"));
  assert.deepEqual(vendor.tripwireValue.find(item => item.tripwireId === "portal-visit").uniqueCatches, ["offline-viewer"]);
});

test("a document token cannot sit in a plain-text file", () => {
  const base = plan("vendor-pattern");
  const inText = { ...base, tripwires: [{ id: "x", label: "x", trigger: "render", artifactId: "steering", exposedTo: "document-package" }] };
  assert.throws(() => validateTripwirePlan(acquisitionScenario, inText), /auto-fetch/);
});
