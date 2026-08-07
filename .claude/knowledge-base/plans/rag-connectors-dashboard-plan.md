---
slug: rag-connectors-dashboard
issue: 191
created_at: 2026-07-12
goal: Surface a RAG Connectors management page (list + sync + delete) in the dashboard, backed by BFF proxy routes for /v1/dashboard/rag/connectors, proven by the Go route-invariant + handler tests and the dashboard vitest page test
---

# Plan: theo-cloud #191 — RAG Connectors dashboard page + BFF proxy (v1: manage)

> **Version 1.0** — The theo-rag connectors platform (12 providers) is fully implemented in the API (`/v1/connectors/*`) but INVISIBLE in the dashboard: there is no `/rag/connectors` page and the BFF does not proxy connectors. This plan closes the headline gap with a **Connectors management page** — list existing connections (provider, collection, status, created), trigger a sync, and delete (confirm) — backed by three BFF proxy routes (`GET/POST-sync/DELETE`). It mirrors the shipped `collections` page + its BFF handler exactly (same `cloudFetch` + React-Query + `DataTable` + `ConfirmDialog` on the frontend; same `RagDashboardHandler` + `DataClient` + chi mount + route-invariant test on the BFF). **"Connect a new source"** (per-provider OAuth + credential forms across 14 connect endpoints) and the issue's SECONDARY asks (documents-page enrichment, webhooks page) are explicitly OUT of scope v1 — disclosed as immediate follow-ups. Zero new dependencies. Closes the "connectors invisible / BFF doesn't proxy" core of #191.

## Goal

> "Enable a dashboard user to see and manage RAG connectors — list connections, trigger a sync, and delete one — via new BFF proxy routes for `/v1/dashboard/rag/connectors`, measured by the Go route-invariant test (`cmd/main_test.go`) asserting the 3 new routes are mounted AND a dashboard vitest test (`connectors.test.tsx`) asserting the page lists connections and calls the sync/delete BFF endpoints."

## Context

