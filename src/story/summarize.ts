import type { StoryCheck, StoryStatus } from "./check.ts";

/** One generated story after checking, and after one repair pass if it had contradictions or unsafe content. */
export interface StoryOutcome {
  readonly condition: "free-form" | "fact-sheet";
  readonly seedId: string;
  /** Why no story was produced (refusal, api_error:529, parse_error, sheet:incomplete:…), or null. */
  readonly failure: string | null;
  readonly check: StoryCheck | null;
  readonly repairAttempted: boolean;
  readonly repairFailure: string | null;
  readonly repaired: StoryCheck | null;
  readonly fallbackCalls: number;
  readonly costUsd: number;
}

export interface ConditionSummary {
  readonly condition: "free-form" | "fact-sheet";
  readonly attempted: number;
  readonly failed: number;
  /** The denominator for every rate below: stories that were produced and checked. */
  readonly checked: number;
  readonly byStatus: Readonly<Record<StoryStatus, number>>;
  /** Stories with at least one issue of each contradiction code (a story counts once per code). */
  readonly storiesWithCode: Readonly<Record<string, number>>;
  readonly repairAttempted: number;
  readonly repairFailed: number;
  readonly repairedClean: number;
  readonly repairIntroducedNew: number;
  readonly fallbackCalls: number;
  readonly costUsd: number;
}

const codesOf = (check: StoryCheck | null): Set<string> =>
  new Set(check?.issues.filter(issue => issue.severity === "contradiction" || issue.severity === "unsafe").map(issue => issue.code) ?? []);

export function summarize(outcomes: readonly StoryOutcome[]): ConditionSummary[] {
  return (["free-form", "fact-sheet"] as const).flatMap(condition => {
    const rows = outcomes.filter(item => item.condition === condition);
    if (rows.length === 0) return [];
    const checked = rows.filter(row => row.check !== null);
    const byStatus: Record<StoryStatus, number> = { consistent: 0, incomplete: 0, contradiction: 0, unsafe: 0 };
    const storiesWithCode: Record<string, number> = {};
    for (const row of checked) {
      byStatus[(row.check as StoryCheck).status] += 1;
      for (const code of codesOf(row.check)) storiesWithCode[code] = (storiesWithCode[code] ?? 0) + 1;
    }
    const attemptedRepairs = rows.filter(row => row.repairAttempted);
    const repairedRows = attemptedRepairs.filter(row => row.repaired !== null);
    return [{
      condition,
      attempted: rows.length,
      failed: rows.filter(row => row.failure !== null).length,
      checked: checked.length,
      byStatus,
      storiesWithCode,
      repairAttempted: attemptedRepairs.length,
      repairFailed: attemptedRepairs.filter(row => row.repaired === null).length,
      repairedClean: repairedRows.filter(row => row.repaired?.status === "consistent").length,
      repairIntroducedNew: repairedRows.filter(row => [...codesOf(row.repaired)].some(code => !codesOf(row.check).has(code))).length,
      fallbackCalls: rows.reduce((total, row) => total + row.fallbackCalls, 0),
      costUsd: rows.reduce((total, row) => total + row.costUsd, 0)
    }];
  });
}
