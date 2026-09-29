const gate = document.querySelector("#gate");
const tokenForm = document.querySelector("#token-form");
const tokenInput = document.querySelector("#token");
const gateError = document.querySelector("#gate-error");
const workspace = document.querySelector("#workspace");
const loadError = document.querySelector("#load-error");
const linkIsTell = document.querySelector("#link-is-tell");
const grid = document.querySelector("#grid");

const AVATARS = { "office-render": "🖱️", "offline-viewer": "🛡️", "package-scan": "🔬", "package-and-directory": "🗂️", "cross-checker": "🕵️" };
const STEP_MS = 520;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const settings = { plan: "narrative-no-beacon", files: "clean", onTell: "abandon" };
let token = "";
let report = null;
let selected = null;
let timers = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function load(candidate) {
  const query = new URLSearchParams({ ...settings, linkIsTell: linkIsTell.checked ? "1" : "0" });
  const response = await fetch(`/api/attacker-read?${query}`, { headers: { "x-canary-token": candidate }, cache: "no-store" });
  if (response.status === 403) throw new Error("That researcher token was not accepted.");
  if (!response.ok) throw new Error("The attacker's read could not be computed.");
  return response.json();
}

const titleOf = id => report.lurePath.find(item => item.id === id)?.title ?? id;
const tripwireOf = id => report.tripwires.find(item => item.id === id);
const hasAccount = () => report.tripwires.some(item => item.trigger === "use-value");
const columns = () => [...report.lurePath.map(item => item.id), ...(hasAccount() ? ["@account"] : [])];

function columnOf(step) {
  const id = step.kind === "stopped" ? step.reason.artifactId : step.artifactId;
  return id ?? "@account";
}

/** Turn one walk into timed cell updates for the board. */
function rowEvents(walk) {
  return walk.steps.map(step => {
    const col = columnOf(step);
    if (step.kind === "read") {
      return { col, state: "read", text: step.taught.length ? `learns “${step.taught.map(item => item.value).join(", ")}”` : "reads it" };
    }
    if (step.kind === "fired") {
      const vetting = /vetting/.test(step.reason);
      return { col, state: "fired", text: vetting ? "looks it up · lookup watched" : tripwireOf(step.tripwireId)?.trigger === "use-value" ? "tries the account" : tripwireOf(step.tripwireId)?.trigger === "render" ? "beacon loads" : "visits it", alert: true };
    }
    if (step.kind === "suppressed") return { col, state: "silent", text: "beacon never loads" };
    const reason = step.reason;
    if (reason.kind === "tell") {
      return { col, state: "tell", text: reason.surface === "document-package" ? (tripwireOf(reason.tripwireId)?.trigger === "visit" ? "distrusts the link" : "finds the token inside") : "account looks unused", stop: true };
    }
    return { col, state: "tell", text: `“${reason.observations[0].value}” ≠ “${reason.observations[1].value}”`, stop: true };
  });
}

function renderControls() {
  document.querySelector("#plan-options").replaceChildren(...report.plans.map(plan => {
    const button = el("button", "", plan.label.replace(/^(Generic|Narrative) files \+ /, (_, kind) => `${kind} + `));
    button.type = "button";
    button.setAttribute("aria-pressed", String(plan.id === settings.plan));
    button.addEventListener("click", () => update({ plan: plan.id }));
    return button;
  }));
  for (const button of document.querySelectorAll("[data-files]")) button.setAttribute("aria-pressed", String(button.dataset.files === settings.files));
  for (const button of document.querySelectorAll("[data-tell]")) button.setAttribute("aria-pressed", String(button.dataset.tell === settings.onTell));
}

