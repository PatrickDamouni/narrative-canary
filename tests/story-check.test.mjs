import assert from "node:assert/strict";
import test from "node:test";

import { checkStory, parseDate } from "../src/story/check.ts";

const facts = {
  company_name: "Halden Freight", project_name: "Project Kestrel", project_lead: "Ines Marlow", sponsor: "Tomas Reyes",
  project_status: "Working review", kickoff_date: "2026-10-01", review_date: "2026-10-15", final_deadline: "2026-11-20",
  finance_owner: "Ines Marlow", finance_due: "2026-11-02", legal_owner: "Omar Blake", legal_due: "2026-11-06",
  ops_owner: "Lena Fisk", ops_due: "2026-11-10"
};
const long = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const fact = (key, quote = facts[key]) => ({ key, quote, value: facts[key] });

function cleanSet() {
  return { documents: [
    { id: "kickoff_email", title: "Kestrel kickoff", facts: [fact("project_name"), fact("project_lead"), fact("sponsor"), fact("kickoff_date", long(facts.kickoff_date)), fact("company_name")],
      body: `Team, Ines Marlow will lead Project Kestrel for Halden Freight. Tomas Reyes is sponsoring. We start on ${long(facts.kickoff_date)}.` },
    { id: "scope_memo", title: "Kestrel scope", facts: [fact("project_name"), fact("project_status"), fact("final_deadline", long(facts.final_deadline)), fact("company_name"), fact("kickoff_date", long(facts.kickoff_date))],
      body: `Project Kestrel is a Working review for Halden Freight. Work began ${long(facts.kickoff_date)}. The final handoff is due ${long(facts.final_deadline)}.` },
    { id: "workstream_tracker", title: "Kestrel tracker", facts: [fact("finance_owner"), fact("finance_due"), fact("legal_owner"), fact("legal_due"), fact("ops_owner"), fact("ops_due")],
      body: `Workstream,Owner,Due
Finance,Ines Marlow,2026-11-02
Legal,Omar Blake,2026-11-06
Operations,Lena Fisk,2026-11-10` },
    { id: "status_update", title: "Kestrel status", facts: [fact("review_date", long(facts.review_date)), fact("project_lead"), fact("project_status"), fact("legal_owner"), fact("legal_due"), fact("finance_owner"), fact("finance_due")],
      body: `Ines Marlow will present the Working review on ${long(facts.review_date)}. Omar Blake expects legal sign-off by 2026-11-06, and Ines Marlow owns finance through 2026-11-02.` },
    { id: "handoff_note", title: "Kestrel handoff", facts: [fact("sponsor"), fact("final_deadline"), fact("ops_owner"), fact("ops_due"), fact("review_date")],
      body: `Tomas Reyes approved the plan at the ${facts.review_date} review. Lena Fisk will close operations by 2026-11-10, before 2026-11-20.` }
  ] };
}
const codes = result => result.issues.map(issue => issue.code);
const edit = (set, id, change) => ({ documents: set.documents.map(doc => doc.id === id ? change(structuredClone(doc)) : doc) });

test("dates in the formats generated stories use are read the same way", () => {
  assert.equal(parseDate("2026-10-01"), "2026-10-01");
  assert.equal(parseDate("October 1, 2026"), "2026-10-01");
  assert.equal(parseDate("Oct 1, 2026"), "2026-10-01");
  assert.equal(parseDate("1 October 2026"), "2026-10-01");
  assert.equal(parseDate("10/1/2026"), "2026-10-01");
  assert.equal(parseDate("February 30, 2026"), null);
  assert.equal(parseDate("next Tuesday"), null);
});

test("a consistent story that covers every fact twice is the only kind called consistent", () => {
  const result = checkStory(cleanSet());
  assert.deepEqual(result.issues, []);
  assert.equal(result.hasContradiction, false);
  assert.equal(result.status, "consistent");
});

