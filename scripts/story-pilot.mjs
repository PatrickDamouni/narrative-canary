import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkStory } from "../src/story/check.ts";
import { claudeAsk } from "../src/story/client.ts";
import { costUsd, generateFreeForm, generateWithSheet, MODEL, repairStory, SEEDS } from "../src/story/generate.ts";
import { summarize } from "../src/story/summarize.ts";

// Usage: npm run story-pilot -- [--n 3] [--yes]
// Without --yes this only prints the plan and a cost estimate. With --yes it calls the Claude API and spends money.
const args = process.argv.slice(2);
const nIndex = args.indexOf("--n");
const n = nIndex >= 0 ? Number(args[nIndex + 1]) : 3;
if (!Number.isInteger(n) || n < 1 || n > SEEDS.length) {
  process.stderr.write(`--n must be 1-${SEEDS.length}\n`);
  process.exit(1);
}

// Rough upper bound: free-form 1 call, fact-sheet 2 calls, up to 1 repair each; ~$0.20 per call at Opus 5 prices.
const maxCalls = n * (1 + 2 + 2);
process.stdout.write([
  `Plan: ${n} fictional seeds × 2 conditions (free-form, fact-sheet) on ${MODEL}, one repair pass where the checker finds contradictions.`,
  `Up to ${maxCalls} API calls. Estimated cost: about $${(maxCalls * 0.08).toFixed(2)}–$${(maxCalls * 0.2).toFixed(2)}.`,
  ""
].join("\n"));

if (!args.includes("--yes")) {
  process.stdout.write("Nothing was sent. Re-run with --yes to spend the credits.\n");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  process.stderr.write("ANTHROPIC_API_KEY is not set. Create a key at console.anthropic.com, save it with setx in your own terminal, then restart.\n");
  process.exit(1);
}

const ask = claudeAsk();
const runDir = path.join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });
const outcomes = [];
const save = () => writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ model: MODEL, seeds: n, summary: summarize(outcomes) }, null, 2));

try {
  for (const seed of SEEDS.slice(0, n)) {
    for (const generate of [generateFreeForm, generateWithSheet]) {
      const condition = generate === generateFreeForm ? "free-form" : "fact-sheet";
      try {
        const record = await generate(ask, seed);
        const check = record.set ? checkStory(record.set, record.sheet ?? undefined) : null;
        const needsRepair = check !== null && (check.status === "contradiction" || check.status === "unsafe");
        const repair = needsRepair ? await repairStory(ask, record.set, check.issues, record.sheet) : null;
        const repaired = repair?.set ? checkStory(repair.set, record.sheet ?? undefined) : null;
        const calls = [...record.calls, ...(repair ? [repair.call] : [])];
        const cost = calls.reduce((total, call) => total + costUsd(call), 0);
        const outcome = { condition, seedId: seed.id, failure: record.failure, check, repairAttempted: needsRepair,
          repairFailure: repair?.failure ?? null, repaired, fallbackCalls: calls.filter(call => call.fallbackModel).length, costUsd: cost };
        outcomes.push(outcome);
        writeFileSync(path.join(runDir, `${seed.id}.${condition}.json`), JSON.stringify({ record, check, repair, repaired, outcome }, null, 2));
        const after = needsRepair ? ` → after repair: ${repaired ? repaired.status : `repair failed (${repair?.failure})`}` : "";
        process.stdout.write(`${seed.id} ${condition}: ${record.failure ?? check.status}${after} ($${cost.toFixed(3)})\n`);
      } catch (error) {
        // An unexpected crash is recorded as a failed story so it stays in the denominator.
        outcomes.push({ condition, seedId: seed.id, failure: `crash:${error instanceof Error ? error.message : String(error)}`,
          check: null, repairAttempted: false, repairFailure: null, repaired: null, fallbackCalls: 0, costUsd: 0 });
        process.stdout.write(`${seed.id} ${condition}: crashed (${error instanceof Error ? error.message : error})\n`);
      }
      save();
    }
  }
} finally {
  save();
  process.stdout.write(`\n${JSON.stringify(summarize(outcomes), null, 2)}\nSaved to ${runDir}\n`);
}
