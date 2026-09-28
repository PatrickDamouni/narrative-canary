import { createHash } from "node:crypto";
import { parseFixtureTable } from "./ui/table.js";

export type ArmId = "baseline" | "narrative";
export type ArtifactKind = "document" | "message" | "access-note" | "portal";
export type ArtifactRole = "target" | "alternative" | "goal";

export interface ScenarioFact {
  readonly id: string;
  readonly subject: string;
  readonly attribute: string;
  readonly value: string;
}

export interface TimelineSourceCell {
  readonly armId: ArmId;
  readonly artifactId: string;
  readonly rowKey: string;
  readonly column: string;
  readonly sourceText: string;
}

export interface TimelineConstraint {
  readonly id: string;
  readonly beforeFactId: string;
  readonly afterFactId: string;
  readonly sourceCells: readonly TimelineSourceCell[];
}

export interface Artifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly role: ArtifactRole;
  readonly title: string;
  readonly body: string;
  readonly nextId: string | null;
  readonly visibleAtStart: boolean;
  readonly factIds: readonly string[];
  readonly literalClaims?: readonly { readonly factId: string; readonly quote: string }[];
  readonly tableBindings?: readonly { readonly factId: string; readonly rowKey: string; readonly column: string }[];
}

export interface ScenarioArm {
  readonly id: ArmId;
  readonly goalId: string;
  /** A matched, visible document whose local open is the canary-interaction proxy. */
  readonly canaryArtifactId: string;
  readonly artifacts: readonly Artifact[];
}

export interface Scenario {
  readonly id: string;
  readonly version: number;
  readonly organization: string;
  readonly objective: string;
  readonly taskText: string;
  readonly facts: readonly ScenarioFact[];
  readonly timelineConstraints: readonly TimelineConstraint[];
  readonly arms: Readonly<Record<ArmId, ScenarioArm>>;
}

function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      freezeDeep(child);
    }
    Object.freeze(value);
  }
  return value;
}

