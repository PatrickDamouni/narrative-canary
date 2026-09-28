import type { ArmId, Artifact, Scenario } from "./scenario.ts";
import { parseFixtureTable } from "./ui/table.js";

/**
 * Attacker's read: walk explicit, cited attacker tradecraft profiles through one lure path
 * and report which defender tripwire conditions would be met, or exactly what ended the walk.
 * This computes consequences of stated assumptions. It does not observe attackers or deliver alerts.
 */

export type InspectionSurface = "document-package" | "directory-object";
export type TripwireTrigger = "render" | "visit" | "use-value";
export type OnTell = "abandon" | "stop-path";
export type EvidenceStrength = "vendor-documentation" | "public-tool" | "public-report" | "assumption";

export interface Tripwire {
  readonly id: string;
  readonly label: string;
  /** render: an auto-fetch reference fires when the file is rendered with network access.
   *  visit: a request for this page is watched.
   *  use-value: a sensor watches for use of a fact's exact value elsewhere (for example, a dormant honey account). */
  readonly trigger: TripwireTrigger;
  readonly artifactId?: string;
  readonly factId?: string;
  /** Where the tripwire's tell is visible before it fires, if anywhere. */
  readonly exposedTo: InspectionSurface | null;
  /** True when inspecting that surface is itself monitored, so vetting the tripwire trips it. */
  readonly watchesInspection?: boolean;
}

export interface TripwirePlan {
  readonly id: string;
  readonly label: string;
  readonly armId: ArmId;
  readonly tripwires: readonly Tripwire[];
}

export interface TradecraftProfile {
  readonly id: string;
  readonly label: string;
  readonly rendersWithNetwork: boolean;
  readonly inspects: readonly InspectionSurface[];
  readonly crossChecksFacts: boolean;
  readonly basis: readonly { readonly strength: EvidenceStrength; readonly source: string; readonly supports: string }[];
}

export interface Observation { readonly artifactId: string; readonly value: string }

export type StopReason =
  | { readonly kind: "tell"; readonly tripwireId: string; readonly surface: InspectionSurface; readonly artifactId: string | null; readonly response: OnTell }
  | { readonly kind: "contradiction"; readonly artifactId: string; readonly factId: string; readonly observations: readonly Observation[] }
  | { readonly kind: "contradiction"; readonly artifactId: string; readonly constraintId: string; readonly beforeFactId: string; readonly afterFactId: string; readonly observations: readonly Observation[] };

export type WalkStep =
  | { readonly kind: "read"; readonly artifactId: string; readonly title: string; readonly taught: readonly { readonly tripwireId: string; readonly value: string }[] }
  | { readonly kind: "fired"; readonly tripwireId: string; readonly artifactId: string | null; readonly reason: string }
  | { readonly kind: "suppressed"; readonly tripwireId: string; readonly artifactId: string; readonly reason: string }
  | { readonly kind: "stopped"; readonly reason: StopReason };

export interface WalkResult {
  readonly profileId: string;
  readonly planId: string;
  readonly detected: boolean;
  readonly firstAlert: string | null;
  readonly fired: readonly string[];
  readonly singlePointOfDetection: boolean;
  readonly stoppedBy: StopReason | null;
  readonly steps: readonly WalkStep[];
}

export interface LureFinding {
  readonly code: "LURE_TEACHES_OTHER_VALUE" | "LURE_OMITS_WATCHED_VALUE" | "TRIPWIRE_NEVER_TAUGHT";
  readonly tripwireId: string;
  readonly artifactId: string | null;
  readonly factId: string;
  readonly watchedValue: string;
  readonly shownText: string | null;
}

export interface AttackerReadReport {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly planId: string;
  readonly planLabel: string;
  readonly armId: ArmId;
  readonly onTell: OnTell;
  readonly lurePath: readonly { readonly id: string; readonly title: string }[];
  readonly tripwires: readonly Tripwire[];
  readonly profiles: readonly TradecraftProfile[];
  readonly walks: readonly WalkResult[];
  readonly coverage: { readonly detected: number; readonly total: number };
  /** Leave-one-out: profiles that only this tripwire catches. Empty means it adds no coverage here. */
  readonly tripwireValue: readonly { readonly tripwireId: string; readonly uniqueCatches: readonly string[] }[];
  readonly lureFindings: readonly LureFinding[];
  readonly assumptions: readonly string[];
}

const THINKST_WORD = "https://docs.canarytokens.org/guide/ms-word-token.html";
const CVE_2019_9768 = "https://github.com/thinkst/canarytokens/issues/35";

