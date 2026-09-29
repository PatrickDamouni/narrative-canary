import type { ArmId, Scenario, TimelineSourceCell } from "./scenario.ts";
import { parseFixtureTable } from "./ui/table.js";

/**
 * Pre-deployment lint for a fictional decoy campaign: compares declared quotes, worksheet cells,
 * and declared date rules with canonical facts. A clean result covers only those anchors;
 * surrounding prose is not verified.
 */

export interface AssuranceFinding {
  readonly code: "CLAIM_VALUE_CONFLICT" | "CLAIM_ANCHOR_MISSING" | "TABLE_VALUE_CONFLICT" | "TABLE_BINDING_MISSING";
  readonly armId: ArmId;
  readonly artifactId: string;
  readonly factId: string;
  readonly sourceText: string;
  readonly canonicalValue: string;
  readonly relatedArtifactIds: readonly string[];
}

export interface TimelineFinding {
  readonly code: "TIMELINE_ORDER_CONFLICT";
  readonly constraintId: string;
  readonly beforeFactId: string;
  readonly beforeValue: string;
  readonly afterFactId: string;
  readonly afterValue: string;
  readonly sourceCells: readonly TimelineSourceCell[];
}

export interface UncheckedReference {
  readonly armId: ArmId;
  readonly artifactId: string;
  readonly factId: string;
}

/** Text in a file that is one or two letters away from a canonical name or phrase, without being it. */
export interface NearMiss {
  readonly code: "NEAR_MISS_VALUE";
  readonly armId: ArmId;
  readonly artifactId: string;
  readonly text: string;
  readonly closestTo: string;
  readonly factIds: readonly string[];
}

export interface LintReport {
  readonly findings: readonly AssuranceFinding[];
  readonly timelineFindings: readonly TimelineFinding[];
  readonly uncheckedReferences: readonly UncheckedReference[];
  readonly nearMisses: readonly NearMiss[];
  readonly literalChecks: number;
  readonly tableChecks: number;
  readonly timelineChecks: number;
  readonly blocking: boolean;
}

function comparableLiteral(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function assuranceFindings(scenario: Scenario): AssuranceFinding[] {
  const findings: AssuranceFinding[] = [];
  const facts = new Map(scenario.facts.map(fact => [fact.id, fact]));
  for (const armId of ["baseline", "narrative"] as const) {
    const artifacts = scenario.arms[armId].artifacts;
    for (const artifact of artifacts) {
      for (const claim of artifact.literalClaims ?? []) {
        const fact = facts.get(claim.factId);
        if (!fact) throw new Error(`Validated scenario is missing fact ${claim.factId}`);
        const anchorPresent = artifact.title.includes(claim.quote) || artifact.body.includes(claim.quote);
        const valueMatches = comparableLiteral(claim.quote) === comparableLiteral(fact.value);
        if (anchorPresent && valueMatches) continue;
        findings.push({
          code: anchorPresent ? "CLAIM_VALUE_CONFLICT" : "CLAIM_ANCHOR_MISSING",
          armId,
          artifactId: artifact.id,
          factId: claim.factId,
          sourceText: claim.quote,
          canonicalValue: fact.value,
          relatedArtifactIds: artifacts
            .filter(other => other.id !== artifact.id && other.factIds.includes(claim.factId))
            .map(other => other.id)
            .sort()
        });
      }
      for (const binding of artifact.tableBindings ?? []) {
        const fact = facts.get(binding.factId);
        if (!fact) throw new Error(`Validated scenario is missing fact ${binding.factId}`);
        const table = parseFixtureTable(artifact.body);
        const columnIndexes = table?.[0].flatMap((header, index) => header === binding.column ? [index] : []) ?? [];
        const rows = table?.slice(1).filter(row => row[0] === binding.rowKey) ?? [];
        const sourceText = columnIndexes.length === 1 && rows.length === 1 ? rows[0][columnIndexes[0]] : "";
        if (sourceText && comparableLiteral(sourceText) === comparableLiteral(fact.value)) continue;
        findings.push({
          code: sourceText ? "TABLE_VALUE_CONFLICT" : "TABLE_BINDING_MISSING",
          armId,
          artifactId: artifact.id,
          factId: binding.factId,
          sourceText,
          canonicalValue: fact.value,
          relatedArtifactIds: artifacts
            .filter(other => other.id !== artifact.id && other.factIds.includes(binding.factId))
            .map(other => other.id)
            .sort()
        });
      }
    }
  }
  return findings;
}

function timelineFindings(scenario: Scenario): TimelineFinding[] {
  const facts = new Map(scenario.facts.map(fact => [fact.id, fact]));
  return scenario.timelineConstraints.flatMap(constraint => {
    const before = facts.get(constraint.beforeFactId);
    const after = facts.get(constraint.afterFactId);
    if (!before || !after) throw new Error(`Validated timeline constraint ${constraint.id} has a missing fact`);
    if (before.value < after.value) return [];
    return [{
      code: "TIMELINE_ORDER_CONFLICT" as const,
      constraintId: constraint.id,
      beforeFactId: before.id,
      beforeValue: before.value,
      afterFactId: after.id,
      afterValue: after.value,
      sourceCells: constraint.sourceCells.map(cell => ({ ...cell }))
    }];
  });
}

function uncheckedReferences(scenario: Scenario): UncheckedReference[] {
  return (["baseline", "narrative"] as const).flatMap(armId => scenario.arms[armId].artifacts.flatMap(artifact =>
    artifact.factIds
      .filter(factId =>
        !(artifact.literalClaims ?? []).some(claim => claim.factId === factId) &&
        !(artifact.tableBindings ?? []).some(binding => binding.factId === factId)
      )
      .map(factId => ({ armId, artifactId: artifact.id, factId }))
  ));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
}

// Possessives are correct usage ("Project Lantern's"), not spelling slips.
export const words = (text: string): string[] => text.split(/\s+/)
  .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/u, ""))
  .filter(Boolean);

