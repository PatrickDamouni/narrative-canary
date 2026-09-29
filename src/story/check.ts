import { editDistance, words } from "../lint.ts";
import { DOC_IDS, FACT_KEYS, FACT_KIND, TIMELINE_RULES, type DecoySet, type DocId, type FactKey, type FactSheet } from "./schema.ts";

/**
 * Plain-code audit of an AI-written decoy story. It never asks a model whether the story is consistent;
 * it checks the model's own quotes against its own text, and its documents against each other.
 * It reads spelling and dates, not meaning: a wrong but well-formed statement can still pass.
 */

export type Severity = "unsafe" | "contradiction" | "incomplete" | "hygiene" | "review";
export type StoryStatus = "unsafe" | "contradiction" | "incomplete" | "consistent";

export type StoryIssue = { readonly severity: Severity } & (
  | { readonly code: "MISSING_DOCUMENT" | "DUPLICATE_DOCUMENT"; readonly docId: DocId }
  | { readonly code: "UNSAFE_CONTENT"; readonly docId: DocId; readonly kind: "link" | "email" | "phone" | "credential" }
  | { readonly code: "UNGROUNDED_QUOTE"; readonly docId: DocId; readonly key: FactKey; readonly quote: string }
  | { readonly code: "INVALID_VALUE" | "UNREADABLE_QUOTE" | "QUOTE_VALUE_MISMATCH" | "PARTIAL_NAME"; readonly docId: DocId; readonly key: FactKey; readonly quote: string; readonly value: string }
  | { readonly code: "CROSS_DOC_CONFLICT"; readonly key: FactKey; readonly observations: readonly { readonly docId: DocId; readonly value: string }[] }
  | { readonly code: "SHEET_CONFLICT"; readonly docId: DocId; readonly key: FactKey; readonly value: string; readonly sheetValue: string }
  | { readonly code: "NEAR_MISS_NAME"; readonly docId: DocId; readonly text: string; readonly closestTo: string }
  | { readonly code: "TIMELINE_ORDER"; readonly before: FactKey; readonly after: FactKey; readonly beforeValue: string; readonly afterValue: string }
  | { readonly code: "UNACCOUNTED_DATE"; readonly docId: DocId; readonly text: string; readonly date: string }
  | { readonly code: "THIN_COVERAGE"; readonly key: FactKey; readonly documents: number }
);

export interface StoryCheck {
  readonly issues: readonly StoryIssue[];
  readonly status: StoryStatus;
  readonly hasContradiction: boolean;
  readonly counts: Readonly<Record<Severity, number>>;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "Sept" is common enough in business prose to need its own spelling.
const MONTH = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE_PATTERNS: readonly { readonly regex: RegExp; readonly read: (match: RegExpExecArray) => [number, number, number] }[] = [
  { regex: /\b(\d{4})-(\d{2})-(\d{2})\b/g, read: m => [Number(m[1]), Number(m[2]), Number(m[3])] },
  { regex: new RegExp(`\\b${MONTH} (\\d{1,2}),? (\\d{4})\\b`, "gi"), read: m => [Number(m[3]), monthNumber(m[1]), Number(m[2])] },
  { regex: new RegExp(`\\b(\\d{1,2}) ${MONTH},? (\\d{4})\\b`, "gi"), read: m => [Number(m[3]), monthNumber(m[2]), Number(m[1])] },
  { regex: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, read: m => [Number(m[3]), Number(m[1]), Number(m[2])] }
];

function monthNumber(text: string): number {
  return MONTHS.findIndex(month => month.startsWith(text.toLowerCase().replace(".", "").slice(0, 3))) + 1;
}

function toIso([year, month, day]: [number, number, number]): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = month >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

export function findDates(text: string): { text: string; iso: string }[] {
  return DATE_PATTERNS.flatMap(({ regex, read }) => [...text.matchAll(new RegExp(regex))].flatMap(match => {
    const iso = toIso(read(match as RegExpExecArray));
    return iso ? [{ text: match[0], iso }] : [];
  }));
}

/** Reads text that is exactly one date, in any format generated stories use; null otherwise. */
export function parseDate(text: string): string | null {
  const found = findDates(text.trim());
  return found.length === 1 && found[0].text === text.trim() ? found[0].iso : null;
}

const comparable = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/** The form two values are compared in: ISO for dates, case-folded text otherwise. */
const normalized = (key: FactKey, value: string): string => FACT_KIND[key] === "date" ? (parseDate(value) ?? comparable(value)) : comparable(value);

/** Keys whose values are proper names, so a one-letter slip elsewhere is suspicious. Status words are not names. */
const NAME_KEYS: readonly FactKey[] = FACT_KEYS.filter(key => FACT_KIND[key] === "person" || key === "company_name" || key === "project_name");

const UNSAFE: readonly { kind: "link" | "email" | "phone" | "credential"; regex: RegExp }[] = [
  { kind: "link", regex: /\b(?:https?|ftp|file):\/\/|\bwww\.[a-z0-9-]/i },
  { kind: "email", regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { kind: "phone", regex: /(?:\+?\d{1,2}[-. ]?)?\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/ },
  { kind: "credential", regex: /\bAKIA[0-9A-Z]{16}\b|\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]/i }
];

function documentIssues(set: DecoySet): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const seen = new Set<string>();
  for (const doc of set.documents) {
    if (seen.has(doc.id)) issues.push({ code: "DUPLICATE_DOCUMENT", severity: "hygiene", docId: doc.id });
    seen.add(doc.id);
    for (const { kind, regex } of UNSAFE) {
      if (regex.test(`${doc.title}\n${doc.body}`)) issues.push({ code: "UNSAFE_CONTENT", severity: "unsafe", docId: doc.id, kind });
    }
  }
  for (const id of DOC_IDS) if (!seen.has(id)) issues.push({ code: "MISSING_DOCUMENT", severity: "incomplete", docId: id });
  return issues;
}

