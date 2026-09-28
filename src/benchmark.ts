import type { LintReport } from "./lint.ts";
import { validateScenario, type ArmId, type Artifact, type Scenario, type ScenarioFact } from "./scenario.ts";
import { parseFixtureTable } from "./ui/table.js";

/**
 * Planted-flaw benchmark: copies of a clean fictional campaign, each with exactly one known mistake,
 * used to measure what the consistency lint catches, where, and what it misses.
 * The flaws are synthetic and written by the same author as the lint; read the score in that light.
 */

export type FlawKind = "anchored-quote-typo" | "worksheet-cell-edit" | "impossible-deadline" | "prose-name-typo" | "prose-wrong-value";

export interface PlantedCase {
  readonly id: string;
  readonly kind: FlawKind;
  readonly description: string;
  /** Where the mistake was planted. Timeline cases change a canonical date and are located by rule instead. */
  readonly armId: ArmId | null;
  readonly artifactId: string | null;
  readonly factId: string;
  readonly constraintId: string | null;
  readonly scenario: Scenario;
}

export interface KindScore {
  readonly kind: FlawKind;
  readonly planted: number;
  readonly caught: number;
  readonly strayFindings: number;
  readonly missed: readonly string[];
}

export interface BenchmarkScore {
  readonly cleanFalseAlarms: number;
  readonly byKind: readonly KindScore[];
}

type LintLike = Pick<LintReport, "findings" | "timelineFindings" | "nearMisses">;

