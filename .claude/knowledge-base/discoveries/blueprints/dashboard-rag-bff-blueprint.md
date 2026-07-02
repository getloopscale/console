# Blueprint: BFF dashboard read routes — M17 (edge-integration)

**Slug:** `dashboard-rag-bff` · **Owner:** paulohenriquevn · **Created:** 2026-07-02 · **Repos:** theo-cloud (native) + theo-rag

## Context

M17 (deps M14 — the theo-cloud rag broker; M11 — theo-rag per-verb scope) adds a **read-only**
`/v1/dashboard/rag/*` BFF in theo-cloud, workspace-scoped via a minted per-tenant key, mirroring the memory
dashboard BFF (`cmd/main.go:739`). DISCOVER surfaced a scope-alignment fact: the DoD wants the BFF to surface
the "M5 analytics summary" via the minted per-tenant key, but theo-rag gates `/v1/analytics` with
`requireRole('admin')` (`analytics.ts:65`) while the gateway mints role=**member** keys (M12 pin: minted keys
can NEVER be admin). **theo-memory's equivalent metrics endpoint is gated by `memory:read`, NOT admin**
(`theo-memory app.ts:368` — `app.get('/v1/scopes/:type/:id/metrics', requireScopeOnPrincipal('memory:read'), …)`).
So "100% aligned with theo-memory + max security" = align `/v1/analytics` to `rag:read` (a read scope) and mint
a **least-privilege rag:read-only** dashboard key.

## Objective

Give M17's `/to-plan` a citation-backed design for: (a) aligning theo-rag `/v1/analytics` to `rag:read` (the
theo-memory metrics precedent) so a minted per-tenant read key can reach it while staying workspace-scoped;
(b) a theo-cloud rag **data client** (proxy to theo-rag `GET /v1/collections` + `GET /v1/analytics` with the
per-tenant bearer) mirroring `internal/themory/client.go`; (c) a read-only `/v1/dashboard/rag/*` BFF under
`requireJWT` minting a **rag:read-only** per-tenant key (least privilege); (d) the read-only route-set +
cross-tenant isolation Go tests.

## Coverage Corner 1 — Integration Tests

- **theo-rag (vitest):** `analytics` — a `rag:read` Principal now reaches `GET /v1/analytics` (was 403 under
  admin-role); the aggregation stays scoped to the caller's workspace (`workspace_id==tenant_id`); a
  no-credential request still 401s; the existing admin-only endpoints (`/v1/members`, `/v1/api_keys`) are
  UNCHANGED (only analytics moves to read scope).
