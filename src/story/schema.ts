import { z } from "zod";

/**
 * The shape an AI-written decoy story must take. Every document lists the facts it states,
 * with the exact quote it used, so a plain-code checker can audit the story without trusting the model.
 */

export const FACT_KEYS = [
  "company_name", "project_name", "project_lead", "sponsor", "project_status",
  "kickoff_date", "review_date", "final_deadline",
  "finance_owner", "finance_due", "legal_owner", "legal_due", "ops_owner", "ops_due"
] as const;
export type FactKey = typeof FACT_KEYS[number];

export const FACT_KIND: Readonly<Record<FactKey, "text" | "person" | "date">> = {
  company_name: "text", project_name: "text", project_lead: "person", sponsor: "person", project_status: "text",
  kickoff_date: "date", review_date: "date", final_deadline: "date",
  finance_owner: "person", finance_due: "date", legal_owner: "person", legal_due: "date", ops_owner: "person", ops_due: "date"
};

export const DOC_IDS = ["kickoff_email", "scope_memo", "workstream_tracker", "status_update", "handoff_note"] as const;
export type DocId = typeof DOC_IDS[number];

/** Declared order rules: each pair must be strictly earlier-then-later. */
export const TIMELINE_RULES: readonly (readonly [FactKey, FactKey])[] = [
  ["kickoff_date", "review_date"], ["review_date", "final_deadline"],
  ["kickoff_date", "finance_due"], ["kickoff_date", "legal_due"], ["kickoff_date", "ops_due"],
  ["finance_due", "final_deadline"], ["legal_due", "final_deadline"], ["ops_due", "final_deadline"]
];

export const StatedFact = z.object({
  key: z.enum(FACT_KEYS),
  quote: z.string().describe("The exact text copied from this document's body where the fact is stated."),
  value: z.string().describe("The fact's value. Dates as YYYY-MM-DD; names exactly as written.")
});

export const StoryDocument = z.object({
  id: z.enum(DOC_IDS),
  title: z.string(),
  body: z.string(),
  facts: z.array(StatedFact)
});

export const DecoySet = z.object({ documents: z.array(StoryDocument) });
export type DecoySet = z.infer<typeof DecoySet>;
export type StoryDocument = z.infer<typeof StoryDocument>;

export const FactSheet = z.object({
  facts: z.array(z.object({ key: z.enum(FACT_KEYS), value: z.string() }))
});
export type FactSheet = z.infer<typeof FactSheet>;
