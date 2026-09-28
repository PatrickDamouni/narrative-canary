# Attacker's read: what catches the reader who doesn't trip the beacon

Status: design note and deterministic model, 2026-09-28. No attacker, vendor product, token, or alert was tested. All scenario material is fictional.

## The question

The starting point was a vendor's own material, read from the attacker's side. I used Thinkst's document-token documentation, the most widely used public reference for document canaries, and asked what a careful intruder does with it.

The answer in public sources is consistent. A document token fires when the file is [opened in Microsoft Office with network access](https://docs.canarytokens.org/guide/ms-word-token.html). A careful intruder can avoid that:

| Attacker habit | What it defeats | Public basis | Strength |
| --- | --- | --- | --- |
| Opens in desktop Office, online | nothing; the token fires | [Thinkst Word token guide](https://docs.canarytokens.org/guide/ms-word-token.html) | vendor documentation |
| Reads in Protected View or another viewer | the render-time beacon | [thinkst/canarytokens#35, CVE-2019-9768 (2019)](https://github.com/thinkst/canarytokens/issues/35); [practitioner guidance, 2026](https://hivesecurity.gitlab.io/blog/canary-tokens-deception-blue-team/) | public report; not re-tested |
| Scans the file package first | any auto-fetch reference, visible before opening | [CanaryTokenScanner](https://github.com/0xNslabs/CanaryTokenScanner) | public tool |
| Checks an account before using it | dormant honey accounts, unless the lookup is watched | [HoneypotBuster](https://github.com/JavelinNetworks/HoneypotBuster); [Defender for Identity: honeytoken accounts are usually dormant](https://learn.microsoft.com/en-us/defender-for-identity/entity-tags); [LDAP-query honeytoken alert](https://learn.microsoft.com/en-us/defender-for-identity/whats-new-archive) | public tool; vendor documentation |
| Cross-checks the story before acting | a lure whose files contradict each other | reasoning by analogy: the 2019 report notes token files were identifiable from limited size, metadata, and timestamp variation | **assumption** |

The beacon is optional for the attacker. The content is not: an intruder who wants what a decoy promises has to read it and act on it. That's the sense in which a canary can carry a narrative. The story teaches values, such as a person's account name or a workspace, and tripwires can watch for their *use* rather than for a file opening.

## The model

`src/tradecraft.ts` walks each habit through the designed lure path of a fictional scenario (steering update → scope note → worksheet → handoff note → workspace portal). A defender plan places tripwires of three kinds:

- **render**: an auto-fetch reference in a file. It fires on an online Office render and is visible to package inspection.
- **visit**: a watched request for a page.
- **use-value**: a sensor watching for use of a fact's exact value, here a dormant honey account for the named project lead.

For every habit the model returns the tripwires met, the first alert, whether detection rests on a single tripwire, and the step that ended the walk. That step is either a tell on a named surface, or a contradiction with the exact files and values the reader compared. Assumptions are listed in every output and two of them can be flipped from the CLI or page: whether a tell makes the reader abandon the story or just stop, and whether the portal link is itself a tell.

The cross-checking reader compares only what it has read: declared quotes and worksheet cells. It doesn't know the canonical facts. So a date that is wrong against the source of truth but appears in one file only is *invisible* to it, while two files disagreeing about a name is not. That separates defects a careful reader can see from the lure alone from defects that need outside knowledge.

## Results on the fictional fixtures

See the table in the [README](../../README.md#what-it-does). Three things the model surfaced that I didn't set out to show:

1. **A token on the entry document can cost coverage.** Under "abandon on a tell", the conventional token ends every inspecting habit's walk before the story's other tripwires are reached. The narrative plan *with* the token covers 2 of 5 habits, the same as the generic plan.
2. **Vetting can be the tripwire.** A first version let the careful attacker check the honey account and back away unseen. A skeptical review pointed out that Defender for Identity alerts on the lookup itself ("Honeytoken user was queried via LDAP", release 2.198; the SAM-R variant was later disabled over legacy-system false positives). Modeling that gives two catches per habit. If careful attackers distrust the workspace link, though, coverage still falls to 2 of 5.
3. **A partial mention is a lure that teaches nothing.** The clean handoff note cites the project lead but says only "Maya", so it cannot teach the account name on its own. I didn't plant this; the lure check found it. In the flawed copy, the scope note says "Maya Chan", so an attacker who learns the name there uses a value no sensor watches.

## What this does not show

- It is not a measurement. Every outcome follows from the listed assumptions and could be wrong about real intruders.
- It does not show that narrative decoys outperform any vendor. No product was tested, and vendors may already reason this way internally.
- The walk models one designed path. Real intruders skip files, arrive from elsewhere, and use values outside the story.
- It ignores alert fidelity: legitimate users touching decoys, and the cost of keeping a story consistent with a live environment.

## Questions for a practitioner

These are the questions whose answers would most change the model.

1. When an intruder finds one token, do they abandon the whole story or just avoid that file? Which should the default be?
2. Do defenders put tokens on the document most likely to be read first, or deliberately elsewhere?
3. Is a honey account named in a document a realistic lure, and which attributes do careful intruders check before trying one?
4. Is a hyperlink to an internal-looking workspace a tell in practice?
5. Does a pre-deployment check like this answer a decision your team actually makes? If you already do it, how?