- **theo-cloud (Go):**
  - `TestRagDashboard_ReadOnlyRouteSet` — every route mounted under `/v1/dashboard/rag` is a GET; there is NO
    POST/PUT/PATCH/DELETE (the roadmap risk-1 guard: a write path must be impossible). Asserts the chi route
    walk yields only `GET`.
  - `TestRagDashboard_CrossTenantReadIsolation` — the handler resolves the per-tenant key from the JWT tenant
    via `ragBroker.KeyForTenantScoped(ctx, accountID, tenantID, ["rag:read"])`; tenant A's request mints A's
    key (not B's). No JWT tenant → 401 (fail-closed). Mirrors the memory `keyResolver` fail-closed.
  - `TestRagDataClient_ProxiesWithPerTenantBearer` — `ListCollections` / `Analytics` set the resolved
    per-tenant Bearer on the outbound request to theo-rag (httptest asserts the header); a keyResolver error →
    no request, typed error (fail-closed).
  - `TestRagDataClient_MintsReadOnlyKey` — the dashboard keyResolver mints a **rag:read-only** key
    (`KeyForTenantScoped(…, ["rag:read"])`), not the full read/write/delete set (least privilege).

## Coverage Corner 2 — Dependencies

**Zero new Go modules; zero new npm deps.** theo-cloud reuses the existing `ragBroker` (M14, exposed in M16),
`internal/themory/client.go` as the shape to mirror, chi router, and `auth.RequireJWT`/`auth.GetUser`. theo-rag
reuses `requireScopeOnPrincipal` (already imported in the auth middleware) — the change swaps `requireRole` for
it on one route. `/deps-audit` seed: no NEW dep.

## Coverage Corner 3 — Tools

**No new tooling.** `go test` (theo-cloud) + `pnpm --filter @usetheo/rag-api test` + `tsc`/`eslint` (theo-rag).
The dashboard BFF is an in-process chi route group; the data client is a stdlib `net/http` proxy (mirror
themory.Client). Live dashboard proof needs the browser + JWT session + the full stack; the automated proof is
the Go route-set + isolation tests here (M18 is the hermetic edge e2e for the SDK/MCP surfaces).

## Coverage Corner 4 — Techniques

**(a) theo-rag — align `/v1/analytics` to `rag:read` (ADR D1).** One-line gate swap + import + doc:
```ts
// packages/api/src/server/handlers/analytics.ts
// BEFORE: import { getPrincipal, requireRole } from '../middleware/auth.js';
//         app.get('/v1/analytics', requireRole('admin'), async (c) => { … });
// AFTER:  import { getPrincipal, requireScopeOnPrincipal } from '../middleware/auth.js';
//         app.get('/v1/analytics', requireScopeOnPrincipal('rag:read'), async (c) => { … });
// Rationale: analytics aggregates the CALLER's OWN workspace query_events (workspace_id==tenant_id) — a read.
// Mirrors theo-memory's metrics gate (memory:read). /v1/members + /v1/api_keys STAY requireRole('admin').
```

**(b) theo-cloud — rag data client (mirror themory.Client, ADR D2).** M14 omitted a rag data client
("the edge proxies"); the dashboard BFF is a NEW Go data path (browser JWT → theo-cloud → theo-rag), so it
needs one — but ONLY the 2 read methods:
```go
// internal/rag/data_client.go (NEW) — mirror internal/themory/client.go
type DataClient struct { baseURL string; http *http.Client; keyResolver func(ctx context.Context) (string, error) }
func NewDataClient(baseURL string, hc *http.Client) *DataClient { … }
func (c *DataClient) WithKeyResolver(r func(context.Context) (string, error)) *DataClient { c.keyResolver = r; return c }
// GET /v1/collections?limit&offset  → {items:[{id,name,metadata,created_at}], + X-Total-Count header}
func (c *DataClient) ListCollections(ctx context.Context, limit, offset int) (*CollectionsResult, error) { … }
// GET /v1/analytics?since  → {window, totals, latency, confidence}
func (c *DataClient) Analytics(ctx context.Context, since string) (*AnalyticsResult, error) { … }
// each: bearer, err := c.keyResolver(ctx); if err→fail-closed; req.Header.Set("Authorization","Bearer "+bearer)
```

**(c) theo-cloud — read-only BFF mount (mirror memory BFF, ADR D3).** GET-only route set + least-privilege key:
```go
// cmd/main.go — dashboard keyResolver mints a rag:READ-ONLY per-tenant key (least privilege, MAX security).
ragDashKeyResolver := func(ctx context.Context) (string, error) {
    u := auth.GetUser(ctx)
    if u == nil || u.TenantID == "" { return "", fmt.Errorf("rag dashboard: no authenticated tenant in context") }
    return ragBroker.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"rag:read"}) // read-only
}
// wired only when ragBroker != nil:
ragDataClient := rag.NewDataClient(cfg.RagBaseURL, ragHTTP).WithKeyResolver(ragDashKeyResolver)
ragDashboardHandler = routes.NewRagDashboardHandler(ragDataClient, logger)
// mount (GET ONLY — no mutating verb):
r.Route("/v1/dashboard/rag", func(r chi.Router) {
    r.Use(requireJWT)
    r.Get("/collections", ragDashboardHandler.ListCollections)
    r.Get("/analytics",   ragDashboardHandler.Analytics)
})
```

**(d) theo-cloud — dashboard handler (mirror MemoryHandler, ADR D3).**
```go
// internal/routes/rag_dashboard.go (NEW)
type RagDashboardHandler struct { client RagDataClient; logger *slog.Logger }  // RagDataClient interface (DIP, testable)
func (h *RagDashboardHandler) ListCollections(w http.ResponseWriter, r *http.Request) { /* auth.GetUser → client.ListCollections → JSON */ }
func (h *RagDashboardHandler) Analytics(w http.ResponseWriter, r *http.Request) { /* auth.GetUser → client.Analytics → JSON */ }
```

## Cross-cutting Comparison

| Dimension | memory dashboard BFF (reference) | rag dashboard BFF (M17) |
|---|---|---|
| mount | `/v1/dashboard/memory` under `requireJWT` | `/v1/dashboard/rag` under `requireJWT` |
| route set | read + write (List/Metrics + Remember/Forget/…) | **read-only** (ListCollections + Analytics — GET only) |
| minted key scopes | full (`memory:read/write/delete`) | **`rag:read` only** (least privilege — stronger) |
| data client | `themory.Client` + keyResolver | NEW `rag.DataClient` + keyResolver (2 read methods) |
| metrics/analytics gate | `memory:read` (theo-memory app.ts:368) | align `/v1/analytics` → `rag:read` (was admin) |
| tenant scoping | keyResolver → `KeyForTenant(acc,tenant)` | keyResolver → `KeyForTenantScoped(acc,tenant,[rag:read])` |
| new deps | — | none |

## ADRs

### D1 — align theo-rag `/v1/analytics` to `rag:read` (the theo-memory metrics precedent)
**Decision:** swap `requireRole('admin')` → `requireScopeOnPrincipal('rag:read')` on `GET /v1/analytics` only.
**Rationale:** theo-memory gates its dashboard metrics by `memory:read` (`app.ts:368`), NOT admin — the user's
directive is "100% aligned with theo-memory + max security". Analytics aggregates the CALLER's OWN workspace
`query_events` (`workspace_id==tenant_id`); a workspace-scoped read key reading its own aggregate metrics is a
read, not a management op. MAX security preserved: the minted key stays member (M12 pin intact) and is minted
**read-only** for the dashboard; no cross-tenant leak (the sink queries only the caller's workspace).
**Alternatives:** keep admin-gate + drop analytics from the BFF (rejected — fails the DoD + diverges from
theo-memory); mint an admin key for the dashboard (rejected — breaks the M12 "minted keys never admin" pin).

### D2 — rag data client in theo-cloud (mirror themory.Client; M14 omitted it for the edge path)
**Decision:** add `internal/rag/data_client.go` with ONLY `ListCollections` + `Analytics`, keyResolver-driven.
**Rationale:** M14 omitted a rag data client because the EDGE proxies the SDK REST surface; the dashboard BFF is
a distinct browser-JWT Go data path that theo-cloud proxies, so it needs a client — mirrors `themory.Client`
(Rule 9). Only 2 read methods (YAGNI — the BFF is read-only).
**Alternatives:** reuse a generic HTTP proxy (rejected — themory.Client is the established, tested shape).

### D3 — read-only BFF, least-privilege rag:read key (mirror memory BFF mount)
**Decision:** mount `/v1/dashboard/rag` under `requireJWT` with GET-only routes; mint a **rag:read-only** key.
**Rationale:** the DoD mandates read-only (no write path); minting read-only (`KeyForTenantScoped([rag:read])`)
is stricter than the memory BFF (full scopes) → MAX security. The read-only route-set test makes a write path
structurally impossible.
**Alternatives:** mint full scopes like memory (rejected — the dashboard is read-only; least privilege wins).

## Recommendations

1. **theo-rag** — swap the analytics gate to `rag:read` + update the doc comment; vitest proves a read key reaches it. (Corner 4a, D1)
2. **theo-cloud** — add `internal/rag/data_client.go` (ListCollections + Analytics). (Corner 4b, D2)
3. **theo-cloud** — add `internal/routes/rag_dashboard.go` + mount `/v1/dashboard/rag` GET-only under requireJWT, minting a rag:read-only key. (Corner 4c/4d, D3)
4. **Tests** — read-only route-set + cross-tenant isolation + proxy-bearer + read-only-mint (Go); analytics-at-rag:read (vitest). (Corner 1)
5. **CHANGELOG** — theo-cloud + theo-rag entries; note the live dashboard proof needs the browser+stack.

### Blocked questions

None — every surface is grounded in file:line (theo-cloud memory BFF mount + themory.Client + rag broker;
theo-rag analytics + collections routes + auth middleware; theo-memory metrics gate). Honest caveat: the live
dashboard render needs the browser + JWT session + the full stack; the automated proof is the Go route-set +
isolation tests + the theo-rag scope test.
