---
slug: rag-dashboard-ui
milestone_id: M21
created_at: 2026-07-02
goal: Ship the RAG management dashboard UI (collections/documents/ask/analytics) in theo-cloud by copying the theo-memory dashboard section, lifting the M17 read-only BFF to read+write, proven by Go route tests + a Playwright happy-path e2e.
---

# Plan — M21: Full RAG management dashboard UI

## Goal

Deliver a user-facing RAG dashboard in theo-cloud — a human creates/lists/deletes collections,
uploads/lists/deletes documents (with async ingest status), asks (query → cited answer), and views
analytics — mirroring the theo-memory dashboard section exactly, with the BFF lifted from M17
read-only to read+write+delete per-tenant. Success metric: the Playwright e2e drives
create-collection → upload-doc → ask → sees a cited answer, and the Go BFF route tests prove
per-tenant write is proxied with the minted key and fail-closed on missing JWT.

## Context

Per the rag-dashboard-ui discovery blueprint (SHIPPABLE): most backend plumbing exists — the rag broker
already grants `rag:read`+`rag:write`+`rag:delete` (`cmd/main.go:63`); only the DASHBOARD key
resolver narrows to read-only (`cmd/main.go:89`, M17 choice). The frontend has ZERO rag pages. This
plan copies memory's dashboard (Rule 9) and lifts the read-only BFF.

## Baseline Context

### Files that will be touched