/**
 * Finds phrases one or two letters away from a canonical value without matching it: likely slips in
 * unannotated prose. It compares spelling only; a different but plausible value is not detected.
 */
function nearMisses(scenario: Scenario): NearMiss[] {
  const targets = [...new Set(scenario.facts.map(fact => fact.value))]
    .filter(value => !ISO_DATE.test(value) && /\p{L}/u.test(value) && value.length >= 6)
    .map(value => ({ value, key: words(value).join(" ").toLocaleLowerCase("en-US"), size: words(value).length }));
  const results: NearMiss[] = [];
  for (const armId of ["baseline", "narrative"] as const) {
    for (const artifact of scenario.arms[armId].artifacts) {
      const text = words(`${artifact.title} ${artifact.body.replace(/,/g, " ")}`);
      const seen = new Set<string>();
      for (const target of targets) {
        const allowed = target.key.length >= 12 ? 2 : 1;
        for (let start = 0; start + target.size <= text.length; start += 1) {
          const window = text.slice(start, start + target.size).join(" ");
          const distance = editDistance(window.toLocaleLowerCase("en-US"), target.key);
          if (distance === 0 || distance > allowed || seen.has(window)) continue;
          seen.add(window);
          results.push({
            code: "NEAR_MISS_VALUE", armId, artifactId: artifact.id, text: window, closestTo: target.value,
            factIds: scenario.facts.filter(fact => fact.value === target.value).map(fact => fact.id)
          });
        }
      }
    }
  }
  return results;
}

export function lintScenario(scenario: Scenario): LintReport {
  const artifacts = (["baseline", "narrative"] as const).flatMap(armId => scenario.arms[armId].artifacts);
  const findings = assuranceFindings(scenario);
  const timeline = timelineFindings(scenario);
  return {
    findings,
    timelineFindings: timeline,
    uncheckedReferences: uncheckedReferences(scenario),
    nearMisses: nearMisses(scenario),
    literalChecks: artifacts.reduce((total, artifact) => total + (artifact.literalClaims?.length ?? 0), 0),
    tableChecks: artifacts.reduce((total, artifact) => total + (artifact.tableBindings?.length ?? 0), 0),
    timelineChecks: scenario.timelineConstraints.length,
    blocking: findings.length > 0 || timeline.length > 0
  };
}
