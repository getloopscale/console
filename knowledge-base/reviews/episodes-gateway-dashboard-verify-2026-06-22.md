# Live verification — episodes-gateway-dashboard

**Date:** 2026-06-22 · gateway rebuilt to dev/bin + recreated; dashboard vite hot.

| Check | Result |
|---|---|
| SDK `GET /v1/memory/episodes?scope=user` (no auth) | **401** (route mounted, memory:read required — identical to entities/graph) |
| SDK `GET /v1/memory/nope` (calibration) | 404 (per-route group; proves 401 above is the real route, not blanket) |
| BFF `GET /v1/dashboard/memory/episodes` (no JWT) | 401 (route mounted; BFF group JWT-gated) |
| Dashboard SPA `/memory/episodes` | 200 (new Episodes tab route resolves) |
| Provider `GET /v1/scopes/user/.../episodes` (themory :18081 — gateway upstream) | 200 (live) |
| Go: contract_test (client maps items+nextCursor, forwards after/limit/order/asOf/q, scope!=user→empty) | PASS |
| Go: dashboard_memory_test (BFF mint+delegate + security-gate row) + memory_handlers_test (unauth/invalid-scope/invalid-limit/happy-forwards-opts) | PASS |
| Dashboard tsc --noEmit | 0 errors |
| Dashboard vite build | OK |

## Honest gap
A full authed end-to-end via a real API key was not run here: dev `theo_api_keys` store hashes keys (only prefixes readable), and the chrome-devtools MCP browser disconnected mid-session, so the JWT browser drive could not be repeated. The BFF mint+delegate+auth chain is the SAME one the M2 Theo-Cloud live-test exercised as a real user (register→remember→recall, 0 console errors); Episodes reuses it byte-for-byte (shared MemoryHandler). Routing + mapping + auth-gating are verified at every layer; the only unrun step is a browser click-through of the new tab.

## Note
The running gateway binary must be built to `dev/bin/theo-cloud` (the compose build context is `./dev`); a normal `make dev-up`/`make dev-restart` (or CI) bakes it correctly.
