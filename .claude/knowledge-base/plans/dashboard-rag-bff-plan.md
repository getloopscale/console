---
slug: dashboard-rag-bff
milestone_id: M17
roadmap: ../../../theo-data/theo-rag/ROADMAP-edge-integration.md
created_at: 2026-07-02
goal: Add a read-only /v1/dashboard/rag/* BFF in theo-cloud (collections list + analytics summary) workspace-scoped via a least-privilege rag:read-only minted per-tenant key, mirroring the memory dashboard BFF, and align theo-rag /v1/analytics to rag:read (the theo-memory metrics precedent) — verified by a Go read-only route-set test + a cross-tenant read-isolation test + a vitest analytics-at-rag:read test.
---

# Plan: BFF dashboard read routes — M17 (edge-integration, 2 repos)

> **v1.0** (2026-07-02) — from blueprint `.claude/knowledge-base/discoveries/blueprints/dashboard-rag-bff-blueprint.md` (SHIPPABLE 100). Spans theo-cloud (Go, native) + theo-rag (TS, one-line scope alignment).

## Goal

Add a read-only `/v1/dashboard/rag/*` BFF in theo-cloud — `GET /collections` (list) + `GET /analytics`
(the M5 summary) — workspace-scoped via a **least-privilege rag:read-only** minted per-tenant key, mirroring
the memory dashboard BFF; and align theo-rag `GET /v1/analytics` from `requireRole('admin')` to
`requireScopeOnPrincipal('rag:read')` (the theo-memory metrics precedent) so the minted read key can reach it —
verified by a Go read-only route-set test (no mutating verb under `/v1/dashboard/rag`) + a cross-tenant
read-isolation test + a vitest analytics-at-`rag:read` test.

## Context

ROADMAP-edge-integration.md § M17 (deps M14 — theo-cloud rag broker; M11 — theo-rag per-verb scope). DISCOVER
(SHIPPABLE 100) surfaced: the DoD wants analytics via the minted per-tenant key, but `/v1/analytics` is
admin-role-gated and minted keys are member (M12 pin). theo-memory gates its dashboard metrics by `memory:read`
(`app.ts:368`), NOT admin. The user directive is "max security + 100% aligned with theo-memory", so analytics
aligns to `rag:read` and the dashboard mints a **read-only** key (stricter than the memory BFF). ADRs D1
(analytics→rag:read), D2 (rag data client), D3 (read-only BFF + least-privilege key) are locked by the blueprint.

## Baseline Context

### Files that will be touched

| Repo | File | Role |
|---|---|---|
| theo-rag | `packages/api/src/server/handlers/analytics.ts` | swap `requireRole('admin')` → `requireScopeOnPrincipal('rag:read')` + import + doc |
| theo-rag | `packages/api/src/server/handlers/analytics.test.ts` (or __tests__) | a rag:read Principal reaches analytics; admin endpoints unchanged |
| theo-cloud | `internal/rag/data_client.go` (NEW) | proxy `GET /v1/collections` + `GET /v1/analytics` with the per-tenant bearer |
| theo-cloud | `internal/rag/data_client_test.go` (NEW) | proxy-bearer + fail-closed |
| theo-cloud | `internal/routes/rag_dashboard.go` (NEW) | `ListCollections` + `Analytics` GET handlers |
| theo-cloud | `internal/routes/rag_dashboard_test.go` (NEW) | cross-tenant isolation + handler shape |
| theo-cloud | `cmd/main.go` | wire the rag data client + keyResolver (read-only mint) + mount `/v1/dashboard/rag` GET-only |
| theo-cloud | `cmd/main_test.go` | read-only route-set assertion (no mutating verb) |
| (both) | `CHANGELOG.md` | M17 entry |

### Reference (read-only) — verified

| Reference | path | Proves |
|---|---|---|
| memory dashboard BFF mount | theo-cloud `cmd/main.go:739-769` | the `/v1/dashboard/*` + requireJWT pattern |
| memory keyResolver | theo-cloud `cmd/main.go:321-328` | per-tenant key resolution from JWT tenant |
| themory.Client | theo-cloud `internal/themory/client.go:57-82,356,503,805` | the data-client + keyResolver shape (Rule 9) |
| MemoryHandler | theo-cloud `internal/routes/memory.go:94,220-262` | the BFF handler shape (auth.GetUser → client) |
| memory BFF test | theo-cloud `internal/routes/memory_test.go:22-39` | stub-client + auth.WithUser test pattern |
| rag broker | theo-cloud `internal/rag/broker.go:77,95` | `KeyForTenant` + `KeyForTenantScoped` (least privilege) |
| requireJWT | theo-cloud `cmd/main.go:188` | `auth.RequireJWT(jwtValidator, sessIssuer)` |
| theo-memory metrics gate | theo-memory `packages/api/src/server/app.ts:368` | metrics gated by `memory:read`, NOT admin (the D1 precedent) |
| theo-rag analytics | theo-rag `packages/api/src/server/handlers/analytics.ts:65` | the `requireRole('admin')` line to change |
| theo-rag collections | theo-rag `packages/api/src/server/handlers/collections.ts:166` | `GET /v1/collections` (rag:read), `{items,X-Total-Count}` |
| theo-rag auth middleware | theo-rag `packages/api/src/server/middleware/auth.ts:104` | `requireScopeOnPrincipal` (already exported) |

### Current callers / dependents

- **theo-cloud `ragBroker`** — built in `buildRagForwardAuth`, exposed at main() (M16 D2); already feeds the REST ForwardAuth handler + the MCP binding; M17 adds a THIRD consumer (the dashboard keyResolver) — one broker, one mint cache.
- **theo-rag `/v1/analytics`** — called by the analytics-consuming clients; changing the gate from admin→rag:read WIDENS access to any read key (all `rag:admin` keys already imply `rag:read`, so existing admin callers are unaffected). `/v1/members` + `/v1/api_keys` are UNCHANGED (stay admin).
- **theo-cloud `requireJWT`** — the dashboard route group reuses the existing middleware (browser session), same as the memory BFF.

### Domain glossary

- **BFF (Backend-For-Frontend)** — theo-cloud proxies the browser dashboard's read requests to theo-rag, minting a per-tenant key from the JWT session (Model B).
- **keyResolver** — a closure that resolves the per-tenant Bearer per request from the JWT-derived tenant (fail-closed when absent).
- **least-privilege mint** — `KeyForTenantScoped(…, ["rag:read"])` mints a read-only key so the dashboard can NEVER write/delete.
- **read-only route set** — the `/v1/dashboard/rag` group has GET routes only; a mutating verb is structurally absent (tested).

### Architecture boundaries affected

- Per `.claude/rules/architecture.md` (DIP + composition root): the dashboard handler depends on a `RagDataClient` INTERFACE (testable stub); the concrete client + keyResolver are wired at `main()`. Per **DRY** (Rule 12) the data client + handler + mount copy the memory shapes; per **KISS/YAGNI** (Rules 10/11) the data client has ONLY the 2 read methods the BFF needs, zero new deps. **MAX SECURITY**: the minted key is read-only (least privilege, stricter than the memory BFF's full-scope mint); the route set is GET-only; analytics stays workspace-scoped (`workspace_id==tenant_id`, no cross-tenant leak); the M12 "minted keys never admin" pin is intact (aligned with theo-memory's read-gated metrics).

## Prior Art & Related Work

- Internal blueprint `.claude/knowledge-base/discoveries/blueprints/dashboard-rag-bff-blueprint.md` (design source; 4 corners + D1–D3).
- Reference: theo-cloud's memory dashboard BFF (mount + keyResolver + themory.Client + MemoryHandler) — mirrored (Rule 9); theo-memory's `memory:read`-gated metrics (the D1 precedent); M14's rag broker (reused).

## ADRs

### D1 — align theo-rag `/v1/analytics` to `rag:read` (the theo-memory metrics precedent)
**Decision:** swap `requireRole('admin')` → `requireScopeOnPrincipal('rag:read')` on `GET /v1/analytics` only.
**Rationale:** theo-memory gates dashboard metrics by `memory:read` (`app.ts:368`), not admin — the directive is "100% aligned with theo-memory + max security". Analytics aggregates the caller's OWN workspace `query_events` (`workspace_id==tenant_id`) — a read. The minted key stays member (M12 pin intact) + is minted read-only; no cross-tenant leak.
**Alternatives:** keep admin-gate + drop analytics from the BFF (rejected — fails DoD + diverges from theo-memory); mint an admin key (rejected — breaks the M12 pin).

### D2 — rag data client in theo-cloud (mirror themory.Client)
**Decision:** add `internal/rag/data_client.go` with ONLY `ListCollections` + `Analytics`, keyResolver-driven.
**Rationale:** M14 omitted a rag data client (edge proxies the SDK surface); the dashboard BFF is a distinct browser-JWT Go data path theo-cloud proxies, so it needs one — mirrors `themory.Client` (Rule 9). Only 2 read methods (YAGNI — read-only BFF).
**Alternatives:** generic HTTP proxy (rejected — themory.Client is the established, tested shape).

### D3 — read-only BFF, least-privilege rag:read key
**Decision:** mount `/v1/dashboard/rag` under `requireJWT` with GET-only routes; mint a **rag:read-only** key.
**Rationale:** the DoD mandates read-only; minting read-only (`KeyForTenantScoped([rag:read])`) is stricter than the memory BFF (full scopes) → MAX security. The read-only route-set test makes a write path structurally impossible.
**Alternatives:** mint full scopes like memory (rejected — dashboard is read-only; least privilege wins).

## Dependencies

### New — to be introduced
| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | Go: reuse ragBroker + themory.Client shape + chi + net/http + auth.RequireJWT. TS: reuse requireScopeOnPrincipal (already imported). | Zero new dependency in either repo. |

### Existing — use as-is
| Package | Version | Ecosystem | Why |
|---|---|---|---|
| chi router | (existing) | go | the dashboard route group |
| ragBroker (internal/rag) | (existing, M14) | go | mints the per-tenant read-only key |

## Dependency Graph

```
Phase 1 (theo-rag: analytics → rag:read) ──┐ (TS; independent)
Phase 2 (theo-cloud: rag data client) ─────┤ (Go; independent of P1)
        ↓                                   │
Phase 3 (theo-cloud: dashboard handler + mount + keyResolver) ── needs P2
        ↓                                   │
Phase 4 (Integration Validation: go test + vitest + read-only route-set + cross-tenant) ── needs all
```

## Phase 1 — theo-rag: align /v1/analytics to rag:read

### T1.1 — Swap the analytics gate from admin-role to rag:read

#### Why this step
The dashboard's minted per-tenant key is member-role + rag:read (M12); analytics must be reachable by a read key for the BFF to surface it. Reasoning: theo-memory gates metrics by `memory:read` (`app.ts:368`) — aligning `/v1/analytics` to `rag:read` matches the reference AND is safe (workspace-scoped own-data read); `/v1/members` + `/v1/api_keys` stay admin (they ARE management surfaces).

#### Files to edit
- `packages/api/src/server/handlers/analytics.ts`; `packages/api/src/server/handlers/analytics.test.ts` (or the co-located test).

#### Deep file dependency analysis
`analytics.ts:14` import `requireRole` → `requireScopeOnPrincipal`; `analytics.ts:65` `requireRole('admin')` → `requireScopeOnPrincipal('rag:read')`; update the doc comment (lines 2-4) to state read-scope + the theo-memory precedent. `requireScopeOnPrincipal` is already exported from `../middleware/auth.js` (auth.ts:104).

#### TDD
- RED: `analytics` test — a Principal with `['rag:read']` (no admin role) gets `200` from `GET /v1/analytics` (currently 403 under admin-role); a Principal with NO credential gets 401; a `rag:read` Principal's aggregation is scoped to its workspace (the sink receives the caller's workspace_id).
- RED: a regression assert that `/v1/members` + `/v1/api_keys` STILL require admin (unchanged) — guards against over-broad edits.
- GREEN: the gate swap.

#### Concurrency tests
(none — single-threaded) — a request-scoped middleware swap.

#### Failure-scenarios chaos pass
`?since=<malformed>` still returns 422 (unchanged — the handler validation is untouched); no-credential → 401 (fail-closed, unchanged). Test: the malformed-since case stays 422.

#### Acceptance criteria
- `GET /v1/analytics` requires `rag:read` (not admin role); a rag:read key → 200; no credential → 401; `/v1/members` + `/v1/api_keys` UNCHANGED (still admin); `pnpm --filter @usetheo/rag-api test` + `tsc` + `eslint` green.

#### DoD
`pnpm --filter @usetheo/rag-api test -t analytics` green; typecheck + lint clean.

## Phase 2 — theo-cloud: rag data client

### T2.1 — DataClient proxying collections + analytics with the per-tenant bearer

#### Why this step
The dashboard BFF must proxy the browser's read to theo-rag with the minted per-tenant key; M14 omitted a rag data client (edge path), so the BFF needs one. Reasoning: mirror `themory.Client` (D2, Rule 9) with only the 2 read methods (YAGNI).

#### Files to edit
- `internal/rag/data_client.go` (NEW); `internal/rag/data_client_test.go` (NEW).

#### Deep file dependency analysis
`DataClient{baseURL, http, keyResolver}`; `NewDataClient(baseURL, hc)`; `WithKeyResolver(r)`; `ListCollections(ctx, limit, offset) (*CollectionsResult, error)` (GET `/v1/collections?limit&offset`, decode `{items:[{id,name,metadata,created_at}]}`); `Analytics(ctx, since) (*AnalyticsResult, error)` (GET `/v1/analytics?since`, decode `{window,totals,latency,confidence}`). Each: `bearer, err := c.keyResolver(ctx)`; on err → typed error, NO request (fail-closed); `req.Header.Set("Authorization","Bearer "+bearer)`; non-2xx → typed error (never leak the key).

#### TDD
- RED: `TestRagDataClient_ProxiesWithPerTenantBearer` — a `httptest.Server` captures the Authorization header; `ListCollections`/`Analytics` set `Bearer <resolved>`; the response decodes to the typed result.
- RED: `TestRagDataClient_KeyResolverError_FailsClosed` — keyResolver returns error → no upstream request, typed error.
- GREEN: implement.

#### Concurrency tests
(none — single-threaded) — a stateless HTTP client; the broker (mint cache) concurrency is covered in M14/M16.

#### Failure-scenarios chaos pass
theo-rag returns 5xx / connection reset → typed error (no key leak); keyResolver error → fail-closed. Test: a 500 upstream → error; a keyResolver error → no request.

#### Acceptance criteria
- `ListCollections`/`Analytics` proxy with the resolved per-tenant Bearer; keyResolver error fails closed; non-2xx → typed error; `go test ./internal/rag/...` + `go vet` green.

#### DoD
`go test ./internal/rag/ -run RagDataClient` green.

## Phase 3 — theo-cloud: dashboard handler + mount + keyResolver

### T3.1 — Read-only /v1/dashboard/rag BFF (least-privilege key)

#### Why this step
The BFF exposes the workspace's read surface (collections + analytics) to the browser session, minting a read-only per-tenant key. Reasoning: mirror the memory BFF mount (D3); mint `rag:read`-only (least privilege, MAX security); GET-only route set makes a write path impossible.

#### Files to edit
- `internal/routes/rag_dashboard.go` (NEW); `internal/routes/rag_dashboard_test.go` (NEW); `cmd/main.go`; `cmd/main_test.go`.

#### Deep file dependency analysis
`rag_dashboard.go`: `RagDataClient` interface (`ListCollections`, `Analytics` — DIP for testability); `RagDashboardHandler{client, logger}`; `NewRagDashboardHandler(client, logger)`; `ListCollections(w,r)` + `Analytics(w,r)` (extract `auth.GetUser(r.Context())` → 401 if nil; parse bounded query params; call client; encode JSON; empty-slice guard). `cmd/main.go`: `ragDashKeyResolver` (mints `KeyForTenantScoped(ctx, acc, tenant, ["rag:read"])`, fail-closed on no tenant); `ragDataClient := rag.NewDataClient(cfg.RagBaseURL, ragHTTP).WithKeyResolver(ragDashKeyResolver)`; `ragDashboardHandler = routes.NewRagDashboardHandler(ragDataClient, logger)` (wired only when `ragBroker != nil`); mount `r.Route("/v1/dashboard/rag", …)` under `requireJWT`, GET `/collections` + GET `/analytics` ONLY.

#### TDD
- RED: `TestRagDashboard_CrossTenantReadIsolation` — a stub client records the resolved key; tenant A's request (JWT tenant A) resolves A's key via the keyResolver (not B's); no JWT tenant → 401.
- RED: `TestRagDashboard_ListCollections_ProxiesUserTenant` / `_Analytics_` — `auth.WithUser(ctx, {TenantID})` → the handler calls the client + returns the JSON (mirror memory_test.go).
- RED: `TestRagDashboard_ReadOnlyRouteSet` (in cmd/main_test.go or a route-walk test) — walk the `/v1/dashboard/rag` chi routes; assert EVERY method is GET; NO POST/PUT/PATCH/DELETE.
- RED: `TestRagDashKeyResolver_MintsReadOnly` — the keyResolver calls `KeyForTenantScoped` with exactly `["rag:read"]` (least privilege), via a stub broker.
- GREEN: implement.

#### Concurrency tests
(none — single-threaded) — request-scoped handlers; broker concurrency covered upstream.

#### Failure-scenarios chaos pass
No JWT tenant → 401 (fail-closed); data client error → 502/typed error (no key leak). Test: nil-user → 401; client error → error response.

#### Acceptance criteria
- `/v1/dashboard/rag` has GET `/collections` + GET `/analytics` ONLY (no mutating verb); the keyResolver mints `rag:read`-only; cross-tenant isolation (A's request → A's key); no JWT → 401; wired only when ragBroker configured; `go build ./...` + `go vet` clean.

#### DoD
`go test ./internal/routes/ ./cmd/ -run 'RagDashboard|RagDashKeyResolver'` green; `go build ./...` OK.

## Phase 4 — Integration Validation

### T4.1 — All gates green (+ documented live dashboard caveat)

#### Why this step
Prove the 2-repo change: theo-cloud `go test`/`go vet` green (incl. read-only route-set + cross-tenant), theo-rag vitest+typecheck+lint green. Reasoning: the live dashboard render needs the browser + JWT session + the full stack → documented; the automated proof is the Go route-set + isolation tests + the theo-rag scope test.

#### Files to edit
- `theo-cloud/CHANGELOG.md`; `theo-rag/CHANGELOG.md`.

#### Failure-scenarios chaos pass
(covered by the per-phase fail-closed tests: keyResolver no-tenant → 401, data-client 5xx → typed error, malformed-since → 422.)

#### Concurrency tests
(none — single-threaded) — no new concurrency introduced.

#### Acceptance criteria
- theo-cloud `go test ./...` + `go vet` green; theo-rag `pnpm --filter @usetheo/rag-api test` + `tsc` + `eslint` green; the read-only route-set test passes; cross-tenant isolation test passes; 2 CHANGELOGs updated; live dashboard caveat documented (needs browser+JWT+stack); `/review` = READY_TO_MERGE.

#### DoD
All gates green; both CHANGELOGs have the M17 entry.

## Coverage Matrix

| DoD item (ROADMAP M17) | Task(s) |
|---|---|
| `/v1/dashboard/rag/*` read-only (`rag:read` only, no write path) | T3.1 (GET-only mount + read-only mint) |
| Go test: no mutating verb under `/v1/dashboard/rag`; cross-tenant read isolation | T3.1 (`ReadOnlyRouteSet` + `CrossTenantReadIsolation`) |
| collections list + M5 analytics summary via the minted per-tenant key | T1.1 (analytics→rag:read), T2.1 (data client), T3.1 (handlers) |
| theo-cloud CHANGELOG; /review READY_TO_MERGE | T4.1 (+ theo-rag CHANGELOG) |

**Coverage: 4/4 DoD items mapped (100%).**

## Failure scenarios

- **No JWT tenant on a dashboard request:** the keyResolver returns an error → the handler 401s (fail-closed, mirror memory). Test: nil-user request → 401.
- **theo-rag returns 5xx / connection reset to the data client:** typed error, no key leak, the handler surfaces a 502-class error. Test: stubbed 500 upstream → error.
- **Malformed `?since` on analytics:** theo-rag returns 422 (unchanged by the gate swap); the BFF surfaces it. Test: the theo-rag 422 case stays 422.
- **A write attempt under `/v1/dashboard/rag`:** structurally impossible — the route set is GET-only + the minted key is rag:read-only (double guard). Test: the route-set walk asserts no mutating verb.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| BFF exposing a write path (roadmap risk 1) | HIGH | GET-only route set + rag:read-only minted key (double guard) + `ReadOnlyRouteSet` test | paulohenriquevn |
| Analytics scope loosening leaks cross-tenant | HIGH | analytics aggregates the caller's OWN workspace only (`workspace_id==tenant_id`); minted key is workspace-scoped; `CrossTenantReadIsolation` test | paulohenriquevn |
| Over-broad edit moves `/v1/members` / `/v1/api_keys` off admin | MEDIUM | D1 changes ONLY `/v1/analytics`; a regression test asserts members/api_keys stay admin | paulohenriquevn |
| Live dashboard proof not provable without the browser+stack | LOW | Documented; the Go route-set + isolation tests + the theo-rag scope test are the automated proof | paulohenriquevn |

## Unresolved Questions

(none — every decision is resolved at plan time: analytics→rag:read (D1, the theo-memory precedent), rag data
client (D2), read-only BFF + least-privilege key (D3) are locked by the blueprint. The live dashboard render is
a browser concern proven by the team's manual QA, not an open question.)

## Global Definition of Done

Per `.claude/rules/architecture.md` (DIP + composition root — the handler depends on a `RagDataClient`
interface, wired at main()), `.claude/rules/testing.md` (TDD RED→GREEN per task; read-only route-set +
cross-tenant isolation are the security tests), and `.claude/rules/git-safety.md` (develop-only): all 4
Coverage-Matrix items delivered; theo-cloud `go test`+`go vet` green (the **lint/quality gate**); theo-rag
`pnpm test`+`tsc`+`eslint` green; 2 CHANGELOGs updated; live dashboard caveat documented; `/review` =
READY_TO_MERGE. **File-size budget:** every new file (`data_client.go` ~90 LoC mirror, `rag_dashboard.go`
~70 LoC) stays well under the 500-LoC budget (`.claude/rules/architecture.md`); no split needed (KISS).

## Final Phase: Integration Validation

T4.1 is the integration gate — the milestone is NOT complete until theo-cloud's `go test`/`go vet`, theo-rag's
vitest+typecheck+lint, the read-only route-set test, and the cross-tenant isolation test are all green. A
mutating verb under `/v1/dashboard/rag` or a cross-tenant leak is a blocker, not a caveat.
