import { createHash } from "node:crypto";

import type { z } from "zod";

import { DecoySet, DOC_IDS, FACT_KEYS, FACT_KIND, FactSheet, type FactSheet as FactSheetType } from "./schema.ts";
import type { StoryIssue } from "./check.ts";

/**
 * Asks Claude for a fictional multi-document decoy story, either free-form or from a fact sheet written first.
 * The model call is injected, so tests never reach the API. Nothing here judges the output; see check.ts.
 */

export const MODEL = "claude-opus-5";

/** Usage fields read from the response to compute cost. */
export interface CallUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

export interface StructuredCall<T> {
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType<T>;
}

/** One sampling pass inside a call; a fallback-served call has a "fallback_message" entry naming the model. */
export interface IterationUsage extends CallUsage {
  readonly type: string;
  readonly model: string;
}

export interface StructuredResult<T> {
  readonly output: T | null;
  readonly stopReason: string | null;
  /** Set when the call itself failed or its output could not be parsed: "api_error:<status>" or "parse_error". */
  readonly error: string | null;
  readonly usage: CallUsage;
  readonly iterations: readonly IterationUsage[];
  readonly fallbackModel: string | null;
  readonly requestId: string | null;
  readonly model: string;
}

/** The only boundary to Claude. The real one lives in client.ts; tests pass a fake. */
export type Ask = <T>(call: StructuredCall<T>) => Promise<StructuredResult<T>>;

export interface Seed {
  readonly id: string;
  readonly industry: string;
  readonly initiative: string;
}

/** Fixed, fictional starting points so runs are comparable. No real organization is named. */
export const SEEDS: readonly Seed[] = [
  { id: "freight-acquisition", industry: "regional freight carrier", initiative: "review of a proposed acquisition" },
  { id: "clinic-migration", industry: "network of outpatient clinics", initiative: "migration of scheduling systems" },
  { id: "grocer-pricing", industry: "mid-size grocery chain", initiative: "pricing model overhaul" },
  { id: "utility-audit", industry: "water utility", initiative: "internal controls audit" },
  { id: "bank-vendor", industry: "community bank", initiative: "core vendor replacement" },
  { id: "school-portal", industry: "school district", initiative: "family portal redesign" },
  { id: "hotel-loyalty", industry: "boutique hotel group", initiative: "loyalty program relaunch" },
  { id: "maker-plant", industry: "industrial parts maker", initiative: "second plant feasibility study" },
  { id: "insurer-claims", industry: "specialty insurer", initiative: "claims workflow consolidation" },
  { id: "museum-merger", industry: "regional museum consortium", initiative: "back-office merger" }
];

export const SYSTEM_PROMPT = `You write fictional internal business documents for a defensive cyber-deception exercise: decoy files an organization places inside its own network so that intruders who read them can be detected.

Rules:
- Everything is invented. Do not name or allude to real companies, people, products, or places beyond generic city names.
- No links, URLs, email addresses, phone numbers, account numbers, passwords, keys, or anything credential-like.
- Write ordinary, believable workplace prose. The documents must agree with each other on every fact.
- Produce exactly these five documents, one each: ${DOC_IDS.join(", ")}. The workstream_tracker body is a small CSV table.
- For every document, list each fact it states. "quote" is the exact text copied from that document's body; "value" is the fact's value: dates as YYYY-MM-DD, and people's full names even when the text uses only a first name.
- Facts to cover, each in at least two documents: ${FACT_KEYS.join(", ")}.
- Dates must be plausible: kickoff before review before the final deadline, and every workstream due date between kickoff and the final deadline.`;