function buildBoard() {
  const cols = columns();
  grid.style.setProperty("--cols", String(cols.length));
  const header = [el("div", "colhead", "")];
  for (const id of cols) {
    const head = el("div", "colhead");
    const armed = report.tripwires.filter(item => (id === "@account" ? item.trigger === "use-value" : item.artifactId === id));
    head.append(el("b", "", id === "@account" ? "Honey account" : titleOf(id)));
    if (armed.length) head.append(el("span", "armed", armed.map(item => item.trigger === "render" ? "● DOCUMENT TOKEN" : item.trigger === "visit" ? "● WATCHED" : "● WATCHED ACCOUNT").join(" ")));
    header.push(head);
  }
  header.push(el("div", "colhead", ""));
  const rows = report.walks.map(walk => {
    const profile = report.profiles.find(item => item.id === walk.profileId);
    const who = el("button", "who");
    who.type = "button";
    who.setAttribute("aria-pressed", String(selected === walk.profileId));
    who.append(el("span", "avatar", AVATARS[walk.profileId] ?? "•"), el("span", "", profile.label));
    who.addEventListener("click", () => { selected = walk.profileId; renderDetail(); for (const b of grid.querySelectorAll(".who")) b.setAttribute("aria-pressed", String(b === who)); });
    const cells = cols.map(col => { const cell = el("div", "cell"); cell.dataset.col = col; return cell; });
    const outcome = el("div", "outcome", walk.detected ? `CAUGHT ×${walk.fired.length}` : "WALKED AWAY UNSEEN");
    outcome.classList.add(walk.detected ? "caught" : "unseen");
    return { walk, nodes: [who, ...cells, outcome], cells, outcome };
  });
  grid.replaceChildren(...header, ...rows.flatMap(row => row.nodes));
  return rows;
}

const PRIORITY = ["read", "silent", "tell", "fired"];

function paint(cell, event) {
  const current = PRIORITY.find(state => cell.classList.contains(state));
  if (!current || PRIORITY.indexOf(event.state) > PRIORITY.indexOf(current)) {
    cell.classList.remove(...PRIORITY);
    cell.classList.add(event.state);
  }
  if (event.alert) cell.append(el("span", "alert", "ALERT"));
  cell.append(el("span", "label", event.text));
}

function play() {
  for (const id of timers) clearTimeout(id);
  timers = [];
  const rows = buildBoard();
  document.querySelector("#coverage").textContent = `${report.coverage.detected} / ${report.coverage.total}`;
  let longest = 0;
  for (const row of rows) {
    const events = rowEvents(row.walk);
    longest = Math.max(longest, events.length);
    const finish = () => {
      const touched = new Set(events.map(item => item.col));
      for (const cell of row.cells) if (!touched.has(cell.dataset.col)) cell.classList.add("unreached");
      row.outcome.classList.add("show");
    };
    if (reducedMotion) { events.forEach(event => paint(row.cells.find(cell => cell.dataset.col === event.col), event)); finish(); continue; }
    events.forEach((event, index) => timers.push(setTimeout(() => paint(row.cells.find(cell => cell.dataset.col === event.col), event), (index + 1) * STEP_MS)));
    timers.push(setTimeout(finish, (events.length + 1) * STEP_MS));
  }
}

function renderDetail() {
  const detail = document.querySelector("#detail");
  const walk = report.walks.find(item => item.profileId === selected);
  if (!walk) { detail.replaceChildren(); return; }
  const profile = report.profiles.find(item => item.id === walk.profileId);
  const storyCard = el("div", "card");
  storyCard.append(el("h3", "", `${AVATARS[walk.profileId] ?? ""} ${profile.label}`));
  const story = el("ol", "story");
  for (const step of walk.steps) {
    if (step.kind === "read") story.append(el("li", "", `Reads “${step.title}”${step.taught.length ? ` and learns “${step.taught.map(item => item.value).join(", ")}”` : ""}.`));
    else if (step.kind === "fired") story.append(el("li", "fired", `Tripwire fires: ${tripwireOf(step.tripwireId)?.label}. ${step.reason}`));
    else if (step.kind === "suppressed") story.append(el("li", "silent", `Silent: ${tripwireOf(step.tripwireId)?.label}. ${step.reason}`));
    else if (step.reason.kind === "tell") story.append(el("li", "stop", step.reason.surface === "document-package"
      ? `Inspects “${titleOf(step.reason.artifactId)}” before touching it and spots ${tripwireOf(step.reason.tripwireId)?.label.toLowerCase()}. ${step.reason.response === "abandon" ? "Leaves." : "Stops following the path."}`
      : `Checks the account first: it has never been used. ${step.reason.response === "abandon" ? "Leaves." : "Skips it."}`));
    else story.append(el("li", "stop", `The story contradicts itself: ${step.reason.observations.map(item => `“${item.value}” in ${titleOf(item.artifactId)}`).join(" vs ")}. Stops trusting it.`));
  }
  storyCard.append(story);
  const basisCard = el("div", "card");
  basisCard.append(el("h3", "", "Why this habit is modeled"));
  for (const item of profile.basis) {
    const row = el("p", "source");
    row.append(el("b", item.strength === "assumption" ? "assumption" : "", item.strength.replace("-", " ")), document.createTextNode(`${item.supports} `));
    if (/^https:\/\//.test(item.source)) {
      const link = el("a", "", "source ↗");
      link.href = item.source; link.target = "_blank"; link.rel = "noreferrer noopener";
      row.append(link);
    }
    basisCard.append(row);
  }
  detail.replaceChildren(storyCard, basisCard);
}

