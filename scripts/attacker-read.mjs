import { acquisitionScenario } from "../src/fixtures/acquisition.ts";
import { flawedScenario } from "../src/fixtures/flawed.ts";
import { tripwirePlans } from "../src/fixtures/tripwire-plans.ts";
import { attackerRead } from "../src/tradecraft.ts";

// Usage: npm run attacker-read -- [--flawed] [--stop-path] [--link-is-tell] [--plan <id>]
const args = process.argv.slice(2);
const scenario = args.includes("--flawed") ? flawedScenario : acquisitionScenario;
const onTell = args.includes("--stop-path") ? "stop-path" : "abandon";
const planIndex = args.indexOf("--plan");
const planId = planIndex >= 0 ? args[planIndex + 1] : null;
const linkIsTell = args.includes("--link-is-tell");
// --link-is-tell challenges assumption 2: the portal link destination becomes visible to package inspection.
const plans = (planId ? tripwirePlans.filter(plan => plan.id === planId) : tripwirePlans).map(plan => linkIsTell
  ? { ...plan, tripwires: plan.tripwires.map(item => item.trigger === "visit" ? { ...item, exposedTo: "document-package" } : item) }
  : plan);
if (plans.length === 0) {
  process.stderr.write(`Unknown plan. Choose one of: ${tripwirePlans.map(plan => plan.id).join(", ")}\n`);
  process.exit(1);
}

function stopText(report, reason) {
  const title = id => report.lurePath.find(item => item.id === id)?.title ?? id;
  if (reason.kind === "tell") {
    return reason.surface === "document-package"
      ? `package inspection exposed ${reason.tripwireId} at “${title(reason.artifactId)}” → ${reason.response}`
      : `directory check showed ${reason.tripwireId} is dormant → ${reason.response}`;
  }
  const seen = reason.observations.map(item => `“${item.value}” in ${title(item.artifactId)}`).join(" vs ");
  return reason.constraintId
    ? `timeline contradiction (${reason.constraintId}): ${seen}`
    : `contradiction on ${reason.factId}: ${seen}`;
}

const lines = [
  "# Narrative Canary — attacker's read",
  "",
  `Scenario: ${scenario.id} v${scenario.version} (fictional) · on a tell the reader will: ${onTell}${linkIsTell ? " · portal link treated as a tell" : ""}`,
  "Each row is a cited attacker tradecraft profile walked through the designed lure path.",
  "“Detected” means a local tripwire condition was met in this model. Nothing was deployed or alerted."
];
for (const plan of plans) {
  const report = attackerRead(scenario, plan, undefined, { onTell });
  lines.push("", `## ${report.planLabel} [${report.planId}, ${report.armId} files]`,
    `Lure path: ${report.lurePath.map(item => item.title).join(" → ")}`,
    `Coverage: ${report.coverage.detected}/${report.coverage.total} profiles meet a tripwire condition`, "");
  for (const walk of report.walks) {
    const profile = report.profiles.find(item => item.id === walk.profileId);
    const outcome = walk.detected
      ? `DETECTED by ${walk.fired.join(", ")}${walk.singlePointOfDetection ? "  (single point of detection)" : ""}`
      : "UNDETECTED";
    lines.push(`- ${profile.label.padEnd(44)} ${outcome}`);
    if (walk.stoppedBy) lines.push(`    stopped: ${stopText(report, walk.stoppedBy)}`);
  }
  for (const finding of report.lureFindings) {
    const where = finding.artifactId ? report.lurePath.find(item => item.id === finding.artifactId)?.title : "any file on the path";
    lines.push(`  ! ${finding.code}: ${where} — sensor watches “${finding.watchedValue}”${finding.shownText ? `, file says “${finding.shownText}”` : ""}`);
  }
}
const assumptions = attackerRead(scenario, plans[0], undefined, { onTell }).assumptions;
lines.push("", "## Assumptions (change these to challenge the result)", ...assumptions.map(item => `- ${item}`));
process.stdout.write(`${lines.join("\n")}\n`);