test("a story that leaves out documents or facts is incomplete, never consistent", () => {
  assert.equal(checkStory({ documents: [] }).status, "incomplete");
  const emptied = edit(cleanSet(), "status_update", doc => ({ ...doc, facts: [] }));
  const result = checkStory(emptied);
  assert.equal(result.status, "incomplete");
  assert.ok(result.issues.some(issue => issue.code === "THIN_COVERAGE" && issue.key === "legal_due"));
});

test("status ranks unsafe over contradiction over incomplete", () => {
  const unsafe = edit(cleanSet(), "scope_memo", doc => ({ ...doc, body: `${doc.body} See https://example.com.` }));
  assert.equal(checkStory(unsafe).status, "unsafe");
  const both = edit(cleanSet(), "status_update", doc => {
    doc.body = doc.body.replace("Ines Marlow will present", "Ines Barlow will present");
    doc.facts = doc.facts.map(item => item.key === "project_lead" ? { ...item, quote: "Ines Barlow", value: "Ines Barlow" } : item);
    doc.facts = doc.facts.filter(item => item.key !== "legal_due");
    return doc;
  });
  assert.equal(checkStory(both).status, "contradiction");
});

test("timeline order compares dates, not their spelling", () => {
  const sheet = { facts: Object.entries(facts).map(([key, value]) => ({ key, value: key === "kickoff_date" ? "October 1, 2026" : value })) };
  assert.equal(checkStory(cleanSet(), sheet).issues.filter(issue => issue.code === "TIMELINE_ORDER").length, 0);
});

test("two documents disagreeing about a fact is a cross-document contradiction", () => {
  const set = edit(cleanSet(), "status_update", doc => {
    doc.body = doc.body.replace("Ines Marlow will present", "Ines Barlow will present");
    doc.facts = doc.facts.map(item => item.key === "project_lead" ? { ...item, quote: "Ines Barlow", value: "Ines Barlow" } : item);
    return doc;
  });
  const conflict = checkStory(set).issues.find(issue => issue.code === "CROSS_DOC_CONFLICT");
  assert.equal(conflict.key, "project_lead");
  assert.deepEqual(conflict.observations.map(item => item.docId), ["kickoff_email", "status_update"]);
});

test("a quote that is not in the document, or says a different value, is caught", () => {
  const ungrounded = edit(cleanSet(), "scope_memo", doc => {
    doc.facts = doc.facts.map(item => item.key === "project_status" ? { ...item, quote: "Approved to proceed" } : item);
    return doc;
  });
  assert.ok(codes(checkStory(ungrounded)).includes("UNGROUNDED_QUOTE"));
  const mislabeled = edit(cleanSet(), "kickoff_email", doc => {
    doc.facts = doc.facts.map(item => item.key === "kickoff_date" ? { ...item, value: "2026-10-02" } : item);
    return doc;
  });
  assert.ok(codes(checkStory(mislabeled)).includes("QUOTE_VALUE_MISMATCH"));
});

test("a misspelled name in unannotated prose is a near miss", () => {
  const set = edit(cleanSet(), "status_update", doc => ({ ...doc, body: `${doc.body} Omar Blacke will confirm.` }));
  const issue = checkStory(set).issues.find(item => item.code === "NEAR_MISS_NAME");
  assert.equal(issue.text, "Omar Blacke");
  assert.equal(issue.closestTo, "Omar Blake");
});

test("a workstream due after the final deadline breaks the declared timeline", () => {
  const set = edit(cleanSet(), "workstream_tracker", doc => {
    doc.body = doc.body.replace("2026-11-10", "2026-11-25");
    doc.facts = doc.facts.map(item => item.key === "ops_due" ? { ...item, quote: "2026-11-25", value: "2026-11-25" } : item);
    return doc;
  });
  const issue = checkStory(set).issues.find(item => item.code === "TIMELINE_ORDER");
  assert.deepEqual([issue.before, issue.after], ["ops_due", "final_deadline"]);
});

test("a date in the prose that matches no stated fact is queued for review, not called a contradiction", () => {
  const set = edit(cleanSet(), "handoff_note", doc => ({ ...doc, body: `${doc.body} Archive by December 4, 2026.` }));
  const result = checkStory(set);
  assert.equal(result.issues.find(item => item.code === "UNACCOUNTED_DATE").severity, "review");
  assert.equal(result.hasContradiction, false);
});

