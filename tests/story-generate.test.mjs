import assert from "node:assert/strict";
import test from "node:test";

import { costUsd, generateFreeForm, generateWithSheet, repairStory, SEEDS, SYSTEM_PROMPT } from "../src/story/generate.ts";

const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const FULL = {
  company_name: "Halden Freight", project_name: "Project Kestrel", project_lead: "Ines Marlow", sponsor: "Tomas Reyes",
  project_status: "Working review", kickoff_date: "2026-10-01", review_date: "2026-10-15", final_deadline: "2026-11-20",
  finance_owner: "Ines Marlow", finance_due: "2026-11-02", legal_owner: "Omar Blake", legal_due: "2026-11-06",
  ops_owner: "Lena Fisk", ops_due: "2026-11-10"
};
const sheet = { facts: Object.entries(FULL).map(([key, value]) => ({ key, value })) };
const set = { documents: [{ id: "kickoff_email", title: "Kickoff", body: "Ines Marlow leads.", facts: [{ key: "project_lead", quote: "Ines Marlow", value: "Ines Marlow" }] }] };

/** A stand-in for Claude that returns scripted outputs and records every call. */
function fakeAsk(outputs) {
  const calls = [];
  const ask = async call => {
    calls.push(call);
    const next = outputs[calls.length - 1];
    return { output: next.output ?? null, stopReason: next.stopReason ?? "end_turn", error: next.error ?? null, usage, iterations: [],
      fallbackModel: null, requestId: `req_${calls.length}`, model: "claude-opus-5" };
  };
  return { ask, calls };
}

test("the system prompt keeps every story fictional and free of links, contacts, and credentials", () => {
  for (const rule of ["Everything is invented", "No links, URLs, email addresses, phone numbers", "passwords, keys"]) {
    assert.match(SYSTEM_PROMPT, new RegExp(rule));
  }
  assert.equal(new Set(SEEDS.map(seed => seed.id)).size, SEEDS.length);
  assert.ok(SEEDS.every(seed => !/https?:|www\.|@/.test(`${seed.industry} ${seed.initiative}`)));
});

test("free-form generation makes one call and keeps the parsed story", async () => {
  const { ask, calls } = fakeAsk([{ output: set }]);
  const record = await generateFreeForm(ask, SEEDS[0]);
  assert.equal(calls.length, 1);
  assert.equal(record.condition, "free-form");
  assert.deepEqual(record.set, set);
  assert.equal(record.failure, null);
  assert.equal(record.calls[0].output, null, "raw outputs are not duplicated into the call log");
  assert.equal((await generateFreeForm(fakeAsk([{ output: set }]).ask, SEEDS[0])).promptHash, record.promptHash);
});

test("fact-sheet generation writes the facts first, then hands exactly those facts to the documents call", async () => {
  const { ask, calls } = fakeAsk([{ output: sheet }, { output: set }]);
  const record = await generateWithSheet(ask, SEEDS[1]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /Ines Marlow/);
  assert.deepEqual(record.sheet, sheet);
  assert.deepEqual(record.set, set);
});

test("a decline is recorded as a failure and never silently retried", async () => {
  const free = await generateFreeForm(fakeAsk([{ stopReason: "refusal" }]).ask, SEEDS[0]);
  assert.equal(free.failure, "refusal");
  assert.equal(free.set, null);
  const { ask, calls } = fakeAsk([{ stopReason: "refusal" }]);
  const sheeted = await generateWithSheet(ask, SEEDS[0]);
  assert.equal(sheeted.failure, "sheet:refusal");
  assert.equal(calls.length, 1);
  const cut = await generateFreeForm(fakeAsk([{ output: set, stopReason: "max_tokens" }]).ask, SEEDS[0]);
  assert.equal(cut.failure, "max_tokens");
});

test("repair sends back everything but review-only items, plus the sheet when there is one", async () => {
  const { ask, calls } = fakeAsk([{ output: set }]);
  const issues = [
    { code: "CROSS_DOC_CONFLICT", severity: "contradiction", key: "project_lead", observations: [] },
    { code: "THIN_COVERAGE", severity: "incomplete", key: "sponsor", documents: 1 },
    { code: "UNACCOUNTED_DATE", severity: "review", docId: "scope_memo", text: "May 1, 2027", date: "2027-05-01" }
  ];
  const repaired = await repairStory(ask, set, issues, sheet);
  assert.deepEqual(repaired.set, set);
  assert.match(calls[0].prompt, /CROSS_DOC_CONFLICT/);
  assert.match(calls[0].prompt, /THIN_COVERAGE/, "missing coverage is something the repair can fix");
  assert.doesNotMatch(calls[0].prompt, /UNACCOUNTED_DATE/, "a stray date is for a person to review, not an instruction");
  assert.match(calls[0].prompt, /must match this sheet/);
});

test("cost is priced per model actually used, including a fallback that served the call", () => {
  const call = (usage, iterations = [], model = "claude-opus-5") => ({ usage, iterations, model });
  assert.equal(costUsd(call({ input_tokens: 1_000_000, output_tokens: 0 })), 5);
  assert.equal(costUsd(call({ input_tokens: 0, output_tokens: 1_000_000 })), 25);
  assert.equal(costUsd(call({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })), 0.5);
  const served = call({ input_tokens: 0, output_tokens: 0 }, [
    { type: "message", model: "claude-opus-5", input_tokens: 1_000_000, output_tokens: 0 },
    { type: "fallback_message", model: "claude-sonnet-5", input_tokens: 0, output_tokens: 1_000_000 }
  ]);
  assert.equal(costUsd(served), 5 + 10);
});

test("an API error or unparseable output is a recorded failure, not a story", async () => {
  const errored = await generateFreeForm(fakeAsk([{ error: "api_error:529" }]).ask, SEEDS[0]);
  assert.equal(errored.failure, "api_error:529");
  assert.equal(errored.set, null);
  const unparsed = await generateFreeForm(fakeAsk([{ error: "parse_error" }]).ask, SEEDS[0]);
  assert.equal(unparsed.failure, "parse_error");
});

test("a fact sheet missing a key or with a non-ISO date fails loudly before any documents are written", async () => {
  const partial = { facts: sheet.facts.filter(item => item.key !== "sponsor") };
  const { ask, calls } = fakeAsk([{ output: partial }]);
  const record = await generateWithSheet(ask, SEEDS[0]);
  assert.equal(record.failure, "sheet:incomplete:sponsor");
  assert.equal(calls.length, 1);
  const badDate = { facts: sheet.facts.map(item => item.key === "review_date" ? { ...item, value: "October 15, 2026" } : item) };
  assert.equal((await generateWithSheet(fakeAsk([{ output: badDate }]).ask, SEEDS[0])).failure, "sheet:incomplete:review_date");
});
