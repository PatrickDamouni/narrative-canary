import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { latestRun } from "../src/story/runs.ts";

const doc = id => ({ id, title: id, body: "Ines Marlow leads.", facts: [{ key: "project_lead", quote: "Ines Marlow", value: "Ines Marlow" }] });
const story = (condition, status) => ({
  record: { condition, seedId: "freight-acquisition", failure: null, sheet: null,
    set: { documents: ["kickoff_email", "scope_memo", "workstream_tracker", "status_update", "handoff_note"].map(doc) } },
  check: { status, issues: status === "contradiction" ? [{ code: "CROSS_DOC_CONFLICT", severity: "contradiction", key: "project_lead", observations: [] }] : [] },
  repair: null, repaired: null,
  outcome: { costUsd: 0.12 }
});

function withRuns(t, build) {
  const root = mkdtempSync(path.join(tmpdir(), "nc-runs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  build(root);
  return root;
}

test("no runs yet is reported plainly, not as an error", t => {
  const root = withRuns(t, () => {});
  assert.deepEqual(latestRun(root), { run: null, summary: null, stories: [], skipped: 0 });
  assert.deepEqual(latestRun(path.join(root, "missing")), { run: null, summary: null, stories: [], skipped: 0 });
});

test("the newest run is loaded with its summary and every story", t => {
  const root = withRuns(t, dir => {
    mkdirSync(path.join(dir, "2026-10-01T00-00-00-000Z"));
    mkdirSync(path.join(dir, "2026-10-02T00-00-00-000Z"));
    const newest = path.join(dir, "2026-10-02T00-00-00-000Z");
    writeFileSync(path.join(newest, "summary.json"), JSON.stringify({ model: "claude-opus-5", seeds: 1, summary: [{ condition: "free-form", checked: 1 }] }));
    writeFileSync(path.join(newest, "freight-acquisition.free-form.json"), JSON.stringify(story("free-form", "consistent")));
    writeFileSync(path.join(newest, "freight-acquisition.fact-sheet.json"), JSON.stringify(story("fact-sheet", "contradiction")));
  });
  const result = latestRun(root);
  assert.equal(result.run, "2026-10-02T00-00-00-000Z");
  assert.equal(result.summary.model, "claude-opus-5");
  assert.deepEqual(result.stories.map(item => [item.condition, item.status]), [["fact-sheet", "contradiction"], ["free-form", "consistent"]]);
  assert.equal(result.stories[0].documents.length, 5);
  assert.equal(result.stories[0].issues[0].code, "CROSS_DOC_CONFLICT");
});

test("unexpected file names and malformed stories are skipped and counted, never trusted", t => {
  const root = withRuns(t, dir => {
    const run = path.join(dir, "2026-10-03T00-00-00-000Z");
    mkdirSync(run);
    writeFileSync(path.join(run, "summary.json"), JSON.stringify({ summary: [] }));
    writeFileSync(path.join(run, "notes.txt"), "ignored");
    writeFileSync(path.join(run, "..evil.free-form.json"), "{}");
    writeFileSync(path.join(run, "bank-vendor.free-form.json"), "{ not json");
    writeFileSync(path.join(run, "bank-vendor.fact-sheet.json"), JSON.stringify({ record: { set: { documents: [{ id: "nope" }] } } }));
  });
  const result = latestRun(root);
  assert.equal(result.stories.length, 0);
  assert.equal(result.skipped, 2);
});

test("a story that failed to generate is still listed with its failure", t => {
  const root = withRuns(t, dir => {
    const run = path.join(dir, "2026-10-04T00-00-00-000Z");
    mkdirSync(run);
    writeFileSync(path.join(run, "summary.json"), JSON.stringify({ summary: [] }));
    writeFileSync(path.join(run, "grocer-pricing.free-form.json"), JSON.stringify({
      record: { condition: "free-form", seedId: "grocer-pricing", failure: "refusal", sheet: null, set: null },
      check: null, repair: null, repaired: null, outcome: { costUsd: 0 }
    }));
  });
  const [only] = latestRun(root).stories;
  assert.equal(only.failure, "refusal");
  assert.equal(only.status, null);
  assert.deepEqual(only.documents, []);
});
