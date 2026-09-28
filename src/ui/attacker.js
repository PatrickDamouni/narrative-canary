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

async function open(candidate) {
  gateError.hidden = true;
  try {
    report = await load(candidate);
    token = candidate;
    gate.hidden = true;
    workspace.hidden = false;
    selected = "cross-checker";
    render();
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
