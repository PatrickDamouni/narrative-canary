import assert from "node:assert/strict";
import test from "node:test";

import { createCanaryServer } from "../src/server.ts";

async function start(t) {
  const { server, token } = createCanaryServer();
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