const PROFILE_DATA: readonly TradecraftProfile[] = [
  {
    id: "office-render", label: "Opens files in desktop Office, online", rendersWithNetwork: true, inspects: [], crossChecksFacts: false,
    basis: [{ strength: "vendor-documentation", source: THINKST_WORD, supports: "The Word token alerts when the document is opened in Microsoft Office on Windows or macOS." }]
  },
  {
    id: "offline-viewer", label: "Reads in Protected View or another viewer", rendersWithNetwork: false, inspects: [], crossChecksFacts: false,
    basis: [
      { strength: "public-report", source: CVE_2019_9768, supports: "A 2019 report (CVE-2019-9768) says Protected View and LibreOffice 6.x opened a Word token without triggering it. Not re-tested here." },
      { strength: "public-report", source: "https://hivesecurity.gitlab.io/blog/canary-tokens-deception-blue-team/", supports: "Practitioner guidance warns that not every viewer, preview pane, or offline inspection activates a document token." }
    ]
  },
  {
    id: "package-scan", label: "Scans the file package before opening", rendersWithNetwork: false, inspects: ["document-package"], crossChecksFacts: false,
    basis: [{ strength: "public-tool", source: "https://github.com/0xNslabs/CanaryTokenScanner", supports: "Open-source static scanner inspects Office relationships, templates, fields, and URLs without opening the file." }]
  },
  {
    id: "package-and-directory", label: "Also checks an account before using it", rendersWithNetwork: false, inspects: ["document-package", "directory-object"], crossChecksFacts: false,
    basis: [
      { strength: "public-tool", source: "https://github.com/JavelinNetworks/HoneypotBuster", supports: "Red-team tool fingerprints fake accounts by logon count and last-logon date." },
      { strength: "vendor-documentation", source: "https://learn.microsoft.com/en-us/defender-for-identity/entity-tags", supports: "Defender for Identity honeytoken accounts are usually dormant; any sign-in triggers an alert. Dormancy is the tell." },
      { strength: "vendor-documentation", source: "https://learn.microsoft.com/en-us/defender-for-identity/whats-new-archive", supports: "Release 2.198 split honeytoken alerts, including 'Honeytoken user was queried via LDAP'. The SAM-R variant was later disabled over legacy-system false positives." }
    ]
  },
  {
    id: "cross-checker", label: "Also cross-checks the story before acting", rendersWithNetwork: false, inspects: ["document-package", "directory-object"], crossChecksFacts: true,
    basis: [
      { strength: "assumption", source: "this model", supports: "A careful intruder compares names, dates, and dependencies across files and stops trusting a story that contradicts itself." },
      { strength: "public-report", source: CVE_2019_9768, supports: "The same report notes token documents were identifiable from limited size, metadata, and timestamp variation: fingerprinting by inconsistency, by analogy." }
    ]
  }
];

export const TRADECRAFT_PROFILES: readonly TradecraftProfile[] = Object.freeze(PROFILE_DATA.map(profile => Object.freeze({
  ...profile,
  inspects: Object.freeze([...profile.inspects]),
  basis: Object.freeze(profile.basis.map(item => Object.freeze({ ...item })))
})));

const ASSUMPTIONS: readonly string[] = [
  "A reader who does not abandon follows the designed lure path to its end, then acts on every tripwire value they read.",
  "An auto-fetch reference inside a file is a tell to package inspection; an ordinary user-followed link is not.",
  "Inspecting a directory object reveals a honey account as dormant. Where the plan says so, that query is itself watched.",
  "A cross-checking reader compares only anchored values (declared quotes and worksheet cells). Real readers notice more, and less.",
  "Detection means a local tripwire condition was met in this model; no alert was delivered, and no real attacker was observed."
];

const ID = /^[a-z][a-z0-9-]*$/;