function renderFindings() {
  const section = document.querySelector("#findings");
  const profileLabel = id => report.profiles.find(item => item.id === id)?.label.toLowerCase() ?? id;
  const singlePoints = report.tripwireValue.filter(item => item.uniqueCatches.length > 0);
  const silent = report.tripwireValue.filter(item => !report.walks.some(walk => walk.fired.includes(item.tripwireId)));
  const cards = [
    ...report.lureFindings.map(finding => {
      const card = el("div", "finding");
      const text = finding.code === "LURE_TEACHES_OTHER_VALUE"
        ? `“${titleOf(finding.artifactId)}” says “${finding.shownText}”, but the sensor watches “${finding.watchedValue}”. An attacker who learns the name here uses one nothing is watching.`
        : finding.code === "LURE_OMITS_WATCHED_VALUE"
          ? `“${titleOf(finding.artifactId)}” mentions this person but never gives the full name “${finding.watchedValue}”, so it can't teach the account on its own.`
          : `No file teaches “${finding.watchedValue}”. That tripwire can never fire through this lure.`;
      card.append(el("b", "", finding.code === "LURE_OMITS_WATCHED_VALUE" ? "WEAK LURE" : "BROKEN LURE"), document.createTextNode(text));
      return card;
    }),
    ...singlePoints.map(item => {
      const card = el("div", "finding");
      card.append(el("b", "", "SINGLE POINT OF DETECTION"), document.createTextNode(`Only “${tripwireOf(item.tripwireId)?.label}” catches: ${item.uniqueCatches.map(profileLabel).join("; ")}. If it fails, they walk away unseen.`));
      return card;
    }),
    ...silent.map(item => {
      const card = el("div", "finding");
      card.append(el("b", "", "NEVER FIRES HERE"), document.createTextNode(`“${tripwireOf(item.tripwireId)?.label}” catches none of the five attackers in this setup.`));
      return card;
    })
  ];
  section.hidden = cards.length === 0;
  section.replaceChildren(...cards);
}

function render() {
  renderControls();
  play();
  renderDetail();
  renderFindings();
  document.querySelector("#assumptions").replaceChildren(...report.assumptions.map(item => el("li", "", item)));
}

async function update(change) {
  Object.assign(settings, change);
  loadError.hidden = true;
  try {
    report = await load(token);
    render();
  } catch (error) {
    loadError.textContent = error instanceof Error ? error.message : "The attacker's read could not be computed.";
    loadError.hidden = false;
  }
}

for (const button of document.querySelectorAll("[data-files]")) button.addEventListener("click", () => update({ files: button.dataset.files }));
for (const button of document.querySelectorAll("[data-tell]")) button.addEventListener("click", () => update({ onTell: button.dataset.tell }));
linkIsTell.addEventListener("change", () => update({}));
document.querySelector("#replay").addEventListener("click", () => report && play());

const MISTAKE_LABELS = {
  "anchored-quote-typo": "Misspelled name or date in an annotated quote",
  "worksheet-cell-edit": "Edited worksheet cell",
  "impossible-deadline": "Deadline moved past the date it must precede",
  "prose-name-typo": "Misspelling slipped into plain prose",
  "prose-wrong-value": "Wrong but plausible value in prose"
};