/** Values the story commits to: the sheet when there is one, otherwise the value most documents state. */
function committedValues(set: DecoySet, sheet?: FactSheet): Map<FactKey, string> {
  const committed = new Map<FactKey, string>();
  for (const key of FACT_KEYS) {
    const fromSheet = sheet?.facts.find(item => item.key === key)?.value;
    if (fromSheet) { committed.set(key, fromSheet); continue; }
    const tally = new Map<string, { value: string; count: number }>();
    for (const doc of set.documents) for (const fact of doc.facts) {
      if (fact.key !== key) continue;
      const entry = tally.get(normalized(key, fact.value)) ?? { value: fact.value, count: 0 };
      tally.set(normalized(key, fact.value), { ...entry, count: entry.count + 1 });
    }
    const top = [...tally.values()].sort((left, right) => right.count - left.count || right.value.length - left.value.length)[0];
    if (top) committed.set(key, top.value);
  }
  return committed;
}

/** A single-word value that is part of the committed full name, e.g. "Ines" for "Ines Marlow". */
function isPartialName(key: FactKey, value: string, committed: string | undefined): boolean {
  if (FACT_KIND[key] !== "person" || !committed || words(value).length !== 1) return false;
  return words(committed).some(part => comparable(part) === comparable(value)) && words(committed).length > 1;
}

/** Each stated fact must be literally present and must say what its value claims. */
function quoteIssues(set: DecoySet, committed: Map<FactKey, string>): StoryIssue[] {
  return set.documents.flatMap(doc => doc.facts.flatMap((fact): StoryIssue[] => {
    const base = { docId: doc.id, key: fact.key, quote: fact.quote, value: fact.value };
    if (!doc.body.includes(fact.quote) && !doc.title.includes(fact.quote)) {
      return [{ code: "UNGROUNDED_QUOTE", severity: "hygiene", docId: doc.id, key: fact.key, quote: fact.quote }];
    }
    if (FACT_KIND[fact.key] === "date") {
      if (!parseDate(fact.value)) return [{ code: "INVALID_VALUE", severity: "hygiene", ...base }];
      const dates = [...new Set(findDates(fact.quote).map(found => found.iso))];
      // A quote may be a whole sentence; it agrees if the one date it contains is the value.
      if (dates.length !== 1) return [{ code: "UNREADABLE_QUOTE", severity: "hygiene", ...base }];
      return dates[0] === parseDate(fact.value) ? [] : [{ code: "QUOTE_VALUE_MISMATCH", severity: "contradiction", ...base }];
    }
    if (!comparable(fact.quote).includes(comparable(fact.value))) return [{ code: "QUOTE_VALUE_MISMATCH", severity: "contradiction", ...base }];
    return isPartialName(fact.key, fact.value, committed.get(fact.key)) ? [{ code: "PARTIAL_NAME", severity: "hygiene", ...base }] : [];
  }));
}

