import type { TripwirePlan } from "../tradecraft.ts";

// Three fictional defender designs for the same lure path. Nothing here is deployed or connected.
const beacon = {
  id: "brief-beacon", label: "Auto-fetch reference in the scope note (conventional document token)",
  trigger: "render", artifactId: "brief", exposedTo: "document-package"
} as const;
const portal = {
  id: "portal-visit", label: "Request for the diligence workspace",
  trigger: "visit", artifactId: "portal", exposedTo: null
} as const;
const leadAccount = {
  id: "lead-account", label: "Honey account for the named project lead (sign-in or directory query alerts)",
  trigger: "use-value", factId: "project-lead", exposedTo: "directory-object", watchesInspection: true
} as const;

export const tripwirePlans: readonly TripwirePlan[] = Object.freeze([
  { id: "vendor-pattern", label: "Generic files + document token + portal", armId: "baseline", tripwires: [beacon, portal] },
  { id: "narrative-with-beacon", label: "Narrative files + document token + portal + honey account", armId: "narrative", tripwires: [beacon, portal, leadAccount] },
  { id: "narrative-no-beacon", label: "Narrative files + portal + honey account, no document token", armId: "narrative", tripwires: [portal, leadAccount] }
].map(plan => Object.freeze({ ...plan, tripwires: Object.freeze([...plan.tripwires]) })) as TripwirePlan[]);
