import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { StoryDocument } from "./schema.ts";

/**
 * Reads the newest pilot run for the board. File names are never taken from a request; only files matching the
 * exact names the pilot writes are read, and each is validated before it is shown. Anything else is skipped and counted.
 */

const RUN_DIR = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;
const STORY_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(free-form|fact-sheet)\.json$/;
const MAX_BYTES = 2_000_000;

const Issue = z.object({ code: z.string(), severity: z.string() }).passthrough();
const Check = z.object({ status: z.string(), issues: z.array(Issue) }).passthrough().nullable();
const StoryFile = z.object({
  record: z.object({
    condition: z.enum(["free-form", "fact-sheet"]),
    seedId: z.string(),
    failure: z.string().nullable(),
    set: z.object({ documents: z.array(StoryDocument) }).nullable()
  }).passthrough(),
  check: Check,
  repair: z.object({ set: z.object({ documents: z.array(StoryDocument) }).nullable(), failure: z.string().nullable() }).passthrough().nullable(),
  repaired: Check,
  outcome: z.object({ costUsd: z.number() }).passthrough()
});

export interface StoryView {
  readonly seedId: string;
  readonly condition: "free-form" | "fact-sheet";
  readonly failure: string | null;
  readonly status: string | null;
  readonly issues: readonly z.infer<typeof Issue>[];
  readonly documents: readonly z.infer<typeof StoryDocument>[];
  readonly repairFailure: string | null;
  readonly repairedStatus: string | null;
  readonly repairedIssues: readonly z.infer<typeof Issue>[];
  readonly repairedDocuments: readonly z.infer<typeof StoryDocument>[];
  readonly costUsd: number;
}

export interface RunView {
  readonly run: string | null;
  readonly summary: unknown;
  readonly stories: readonly StoryView[];
  readonly skipped: number;
}

function readJson(file: string): unknown {
  if (statSync(file).size > MAX_BYTES) throw new Error("too large");
  return JSON.parse(readFileSync(file, "utf8"));
}

export function latestRun(runsDir: string): RunView {
  const empty: RunView = { run: null, summary: null, stories: [], skipped: 0 };
  if (!existsSync(runsDir)) return empty;
  const run = readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && RUN_DIR.test(entry.name))
    .map(entry => entry.name).sort().at(-1);
  if (!run) return empty;
  const dir = path.join(runsDir, run);
  let summary: unknown = null;
  try { summary = readJson(path.join(dir, "summary.json")); } catch { summary = null; }
  const stories: StoryView[] = [];
  let skipped = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!STORY_FILE.test(name)) continue;
    try {
      const file = StoryFile.parse(readJson(path.join(dir, name)));
      stories.push({
        seedId: file.record.seedId,
        condition: file.record.condition,
        failure: file.record.failure,
        status: file.check?.status ?? null,
        issues: file.check?.issues ?? [],
        documents: file.record.set?.documents ?? [],
        repairFailure: file.repair?.failure ?? null,
        repairedStatus: file.repaired?.status ?? null,
        repairedIssues: file.repaired?.issues ?? [],
        repairedDocuments: file.repair?.set?.documents ?? [],
        costUsd: file.outcome.costUsd
      });
    } catch {
      skipped += 1;
    }
  }
  return { run, summary, stories, skipped };
}
