# Blueprint: RAG dashboard UI (M21) — copy the theo-memory dashboard section

**Slug:** `rag-dashboard-ui` · **Milestone:** M21 (ROADMAP-edge-integration, theo-rag) · **Repos:** theo-cloud (dashboard + BFF) · **Created:** 2026-07-02

## Context

M10–M20 integrated theo-rag at the data-plane + edge + BFF-backend (read-only) + MCP level. There is
**no user-facing RAG UI** (`dashboard/src/pages/rag/` does not exist; 0 rag API call-sites in the
frontend). `memory` has a complete 8-page dashboard. M21 builds the RAG UI (collections, documents,
ask, analytics) by **copying the theo-memory dashboard section exactly** (Unbreakable Rule 9) and
lifting the M17 read-only BFF to read+write.

## Key discovery — most of the backend plumbing already exists

- **The rag broker already grants `rag:read`+`rag:write`+`rag:delete`** (`cmd/main.go:63-64` — `rag.NewBroker(..., []string{"rag:read","rag:write","rag:delete"})`). The EDGE ForwardAuth uses all three.
- **The dashboard key resolver deliberately narrows to read-only** (`cmd/main.go:89` — `newRagDashboardKeyResolver` → `KeyForTenantScoped(..., []string{"rag:read"})`). This is the M17 least-privilege choice. **M21 changes this one call to `["rag:read","rag:write","rag:delete"]`** (mirroring memory).
- The rag broker (`internal/rag/broker.go`) is already a faithful copy of `internal/themory/broker.go` (`MintKey`, `NewBroker`, `KeyForTenant`, `KeyForTenantScoped`). No broker rewrite needed.

## Coverage Corner 1 — Integration Tests (the proof to copy)

- **Go BFF route tests:** `internal/routes/memory_test.go` — per-tenant write proxied with the minted key; fail-closed on missing JWT. Mirror for rag write routes.
- **The read-only invariant test MUST be updated:** `cmd/main_test.go:66 TestRagDashboard_ReadOnlyRouteSet` asserts NO mutating verb under `/v1/dashboard/rag` (a POST/DELETE fails the build). M21 intentionally lifts this → rewrite it to assert the NEW read+write route set + still assert the SDK surface (`/v1/rag/*`) stays distinct. Also `cmd/main_test.go:108 TestNewRagDashboardKeyResolver_MintsReadOnlyFromJWTTenant` → update to assert read+write+delete scopes.
- **Frontend e2e (Playwright):** `dashboard/e2e/*.spec.ts` (journeys.spec.ts pattern) + `playwright.config.ts`. A rag dashboard e2e drives create-collection → upload-doc → ask → sees cited answer.
- **6-invariant edge proof:** extend the M18 hermetic e2e (`tests/e2e/edge_rag_forward_auth_e2e_test.go`) OR add a dashboard-BFF e2e asserting a tenant-A session cannot write/read tenant-B data.

## Coverage Corner 2 — Dependencies

**Zero new runtime deps** (roadmap constraint). Frontend reuses `@tanstack/react-query` (`useQuery`/`useMutation`), the shared `cloudFetch` (`dashboard/src/lib/api.ts:178`, injects the browser JWT), and existing primitives (`components/data/virtual-table.tsx`, `ConfirmDialog`, forms). Backend reuses chi + the existing rag broker + data_client. Document upload is multipart/text → reuse theo-rag's `POST /v1/documents/raw` (no new upload lib for text; file upload mirrors any existing dashboard upload primitive if present, else a plain `<input type=file>` → text).

## Coverage Corner 3 — Tools

- Frontend: `vitest` (test), `eslint` (lint), `tsc -b && vite build` (build), `playwright` (e2e) — `dashboard/package.json`.
- Backend: `go test` + `go vet`. The route-set invariant test is the drift-guard.

## Coverage Corner 4 — Techniques (the exact copy map)

### Frontend (dashboard/src/pages/rag/ — NEW, mirror pages/memory/)

| rag page (NEW) | copies memory page | shape |
|---|---|---|
| `collections.tsx` (create/list/delete) | `entities.tsx` (list + `useMutation` cascade-delete + `ConfirmDialog`) + a create form | `useQuery` list + `useMutation` create/delete + ConfirmDialog on delete |
| `documents.tsx` (upload/list/status/delete) | `memories.tsx` (list + write) + async status | `useQuery` list (poll for ingest status) + `useMutation` upload/delete |
| `ask.tsx` (query → cited answer) | `playground.tsx` (query → scored results via POST) | `useMutation` ask → render answer + cited sources |
| `analytics.tsx` (usage/cost/latency) | `graph.tsx`/metrics (read-only `useQuery`) | `useQuery` the M5 summary (BFF `GET /analytics`, already exists) |