const KINDS: readonly FlawKind[] = ["anchored-quote-typo", "worksheet-cell-edit", "impossible-deadline", "prose-name-typo", "prose-wrong-value"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VOWELS = "aeiou";

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A one-character slip: the next vowel in the last word, or the next day for a date. */
export function typo(value: string): string {
  if (ISO_DATE.test(value)) return shiftDate(value, 1);
  const words = value.split(" ");
  const last = words[words.length - 1];
  for (let index = 1; index < last.length; index += 1) {
    const vowel = VOWELS.indexOf(last[index].toLowerCase());
    if (vowel >= 0) {
      words[words.length - 1] = `${last.slice(0, index)}${VOWELS[(vowel + 1) % VOWELS.length]}${last.slice(index + 1)}`;
      return words.join(" ");
    }
  }
  return `${value}s`;
}

/** A plausible but wrong value: another person from the story, a later date, or a fixed fictional alternative. */
function substitute(fact: ScenarioFact, facts: readonly ScenarioFact[]): string {
  if (ISO_DATE.test(fact.value)) return shiftDate(fact.value, 7);
  if (fact.attribute === "lead" || fact.attribute === "owner") {
    const other = facts.find(item => (item.attribute === "lead" || item.attribute === "owner") && item.value !== fact.value);
    if (other) return other.value;
  }
  const alternatives: Record<string, string> = { name: "Project Harbor", status: "Approved to proceed", purpose: "Vendor consolidation review" };
  return alternatives[fact.attribute] ?? `${fact.value} (revised)`;
}

/** A writable copy of a read-only scenario; every draft is re-validated before use. */
type Draft = { facts: ScenarioFact[]; arms: Record<ArmId, { artifacts: Artifact[] }> };
const draftOf = (base: Scenario): Draft => structuredClone(base) as unknown as Draft;

function withArtifact(base: Scenario, armId: ArmId, artifactId: string, change: (artifact: Artifact) => Artifact): Scenario {
  const draft = draftOf(base);
  draft.arms[armId].artifacts = draft.arms[armId].artifacts.map(item => item.id === artifactId ? change(item) : item);
  return validateScenario(draft);
}

function editCell(body: string, rowKey: string, column: string, next: (value: string) => string): string {
  const table = parseFixtureTable(body);
  if (!table) throw new Error("benchmark expected a curated table");
  const col = table[0].indexOf(column);
  return table.map((row: string[], index: number) => index > 0 && row[0] === rowKey
    ? row.map((cell, cellIndex) => cellIndex === col ? next(cell) : cell)
    : row).map((row: string[]) => row.join(",")).join("\n");
}

function anchoredCases(base: Scenario): PlantedCase[] {
  return (["baseline", "narrative"] as const).flatMap(armId => base.arms[armId].artifacts.flatMap(artifact => [
    ...(artifact.literalClaims ?? []).filter(claim => artifact.body.includes(claim.quote)).map(claim => ({
      id: `quote:${armId}/${artifact.id}/${claim.factId}`,
      kind: "anchored-quote-typo" as const,
      description: `“${claim.quote}” becomes “${typo(claim.quote)}” in ${artifact.title}`,
      armId, artifactId: artifact.id, factId: claim.factId, constraintId: null,
      scenario: withArtifact(base, armId, artifact.id, item => ({ ...item, body: item.body.replaceAll(claim.quote, typo(claim.quote)) }))
    })),
    ...(artifact.tableBindings ?? []).map(binding => ({
      id: `cell:${armId}/${artifact.id}/${binding.factId}`,
      kind: "worksheet-cell-edit" as const,
      description: `${binding.rowKey} / ${binding.column} is edited in ${artifact.title}`,
      armId, artifactId: artifact.id, factId: binding.factId, constraintId: null,
      scenario: withArtifact(base, armId, artifact.id, item => ({ ...item, body: editCell(item.body, binding.rowKey, binding.column, typo) }))
    }))
  ]));
}

/** The source of truth itself goes wrong: a workstream deadline moves past the handoff, consistently everywhere. */
function deadlineCases(base: Scenario): PlantedCase[] {
  return base.timelineConstraints.map(constraint => {
    const after = base.facts.find(fact => fact.id === constraint.afterFactId) as ScenarioFact;
    const before = base.facts.find(fact => fact.id === constraint.beforeFactId) as ScenarioFact;
    const late = shiftDate(after.value, 1);
    const draft = draftOf(base);
    draft.facts = draft.facts.map(fact => fact.id === before.id ? { ...fact, value: late } : fact);
    for (const armId of ["baseline", "narrative"] as const) {
      draft.arms[armId].artifacts = draft.arms[armId].artifacts.map(artifact => {
        const binding = artifact.tableBindings?.find(item => item.factId === before.id);
        return binding ? { ...artifact, body: editCell(artifact.body, binding.rowKey, binding.column, () => late) } : artifact;
      });
    }
    return {
      id: `deadline:${constraint.id}`, kind: "impossible-deadline" as const,
      description: `${before.subject} deadline moves to ${late}, after the ${after.subject} it must precede`,
      armId: null, artifactId: null, factId: before.id, constraintId: constraint.id,
      scenario: validateScenario(draft)
    };
  });
}

/** A sentence nobody annotated: exactly the prose the anchored checks cannot see. */
function proseCases(base: Scenario, anchoredFactsByArtifact: (armId: ArmId, artifact: Artifact) => Set<string>): PlantedCase[] {
  // Worksheets hold cells, not sentences; a planted sentence would only break the table.
  return (["baseline", "narrative"] as const).flatMap(armId => base.arms[armId].artifacts.filter(artifact => !artifact.title.endsWith(".csv")).flatMap(artifact => {
    const anchored = anchoredFactsByArtifact(armId, artifact);
    return artifact.factIds.filter(factId => !anchored.has(factId)).flatMap(factId => {
      const fact = base.facts.find(item => item.id === factId) as ScenarioFact;
      const label = `${fact.subject} ${fact.attribute}`;
      const plant = (kind: FlawKind, wrong: string) => ({
        id: `${kind}:${armId}/${artifact.id}/${factId}`, kind,
        description: `${artifact.title} adds “The ${label} is ${wrong}.”`,
        armId, artifactId: artifact.id, factId, constraintId: null,
        scenario: withArtifact(base, armId, artifact.id, item => ({ ...item, body: `${item.body} The ${label} is ${wrong}.` }))
      });
      return [plant("prose-name-typo", typo(fact.value)), plant("prose-wrong-value", substitute(fact, base.facts))];
    });
  }));
}

export function plantFlaws(base: Scenario): PlantedCase[] {
  const clean = validateScenario(base);
  const anchoredFacts = (_armId: ArmId, artifact: Artifact) => new Set([
    ...(artifact.literalClaims ?? []).map(claim => claim.factId),
    ...(artifact.tableBindings ?? []).map(binding => binding.factId)
  ]);
  return [...anchoredCases(clean), ...deadlineCases(clean), ...proseCases(clean, anchoredFacts)];
}

function locates(item: PlantedCase, report: LintLike): { located: number; stray: number } {
  let located = 0;
  let stray = 0;
  for (const finding of report.findings) {
    if (finding.armId === item.armId && finding.artifactId === item.artifactId && finding.factId === item.factId) located += 1;
    else stray += 1;
  }
  for (const finding of report.timelineFindings) {
    if (finding.constraintId === item.constraintId) located += 1;
    else stray += 1;
  }
  for (const finding of report.nearMisses) {
    if (finding.armId === item.armId && finding.artifactId === item.artifactId && finding.factIds.includes(item.factId)) located += 1;
    else stray += 1;
  }
  return { located, stray };
}

const countAll = (report: LintLike) => report.findings.length + report.timelineFindings.length + report.nearMisses.length;

export function scoreLint(clean: Scenario, cases: readonly PlantedCase[], lint: (scenario: Scenario) => LintLike): BenchmarkScore {
  const results = cases.map(item => ({ item, ...locates(item, lint(item.scenario)) }));
  return {
    cleanFalseAlarms: countAll(lint(clean)),
    byKind: KINDS.filter(kind => cases.some(item => item.kind === kind)).map(kind => {
      const ofKind = results.filter(result => result.item.kind === kind);
      return {
        kind,
        planted: ofKind.length,
        caught: ofKind.filter(result => result.located > 0).length,
        strayFindings: ofKind.reduce((total, result) => total + result.stray, 0),
        missed: ofKind.filter(result => result.located === 0).map(result => result.item.id)
      };
    })
  };
}