function consistencyIssues(set: DecoySet, sheet: FactSheet | undefined, committed: Map<FactKey, string>): StoryIssue[] {
  const issues: StoryIssue[] = [];
  for (const key of FACT_KEYS) {
    const all = set.documents.flatMap(doc => doc.facts.filter(fact => fact.key === key).map(fact => ({ docId: doc.id, value: fact.value })));
    // A shortened form of the committed name is reported as hygiene above, not as a contradiction here.
    const observations = all.filter(item => !isPartialName(key, item.value, committed.get(key)));
    if (new Set(observations.map(item => normalized(key, item.value))).size > 1) {
      issues.push({ code: "CROSS_DOC_CONFLICT", severity: "contradiction", key, observations });
    }
    const documents = new Set(all.map(item => item.docId)).size;
    if (documents < 2) issues.push({ code: "THIN_COVERAGE", severity: "incomplete", key, documents });
    const sheetValue = sheet?.facts.find(item => item.key === key)?.value;
    if (sheetValue) {
      for (const item of observations) {
        if (normalized(key, item.value) !== normalized(key, sheetValue)) {
          issues.push({ code: "SHEET_CONFLICT", severity: "contradiction", docId: item.docId, key, value: item.value, sheetValue });
        }
      }
    }
  }
  for (const [before, after] of TIMELINE_RULES) {
    const beforeIso = parseDate(committed.get(before) ?? "");
    const afterIso = parseDate(committed.get(after) ?? "");
    if (beforeIso && afterIso && beforeIso >= afterIso) {
      issues.push({ code: "TIMELINE_ORDER", severity: "contradiction", before, after, beforeValue: beforeIso, afterValue: afterIso });
    }
  }
  return issues;
}

/** Slips in text nobody annotated: a proper name one or two letters off, or a date no fact accounts for. */
function proseIssues(set: DecoySet, committed: Map<FactKey, string>): StoryIssue[] {
  const stated = new Set(set.documents.flatMap(doc => doc.facts.map(fact => comparable(fact.value))));
  const names = [...new Set(NAME_KEYS.flatMap(key => committed.get(key) ?? []))]
    .filter(value => value.length >= 6)
    .map(value => ({ value, key: words(value).join(" ").toLocaleLowerCase("en-US"), size: words(value).length }));
  const knownDates = new Set([...committed.values(), ...set.documents.flatMap(doc => doc.facts.map(fact => fact.value))]
    .flatMap(value => parseDate(value) ?? []));
  const issues: StoryIssue[] = [];
  for (const doc of set.documents) {
    const text = words(doc.body.replace(/,/g, " "));
    const flagged = new Set<string>();
    for (const target of names) {
      const allowed = target.key.length >= 12 ? 2 : 1;
      for (let start = 0; start + target.size <= text.length; start += 1) {
        const window = text.slice(start, start + target.size).join(" ");
        const distance = editDistance(window.toLocaleLowerCase("en-US"), target.key);
        if (distance === 0 || distance > allowed || flagged.has(window) || stated.has(comparable(window))) continue;
        flagged.add(window);
        issues.push({ code: "NEAR_MISS_NAME", severity: "contradiction", docId: doc.id, text: window, closestTo: target.value });
      }
    }
    for (const found of findDates(doc.body)) {
      if (!knownDates.has(found.iso)) issues.push({ code: "UNACCOUNTED_DATE", severity: "review", docId: doc.id, text: found.text, date: found.iso });
    }
  }
  return issues;
}

export function checkStory(set: DecoySet, sheet?: FactSheet): StoryCheck {
  const committed = committedValues(set, sheet);
  const issues = [...documentIssues(set), ...quoteIssues(set, committed), ...consistencyIssues(set, sheet, committed), ...proseIssues(set, committed)];
  const counts = { unsafe: 0, contradiction: 0, incomplete: 0, hygiene: 0, review: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  // Hygiene problems make the annotations untrustworthy, so the story cannot be called consistent.
  const status: StoryStatus = counts.unsafe ? "unsafe" : counts.contradiction ? "contradiction"
    : counts.incomplete || counts.hygiene ? "incomplete" : "consistent";
  return { issues, status, hasContradiction: counts.contradiction > 0, counts };
}
