import { acquisitionScenario } from "./acquisition.ts";
import { validateScenario } from "../scenario.ts";

// A separate synthetic teaching fixture. It is intentionally unsuitable for evaluation.
const baselineArtifacts = acquisitionScenario.arms.baseline.artifacts.map(artifact => artifact.id === "model"
  ? { ...artifact, body: artifact.body.replace("2026-10-16", "2026-10-08") }
  : artifact);
const narrativeArtifacts = acquisitionScenario.arms.narrative.artifacts.map(artifact => {
  if (artifact.id === "brief") {
    return {
      ...artifact,
      body: artifact.body.replace("Maya Chen is coordinating", "Maya Chan is coordinating"),
      literalClaims: artifact.literalClaims?.map(claim => claim.factId === "project-lead" ? { ...claim, quote: "Maya Chan" } : claim)
    };
  }
  if (artifact.id === "model") {
    return { ...artifact, body: artifact.body
      .replace("Revenue bridge,Maya Chen", "Revenue bridge,Maya Chan")
      .replace("2026-10-16", "2026-10-08") };
  }
  if (artifact.id === "steering") {
    return {
      ...artifact,
      body: artifact.body.replace("Date: 2026-09-18", "Date: 2026-09-19"),
      literalClaims: artifact.literalClaims?.map(claim => claim.factId === "checkpoint-date" ? { ...claim, quote: "2026-09-19" } : claim)
    };
  }
  return artifact;
});

export const flawedScenario = validateScenario({
  ...acquisitionScenario,
  id: "project-lantern-flawed-demo",
  version: 2,
  objective: "Demonstrate static assurance findings on intentionally inconsistent synthetic documents",
  facts: acquisitionScenario.facts.map(fact => fact.id === "handoff-due" ? { ...fact, value: "2026-10-08" } : fact),
  arms: {
    ...acquisitionScenario.arms,
    baseline: { ...acquisitionScenario.arms.baseline, artifacts: baselineArtifacts },
    narrative: { ...acquisitionScenario.arms.narrative, artifacts: narrativeArtifacts }
  }
});
