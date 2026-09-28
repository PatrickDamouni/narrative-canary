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

export interface LintReport {
  readonly findings: readonly AssuranceFinding[];
  readonly timelineFindings: readonly TimelineFinding[];
  readonly uncheckedReferences: readonly UncheckedReference[];
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

export function lintScenario(scenario: Scenario): LintReport {
  const artifacts = (["baseline", "narrative"] as const).flatMap(armId => scenario.arms[armId].artifacts);
  const findings = assuranceFindings(scenario);
  const timeline = timelineFindings(scenario);
  return {
    findings,
    timelineFindings: timeline,
    uncheckedReferences: uncheckedReferences(scenario),
    literalChecks: artifacts.reduce((total, artifact) => total + (artifact.literalClaims?.length ?? 0), 0),
    tableChecks: artifacts.reduce((total, artifact) => total + (artifact.tableBindings?.length ?? 0), 0),
    timelineChecks: scenario.timelineConstraints.length,
    blocking: findings.length > 0 || timeline.length > 0
  };
}