function rejectUnexpectedFields(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${context} has an unexpected field: ${key}`);
    }
  }
}

export function validateScenario(input: unknown): Scenario {
  if (typeof input !== "object" || input === null) {
    throw new Error("scenario must be an object");
  }
  const manifest = input as Record<string, unknown>;
  rejectUnexpectedFields(manifest, ["id", "version", "organization", "objective", "taskText", "facts", "timelineConstraints", "arms"], "scenario");
  for (const key of ["id", "organization", "objective", "taskText"] as const) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
      throw new Error(`scenario ${key} is required`);
    }
  }
  if ((manifest.taskText as string).length > 1000 || /(?:\b(?:https?|file|ftp|data|javascript|ws|wss|mailto):|\bwww\.)/i.test(manifest.taskText as string)) {
    throw new Error("scenario taskText is too long or contains an external destination");
  }
  if (!Number.isSafeInteger(manifest.version) || (manifest.version as number) < 1) {
    throw new Error("scenario version must be a positive integer");
  }
  if (!Array.isArray(manifest.facts)) {
    throw new Error("scenario facts are required");
  }
  const factIds = new Set<string>();
  const factKeys = new Set<string>();
  for (const item of manifest.facts as unknown[]) {
    if (typeof item !== "object" || item === null) {
      throw new Error("scenario fact must be an object");
    }
    const fact = item as Record<string, unknown>;
    rejectUnexpectedFields(fact, ["id", "subject", "attribute", "value"], "scenario fact");
    for (const key of ["id", "subject", "attribute"] as const) {
      if (typeof fact[key] !== "string" || !/^[a-z][a-z0-9-]*$/.test(fact[key] as string)) {
        throw new Error(`scenario fact ${key} must be a safe identifier`);
      }
    }
    if (typeof fact.value !== "string" || !fact.value.trim()) {
      throw new Error("scenario fact value is required");
    }
    if (/(?:\b(?:https?|file|ftp|data|javascript|ws|wss|mailto):|\bwww\.)/i.test(fact.value)) {
      throw new Error("scenario fact contains an external URL");
    }
    const id = fact.id as string;
    const key = `${fact.subject}:${fact.attribute}`;
    if (factIds.has(id)) {
      throw new Error(`scenario has a duplicate fact: ${id}`);
    }
    if (factKeys.has(key)) {
      throw new Error(`scenario has a conflicting fact: ${key}`);
    }
    factIds.add(id);
    factKeys.add(key);
  }
  const arms = manifest.arms;
  if (typeof arms !== "object" || arms === null) {
    throw new Error("scenario arms are required");
  }
  rejectUnexpectedFields(arms as Record<string, unknown>, ["baseline", "narrative"], "scenario arms");
  for (const armId of ["baseline", "narrative"] as const) {
    const arm = (arms as Record<string, unknown>)[armId];
    if (typeof arm !== "object" || arm === null || !Array.isArray((arm as Record<string, unknown>).artifacts)) {
      throw new Error(`scenario arm ${armId} requires artifacts`);
    }
    rejectUnexpectedFields(arm as Record<string, unknown>, ["id", "goalId", "canaryArtifactId", "artifacts"], `scenario arm ${armId}`);
    for (const artifact of (arm as { artifacts: unknown[] }).artifacts) {
      if (typeof artifact !== "object" || artifact === null) {
        throw new Error("scenario artifact must be an object");
      }
      rejectUnexpectedFields(artifact as Record<string, unknown>, ["id", "kind", "role", "title", "body", "nextId", "visibleAtStart", "factIds", "literalClaims", "tableBindings"], "artifact");
      const { id, title, body, kind, role, nextId, visibleAtStart, factIds: citedFacts, literalClaims, tableBindings } = artifact as Record<string, unknown>;
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
        throw new Error("artifact id must be a safe local identifier");
      }
      if (typeof title !== "string" || !title.trim()) {
        throw new Error("artifact title is required");
      }
      if (typeof body !== "string" || !body.trim()) {
        throw new Error("artifact body is required");
      }
      if (!["document", "message", "access-note", "portal"].includes(kind as string)) {
        throw new Error("artifact kind is unsupported");
      }
      if (!["target", "alternative", "goal"].includes(role as string)) {
        throw new Error("artifact role is unsupported");
      }
      if (nextId !== null && (typeof nextId !== "string" || !/^[a-z][a-z0-9-]*$/.test(nextId))) {
        throw new Error("artifact nextId must be a safe local identifier or null");
      }
      if (typeof visibleAtStart !== "boolean") {
        throw new Error("artifact visibleAtStart must be a boolean");
      }
      if (!Array.isArray(citedFacts) || citedFacts.some(factId => typeof factId !== "string" || !factIds.has(factId))) {
        throw new Error("artifact cites an unknown fact");
      }
      if (new Set(citedFacts).size !== citedFacts.length) {
        throw new Error("artifact cites a duplicate fact");
      }
      if (literalClaims !== undefined) {
        if (!Array.isArray(literalClaims)) throw new Error("artifact literalClaims must be an array");
        for (const item of literalClaims) {
          if (typeof item !== "object" || item === null) throw new Error("literal claim must be an object");
          const claim = item as Record<string, unknown>;
          rejectUnexpectedFields(claim, ["factId", "quote"], "literal claim");
          if (typeof claim.factId !== "string" || !citedFacts.includes(claim.factId)) {
            throw new Error("literal claim must cite a declared artifact fact");
          }
          if (typeof claim.quote !== "string" || !claim.quote.trim() || claim.quote.length > 200) {
            throw new Error("literal claim quote must be nonempty and at most 200 characters");
          }
          if (/(?:\b(?:https?|file|ftp|data|javascript|ws|wss|mailto):|\bwww\.)/i.test(claim.quote)) {
            throw new Error("literal claim contains an external URL");
          }
        }
      }
      if (tableBindings !== undefined) {
        if (!Array.isArray(tableBindings) || typeof title !== "string" || !title.endsWith(".csv")) {
          throw new Error("table bindings require a CSV artifact");
        }
        const boundCells = new Set<string>();
        for (const item of tableBindings) {
          if (typeof item !== "object" || item === null) throw new Error("table binding must be an object");
          const binding = item as Record<string, unknown>;
          rejectUnexpectedFields(binding, ["factId", "rowKey", "column"], "table binding");
          if (typeof binding.factId !== "string" || !citedFacts.includes(binding.factId)) {
            throw new Error("table binding must cite a declared artifact fact");
          }
          for (const key of ["rowKey", "column"] as const) {
            if (typeof binding[key] !== "string" || !(binding[key] as string).trim() || (binding[key] as string).length > 100) {
              throw new Error(`table binding ${key} must be nonempty and at most 100 characters`);
            }
          }
          const cellKey = JSON.stringify([binding.rowKey, binding.column]);
          if (boundCells.has(cellKey)) throw new Error("duplicate table binding for one cell");
          boundCells.add(cellKey);
        }
      }
      if ([title, body].some(value => typeof value === "string" && /(?:\b(?:https?|file|ftp|data|javascript|ws|wss|mailto):|\bwww\.)/i.test(value))) {
        throw new Error("scenario contains an external URL");
      }
    }
  }
  const typedArms = arms as Record<ArmId, ScenarioArm>;
  if (typedArms.baseline.artifacts.length !== typedArms.narrative.artifacts.length) {
    throw new Error("scenario arm structure differs in artifact count");
  }
  for (const armId of ["baseline", "narrative"] as const) {
    const artifactIds = new Set(typedArms[armId].artifacts.map(artifact => artifact.id));
    if (typedArms[armId].id !== armId) {
      throw new Error(`scenario arm ${armId} has an invalid id`);
    }
    if (artifactIds.size !== typedArms[armId].artifacts.length) {
      throw new Error(`scenario has a duplicate artifact in ${armId}`);
    }
    const goal = typedArms[armId].artifacts.find(artifact => artifact.id === typedArms[armId].goalId);
    if (!goal || goal.kind !== "portal" || goal.role !== "goal") {
      throw new Error(`scenario arm ${armId} must have a local portal goal`);
    }
    if (goal.visibleAtStart) {
      throw new Error(`scenario arm ${armId} cannot show the goal at start`);
    }
    const canary = typedArms[armId].artifacts.find(artifact => artifact.id === typedArms[armId].canaryArtifactId);
    if (!canary || canary.kind !== "document" || canary.role !== "target" || !canary.visibleAtStart) {
      throw new Error(`scenario arm ${armId} requires a visible target document canary`);
    }
    for (const artifact of typedArms[armId].artifacts) {
      if (artifact.nextId !== null && !artifactIds.has(artifact.nextId)) {
        throw new Error(`scenario has a dangling local link from ${artifact.id}`);
      }
    }
    const reachable = new Set(typedArms[armId].artifacts.filter(artifact => artifact.visibleAtStart).map(artifact => artifact.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const artifact of typedArms[armId].artifacts) {
        if (reachable.has(artifact.id) && artifact.nextId !== null && !reachable.has(artifact.nextId)) {
          reachable.add(artifact.nextId);
          changed = true;
        }
      }
    }
    if (!reachable.has(typedArms[armId].goalId)) {
      throw new Error(`scenario goal unreachable from ${armId} entry artifacts`);
    }
    const canaryPath = new Set<string>();
    let nextCanaryId: string | null = canary.id;
    while (nextCanaryId !== null && !canaryPath.has(nextCanaryId)) {
      canaryPath.add(nextCanaryId);
      nextCanaryId = typedArms[armId].artifacts.find(artifact => artifact.id === nextCanaryId)?.nextId ?? null;
    }
    if (!canaryPath.has(typedArms[armId].goalId)) {
      throw new Error(`scenario arm ${armId} document canary must lead to the local goal`);
    }
  }
  if (typedArms.baseline.goalId !== typedArms.narrative.goalId) {
    throw new Error("scenario arms must share the same goal");
  }
  if (typedArms.baseline.canaryArtifactId !== typedArms.narrative.canaryArtifactId) {
    throw new Error("scenario arms must share the same document canary position");
  }
  for (let index = 0; index < typedArms.baseline.artifacts.length; index += 1) {
    const baseline = typedArms.baseline.artifacts[index];
    const narrative = typedArms.narrative.artifacts[index];
    if (baseline.id !== narrative.id || baseline.kind !== narrative.kind || baseline.role !== narrative.role || baseline.nextId !== narrative.nextId || baseline.visibleAtStart !== narrative.visibleAtStart) {
      throw new Error(`scenario arm structure differs at artifact ${index}`);
    }
  }
  if (!Array.isArray(manifest.timelineConstraints)) {
    throw new Error("scenario timelineConstraints are required");
  }
  const constraintIds = new Set<string>();
  for (const item of manifest.timelineConstraints as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("timeline constraint must be an object");
    const constraint = item as Record<string, unknown>;
    rejectUnexpectedFields(constraint, ["id", "beforeFactId", "afterFactId", "sourceCells"], "timeline constraint");
    if (typeof constraint.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(constraint.id) || constraintIds.has(constraint.id)) {
      throw new Error("timeline constraint id must be unique and safe");
    }
    constraintIds.add(constraint.id);
    if (typeof constraint.beforeFactId !== "string" || !factIds.has(constraint.beforeFactId) ||
        typeof constraint.afterFactId !== "string" || !factIds.has(constraint.afterFactId)) {
      throw new Error("timeline constraint cites an unknown fact");
    }
    if (constraint.beforeFactId === constraint.afterFactId) throw new Error("timeline constraint must relate two facts");
    for (const factId of [constraint.beforeFactId, constraint.afterFactId] as string[]) {
      const value = (manifest.facts as ScenarioFact[]).find(fact => fact.id === factId)?.value;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
        throw new Error(`timeline constraint ${constraint.id} requires a valid ISO date for ${factId}`);
      }
    }
    if (!Array.isArray(constraint.sourceCells) || constraint.sourceCells.length !== 2) {
      throw new Error("timeline constraint requires one source cell per arm");
    }
    const sourceArms = new Set<ArmId>();
    for (const rawCell of constraint.sourceCells) {
      if (typeof rawCell !== "object" || rawCell === null || Array.isArray(rawCell)) throw new Error("timeline source cell must be an object");
      const cell = rawCell as Record<string, unknown>;
      rejectUnexpectedFields(cell, ["armId", "artifactId", "rowKey", "column", "sourceText"], "timeline source cell");
      if (cell.armId !== "baseline" && cell.armId !== "narrative") throw new Error("timeline source cell has an invalid arm");
      if (sourceArms.has(cell.armId)) throw new Error("timeline source cell repeats an arm");
      sourceArms.add(cell.armId);
      const artifact = typedArms[cell.armId].artifacts.find(candidate => candidate.id === cell.artifactId);
      if (!artifact || !artifact.title.endsWith(".csv") ||
          typeof cell.rowKey !== "string" || !cell.rowKey.trim() ||
          typeof cell.column !== "string" || !cell.column.trim() ||
          typeof cell.sourceText !== "string" || !cell.sourceText.trim()) {
        throw new Error("timeline source cell must identify a CSV value");
      }
      const table = parseFixtureTable(artifact.body);
      const columns = table?.[0].flatMap((header, index) => header === cell.column ? [index] : []) ?? [];
      const rows = table?.slice(1).filter(row => row[0] === cell.rowKey) ?? [];
      if (columns.length !== 1 || rows.length !== 1 || rows[0][columns[0]] !== cell.sourceText) {
        throw new Error("timeline source cell does not match the declared CSV value");
      }
    }
  }
  return freezeDeep(structuredClone(input)) as Scenario;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function scenarioHash(scenario: Scenario): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(scenario))).digest("hex");
}
