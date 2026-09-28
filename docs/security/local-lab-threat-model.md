# Threat model

Status: developer review, 2026-09-28. Not a penetration test. Scope: the local server, the attack board, the attacker model, and the consistency lint. The earlier study lab (event ledger, blinded assignment) was removed from the tree on 2026-09-28 and remains in git history.

## What needs protection

| Asset | Required property |
| --- | --- |
| The host | Nothing binds beyond loopback; no fixture content can navigate or fetch off the machine. |
| The analysis API | Only the person who started the server can read results. |
| The board page | Fixture text can never execute as code in the browser. |
| Conclusions | Modeled outcomes are never presented as observed attacker behavior. |

## Controls

1. **Loopback only.** The server wrapper throws on any host other than `127.0.0.1`; the startup port variable is validated (0 or 1024–65535).
2. **Token.** A random 256-bit token is required in the `x-canary-token` header and compared in constant time. It is printed once as a `#fragment` link. Fragments are not sent in HTTP requests, and the page clears it from the address bar after reading it. It is held in page memory only.
3. **Strict inputs.** `/api/attacker-read` accepts exactly four known query keys, rejects repeats and extras, and only *selects* among fixed fictional fixtures. It never accepts content. Only GET is allowed.
4. **Safe rendering.** A restrictive CSP (`default-src 'none'`, same-origin scripts and styles only), `nosniff`, `no-referrer`, and `textContent`-only DOM writes; tests assert the page script contains no `innerHTML`. Source links are rendered only for `https:` URLs from server-side constants.
5. **Fixture validation.** `validateScenario` rejects unknown fields, dangling links, unknown facts, and any URL-like value in text. Render tripwires must sit in a file format that can auto-fetch.
6. **Errors.** Clients get fixed messages; no stack traces or request data are echoed.

## Known limits

| Risk | Current state |
| --- | --- |
| Another local process reads the printed token from the terminal | Out of scope; anyone with the user's session can already read the fixtures. |
| Results read as evidence about real attackers or vendors | Every output lists its assumptions beside the numbers; toggles show how conclusions move. |
| A fixture contains a real secret in free text | Not detected; fixtures must stay invented. |
| A checked quote passes while nearby prose contradicts it | Lint verifies declared anchors only; unchecked references are listed, not counted as clean. |

The upcoming real-canary work adds a local collector that receives requests from real documents. It will get its own entry here before it merges.
