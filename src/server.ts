import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { plantFlaws, scoreLint } from "./benchmark.ts";
import { acquisitionScenario } from "./fixtures/acquisition.ts";
import { flawedScenario } from "./fixtures/flawed.ts";
import { tripwirePlans } from "./fixtures/tripwire-plans.ts";
import { lintScenario } from "./lint.ts";
import { attackerRead } from "./tradecraft.ts";

const asset = (file: string, type: string) => ({ type, body: readFileSync(new URL(`./ui/${file}`, import.meta.url)) });
const uiAssets = {
  "/": asset("attacker.html", "text/html; charset=utf-8"),
  "/attacker.css": asset("attacker.css", "text/css; charset=utf-8"),
  "/attacker.js": asset("attacker.js", "text/javascript; charset=utf-8")
} as const;

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const LOOPBACK = "127.0.0.1";

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(data));
}

function fixedTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fixed fictional fixtures only: the query selects among them and never supplies content. */
function attackerReadFromQuery(query: URLSearchParams): unknown {
  const keys = [...query.keys()];
  const plan = tripwirePlans.find(item => item.id === query.get("plan"));
  const files = query.get("files");
  const onTell = query.get("onTell");
  const linkIsTell = query.get("linkIsTell");
  if (keys.length !== 4 || new Set(keys).size !== 4 || !plan || (files !== "clean" && files !== "flawed") ||
      (onTell !== "abandon" && onTell !== "stop-path") || (linkIsTell !== "0" && linkIsTell !== "1")) {
    throw new HttpError(400, "Choose a known plan, clean or flawed files, a tell response, and whether the portal link is a tell.");
  }
  const challenged = linkIsTell === "1"
    ? { ...plan, tripwires: plan.tripwires.map(item => item.trigger === "visit" ? { ...item, exposedTo: "document-package" as const } : item) }
    : plan;
  return {
    ...attackerRead(files === "flawed" ? flawedScenario : acquisitionScenario, challenged, undefined, { onTell }),
    plans: tripwirePlans.map(({ id, label, armId }) => ({ id, label, armId }))
  };
}

/** Deterministic, so it is computed once. Cases are summarized; the planted scenarios stay server-side. */
function benchmarkSummary(): unknown {
  const cases = plantFlaws(acquisitionScenario);
  const score = scoreLint(acquisitionScenario, cases, lintScenario);
  const missed = new Set(score.byKind.flatMap(row => row.missed));
  return {
    cleanFalseAlarms: score.cleanFalseAlarms,
    byKind: score.byKind.map(({ kind, planted, caught, strayFindings }) => ({ kind, planted, caught, strayFindings })),
    cases: cases.map(({ id, kind, description }) => ({ id, kind, description, caught: !missed.has(id) }))
  };
}

export interface LoopbackServer {
  listen(port: number, host: string, callback: (error?: Error) => void): void;
  close(callback: (error?: Error) => void): void;
  address(): ReturnType<Server["address"]>;
}

export function createCanaryServer(): { server: LoopbackServer; token: string } {
  const token = randomBytes(32).toString("hex");
  const benchmark = benchmarkSummary();

  function requireToken(request: IncomingMessage): void {
    const supplied = request.headers["x-canary-token"];
    if (typeof supplied !== "string" || !fixedTimeEqual(supplied, token)) throw new HttpError(403, "A valid local token is required.");
  }

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${LOOPBACK}`);
      if (request.method !== "GET") throw new HttpError(405, "Only GET is supported.");
      if (url.pathname in uiAssets) {
        const { type, body } = uiAssets[url.pathname as keyof typeof uiAssets];
        response.writeHead(200, { "content-type": type, "content-security-policy": CSP, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        response.end(body);
        return;
      }
      if (url.pathname === "/api/attacker-read") {
        requireToken(request);
        json(response, 200, attackerReadFromQuery(url.searchParams));
        return;
      }
      if (url.pathname === "/api/benchmark") {
        requireToken(request);
        if ([...url.searchParams.keys()].length > 0) throw new HttpError(400, "The benchmark takes no settings.");
        json(response, 200, benchmark);
        return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else json(response, 500, { error: "Internal error." });
    }
  });

  return {
    server: {
      listen(port, host, callback) {
        if (host !== LOOPBACK) throw new Error("Narrative Canary must bind to IPv4 loopback only.");
        server.once("error", callback);
        server.listen(port, LOOPBACK, () => {
          server.off("error", callback);
          callback();
        });
      },
      close(callback) { server.close(callback); },
      address() { return server.address(); }
    },
    token
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requested = process.env.NARRATIVE_CANARY_PORT ?? "0";
  if (!/^\d{1,5}$/.test(requested) || (Number(requested) !== 0 && (Number(requested) < 1024 || Number(requested) > 65535))) {
    throw new Error("NARRATIVE_CANARY_PORT must be 0 or a port from 1024 to 65535.");
  }
  const { server, token } = createCanaryServer();
  server.listen(Number(requested), LOOPBACK, error => {
    if (error) throw error;
    const address = server.address();
    if (address && typeof address !== "string") {
      // The fragment is never sent to the server; the page reads it and removes it from the address bar.
      process.stdout.write(`Narrative Canary: http://${LOOPBACK}:${address.port}/#token=${token}\n`);
    }
  });
}
