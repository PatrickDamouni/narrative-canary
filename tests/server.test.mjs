import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createCanaryServer } from "../src/server.ts";

async function start(t, options) {
  const { server, token } = createCanaryServer(options);
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}`, token };
}

test("the server refuses any non-loopback binding", () => {
  const { server } = createCanaryServer();
  assert.throws(() => server.listen(0, "0.0.0.0", () => {}), /loopback/i);
});

test("the board page is served with a strict policy and reveals no fixture content before the token", async t => {
  const { base } = await start(t);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  const html = await page.text();
  assert.match(html, /Read it without tripping it/);
  assert.match(html, /NO DEPLOYED TRAPS OR DELIVERED ALERTS/);
  assert.doesNotMatch(html, /Maya Chen|lead-account/);
  const script = await (await fetch(`${base}/attacker.js`)).text();
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.equal((await fetch(`${base}/api/attacker-read`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});

test("the attacker's read requires the token and rejects unexpected settings", async t => {
  const { base, token } = await start(t);
  const url = query => `${base}/api/attacker-read?${new URLSearchParams(query)}`;
  const headers = { "x-canary-token": token };
  const valid = { plan: "narrative-no-beacon", files: "clean", onTell: "abandon", linkIsTell: "0" };
  assert.equal((await fetch(url(valid))).status, 403);
  assert.equal((await fetch(url(valid), { headers: { "x-canary-token": "0".repeat(64) } })).status, 403);
  const clean = await (await fetch(url(valid), { headers })).json();
  assert.deepEqual(clean.coverage, { detected: 5, total: 5 });
  assert.equal(clean.plans.length, 3);
  const challenged = await (await fetch(url({ ...valid, files: "flawed", linkIsTell: "1" }), { headers })).json();
  assert.equal(challenged.scenarioId, "project-lantern-flawed-demo");
  assert.deepEqual(challenged.walks.filter(walk => walk.detected).map(walk => walk.profileId), ["office-render", "offline-viewer"]);
  for (const query of [
    { ...valid, plan: "missing" },
    { ...valid, files: "live" },
    { ...valid, onTell: "flee" },
    { ...valid, linkIsTell: "yes" },
    { ...valid, extra: "1" }
  ]) {
    assert.equal((await fetch(url(query), { headers })).status, 400, JSON.stringify(query));
  }
  assert.equal((await fetch(`${url(valid)}&plan=vendor-pattern`, { headers })).status, 400, "repeated key");
});

test("the benchmark results require the token and take no settings", async t => {
  const { base, token } = await start(t);
  const headers = { "x-canary-token": token };
  assert.equal((await fetch(`${base}/api/benchmark`)).status, 403);
  assert.equal((await fetch(`${base}/api/benchmark?kind=all`, { headers })).status, 400);
  const result = await (await fetch(`${base}/api/benchmark`, { headers })).json();
  assert.equal(result.cleanFalseAlarms, 0);
  assert.equal(result.cases.length, 42);
  assert.equal(result.cases.filter(item => item.caught).length, 32);
  assert.deepEqual(result.byKind.map(row => [row.kind, row.caught, row.planted]), [
    ["anchored-quote-typo", 7, 7], ["worksheet-cell-edit", 12, 12], ["impossible-deadline", 3, 3],
    ["prose-name-typo", 10, 10], ["prose-wrong-value", 0, 10]
  ]);
  assert.ok(result.cases.every(item => typeof item.description === "string" && !("scenario" in item)));
});

test("story results require the token, take no settings, and report an empty state plainly", async t => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "nc-server-runs-"));
  t.after(() => rmSync(runsDir, { recursive: true, force: true }));
  const { base, token } = await start(t, { runsDir });
  assert.equal((await fetch(`${base}/api/stories`)).status, 403);
  const headers = { "x-canary-token": token };
  assert.equal((await fetch(`${base}/api/stories?run=../..`, { headers })).status, 400);
  assert.deepEqual(await (await fetch(`${base}/api/stories`, { headers })).json(), { run: null, summary: null, stories: [], skipped: 0 });
});