A dogfood surface audit (theo-cloud #191, 2026-07-11) verified live: the dashboard RAG nav lists only Collections/Documents/Ask/Analytics; there is no `connectors.tsx` (`grep -ril connector dashboard/src` = 0), and the BFF `/v1/dashboard/rag/*` proxies only `analytics/answers/collections/documents`. The connectors platform is the headline "ingest from your existing tools" value prop and is unreachable in the product UI. Deep research (2 Explore agents + direct reads) established the exact template: the shipped `collections` page + `RagDashboardHandler.ListCollections/CreateCollection/DeleteCollection` + `DataClient` methods + the chi mount + the route-invariant test. This plan mirrors that template for connectors (read + sync + delete).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `theo-cloud/internal/rag/data_client.go` | ~260 | M21 | `DataClient` proxies theo-rag `/v1/*` with the per-tenant Bearer (`getJSON`/`do`) | Model-B key-resolver discipline (no master fallback); add `ListConnectors`/`SyncConnector`/`DeleteConnector` + types |
| `theo-cloud/internal/routes/rag_dashboard.go` | ~330 | M21 | `RagDashboardHandler` + `RagDataClient` interface + collections/documents/answers handlers | `authTenant` gate on every handler; add `ListConnectors`/`SyncConnector`/`DeleteConnector` methods + interface entries |
| `theo-cloud/cmd/main.go` | (large) | M21 | mounts `/v1/dashboard/rag/*` under `requireJWT` | add `r.Get("/connectors")`, `r.Post("/connectors/{id}/sync")`, `r.Delete("/connectors/{id}")` to the existing block |
| `theo-cloud/cmd/main_test.go` | ~150 | M21 | route-invariant test — asserts the exact mounted rag routes | add the 3 new routes to the `want` list |
| `theo-cloud/internal/routes/rag_dashboard_test.go` (exists) | — | M21 | handler unit tests (fake `RagDataClient`) | add connectors handler tests |
| `theo-cloud/dashboard/src/pages/rag/connectors.tsx` (NEW) | 0 | — | the Connectors management page | — |
| `theo-cloud/dashboard/src/pages/rag/connectors.test.tsx` (NEW) | 0 | — | page vitest test | — |
| `theo-cloud/dashboard/src/app.tsx` | (large) | M21 | React-Router routes + lazy imports for `/rag/*` | add the lazy import + `/rag/connectors` route (mirror collections) |
| `theo-cloud/dashboard/src/components/layout/app-sidebar.tsx` | ~250 | M21 | RAG submenu nav items | add a `Connectors` nav item to the RAG `items` array |

Every file in a `#### Files to edit` block appears here.

### Current callers / dependents

- **Symbol:** `RagDataClient` interface in `rag_dashboard.go:19` — implemented by `rag.DataClient` (`data_client.go`) and a fake in `rag_dashboard_test.go`. Adding 3 methods requires updating BOTH implementors (the real client + the test fake) — tsc/go-compile enforces it.
- **Symbol:** `RagDashboardHandler` methods → mounted in `cmd/main.go`'s `r.Route("/v1/dashboard/rag", …)` block; asserted by `cmd/main_test.go`'s route-invariant `want` list.
- **Symbol:** the theo-rag connectors API the `DataClient` proxies — `GET /v1/connectors` → `{items:[Connection]}` (connection shape: `id, workspace_id, collection_id, provider_id, status, cursor, created_at, updated_at` — `presentConnection`, theo-rag `connectors.ts:88`); `POST /v1/connectors/:id/sync` → `202 {status:'enqueued', connection_id}`; `DELETE /v1/connectors/:id` → 204 (409 if syncing).
- **Symbol:** the dashboard `collections` page (`collections.tsx`) — the exact React template: `useQuery(['cloud','/v1/dashboard/rag/collections'])` + `cloudFetch` + `DataTable` + `ConfirmDialog`. Connectors mirrors it with a sync action added.

### Domain glossary

- **connection** — a configured data source (provider + collection + credentials + sync cursor). The dashboard shows the non-secret fields (`presentConnection`).
- **sync** — enqueue a `CONNECTOR_SYNC` job for a connection (`POST /v1/connectors/:id/sync` → 202); the dashboard triggers it and surfaces the enqueued status.
- **BFF proxy** — the Go `/v1/dashboard/rag/*` route that forwards to theo-rag `/v1/*` with the session's per-tenant Bearer (Model B); the dashboard never talks to theo-rag directly.
- **cloudFetch** — the dashboard's shared authed fetch client (JWT Bearer + idempotency key); reused unchanged.

### Architecture boundaries affected

- **Model-B tenancy (theo-cloud invariant):** every new BFF handler gates on `authTenant` (rejects no-tenant `401`) and the `DataClient` resolves the per-tenant key (no master fallback). Connectors handlers copy the collections handlers verbatim on this.
- **BFF-only upstream:** the dashboard calls `/v1/dashboard/rag/connectors` (never theo-rag directly); the BFF proxies to `/v1/connectors`. No new cross-origin surface.

## Prior Art & Related Work

- **In-repo (the exact template):** `dashboard/src/pages/rag/collections.tsx` + `collections.test.tsx` (frontend), `internal/routes/rag_dashboard.go` `ListCollections`/`DeleteCollection` (BFF handler), `internal/rag/data_client.go` `ListCollections`/`DeleteCollection` (upstream client), `cmd/main.go` rag mount + `cmd/main_test.go` route-invariant test. Connectors mirrors all of these.
- **theo-rag connectors API (the upstream contract):** `packages/api/src/server/handlers/connections.ts` (`GET /v1/connectors`, `GET/DELETE /v1/connectors/:id`) + `connectors.ts:605` (`POST /v1/connectors/:id/sync`).
- **Related issues:** theo-rag #97 (connectors on SDK/MCP — CLOSED), theo-cloud #168 (rag:* self-serve keys — CLOSED, distinct).
- **Discovery (honest):** external `/discover` SKIPPED — the pattern is 100% in-repo (the shipped collections surface); the deep-research phase mapped the collections template + the connectors API contract (2 Explore agents + direct reads). Per `cycle-discover § Do NOT trigger DISCOVER for questions answered by reading your own code`.
- **Patterns skills:** (none — `ls .claude/skills/*-patterns/` returns no matches).

## Objective

- [ ] Sub-goal 1 — the BFF `DataClient` proxies connectors: `ListConnectors` (GET), `SyncConnector` (POST sync), `DeleteConnector` (DELETE) with the per-tenant Bearer.
- [ ] Sub-goal 2 — `RagDashboardHandler` exposes the 3 connectors handlers (tenant-gated), mounted at `/v1/dashboard/rag/connectors[...]` and asserted by the route-invariant test.
- [ ] Sub-goal 3 — a dashboard `/rag/connectors` page lists connections + Sync + Delete (confirm), wired into the router + the RAG nav.
- [ ] Sub-goal 4 — vitest page test + Go handler/route tests prove the surface end-to-end (mocked upstream).

## ADRs

### D1 — Mirror the shipped `collections` surface exactly (frontend + BFF), do not invent a new pattern

- **Decision:** the connectors page, BFF handlers, `DataClient` methods, mount, and tests copy the collections template verbatim (adjusting the resource + adding a `sync` verb).
- **Rationale:** the collections surface is shipped, reviewed, and tested (Model-B tenancy, route-invariant test, ConfirmDialog delete). Reusing it minimizes risk and review surface (Rule 9, KISS). A parallel mechanism would diverge the tenancy discipline.
- **Alternatives considered:** (a) a generic passthrough proxy for all `/v1/connectors/*` — rejected: loses the explicit route-invariant test + per-route tenancy gate + typed methods the collections pattern enforces. (b) call theo-rag directly from the dashboard — rejected: breaks the BFF-only + Model-B invariants.
- **Consequences:** three explicit typed methods/handlers/routes; the route-invariant `want` list grows by 3.

### D2 — v1 is READ + SYNC + DELETE (manage); "Connect a new source" is a disclosed follow-up

- **Decision:** ship list + sync + delete now; do NOT build the per-provider connect flow (14 connect endpoints, OAuth-redirect for 9 providers + credential forms for the rest) in v1.
- **Rationale:** the headline gap is "connectors invisible + BFF doesn't proxy" — list/sync/delete makes them visible + manageable and is fully testable without OAuth infra. The connect flow needs a per-provider OAuth-redirect + credential-form design (its own slice) — forcing it into v1 would be a large, partially-untestable workaround (OAuth apps, redirect URIs). Honest scoping over a half-built connect.
- **Alternatives considered:** (a) a generic "paste your refresh_token/credential" connect form for all 14 — rejected v1: poor UX for OAuth providers + large form matrix; a dedicated slice does it right. (b) block the whole page until connect ships — rejected: list/sync/delete is independently valuable (a workspace with connections created via CLI/API is now manageable in the UI).
- **Consequences:** a fresh workspace sees an empty list + an "Add a source via the CLI/API (dashboard connect coming soon)" empty-state note; the connect flow is filed as the immediate follow-up.

### D3 — Secondary #191 asks (documents-page enrichment, webhooks page) are out of scope

- **Decision:** do not touch the documents page or add a webhooks page in this slice.
- **Rationale:** the issue explicitly marks them "Secondary". Each is its own surface. Bundling them balloons the slice + review.
- **Alternatives considered:** bundle them — rejected (scope creep; the issue separates them).
- **Consequences:** documents enrichment + webhooks tracked as follow-ups on #191.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| v1 has no "connect" → a fresh workspace's page is empty | Medium | D2: an explicit empty-state directs to CLI/API + notes connect is coming; list/sync/delete is valuable for existing connections | eng |
| A sync-in-progress DELETE returns 409 from theo-rag | Low | surface the upstream 409 as a non-destructive error toast; the ConfirmDialog + BFF `writeError` mirror the collections delete-error path | eng |
| Provider/status display for 12 providers | Low | render `provider_id` + `status` as plain labels (no per-provider iconography in v1) — additive later | eng |
| Route-invariant test drift | Low | the `want` list is the single source; the 3 routes are added there + asserted mounted | eng |

## Unresolved Questions

- Q1 — "Connect a new source" (the per-provider OAuth-redirect + credential-form flow across 14 connect endpoints) is the immediate follow-up (out of scope v1 per D2). Open: does the OAuth-redirect flow live in the BFF (redirect + callback + token exchange) or does the dashboard collect a pre-obtained `refresh_token`? (Assumption: a dedicated follow-up slice designs it; v1 does not decide it. `/edge-case-plan` to confirm no cheap connect is worth adding now.)
- Q2 — Secondary #191 asks (documents enrichment, webhooks page) — out of scope v1 (D3), tracked on #191.

## Dependency Graph

```
Phase 0 (BFF: DataClient + handlers + mount + Go tests) ──▶ Phase 1 (Dashboard: page + route + nav + vitest)
                                                                   ▼
                                                            Final Phase (integration validation)
```

Phase 0 → 1 sequential (the page drives the BFF routes; the BFF must exist first for a live check, though the vitest test mocks `cloudFetch` so the page test is independent).

---

## Phase 0: BFF — proxy `/v1/dashboard/rag/connectors` (list + sync + delete)

**Objective:** three tenant-gated BFF routes proxy the theo-rag connectors API.

### T0.1 — `DataClient` connectors methods + `RagDashboardHandler` + mount + Go tests

#### Objective
Add `ListConnectors`/`SyncConnector`/`DeleteConnector` to `rag.DataClient` (+ `Connection`/`ConnectionsResult` types), the matching `RagDashboardHandler` methods + `RagDataClient` interface entries, mount the 3 routes in `cmd/main.go`, and cover them with the route-invariant test + handler unit tests.

#### Why this step (action + reasoning)
1. **What:** the BFF proxy for connectors, mirroring the collections handlers (D1).
2. **Why now:** the dashboard page (Phase 1) calls these routes; the BFF is the contract. Both `RagDataClient` implementors (real + test fake) must gain the methods (go-compile enforces it).

#### Evidence
`data_client.go:78,179` (`ListCollections`/`DeleteCollection` via `getJSON`/`do`), `rag_dashboard.go:19,48,148` (interface + `ListCollections`/`DeleteCollection` handlers + `authTenant`), `cmd/main.go` rag mount block, `cmd/main_test.go:121` (`want` route list). theo-rag: `GET /v1/connectors` (`{items}`), `POST /v1/connectors/:id/sync` (202), `DELETE /v1/connectors/:id`.

#### Files to edit
```
theo-cloud/internal/rag/data_client.go — add Connection/ConnectionsResult types + ListConnectors/SyncConnector/DeleteConnector
theo-cloud/internal/routes/rag_dashboard.go — add the 3 handler methods + interface entries
theo-cloud/cmd/main.go — mount GET /connectors, POST /connectors/{id}/sync, DELETE /connectors/{id}
theo-cloud/cmd/main_test.go — add the 3 routes to the want list
theo-cloud/internal/routes/rag_dashboard_test.go — add connectors handler tests (fake client) + update the fake to implement the 3 methods
```

#### Deep file dependency analysis
- `ListConnectors(ctx) (*ConnectionsResult, error)` → `c.getJSON(ctx, "/v1/connectors", nil, &out)`; nil-guard `Items`. `SyncConnector(ctx, id) (json.RawMessage, error)` → `c.do(ctx, POST, "/v1/connectors/"+url.PathEscape(id)+"/sync", nil, nil, &out)`. `DeleteConnector(ctx, id) error` → `c.do(ctx, DELETE, "/v1/connectors/"+url.PathEscape(id), nil, nil, nil)`. Handlers copy `ListCollections`/`DeleteCollection` (tenant gate + `writeJSON`/`writeError` + `502` on upstream error); the sync handler returns the upstream 202 body. The `RagDataClient` fake in the test file gains the 3 methods (compile-forced).

#### Deep Dives
- `Connection struct { ID, WorkspaceID, CollectionID, ProviderID, Status string; Cursor *string; CreatedAt, UpdatedAt string }` (mirror `presentConnection`); `ConnectionsResult { Items []Connection }`.
- mount (in the existing `r.Route("/v1/dashboard/rag", …)`): `r.Get("/connectors", h.ListConnectors)`, `r.Post("/connectors/{id}/sync", h.SyncConnector)`, `r.Delete("/connectors/{id}", h.DeleteConnector)`.

#### Tasks
1. Add the client types + 3 methods.
2. Add the 3 handlers + interface entries + fake.
3. Mount the routes + extend the route-invariant test.

#### TDD
```
RED:  TestRoutes_connectors_mounted — cmd/main_test.go want list includes the 3 connectors routes (fails until mounted)
RED:  TestListConnectors_ok — handler with a fake client returning {items:[conn]} → 200 + the items; no-tenant → 401
RED:  TestSyncConnector_ok — POST sync → 202 upstream body passthrough; upstream error → 502
RED:  TestDeleteConnector_ok — DELETE → 204; upstream 409 (syncing) surfaced; no-tenant → 401
GREEN: implement client + handlers + mount
REFACTOR: None expected
VERIFY: (cd theo-cloud && go test ./... -race)
```

#### Concurrency tests

(none — single-threaded per request; the `-race` flag on `go test ./...` covers the handler/client for data races, and no shared mutable state is added).

#### Failure scenarios (external I/O) — see the plan-level § Failure scenarios

#### Acceptance Criteria
- [ ] `(cd theo-cloud && go test ./... -race)` exits 0 with the new connectors handler + route-invariant tests
- [ ] `cmd/main_test.go` `want` list asserts `GET /v1/dashboard/rag/connectors`, `POST /v1/dashboard/rag/connectors/{id}/sync`, `DELETE /v1/dashboard/rag/connectors/{id}` are mounted
- [ ] a handler test asserts a no-tenant request → `401` on every connectors route (Model-B tenancy)
- [ ] Pass: `(cd theo-cloud && go vet ./...)` clean

#### DoD
- [ ] `go test ./... -race` green; `go vet ./...` clean; CHANGELOG (theo-cloud) updated under `[Unreleased]`

---

## Phase 1: Dashboard — `/rag/connectors` page (list + sync + delete)

**Objective:** a user sees + manages connectors in the dashboard.

### T1.1 — `connectors.tsx` page + router + nav + vitest

#### Objective
Add `RagConnectorsPage` (list table: provider / collection / status / created + Sync + Delete-confirm), wire it into `app.tsx` (lazy import + `/rag/connectors` route) and the RAG nav (`app-sidebar.tsx`), and a vitest page test.

#### Why this step
1. **What:** the user-facing Connectors page (D1/D2).
2. **Why now:** Phase 0 shipped the BFF routes; this page consumes them via `cloudFetch` (the test mocks `cloudFetch`, so it is independent of a live BFF).

#### Evidence
`collections.tsx` (the exact page template — `useQuery`/`useMutation`/`cloudFetch`/`DataTable`/`ConfirmDialog`), `collections.test.tsx` (the vitest template — mock `cloudFetch`, render, assert POST/DELETE), `app.tsx:105,431` (lazy import + route), `app-sidebar.tsx:198` (RAG `items` nav).

#### Files to edit
```
theo-cloud/dashboard/src/pages/rag/connectors.tsx (NEW)
theo-cloud/dashboard/src/pages/rag/connectors.test.tsx (NEW)
theo-cloud/dashboard/src/app.tsx — lazy import RagConnectorsPage + <Route path="/rag/connectors">
theo-cloud/dashboard/src/components/layout/app-sidebar.tsx — add the Connectors nav item
```

#### Deep file dependency analysis
- `connectors.tsx` mirrors `collections.tsx`: `useQuery(['cloud','/v1/dashboard/rag/connectors'])` → `cloudFetch<ConnectionsResult>`; a `sync` `useMutation` (`POST /v1/dashboard/rag/connectors/{id}/sync`) + a `remove` `useMutation` (`DELETE …/{id}`) with `invalidate` on success; a `DataTable` with columns provider / collection / status / created + row actions (Sync button + Delete → `ConfirmDialog`); `EmptyState` directs to the CLI/API with a "connect via dashboard coming soon" note (D2). `app.tsx` + `app-sidebar.tsx` get the additive route + nav entry (mirror collections).

#### Deep Dives
- columns: `provider_id`, `collection_id` (mono), `status` (label), `created_at` (`<Timestamp>`), actions (Sync + Delete). Sync button shows a pending state; on success, the list invalidates (status may flip to `syncing`).
- `EmptyState` copy: "No connectors yet — connect a data source with the CLI or API (`POST /v1/connectors/{provider}/connect`). Connecting from the dashboard is coming soon."

#### Tasks
1. Write `connectors.tsx`.
2. Wire the router + nav.
3. Write the vitest test.

#### TDD
```
RED:  connectors_page_lists_and_syncs — mock cloudFetch → {items:[{id,provider_id,collection_id,status}]}; render; assert the connection row is shown; click Sync → cloudFetch called with POST /v1/dashboard/rag/connectors/{id}/sync
RED:  connectors_page_delete_confirms — click Delete → ConfirmDialog → confirm → cloudFetch called with DELETE /v1/dashboard/rag/connectors/{id}
RED:  connectors_page_empty_state — mock {items:[]} → the empty-state (CLI/API note) is shown
GREEN: implement the page + router + nav
REFACTOR: None expected
VERIFY: (cd theo-cloud/dashboard && pnpm test -- connectors)
```

#### Concurrency tests

(none — single-threaded React render; React-Query handles async state deterministically in the test via mocked `cloudFetch`).

#### Failure scenarios (external I/O) — see the plan-level § Failure scenarios

#### Acceptance Criteria
- [ ] `(cd theo-cloud/dashboard && pnpm test -- connectors)` exits 0 with the page test asserting list + Sync (POST) + Delete-confirm (DELETE) + empty-state
- [ ] `/rag/connectors` is routed in `app.tsx` and appears as a `Connectors` item in the RAG nav (`app-sidebar.tsx`)
- [ ] the page uses `cloudFetch` against `/v1/dashboard/rag/connectors[...]` (BFF-only; never theo-rag directly)
- [ ] Pass: `(cd theo-cloud/dashboard && pnpm lint)` exits 0; `tsc -b` clean

#### DoD
- [ ] `pnpm test -- connectors` green; `pnpm lint` + `tsc -b` clean; CHANGELOG (theo-cloud) updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | BFF doesn't proxy connectors | T0.1 | `DataClient` + `RagDashboardHandler` + mount for list/sync/delete |
| 2 | no route-invariant coverage for the new routes | T0.1 | `cmd/main_test.go` `want` list + handler tests |
| 3 | Model-B tenancy on the new routes | T0.1 | `authTenant` gate + no-tenant→401 test |
| 4 | no Connectors page in the dashboard | T1.1 | `connectors.tsx` (list + sync + delete) |
| 5 | not routed / not in nav | T1.1 | `app.tsx` route + `app-sidebar.tsx` nav item |
| 6 | no page test | T1.1 | vitest: list + sync + delete + empty-state |
| 7 | "Connect a new source" (14 providers, OAuth) | (disclosed) | out of scope v1 (D2) — immediate follow-up |
| 8 | documents enrichment + webhooks page | (disclosed) | out of scope v1 (D3) — issue's SECONDARY |

**Coverage: 6/6 in-scope gaps covered (100%); #7 + #8 explicitly disclosed out-of-scope.**

## Global Definition of Done

- [ ] All phases completed
- [ ] BFF: `(cd theo-cloud && go test ./... -race)` green; `go vet ./...` clean
- [ ] Dashboard: `(cd theo-cloud/dashboard && pnpm test)` green; `pnpm lint` + `tsc -b` clean
- [ ] CHANGELOG (theo-cloud) updated under `[Unreleased]`
- [ ] Backward compatibility preserved — additive routes/methods/nav; existing collections/documents/analytics surfaces unchanged
- [ ] Plan-specific: the route-invariant test asserts the 3 connectors routes mounted; the vitest page test drives list + sync + delete
- [ ] Runtime-metric proof — the page test asserts the Sync/Delete `cloudFetch` calls fire against the BFF routes (the observable wiring)
- [ ] Plan archived after `/review` = READY_TO_MERGE + PR merged

## Failure scenarios (external I/O)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| theo-rag `/v1/connectors` (upstream) | upstream 5xx / unreachable | fake `RagDataClient` returns an error | BFF handler → `502 UPSTREAM_ERROR`; dashboard shows a "RAG service unavailable" warning (mirror collections) |
| theo-rag `DELETE /v1/connectors/:id` | 409 while syncing | fake client returns a 409-mapped error | BFF surfaces the error; the dashboard delete shows a non-destructive error (row not removed) |
| dashboard → BFF | no tenant on the session | handler test with no `auth.GetUser` tenant | `401 AUTH_REQUIRED` on every connectors route (Model-B fail-closed) |
| dashboard fetch | `cloudFetch` rejects (network) | vitest mock rejects | React-Query error state → the page's error alert (mirror collections) |

## Final Phase: Integration Validation (MANDATORY)

Runs after all phases. NOT done until:

- [ ] `(cd theo-cloud && go test ./... -race)` + `go vet ./...` green
- [ ] `(cd theo-cloud/dashboard && pnpm test && pnpm lint && pnpm exec tsc -b)` all green
- [ ] the connectors route-invariant test + the vitest page test are green in their suites
- [ ] `/code-quality` ∈ {PASS, PASS_WITH_CAVEATS}
- [ ] `/review` = READY_TO_MERGE