- **Router:** `app.tsx` — add `lazy()` imports + `<Route path="/rag/*">` entries, mirroring the `/memory/*` block (`app.tsx:73-98, 253-...`).
- **Nav:** `app-sidebar.tsx` — add a `RAG` root entry (`drillsInto: 'rag'`, mirror line 113) + a `rag` drill-down submenu (mirror the `memory:` submenu at line 190) with Collections/Documents/Ask/Analytics.
- **API:** all pages call `cloudFetch('/v1/dashboard/rag/...', { method })` (JWT-injected).

### Backend (theo-cloud — extend M17)

| Change | file | copies |
|---|---|---|
| Dashboard resolver mints read+write+delete | `cmd/main.go:89` (`newRagDashboardKeyResolver`) | memory's dashboard broker scoping |
| data_client write methods (CreateCollection POST, DeleteCollection DELETE, IngestDocument POST, DeleteDocument DELETE, Ask POST /v1/answers) + a `do(method,...)` helper | `internal/rag/data_client.go` | `internal/themory/client.go:434-493` (`do(ctx, http.MethodPost, ...)`) |
| Handler write methods | `internal/routes/rag_dashboard.go` | `internal/routes/memory_*.go` (Remember/Forget handlers) |
| Mount write routes (POST /collections, DELETE /collections/{id}, POST /documents, DELETE /documents/{id}, POST /answers) | `cmd/main.go mountRagDashboard` (~:93) | memory mount (`cmd/main.go:784` — Get+Post+Delete) |
| Update the read-only invariant test → read+write | `cmd/main_test.go:66, 108` | — (intentional lift) |

## Cross-cutting Comparison (memory ✓ / rag today / rag M21)

| Dimension | memory (reference) | rag today (M17) | rag M21 |
|---|---|---|---|
| Frontend pages | 8 (`pages/memory/`) | 0 | 4 (`pages/rag/`) |
| BFF verbs | read+write (GET/POST/DELETE) | GET only | read+write |
| Dashboard minted scope | read+write | `rag:read` only | read+write+delete |
| broker | `themory/broker.go` | `rag/broker.go` (exists, grants r/w/d) | reuse |
| data_client | write (`client.go do()`) | read-only (`data_client.go getJSON`) | + write methods |
| e2e | Playwright + Go route tests | M18 edge e2e | + dashboard e2e + updated route tests |

## ADRs

### D1 — copy theo-memory's dashboard section verbatim (Rule 9)
**Decision:** every rag page/route/test copies its memory counterpart's shape; no new patterns.
**Rationale:** memory's dashboard is the validated reference; divergence is risk. **Alternatives:** design a fresh RAG UX (rejected — reinvention, Rule 9).

### D2 — lift the M17 read-only BFF to read+write for the dashboard session
**Decision:** the dashboard key resolver mints `rag:read`+`rag:write`+`rag:delete`; the GET-only invariant test is replaced by a read+write route-set assertion.
**Rationale:** the user requires full management from the UI (identical to memory, which mints read+write). The 6 invariants still gate every write at theo-rag (per-verb scope, Principal-resolved, fail-closed, workspace-isolated). **Alternatives:** keep read-only + writes only via SDK (rejected — contradicts the milestone); step-up re-auth on destructive (rejected — diverges from memory, D1).

## Recommendations (phase order for /to-plan)

1. **Phase 1 (backend):** data_client write methods + handlers + mount write routes + resolver read/write/delete + update the invariant tests. Smallest, unblocks the frontend.
2. **Phase 2 (frontend scaffold):** the `rag` router block + sidebar section + a shared api hook, + the Analytics page (read-only, reuses the existing GET).
3. **Phase 3:** Collections page (create/list/delete).
4. **Phase 4:** Documents page (upload/list/status/delete).
5. **Phase 5:** Ask/Playground page (query → cited answer).
6. **Phase 6:** e2e (Playwright happy path) + the 6-invariant edge/BFF isolation proof + CHANGELOG + review.

### Blocked questions

None — every surface is grounded in the memory dashboard + the existing rag broker/BFF. Honest caveat: this milestone is large (memory's equivalent was a multi-plan roadmap); the plan decomposes it into 6 phases, each independently reviewable.