function rejectUnexpectedFields(value: object, allowed: readonly string[], context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${context} has an unexpected field: ${key}`);
  }
}

function comparable(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** The designed chain: the visible target no other target links to, followed to the end. */
export function lurePath(scenario: Scenario, armId: ArmId): readonly string[] {
  const artifacts = scenario.arms[armId].artifacts;
  const targets = artifacts.filter(artifact => artifact.role !== "alternative");
  const linkedTo = new Set(targets.flatMap(artifact => artifact.nextId === null ? [] : [artifact.nextId]));
  const entries = targets.filter(artifact => artifact.visibleAtStart && !linkedTo.has(artifact.id));
  if (entries.length !== 1) throw new Error(`arm ${armId} needs exactly one unlinked visible entry to model a lure path`);
  const path: string[] = [];
  let current: Artifact | undefined = entries[0];
  while (current && !path.includes(current.id)) {
    path.push(current.id);
    const nextId: string | null = current.nextId;
    current = nextId === null ? undefined : artifacts.find(artifact => artifact.id === nextId);
  }
  return Object.freeze(path);
}

export function validateTripwirePlan(scenario: Scenario, input: unknown): TripwirePlan {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("tripwire plan must be an object");
  const plan = input as Record<string, unknown>;
  rejectUnexpectedFields(plan, ["id", "label", "armId", "tripwires"], "tripwire plan");
  if (typeof plan.id !== "string" || !ID.test(plan.id)) throw new Error("tripwire plan id must be a safe identifier");
  if (typeof plan.label !== "string" || !plan.label.trim() || plan.label.length > 120) throw new Error("tripwire plan label is required");
  if (plan.armId !== "baseline" && plan.armId !== "narrative") throw new Error("tripwire plan arm is unsupported");
  if (!Array.isArray(plan.tripwires) || plan.tripwires.length === 0 || plan.tripwires.length > 20) throw new Error("tripwire plan needs 1-20 tripwires");
  const armId = plan.armId;
  const path = lurePath(scenario, armId);
  const artifacts = scenario.arms[armId].artifacts;
  const ids = new Set<string>();
  for (const raw of plan.tripwires as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("tripwire must be an object");
    const tripwire = raw as Record<string, unknown>;
    rejectUnexpectedFields(tripwire, ["id", "label", "trigger", "artifactId", "factId", "exposedTo", "watchesInspection"], "tripwire");
    if (tripwire.watchesInspection !== undefined && (typeof tripwire.watchesInspection !== "boolean" || tripwire.exposedTo === null)) {
      throw new Error("only a tripwire with an exposure surface can watch its inspection");
    }
    if (typeof tripwire.id !== "string" || !ID.test(tripwire.id)) throw new Error("tripwire id must be a safe identifier");
    if (ids.has(tripwire.id)) throw new Error(`tripwire plan has a duplicate tripwire: ${tripwire.id}`);
    ids.add(tripwire.id);
    if (typeof tripwire.label !== "string" || !tripwire.label.trim() || tripwire.label.length > 120) throw new Error("tripwire label is required");
    if (tripwire.exposedTo !== null && tripwire.exposedTo !== "document-package" && tripwire.exposedTo !== "directory-object") {
      throw new Error("tripwire exposure surface is unsupported");
    }
    if (tripwire.trigger === "render" || tripwire.trigger === "visit") {
      if (tripwire.factId !== undefined) throw new Error(`${tripwire.trigger} tripwire cannot watch a fact`);
      const artifact = artifacts.find(item => item.id === tripwire.artifactId);
      if (!artifact) throw new Error(`tripwire ${tripwire.id} names an unknown artifact`);
      if (!path.includes(artifact.id)) throw new Error(`tripwire ${tripwire.id} is not on the lure path this model walks`);
      if (tripwire.trigger === "render" && !/\.(docx|xlsx|pptx|pdf)$/i.test(artifact.title)) {
        throw new Error("a render tripwire needs a file format that can auto-fetch (docx, xlsx, pptx, pdf)");
      }
    } else if (tripwire.trigger === "use-value") {
      if (tripwire.artifactId !== undefined) throw new Error("use-value tripwire watches a fact, not an artifact");
      if (!scenario.facts.some(fact => fact.id === tripwire.factId)) throw new Error(`tripwire ${tripwire.id} watches an unknown fact`);
    } else {
      throw new Error("tripwire trigger is unsupported");
    }
  }
  return plan as unknown as TripwirePlan;
}

function anchoredValues(artifact: Artifact): { factId: string; value: string }[] {
  const text = `${artifact.title}\n${artifact.body}`;
  const claims = (artifact.literalClaims ?? [])
    .filter(claim => text.includes(claim.quote))
    .map(claim => ({ factId: claim.factId, value: claim.quote }));
  const table = artifact.tableBindings?.length ? parseFixtureTable(artifact.body) : null;
  const cells = (artifact.tableBindings ?? []).flatMap(binding => {
    const columns = table?.[0].flatMap((header: string, index: number) => header === binding.column ? [index] : []) ?? [];
    const rows = table?.slice(1).filter((row: string[]) => row[0] === binding.rowKey) ?? [];
    return columns.length === 1 && rows.length === 1 ? [{ factId: binding.factId, value: rows[0][columns[0]] as string }] : [];
  });
  return [...claims, ...cells];
}

/** Contradictions a reader could see from the files alone, without knowing the canonical facts. */
function readerContradiction(scenario: Scenario, armId: ArmId, read: readonly Artifact[]): StopReason | null {
  const current = read[read.length - 1];
  const seen = new Map<string, Observation[]>();
  for (const artifact of read) {
    for (const { factId, value } of anchoredValues(artifact)) {
      seen.set(factId, [...(seen.get(factId) ?? []), { artifactId: artifact.id, value }]);
    }
  }
  for (const [factId, observations] of seen) {
    const distinct = new Set(observations.map(item => comparable(item.value)));
    if (distinct.size > 1 && observations.some(item => item.artifactId === current.id)) {
      return { kind: "contradiction", artifactId: current.id, factId, observations };
    }
  }
  for (const constraint of scenario.timelineConstraints) {
    const cell = constraint.sourceCells.find(item => item.armId === armId);
    if (!cell || cell.artifactId !== current.id) continue;
    const before = seen.get(constraint.beforeFactId)?.at(-1);
    const after = seen.get(constraint.afterFactId)?.at(-1);
    if (!before || !after || !/^\d{4}-\d{2}-\d{2}$/.test(before.value) || !/^\d{4}-\d{2}-\d{2}$/.test(after.value)) continue;
    if (before.value >= after.value) {
      return { kind: "contradiction", artifactId: current.id, constraintId: constraint.id,
        beforeFactId: constraint.beforeFactId, afterFactId: constraint.afterFactId, observations: [before, after] };
    }
  }
  return null;
}

export function walkLure(scenario: Scenario, planInput: TripwirePlan, profile: TradecraftProfile, options: { onTell?: OnTell } = {}): WalkResult {
  const plan = validateTripwirePlan(scenario, planInput);
  const onTell: OnTell = options.onTell ?? "abandon";
  if (onTell !== "abandon" && onTell !== "stop-path") throw new Error("onTell must be abandon or stop-path");
  const artifacts = scenario.arms[plan.armId].artifacts;
  const facts = new Map(scenario.facts.map(fact => [fact.id, fact]));
  const steps: WalkStep[] = [];
  const fired: string[] = [];
  const read: Artifact[] = [];
  const learned = new Set<string>();
  let stoppedBy: StopReason | null = null;
  let trustsStory = true;

  const stop = (reason: StopReason): void => {
    steps.push({ kind: "stopped", reason });
    stoppedBy ??= reason;
    if (reason.kind === "contradiction" || reason.response === "abandon") trustsStory = false;
  };
  const exposed = (tripwire: Tripwire): tripwire is Tripwire & { exposedTo: InspectionSurface } =>
    tripwire.exposedTo !== null && profile.inspects.includes(tripwire.exposedTo);
  const noteVetting = (tripwire: Tripwire, artifactId: string | null): void => {
    if (!tripwire.watchesInspection) return;
    fired.push(tripwire.id);
    steps.push({ kind: "fired", tripwireId: tripwire.id, artifactId, reason: "The vetting query itself was watched." });
  };

  for (const artifactId of lurePath(scenario, plan.armId)) {
    const artifact = artifacts.find(item => item.id === artifactId) as Artifact;
    const here = plan.tripwires.filter(tripwire => tripwire.artifactId === artifactId);
    const renders = here.filter(tripwire => tripwire.trigger === "render");
    // Both an auto-fetch reference and a link destination can be inspected before the request is made.
    const tell = here.find(exposed);
    if (tell) {
      noteVetting(tell, artifactId);
      stop({ kind: "tell", tripwireId: tell.id, surface: tell.exposedTo as InspectionSurface, artifactId, response: onTell });
      break;
    }
    for (const tripwire of here.filter(item => item.trigger === "visit")) {
      fired.push(tripwire.id);
      steps.push({ kind: "fired", tripwireId: tripwire.id, artifactId, reason: `Requested “${artifact.title}”.` });
    }
    for (const tripwire of renders) {
      if (profile.rendersWithNetwork) {
        fired.push(tripwire.id);
        steps.push({ kind: "fired", tripwireId: tripwire.id, artifactId, reason: "Rendered with network access; the auto-fetch reference loaded." });
      } else {
        steps.push({ kind: "suppressed", tripwireId: tripwire.id, artifactId, reason: "Read without a network render; the auto-fetch reference never loaded." });
      }
    }
    const text = `${artifact.title}\n${artifact.body}`;
    const taught = plan.tripwires.flatMap(tripwire => {
      const value = tripwire.trigger === "use-value" ? facts.get(tripwire.factId as string)?.value : undefined;
      if (value === undefined || learned.has(tripwire.id) || !text.includes(value)) return [];
      learned.add(tripwire.id);
      return [{ tripwireId: tripwire.id, value }];
    });
    read.push(artifact);
    steps.push({ kind: "read", artifactId, title: artifact.title, taught });
    if (profile.crossChecksFacts) {
      const contradiction = readerContradiction(scenario, plan.armId, read);
      if (contradiction) {
        stop(contradiction);
        break;
      }
    }
  }

  for (const tripwire of plan.tripwires.filter(item => item.trigger === "use-value" && learned.has(item.id))) {
    if (!trustsStory) break;
    if (exposed(tripwire)) {
      noteVetting(tripwire, null);
      stop({ kind: "tell", tripwireId: tripwire.id, surface: tripwire.exposedTo, artifactId: null, response: onTell });
      continue;
    }
    fired.push(tripwire.id);
    steps.push({ kind: "fired", tripwireId: tripwire.id, artifactId: null, reason: `Used “${facts.get(tripwire.factId as string)?.value}” after reading it in the lure.` });
  }

  return {
    profileId: profile.id,
    planId: plan.id,
    detected: fired.length > 0,
    firstAlert: fired[0] ?? null,
    fired,
    singlePointOfDetection: fired.length === 1,
    stoppedBy,
    steps
  };
}

function lureFindings(scenario: Scenario, plan: TripwirePlan): LureFinding[] {
  const path = lurePath(scenario, plan.armId);
  const artifacts = path.map(id => scenario.arms[plan.armId].artifacts.find(item => item.id === id) as Artifact);
  return plan.tripwires.filter(tripwire => tripwire.trigger === "use-value").flatMap(tripwire => {
    const factId = tripwire.factId as string;
    const watchedValue = scenario.facts.find(fact => fact.id === factId)?.value as string;
    const teaches = (artifact: Artifact) => `${artifact.title}\n${artifact.body}`.includes(watchedValue);
    const omissions = artifacts
      .filter(artifact => artifact.factIds.includes(factId) && !teaches(artifact))
      .map(artifact => {
        // A declared quote for the same fact that differs from the watched value teaches the reader the wrong thing.
        const shownText = artifact.literalClaims?.find(claim => claim.factId === factId)?.quote ?? null;
        return {
          code: shownText === null ? "LURE_OMITS_WATCHED_VALUE" as const : "LURE_TEACHES_OTHER_VALUE" as const,
          tripwireId: tripwire.id, artifactId: artifact.id, factId, watchedValue, shownText
        };
      });
    const never = artifacts.some(teaches) ? [] : [{
      code: "TRIPWIRE_NEVER_TAUGHT" as const, tripwireId: tripwire.id, artifactId: null, factId, watchedValue, shownText: null
    }];
    return [...omissions, ...never];
  });
}

export function attackerRead(scenario: Scenario, planInput: TripwirePlan, profiles: readonly TradecraftProfile[] = TRADECRAFT_PROFILES,
  options: { onTell?: OnTell } = {}): AttackerReadReport {
  const plan = validateTripwirePlan(scenario, planInput);
  const onTell = options.onTell ?? "abandon";
  const walks = profiles.map(profile => walkLure(scenario, plan, profile, { onTell }));
  const artifacts = scenario.arms[plan.armId].artifacts;
  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    planId: plan.id,
    planLabel: plan.label,
    armId: plan.armId,
    onTell,
    lurePath: lurePath(scenario, plan.armId).map(id => ({ id, title: artifacts.find(item => item.id === id)?.title as string })),
    tripwires: plan.tripwires,
    profiles,
    walks,
    coverage: { detected: walks.filter(walk => walk.detected).length, total: walks.length },
    tripwireValue: plan.tripwires.map(tripwire => ({
      tripwireId: tripwire.id,
      uniqueCatches: walks.filter(walk => walk.detected && walk.fired.every(id => id === tripwire.id)).map(walk => walk.profileId)
    })),
    lureFindings: lureFindings(scenario, plan),
    assumptions: [...ASSUMPTIONS, onTell === "abandon"
      ? "On seeing a tell, the reader abandons the story and acts on nothing from it."
      : "On seeing a tell, the reader stops following the path but still acts on what they already read."]
  };
}