export const promptHash = (...parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

const describeSeed = (seed: Seed) => `The organization is a ${seed.industry}. The project is a ${seed.initiative}.`;

export interface GenerationRecord {
  readonly condition: "free-form" | "fact-sheet";
  readonly seedId: string;
  readonly sheet: FactSheetType | null;
  readonly set: z.infer<typeof DecoySet> | null;
  readonly failure: string | null;
  readonly calls: readonly StructuredResult<unknown>[];
  readonly promptHash: string;
}

function failureOf(result: StructuredResult<unknown>): string | null {
  if (result.error) return result.error;
  if (result.stopReason === "refusal") return "refusal";
  if (result.stopReason === "max_tokens") return "max_tokens";
  if (result.output === null) return "unparsed";
  return null;
}

const strip = (result: StructuredResult<unknown>): StructuredResult<unknown> => ({ ...result, output: null });

export async function generateFreeForm(ask: Ask, seed: Seed): Promise<GenerationRecord> {
  const prompt = `${describeSeed(seed)} Write the five documents.`;
  const result = await ask({ system: SYSTEM_PROMPT, prompt, schema: DecoySet });
  return {
    condition: "free-form", seedId: seed.id, sheet: null,
    set: failureOf(result) ? null : result.output, failure: failureOf(result),
    calls: [strip(result)], promptHash: promptHash(SYSTEM_PROMPT, prompt)
  };
}

export async function generateWithSheet(ask: Ask, seed: Seed): Promise<GenerationRecord> {
  const sheetPrompt = `${describeSeed(seed)} First, decide the story's facts only. Give one value for every fact key.`;
  const sheetResult = await ask({ system: SYSTEM_PROMPT, prompt: sheetPrompt, schema: FactSheet });
  const sheetFailure = failureOf(sheetResult);
  if (sheetFailure || !sheetResult.output) {
    return { condition: "fact-sheet", seedId: seed.id, sheet: null, set: null, failure: `sheet:${sheetFailure}`,
      calls: [strip(sheetResult)], promptHash: promptHash(SYSTEM_PROMPT, sheetPrompt) };
  }
  const sheet = sheetResult.output;
  const missing = FACT_KEYS.filter(key => {
    const value = sheet.facts.find(item => item.key === key)?.value?.trim();
    return !value || (FACT_KIND[key] === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value));
  });
  if (missing.length > 0) {
    return { condition: "fact-sheet", seedId: seed.id, sheet, set: null, failure: `sheet:incomplete:${missing.join(",")}`,
      calls: [strip(sheetResult)], promptHash: promptHash(SYSTEM_PROMPT, sheetPrompt) };
  }
  const docsPrompt = `${describeSeed(seed)} Write the five documents using exactly these facts:\n${JSON.stringify(sheet.facts)}`;
  const docsResult = await ask({ system: SYSTEM_PROMPT, prompt: docsPrompt, schema: DecoySet });
  return {
    condition: "fact-sheet", seedId: seed.id, sheet,
    set: failureOf(docsResult) ? null : docsResult.output, failure: failureOf(docsResult),
    calls: [strip(sheetResult), strip(docsResult)], promptHash: promptHash(SYSTEM_PROMPT, sheetPrompt, docsPrompt)
  };
}

/** One repair pass: the checker's findings go back to the model, which returns the full corrected set. */
export async function repairStory(ask: Ask, set: z.infer<typeof DecoySet>, issues: readonly StoryIssue[], sheet: FactSheetType | null) {
  const findings = issues.filter(issue => issue.severity !== "review");
  const prompt = [
    "These documents were audited and the problems below were found. Return the complete corrected set.",
    "Fix only what is listed; keep everything else the same.",
    sheet ? `The facts must match this sheet:\n${JSON.stringify(sheet.facts)}` : "",
    `Problems:\n${JSON.stringify(findings)}`,
    `Documents:\n${JSON.stringify(set)}`
  ].filter(Boolean).join("\n\n");
  const result = await ask({ system: SYSTEM_PROMPT, prompt, schema: DecoySet });
  return { set: failureOf(result) ? null : result.output, failure: failureOf(result), call: strip(result) };
}

/** List prices per million tokens (input, output). Cache reads bill at 0.1x input, 5-minute cache writes at 1.25x. */
export const PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 }
};

function priced(usage: CallUsage, model: string): number {
  const price = PRICES[model] ?? PRICES[MODEL];
  return (usage.input_tokens * price.input + usage.output_tokens * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.input * 0.1 + (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25) / 1_000_000;
}

/**
 * Cost of one call. When the response itemizes sampling passes (including a declined pass and the fallback
 * that served it), each pass is priced at its own model's rate; otherwise the call is priced at the requested model.
 * A call that failed before a response carries no usage and is reported separately as an error, not as $0 of work.
 */
export function costUsd(call: Pick<StructuredResult<unknown>, "usage" | "iterations" | "model">): number {
  return call.iterations.length > 0
    ? call.iterations.reduce((total, item) => total + priced(item, item.model), 0)
    : priced(call.usage, call.model);
}