| File | Repo | Change |
|---|---|---|
| `cmd/main.go` (`newRagDashboardKeyResolver`, `mountRagDashboard`) | theo-cloud | resolver → read+write+delete; mount POST/DELETE routes |
| `internal/rag/data_client.go` | theo-cloud | add write methods (CreateCollection/DeleteCollection/IngestDocument/DeleteDocument/Ask) + a `do(method)` helper |
| `internal/routes/rag_dashboard.go` | theo-cloud | add write handlers |
| `cmd/main_test.go` (2 invariant tests) | theo-cloud | lift GET-only → read+write; resolver mints r/w/d |
| `internal/rag/data_client_test.go`, `internal/routes/rag_dashboard_test.go` (NEW) | theo-cloud | write-path Go tests |
| `dashboard/src/pages/rag/{collections,documents,ask,analytics}.tsx` (NEW) | dashboard | the 4 pages |
| `dashboard/src/app.tsx` | dashboard | lazy routes for /rag/* |
| `dashboard/src/components/layout/app-sidebar.tsx` | dashboard | RAG nav section (drill-down) |
| `dashboard/e2e/rag-dashboard.spec.ts` (NEW) | dashboard | Playwright happy path |

### Reference (read-only) — verified

- Broker r/w/d grant: `cmd/main.go:63-64`. Dashboard resolver read-only: `cmd/main.go:89`.
- GET-only invariant: `cmd/main_test.go:66` (`TestRagDashboard_ReadOnlyRouteSet`), `:108` (resolver scopes).
- memory write client: `internal/themory/client.go:434-493` (`do(ctx, http.MethodPost, ...)`).
- memory BFF mount (read+write): `cmd/main.go:784`. memory route tests: `internal/routes/memory_test.go`.
- rag data_client (read-only today): `internal/rag/data_client.go:76-129` (`getJSON`).
- Frontend: `pages/memory/{entities,memories,playground,graph}.tsx`; router `app.tsx:73-98`; nav `app-sidebar.tsx:113,190`; `cloudFetch` `lib/api.ts:178`.

### Current callers / dependents

- `mountRagDashboard` (`cmd/main.go:93`) is the only mount of `/v1/dashboard/rag`. `RagDashboardHandler` (`internal/routes/rag_dashboard.go`) is its only handler. `data_client.go` is called only by that handler. No external caller breaks from adding methods (additive).
- The frontend rag pages are net-new; no existing page depends on them.

### Domain glossary

- **BFF (dashboard surface)**: `/v1/dashboard/rag/*` — browser-JWT session; the broker mints a per-tenant data key; distinct from the SDK/edge surface `/v1/rag/*`.
- **Dashboard-minted key**: a short-TTL per-tenant `rag_live_*` scoped to the session's workspace.
- **Drill-down nav**: a sidebar section that opens a submenu (memory's pattern) so items don't reflow the root nav.

### Architecture boundaries affected

- No new boundary. The BFF stays a thin proxy (browser JWT → broker mint → theo-rag REST). The 6 data-plane invariants remain enforced at theo-rag (per-verb scope on every write). Lifting the dashboard scope from read to read+write is a config change on the resolver, not a new trust path.

## Prior Art & Related Work

- **theo-memory dashboard section** (`dashboard/src/pages/memory/**` + `internal/routes/memory_*.go` + `internal/themory/broker.go`) — the validated reference, copied verbatim (the blueprint's copy-verbatim decision).
- The rag-dashboard-ui discovery blueprint (this cycle's DISCOVER output).

## ADRs

### ADR-1 — copy memory's dashboard section verbatim (Rule 9)
**Decision:** every rag page/route/test mirrors its memory counterpart's shape.
**Rationale:** memory's dashboard is validated; divergence is risk. **Alternatives:** fresh UX (rejected — reinvention).

### ADR-2 — lift the dashboard BFF to read+write; replace the GET-only invariant
**Decision:** `newRagDashboardKeyResolver` mints `rag:read`+`rag:write`+`rag:delete`; the GET-only route-set test becomes a read+write assertion.
**Rationale:** the milestone requires full management from the UI (identical to memory). The 6 invariants still gate writes at theo-rag. **Alternatives:** read-only UI + SDK-only writes (rejected — contradicts the milestone).

## Failure scenarios

theo-cloud BFF calls theo-rag over HTTP (external I/O):

| Dependency | Failure mode | Reproduce | Expected |
|---|---|---|---|
| theo-rag REST (BFF write) | key resolver returns error | Go test: resolver err | fail-closed — no request, 5xx to browser (never a master-key fallback) |
| theo-rag REST (BFF write) | theo-rag returns 4xx/5xx | Go test: stub non-2xx | propagate the status; no silent 200 |
| theo-rag REST (upload) | doc ingest is async (202) | e2e: upload → poll status | UI shows "processing" then "ready"/"failed", not a fake "done" |
| Browser session (BFF) | missing/invalid JWT | Go test: no JWT | 401 (requireJWT), no minted key |

## Tasks

### Phase 1 — Backend: lift BFF to read+write

#### T1.1 — data_client write methods + `do(method)` helper
- **Files:** `internal/rag/data_client.go`
- **Why:** the BFF handler needs to POST/DELETE to theo-rag with the per-tenant bearer; today only `getJSON` exists.
- **Change:** add a `do(ctx, method, path, body, out)` (mirror `themory/client.go`); add `CreateCollection`, `DeleteCollection`, `IngestDocument`, `DeleteDocument`, `Ask` calling it. All resolve the per-tenant key fail-closed.
- **TDD:** RED — `data_client_test.go`: `TestRagDataClient_CreateCollection_ProxiesBearer` asserts POST /v1/collections with `Authorization: Bearer <minted>` + body; `_KeyResolverError_FailsClosed` for write.
- **Concurrency tests:** (none — single-threaded per request)
- **Acceptance:** every write method proxies the minted bearer + fails closed; non-2xx is an error.

#### T1.2 — BFF write handlers + mount routes + resolver scope
- **Files:** `internal/routes/rag_dashboard.go`, `cmd/main.go`
- **Why:** expose the write methods under `/v1/dashboard/rag` for the browser session.
- **Change:** add handlers (CreateCollection/DeleteCollection/UploadDocument/DeleteDocument/Ask); `mountRagDashboard` adds `POST /collections`, `DELETE /collections/{id}`, `POST /documents`, `DELETE /documents/{id}`, `POST /answers`; `newRagDashboardKeyResolver` → `["rag:read","rag:write","rag:delete"]`.
- **TDD:** RED — update `cmd/main_test.go`: the route-set test now asserts the read+write set (GET collections/analytics + POST/DELETE); `TestNewRagDashboardKeyResolver_Mints…` asserts r/w/d scopes. New `rag_dashboard_test.go`: write handler → data_client called + 401 without JWT.
- **Concurrency tests:** (none — single-threaded)
- **Acceptance:** the BFF exposes read+write; the minted dashboard key carries r/w/d; `go test ./... && go vet ./...` clean.

### Phase 2 — Frontend scaffold + Analytics (read-only)

#### T2.1 — rag router block + sidebar section + Analytics page
- **Files:** `dashboard/src/app.tsx`, `dashboard/src/components/layout/app-sidebar.tsx`, `dashboard/src/pages/rag/analytics.tsx` (NEW)
- **Why:** establish the `/rag` section (routes + nav) + prove the frontend↔BFF wiring with the simplest (read-only) page first.
- **Change:** lazy routes for `/rag`, `/rag/analytics` (+ placeholders for the other 3); a RAG drill-down nav (mirror memory); `analytics.tsx` uses `useQuery` + `cloudFetch('/v1/dashboard/rag/analytics')`.
- **TDD:** RED — `analytics.test.tsx` (vitest + RTL): renders the M5 summary from a mocked cloudFetch; loading/error/empty states.
- **Concurrency tests:** (none — single-threaded UI)
- **Acceptance:** `/rag/analytics` renders real BFF data; nav shows the RAG section; `vitest run` + `tsc -b` green.

### Phase 3 — Collections page

#### T3.1 — collections.tsx (create/list/delete)
- **Files:** `dashboard/src/pages/rag/collections.tsx` (NEW)
- **Why:** the base of the CRUD — mirror `pages/memory/entities.tsx`.
- **Change:** `useQuery` list + `useMutation` create (form) + delete (`ConfirmDialog`), `cloudFetch` to the Phase-1 BFF routes.
- **TDD:** `collections.test.tsx`: list renders; create calls POST + refetches; delete opens ConfirmDialog → DELETE.
- **Concurrency tests:** (none — single-threaded)
- **Acceptance:** create/list/delete work against a mocked BFF; destructive action gated by ConfirmDialog.

### Phase 4 — Documents page

#### T4.1 — documents.tsx (upload/list/status/delete)
- **Files:** `dashboard/src/pages/rag/documents.tsx` (NEW)
- **Why:** upload + async ingest status is the most complex screen.
- **Change:** `useQuery` list (poll for ingest status), `useMutation` upload (text/file → POST /documents) + delete; surface `processing`/`ready`/`failed`.
- **TDD:** `documents.test.tsx`: upload calls POST; the list reflects status transitions (mocked); delete → ConfirmDialog → DELETE.
- **Concurrency tests:** (none — single-threaded; polling uses react-query refetchInterval)
- **Acceptance:** upload → status shown (not fake done); list/delete work.

### Phase 5 — Ask / Playground page

#### T5.1 — ask.tsx (query → cited answer)
- **Files:** `dashboard/src/pages/rag/ask.tsx` (NEW)
- **Why:** the core RAG value — mirror `pages/memory/playground.tsx`.
- **Change:** collection selector + query input + `useMutation` → POST /answers → render the answer + cited sources.
- **TDD:** `ask.test.tsx`: submit calls POST /answers; renders the answer text + the citation list from a mocked response.
- **Concurrency tests:** (none — single-threaded)
- **Acceptance:** ask returns a cited answer rendered with sources.

### Phase 6 — E2E + isolation proof + docs

#### T6.1 — Playwright happy path + BFF isolation proof + CHANGELOG
- **Files:** `dashboard/e2e/rag-dashboard.spec.ts` (NEW), a BFF/edge isolation assertion, `CHANGELOG.md` (theo-cloud + dashboard)
- **Why:** the DoD proof — a real user flow + the 6-invariant isolation on the write path.
- **Change:** Playwright: login → RAG → create collection → upload doc → ask → sees cited answer. Isolation: a Go/e2e assertion that a tenant-A dashboard session cannot read/write tenant-B data (extend the M18 pattern OR a BFF test with two tenants).
- **TDD:** the e2e IS the proof; the isolation test asserts cross-tenant denial.
- **Concurrency tests:** (none — single-threaded)
- **Acceptance:** e2e green; cross-tenant isolation proven; CHANGELOGs updated.

## Coverage Matrix

| # | DoD (ROADMAP M21) | Task(s) | Evidence |
|---|---|---|---|
| G1 | Frontend pages under `pages/rag/` (4 screens) | T2.1, T3.1, T4.1, T5.1 | mirror `pages/memory/` |
| G2 | Frontend consumes BFF via cloudFetch (useQuery/useMutation + ConfirmDialog) | T2.1–T5.1 | `lib/api.ts:178` |
| G3 | BFF write routes on `/v1/dashboard/rag` | T1.2 | `cmd/main.go mountRagDashboard` |
| G4 | Dashboard broker mints rag:read+write+delete | T1.2 | `cmd/main.go:89` resolver |
| G5 | 6 invariants hold on every write route + edge proof | T1.2, T6.1 | per-verb scope at theo-rag + isolation test |
| G6 | Tests: frontend + BFF route tests | T1.1, T1.2, T2.1–T5.1, T6.1 | vitest + go test + playwright |
| G7 | CHANGELOG; /review = READY_TO_MERGE | T6.1 + review | — |

**Coverage: 7/7 DoD items mapped (100%).**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Large scope (full dashboard section) risks shallow work | HIGH | 6 independently-reviewable phases; per-phase mini-review; backend first (unblocks + testable) | paulohenriquevn |
| BFF write posture — browser token can mutate | MEDIUM | mirror memory's read+write broker; short-TTL workspace-scoped minted key; ConfirmDialog; 6 invariants gate every write at theo-rag | paulohenriquevn |
| Async ingest UX faking "done" | MEDIUM | poll real document status; surface processing/ready/failed | paulohenriquevn |

## Unresolved Questions

- File-upload primitive: does the dashboard already have a reusable file-upload component to copy, or is a plain `<input type=file>`→text sufficient for V1? Resolved at implement-time in T4.1 (grep the dashboard components; prefer reuse). Not a blocker.

## Global DoD

- All phases done; `go test ./... && go vet ./...` (theo-cloud) + `vitest run` + `tsc -b && vite build` + `eslint .` (dashboard) clean; Playwright e2e green.
- Cross-tenant isolation proven on the write path.
- CHANGELOG (theo-cloud + dashboard); `/review` = READY_TO_MERGE.

## Final Phase: Integration Validation

- Backend: `go test ./... && go vet ./...` green; the route-set invariant reflects read+write.
- Frontend: `vitest run` + `tsc -b && vite build` + `eslint .` green.
- E2E: `playwright test rag-dashboard` green (create→upload→ask→cited answer).
- Manual: a dashboard session cannot touch another tenant's data.