test("when a fact sheet is given, a document that departs from it is flagged", () => {
  const sheet = { facts: Object.entries(facts).map(([key, value]) => ({ key, value: key === "sponsor" ? "Tomas Ruiz" : value })) };
  const conflicts = checkStory(cleanSet(), sheet).issues.filter(item => item.code === "SHEET_CONFLICT");
  assert.ok(conflicts.length >= 2);
  assert.ok(conflicts.every(item => item.key === "sponsor"));
});

test("links, emails, and credential-like strings are unsafe and never allowed", () => {
  for (const text of ["See https://example.com/x.", "Mail ines@halden.example today.", "Use key AKIAABCDEFGHIJKLMNOP.", "password: hunter22"]) {
    const set = edit(cleanSet(), "scope_memo", doc => ({ ...doc, body: `${doc.body} ${text}` }));
    assert.ok(codes(checkStory(set)).includes("UNSAFE_CONTENT"), text);
  }
});

test("a missing or repeated document is reported", () => {
  const missing = { documents: cleanSet().documents.slice(0, 4) };
  assert.ok(codes(checkStory(missing)).includes("MISSING_DOCUMENT"));
  const repeated = { documents: [...cleanSet().documents, cleanSet().documents[0]] };
  assert.ok(codes(checkStory(repeated)).includes("DUPLICATE_DOCUMENT"));
});

test("a date quoted inside a sentence, or written as Sept., still agrees with its value", () => {
  assert.equal(parseDate("Sept. 14, 2026"), "2026-09-14");
  const sentence = edit(cleanSet(), "kickoff_email", doc => {
    doc.facts = doc.facts.map(item => item.key === "kickoff_date" ? { ...item, quote: `We start on ${long(facts.kickoff_date)}` } : item);
    return doc;
  });
  assert.equal(checkStory(sentence).status, "consistent");
  const noYear = edit(cleanSet(), "status_update", doc => {
    doc.body = doc.body.replace(long(facts.review_date), "October 15");
    doc.facts = doc.facts.map(item => item.key === "review_date" ? { ...item, quote: "October 15" } : item);
    return doc;
  });
  const issue = checkStory(noYear).issues.find(item => item.code === "UNREADABLE_QUOTE");
  assert.equal(issue.severity, "hygiene", "a year-less date is unreadable, not a contradiction");
});

test("ordinary words near a status phrase are not treated as misspelled names", () => {
  const atRisk = { ...cleanSet() };
  atRisk.documents = atRisk.documents.map(doc => ({
    ...doc,
    body: doc.body.replaceAll("Working review", "At risk") + " The vendor delay is a risk.",
    facts: doc.facts.map(item => item.key === "project_status" ? { ...item, quote: "At risk", value: "At risk" } : item)
  }));
  assert.ok(!checkStory(atRisk).issues.some(item => item.code === "NEAR_MISS_NAME"));
});

test("a first-name-only mention is hygiene, not a cross-document contradiction", () => {
  const set = edit(cleanSet(), "status_update", doc => {
    doc.body = doc.body.replace("Ines Marlow will present", "Ines will present");
    doc.facts = doc.facts.map(item => item.key === "project_lead" ? { ...item, quote: "Ines", value: "Ines" } : item);
    return doc;
  });
  const result = checkStory(set);
  assert.ok(!result.issues.some(item => item.code === "CROSS_DOC_CONFLICT"));
  assert.ok(result.issues.some(item => item.code === "PARTIAL_NAME"));
  assert.equal(result.status, "incomplete");
});

test("phone numbers are unsafe too", () => {
  const set = edit(cleanSet(), "scope_memo", doc => ({ ...doc, body: `${doc.body} Call 517-555-0142 with questions.` }));
  assert.ok(checkStory(set).issues.some(item => item.code === "UNSAFE_CONTENT" && item.kind === "phone"));
});