function renderBenchmark(result) {
  const planted = result.cases.length;
  const caught = result.cases.filter(item => item.caught).length;
  document.querySelector("#bench-score").textContent = `${caught} / ${planted}`;
  document.querySelector("#bench-fa").textContent = String(result.cleanFalseAlarms);
  const focus = document.querySelector("#bench-focus");
  const describe = item => `${item.caught ? "✓ Caught" : "✕ Missed"}: ${item.description}`;
  document.querySelector("#bench-rows").replaceChildren(...result.byKind.map(row => {
    const line = el("div", "bench-row");
    const bar = el("div", "bench-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${row.caught} of ${row.planted} caught`);
    if (row.caught) { const part = el("span", "caught"); part.style.flex = String(row.caught); bar.append(part); }
    if (row.planted - row.caught) { const part = el("span", "missed"); part.style.flex = String(row.planted - row.caught); bar.append(part); }
    const dots = el("div", "dots");
    for (const item of result.cases.filter(entry => entry.kind === row.kind)) {
      const dot = el("button", `dot ${item.caught ? "caught" : "missed"}`, item.caught ? "✓" : "✕");
      dot.type = "button";
      dot.setAttribute("aria-label", describe(item));
      const show = () => { focus.textContent = describe(item); };
      dot.addEventListener("mouseenter", show);
      dot.addEventListener("focus", show);
      dot.addEventListener("click", show);
      dots.append(dot);
    }
    line.append(el("span", "bench-label", MISTAKE_LABELS[row.kind] ?? row.kind), bar, el("span", "bench-count", `${row.caught} / ${row.planted}`), dots);
    return line;
  }));
  document.querySelector("#bench-tbody").replaceChildren(...result.cases.map(item => {
    const tr = el("tr");
    tr.append(el("td", "", MISTAKE_LABELS[item.kind] ?? item.kind), el("td", "", item.description), el("td", "", item.caught ? "✓ Caught" : "✕ Missed"));
    return tr;
  }));
  document.querySelector("#bench").hidden = false;
}

async function loadBenchmark(candidate) {
  const response = await fetch("/api/benchmark", { headers: { "x-canary-token": candidate }, cache: "no-store" });
  if (!response.ok) throw new Error("The benchmark could not be loaded.");
  renderBenchmark(await response.json());
}

const STATUS = {
  consistent: { icon: "✓", label: "consistent", css: "st-consistent" },
  incomplete: { icon: "◐", label: "incomplete", css: "st-incomplete" },
  contradiction: { icon: "✕", label: "contradiction", css: "st-contradiction" },
  unsafe: { icon: "⚠", label: "unsafe", css: "st-unsafe" }
};
const DOC_LABELS = { kickoff_email: "Kickoff email", scope_memo: "Scope memo", workstream_tracker: "Workstream tracker", status_update: "Status update", handoff_note: "Handoff note" };
const docLabel = id => DOC_LABELS[id] ?? id;

/** Plain-language line for one checker finding. */
function describeIssue(issue) {
  switch (issue.code) {
    case "CROSS_DOC_CONFLICT": return `Documents disagree on ${issue.key}: ${(issue.observations ?? []).map(item => `“${item.value}” (${docLabel(item.docId)})`).join(" vs ")}.`;
    case "SHEET_CONFLICT": return `${docLabel(issue.docId)} says “${issue.value}” for ${issue.key}; the fact sheet says “${issue.sheetValue}”.`;
    case "QUOTE_VALUE_MISMATCH": return `The quote “${issue.quote}” does not say “${issue.value}” (${issue.key}).`;
    case "NEAR_MISS_NAME": return `“${issue.text}” is one or two letters off “${issue.closestTo}”.`;
    case "TIMELINE_ORDER": return `${issue.before} (${issue.beforeValue}) must come before ${issue.after} (${issue.afterValue}).`;
    case "UNACCOUNTED_DATE": return `The date “${issue.text}” matches no stated fact. For a person to review.`;
    case "UNSAFE_CONTENT": return `Contains a ${issue.kind}. Decoy text must never include one.`;
    case "UNGROUNDED_QUOTE": return `Claims to quote “${issue.quote}” for ${issue.key}, but that text is not in the document.`;
    case "UNREADABLE_QUOTE": return `The quote “${issue.quote}” has no complete date for ${issue.key}.`;
    case "PARTIAL_NAME": return `Uses only “${issue.value}” for ${issue.key}.`;
    case "INVALID_VALUE": return `${issue.key} value “${issue.value}” is not a valid date.`;
    case "THIN_COVERAGE": return `${issue.key} appears in only ${issue.documents} document(s); at least two are required.`;
    case "MISSING_DOCUMENT": return `The ${docLabel(issue.docId)} is missing.`;
    case "DUPLICATE_DOCUMENT": return `The ${docLabel(issue.docId)} appears twice.`;
    default: return issue.code;
  }
}

/** Issues that point into one document, and the exact text to mark there. */
function issuesFor(doc, issues) {
  const quotesOf = key => doc.facts.filter(fact => fact.key === key).map(fact => fact.quote);
  return issues.flatMap(issue => {
    if (issue.docId === doc.id) {
      return [{ issue, needles: [issue.text, issue.quote, ...(issue.code === "SHEET_CONFLICT" ? quotesOf(issue.key) : [])].filter(Boolean) }];
    }
    if (issue.code === "CROSS_DOC_CONFLICT" && (issue.observations ?? []).some(item => item.docId === doc.id)) return [{ issue, needles: quotesOf(issue.key) }];
    return [];
  });
}

/** Builds the document text with marked spans, using text nodes only. */
function markedText(body, marks) {
  const ranges = [];
  for (const { needle, unsafe } of marks) {
    let from = 0;
    while (needle && (from = body.indexOf(needle, from)) !== -1) {
      ranges.push([from, from + needle.length, unsafe]);
      from += needle.length;
    }
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const nodes = [];
  let cursor = 0;
  for (const [start, end, unsafe] of ranges) {
    if (start < cursor) continue;
    nodes.push(document.createTextNode(body.slice(cursor, start)), el("mark", unsafe ? "unsafe" : "", body.slice(start, end)));
    cursor = end;
  }
  nodes.push(document.createTextNode(body.slice(cursor)));
  return nodes;
}

let storyView = { stories: [], selected: null, doc: "kickoff_email", repaired: false };

function versionButtons(story, showRepaired) {
  const versions = [["original", false], ...(story.repairedDocuments.length ? [["after repair", true]] : [])];
  return versions.map(([label, value]) => {
    const button = el("button", "", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(showRepaired === value));
    button.addEventListener("click", () => { storyView.repaired = value; renderViewer(); });
    return button;
  });
}

function renderViewer() {
  const viewer = document.querySelector("#story-viewer");
  const story = storyView.stories[storyView.selected];
  if (!story) { viewer.hidden = true; return; }
  viewer.hidden = false;
  const showRepaired = storyView.repaired && story.repairedDocuments.length > 0;
  const documents = showRepaired ? story.repairedDocuments : story.documents;
  const issues = showRepaired ? story.repairedIssues : story.issues;
  document.querySelector("#viewer-title").textContent = `${story.seedId} · ${story.condition}${story.failure ? ` · failed: ${story.failure}` : ""}`;
  document.querySelector("#viewer-version").replaceChildren(...versionButtons(story, showRepaired));
  document.querySelector("#viewer-tabs").replaceChildren(...documents.map(doc => {
    const count = issuesFor(doc, issues).length;
    const tab = el("button", "", `${docLabel(doc.id)}${count ? ` (${count})` : ""}`);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(doc.id === storyView.doc));
    tab.setAttribute("aria-pressed", String(doc.id === storyView.doc));
    tab.addEventListener("click", () => { storyView.doc = doc.id; renderViewer(); });
    return tab;
  }));
  const doc = documents.find(item => item.id === storyView.doc) ?? documents[0];
  const pre = document.querySelector("#viewer-doc");
  const list = document.querySelector("#viewer-issues");
  if (!doc) {
    pre.replaceChildren(document.createTextNode(story.failure ? `No documents: ${story.failure}.` : "No documents."));
    list.replaceChildren();
    return;
  }
  const local = issuesFor(doc, issues);
  const marks = local.flatMap(({ issue, needles }) => needles.map(needle => ({ needle, unsafe: issue.severity === "unsafe" })));
  pre.replaceChildren(el("b", "", `${doc.title}\n\n`), ...markedText(doc.body, marks));
  const general = issues.filter(issue => !issue.docId && issue.code !== "CROSS_DOC_CONFLICT");
  const shown = [...local.map(item => item.issue), ...general];
  list.replaceChildren(...(shown.length ? shown : [null]).map(issue => {
    if (!issue) return el("li", "minor", "No problems found in this document.");
    const item = el("li", issue.severity === "unsafe" ? "unsafe" : issue.severity === "contradiction" ? "" : "minor");
    item.append(el("b", "", issue.severity.toUpperCase()), document.createTextNode(describeIssue(issue)));
    return item;
  }));
}

function conditionCard(row) {
  const card = el("div", "cond-card");
  card.append(el("h3", "", row.condition === "fact-sheet" ? "Fact sheet first" : "Free-form"),
    el("p", "cond-meta", `${row.checked} of ${row.attempted} stories checked${row.failed ? ` · ${row.failed} failed to generate` : ""} · $${Number(row.costUsd).toFixed(2)}`));
  const bar = el("div", "status-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", Object.entries(row.byStatus ?? {}).map(([status, count]) => `${count} ${status}`).join(", "));
  const counts = el("div", "status-counts");
  for (const [status, meta] of Object.entries(STATUS)) {
    const count = row.byStatus?.[status] ?? 0;
    if (count) { const part = el("span", meta.css); part.style.flex = String(count); bar.append(part); }
    counts.append(el("span", "", `${meta.icon} ${count} ${meta.label}`));
  }
  card.append(bar, counts);
  if (row.repairAttempted) {
    card.append(el("p", "cond-meta", `Repairs: ${row.repairedClean} of ${row.repairAttempted} came back consistent${row.repairFailed ? `, ${row.repairFailed} failed` : ""}${row.repairIntroducedNew ? `, ${row.repairIntroducedNew} introduced a new kind of problem` : ""}.`));
  }
  return card;
}

function storyChip(story, index) {
  const meta = STATUS[story.status] ?? { icon: "–", label: story.failure ? `failed: ${story.failure}` : "unknown", css: "st-incomplete" };
  const chip = el("button", "story-chip");
  chip.type = "button";
  chip.setAttribute("aria-pressed", "false");
  chip.append(el("span", `dot-s ${meta.css}`, meta.icon), document.createTextNode(`${story.seedId} · ${story.condition === "fact-sheet" ? "sheet" : "free"} · ${meta.label}`));
  chip.addEventListener("click", () => {
    storyView.selected = index;
    storyView.repaired = false;
    for (const other of document.querySelectorAll(".story-chip")) other.setAttribute("aria-pressed", String(other === chip));
    renderViewer();
  });
  return chip;
}

function renderStories(result) {
  document.querySelector("#stories").hidden = false;
  document.querySelector("#stories-empty").hidden = result.run !== null;
  document.querySelector("#stories-run").textContent = result.run
    ? `run ${result.run.slice(0, 10)}${result.skipped ? ` · ${result.skipped} unreadable file(s) skipped` : ""}`
    : "no run yet";
  const summaries = Array.isArray(result.summary?.summary) ? result.summary.summary : [];
  document.querySelector("#stories-summary").replaceChildren(...summaries.map(conditionCard));
  storyView = { stories: result.stories, selected: null, doc: "kickoff_email", repaired: false };
  document.querySelector("#stories-list").replaceChildren(...result.stories.map(storyChip));
  renderViewer();
}

async function loadStories(candidate) {
  const response = await fetch("/api/stories", { headers: { "x-canary-token": candidate }, cache: "no-store" });
  if (!response.ok) throw new Error("The story results could not be loaded.");
  renderStories(await response.json());
}

async function open(candidate) {
  gateError.hidden = true;
  try {
    report = await load(candidate);
    token = candidate;
    gate.hidden = true;
    workspace.hidden = false;
    selected = "cross-checker";
    render();
    await loadBenchmark(candidate);
    await loadStories(candidate);
  } catch (error) {
    gateError.textContent = error instanceof Error ? error.message : "The attacker's read could not be computed.";
    gateError.hidden = false;
  }
}

tokenForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = tokenForm.querySelector("button");
  submit.disabled = true;
  const candidate = tokenInput.value;
  tokenInput.value = "";
  await open(candidate);
  submit.disabled = false;
});

// The server prints a link with #token=…; fragments never reach the server. Read it once, then remove it.
const fragment = /^#token=([0-9a-f]{64})$/.exec(window.location.hash);
if (fragment) {
  history.replaceState(null, "", window.location.pathname);
  open(fragment[1]);
}
