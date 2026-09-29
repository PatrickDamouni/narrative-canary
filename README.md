# Narrative Canary

A local research tool that asks a deception question from the attacker's side: **if a careful intruder reads your decoy without tripping its beacon, what catches them?**

## The problem with document canaries

A document canary alerts when the file is opened in the right application with network access. Careful intruders have well-documented ways to read the file without that happening:

- **Read it in another viewer.** Thinkst documents that its Word token alerts [when opened in Microsoft Office on Windows or macOS](https://docs.canarytokens.org/guide/ms-word-token.html). A [2019 report (CVE-2019-9768)](https://github.com/thinkst/canarytokens/issues/35) says Protected View and LibreOffice opened one without triggering it. That report is old; re-testing it is the next step here.
- **Inspect the package first.** Open-source scanners such as [CanaryTokenScanner](https://github.com/0xNslabs/CanaryTokenScanner) unzip Office files and list auto-fetch references without opening them.
- **Vet the account before using it.** Tools such as [HoneypotBuster](https://github.com/JavelinNetworks/HoneypotBuster) fingerprint fake accounts by logon history. Honeytoken accounts are [usually dormant by design](https://learn.microsoft.com/en-us/defender-for-identity/entity-tags), but Defender for Identity can [alert on the lookup itself](https://learn.microsoft.com/en-us/defender-for-identity/whats-new-archive) ("Honeytoken user was queried via LDAP").

The beacon is optional for the attacker. **The words are not.** Anyone who wants what a decoy promises has to read it and act on it. That makes the story inside the decoy a place to put tripwires, and it makes the story's consistency a detection property, not just polish.

## What it does

`npm start` opens an animated **attack board**: five attacker habits walk the same fictional lure files, and each tripwire fires, stays silent, or gets spotted, step by step. Each habit is cited to a vendor document, public tool, or public report, or labeled as an assumption. `npm run attacker-read` prints the same analysis in a terminal.

| Defender plan (fictional) | Office, online | Offline viewer | Scans package | + checks account | + cross-checks story |
| --- | --- | --- | --- | --- | --- |
| Generic files + document token + portal | caught (2) | caught (1) | walks away | walks away | walks away |
| Narrative files + document token + portal + honey account | caught (3) | caught (2) | walks away | walks away | walks away |
| Narrative files + portal + honey account, no token | caught (2) | caught (2) | caught (2) | caught (2) | caught (2) |
| Same, with one misspelled name | caught (2) | caught (2) | caught (2) | caught (2) | **walks away** |

How to read it, including what it does **not** show:

- A detectable token on the first document ends the walk of every attacker who inspects packages, before any other tripwire. That holds only if attackers leave when they spot a trap. Flip it (`--stop-path`) and the trade-off changes.
- Checking the honey account doesn't save the careful attacker, because the lookup itself is watched.
- The no-token plan's clean sweep still rests on assumptions. If careful attackers distrust the workspace link (`--link-is-tell`), coverage drops to 2 of 5.
- In the flawed copy, one misspelled name loses the most careful attacker. The board names the exact files and phrases: "Maya Chen" in the steering update versus "Maya Chan" in the scope note.

These results follow from stated assumptions, computed deterministically. They are not measurements of attackers, tests of any vendor product, or evidence that one plan works better in the field. [The attacker's-read note](docs/research/attacker-read.md) has the reasoning, sources, and open questions.

Underneath, `src/lint.ts` checks declared quotes, worksheet cells, and date rules against the canonical fictional facts, flags near-miss spellings of known names anywhere in the text, and lists every fact reference it could *not* check, so unchecked prose is never counted as clean.

### Planted-flaw benchmark

The board shows these results as its own panel: one bar per mistake type and one dot per planted copy (hover a dot to see exactly what was planted). `npm run benchmark` prints the same numbers. It makes 42 copies of the clean files, each with exactly one planted mistake, and scores whether the lint points at the right file and fact:

| Planted mistake | Caught |
| --- | --- |
| Misspelled name or date in an annotated quote | 7 / 7 |
| Edited worksheet cell | 12 / 12 |
| Deadline moved past the date it must precede | 3 / 3 |
| Misspelled name slipped into unannotated prose | 10 / 10 (was 0 / 10 before the near-miss check) |
| A different but plausible value in prose ("Approved to proceed") | **0 / 10** |
| **Total** | **32 / 42, with 0 false alarms on the clean files** |

The last row is the honest limit: the lint compares spelling, not meaning, so a wrong-but-plausible statement passes. The first version of the near-miss check also flagged the possessive "Project Lantern's" as a typo; the benchmark caught that false alarm, and a regression test now covers it. The flaws are generated by the same author as the lint, so this measures coverage of known mistake types, not real-world accuracy.

## In progress: do AI-written decoy stories hold together?

A story-based decoy only works if its files agree with each other. `src/story/` asks Claude (`claude-opus-5`) to write five connected, fictional documents for an invented organization, in two ways: free-form, or from a fact sheet written first. A plain-code checker (`src/story/check.ts`, no AI involved) audits every set for:
- documents that disagree about a fact
- quotes that are not really in the text
- misspelled names
- impossible timelines
- links, emails, phone numbers, or credential-like text

One repair pass sends the findings back to Claude, and the checker audits the result again.

Every story is counted, including ones Claude declined, cut off, or failed to produce; nothing is dropped from the denominator. `npm run story-pilot` prints the plan and estimated cost and sends nothing unless run with `--yes`. No results yet.

## What is established, and what might be new

| Already established elsewhere | Hypothesis here, not yet evidence |
| --- | --- |
| Document-open tokens ([Thinkst](https://docs.canarytokens.org/guide/ms-word-token.html)), honey accounts ([Defender for Identity](https://learn.microsoft.com/en-us/defender-for-identity/entity-tags)), multistep attack trees ([CounterCraft](https://www.countercraftsec.com/blog/attack-trees-in-deception-campaigns/)) | Checking each tripwire plan, before deployment, against named attacker habits, with every outcome tied to exact source text |
| Tools that detect canaries and honey accounts (see above) | Treating narrative consistency as a detection property: one visible contradiction ends the careful reader's walk |
| Practitioner warnings that tokens have [detection limits](https://hivesecurity.gitlab.io/blog/canary-tokens-deception-blue-team/) | Flagging lures that teach a value the sensor isn't watching |

I found no public vendor page describing the right-hand column, but that doesn't mean nobody does it.

## Status

- **Working and tested:** the attacker model, the board, the CLI, the consistency lint, the planted-flaw benchmark, and the AI story generator and checker; a loopback-only server. 94 automated tests and a strict TypeScript check.
- **Not done:** no human study, no real attackers, no enterprise integration, no vendor comparison. All names, companies, and files are invented.

## Run it

Requires Node.js 24+.

```bash
npm install --ignore-scripts
```

```bash
npm test
```

```bash
npm start
```

`npm start` prints a local link; open it. The link carries a one-time token in its `#fragment`, which the browser never sends to the server; the page reads it and clears it from the address bar. The server refuses non-loopback binding. Set `NARRATIVE_CANARY_PORT` to pin a port.

```bash
npm run attacker-read -- --flawed --link-is-tell --stop-path
```

```bash
npm run benchmark -- --missed
```

## Safety boundaries

Everything is fictional and runs on one machine. The project never generates functional credentials, never scans networks, never sends anything off the machine, and never contacts a vendor or a real person. The attacker habits are described at the level defenders need to review their own decoys. See the [threat model](docs/security/local-lab-threat-model.md).
