---
slug: themory-graph-gateway-dashboard
created_at: 2026-06-20
goal: Proxy TheMemory's /graph through the gateway (/v1/memory/graph + BFF) and render a graph view in the dashboard.
---

# Plan: TheMemory Graph — Gateway BFF + Dashboard view

> **Version 1.0** — TheMemory Slice 2 (on theo-memory `develop`) ships `GET /v1/scopes/:type/:id/graph` returning `{nodes, edges}`. This plan exposes it through the theo-cloud gateway (SDK `GET /v1/memory/graph` + dashboard BFF `GET /v1/dashboard/memory/graph`) and renders a dependency-free SVG graph view in the dashboard at `/memory/graph`. It mirrors the EXISTING entities integration (gateway `Entities` handler + `dashboard/src/pages/memory/entities.tsx`) line-for-line. NO graph DB, NO new dependency.

## Goal

> "Enable a dashboard user to view their entity relation graph so that the relations TheMemory extracted are visible as a node-link diagram, measured by the e2e test `remember → GET /v1/memory/graph` returning a non-empty `edges` array AND the `pages/memory/graph.test.tsx` rendering nodes+edges from a fixture, both green."

## Context

The graph half of the entity feature (theo-memory Slice 2) is shipped at the SDK/REST layer but NOT exposed through TheoCloud — the gateway has `/v1/memory/entities` but no `/graph`, and the dashboard has an Entities browser but no graph view. This plan closes the cross-repo integration that Slice 2 explicitly deferred (Unresolved Q3). Governed by theo-memory CLAUDE.md Amendment 2026-06-20 ("dashboard graph view" named in-scope). The entities integration (gateway `Entities` + dashboard `entities.tsx`) is the exact in-repo precedent.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `internal/themory/client.go` | 596 | `34122a2` | TheMemory HTTP client; `Entity`/`EntitiesResult` (`:175,:184`) + `Entities()` (`:415`) | additive types/method; existing `Entities` untouched; scope!="user"→empty rule mirrored |
| `internal/routes/memory.go` | 594 | `34122a2` | `MemoryHandler` + `TheMemoryClient` interface (`:40`); `Entities` handler (`:266`); `validEntityScopes` (`:62`) | interface additive; `Entities` unchanged; reuse `validEntityScopes` + empty-array fallback |
| `cmd/main.go` | 838 | `34122a2` | route registration; SDK `/entities` (`:418`, `RequireScope memory:read`) + BFF `/entities` (`:468`) | additive route lines; existing routes unchanged |
| `internal/themory/contract_test.go` | 275 | `34122a2` | client contract tests; `Entities` test (`:219`) | additive test; existing unchanged |
| `tests/unit/dashboard_memory_test.go` | — | `34122a2` | BFF handler unit tests; `fakeMemoryClient.Entities` (`:65`), `Entities_MirrorsListPattern` (`:209`), route table (`:308`) | extend fake with `Graph`; add Graph handler test + route-table row |
| `tests/unit/memory_handlers_test.go` | — | `34122a2` | SDK handler unit tests; fake `entitiesResp` (`:52`), Entities test (`:467`) | extend fake with Graph; add SDK Graph test |
| `tests/e2e/memory_e2e_test.go` | — | `34122a2` | gateway↔themory e2e; entities round-trip (`:293`) | add graph round-trip (needs rebuilt themory image, D4) |
| `dashboard/src/pages/memory/graph.tsx` (NEW) | 0 | — | (to be created) — graph view | — |
| `dashboard/src/pages/memory/graph.test.tsx` (NEW) | 0 | — | (to be created) — view test | — |
| `dashboard/src/pages/memory/entities.tsx` | 215 | `34122a2` | the mirror view (DataTable, scope tabs, `cloudFetch`, react-query) | read-only reference; NOT modified |
| `dashboard/src/pages/memory.tsx` | 200 | `34122a2` | memory hub; cards → `/memory/skills` (`:158`) + `/memory/entities` (`:165`) | additive card → `/memory/graph` |
| `dashboard/src/app.tsx` | 419 | `34122a2` | router; lazy `EntitiesPage` (`:75`) | additive lazy `GraphPage` + `<Route path="/memory/graph">` |
| `dashboard/src/components/layout/app-sidebar.tsx` | — | `34122a2` | sidebar nav (has entities entry) | additive graph nav entry |

### Current callers / dependents

- **`TheMemoryClient` interface** (`internal/routes/memory.go:40`) — implemented by `*themory.Client` (production) + `fakeTheMemory` (`tests/unit/memory_handlers_test.go`) + `fakeMemoryClient` (`tests/unit/dashboard_memory_test.go`). Adding `Graph` to the interface REQUIRES extending BOTH fakes (compile-break otherwise — caught at test build).
- **`cloudFetch`** (`dashboard/src/lib/api.ts`) — the dashboard fetch helper; `graph.tsx` calls `cloudFetch<GraphResult>('/v1/dashboard/memory/graph?scope=user')`.

### Domain glossary

- **node** — an extracted entity (`{id,scope_type,memory_count,last_seen_at}`); `id` = entity name.
- **edge** — a relation triple (`{source,relation,target,memory_count}`); source/target are node `id`s.
- **BFF** — the dashboard backend-for-frontend route surface (`/v1/dashboard/memory/*`, JWT-auth), distinct from the SDK surface (`/v1/memory/*`, Bearer `memory:read`). The handler is shared.
- **shared-key model** — each customer is one USER subject; `scope != "user"` → empty (no sub-subject exists).

### Architecture boundaries affected

- Gateway: `internal/routes` (HTTP) → `internal/themory` (client) — same direction as `Entities`. No new boundary.
- Dashboard: `pages/memory/graph.tsx` → `lib/api.cloudFetch` → gateway BFF. Same as `entities.tsx`.
- NO new dependency in either Go (stdlib + chi) or the dashboard (React + react-query + @usetheo/ui + dependency-free SVG).

## Prior Art & Related Work

- **Blueprint** `themory-graph-gateway-dashboard` (`.claude/knowledge-base/discoveries/blueprints/`) — the mirror map.
- **In-repo mirror** — the entities integration: `internal/themory/client.go` `Entities`, `internal/routes/memory.go` `Entities` handler, `dashboard/src/pages/memory/entities.tsx`, `cmd/main.go:418,468` route registration.
- **Upstream contract** — theo-memory Slice 2 plan (`theo-data/theo-memory/.claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md`) defines `/graph` `{nodes,edges}` + the `EdgeSummary` shape.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `go-chi/chi` | (as in go.mod) | go | route registration (existing) |
| `@tanstack/react-query` | (as in package.json) | npm | dashboard data fetching (existing, mirror entities) |
| `@usetheo/ui` | (as in package.json) | npm | Card/Tabs/PageShell/EmptyState/Alert primitives (existing) |
| `react-router-dom` | (as in package.json) | npm | scope tab state via `useSearchParams` (existing) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | D1: graph rendered as dependency-free SVG. Evaluated cytoscape + reactflow + d3 — all REJECTED (heavy dep + bundle + deps-audit surface for a 1–2 hop view). The SVG node-link is ~80 LoC, zero deps. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Objective

- [ ] `go test ./internal/themory/ -run TestClient_Graph` returns PASS — client exposes `Graph(ctx,userID,scope)` mapping `{nodes,edges}`, scope!="user"→empty.
- [ ] `go build ./...` exits 0 with `Graph` on the interface + both fakes (compile proves all 3 implementors).
- [ ] `go test ./internal/routes/ -run Graph` returns PASS — handler emits 200/400/502 + nil→[] fallback.
- [ ] route-table unit test asserts both `/v1/memory/graph` + `/v1/dashboard/memory/graph` resolve (returns PASS).
- [ ] `npx vitest run src/pages/memory/graph.test.tsx` returns PASS — `GraphPage` renders SVG nodes+edges + empty state; `git diff dashboard/package.json` shows 0 new deps.
- [ ] `curl … localhost:<themory>/v1/scopes/user/probe/graph` returns 200 (was 404 pre-rebuild).
- [ ] `go test ./tests/e2e/ -run GraphRoundTrip` returns PASS — `edges` array present (non-empty when LLM emits relations).

## ADRs

### D1 — Dependency-free SVG node-link render (NOT cytoscape/react-flow)
- **Decision:** render the graph as an inline SVG (deterministic circular node layout + straight edges with relation labels) in `graph.tsx`, no graph library.
- **Rationale:** KISS + bundle size + zero deps-audit surface. A 1–2 hop dashboard view does not justify cytoscape (~400KB) or reactflow.
- **Alternatives:** (a) cytoscape — REJECTED (heavy, over-engineered for 1–2 hop). (b) reactflow/@xyflow — REJECTED (heavy + interaction model we don't need). (c) recharts — REJECTED (not a node-link lib).
- **Consequences:** simple, static layout (no drag/zoom v1); richer interaction is a future enhancement, not rework (the data contract is stable).

### D2 — Shared `Graph` handler on BOTH route surfaces
- **Decision:** one `MemoryHandler.Graph` method registered on SDK (`memory:read`) AND BFF (JWT) routes — exactly like `Entities`.
- **Rationale:** DRY + mirror; the handler is transport-only.
- **Alternatives:** separate handlers per surface — REJECTED (duplicates logic; entities proves one handler serves both).
- **Consequences:** both surfaces stay in lockstep; one test matrix covers the shared handler + a route-table test asserts both registrations.

### D3 — `scope != "user"` → empty graph
- **Decision:** the client returns `{nodes:[],edges:[]}` for non-user scopes (shared-key model).
- **Rationale:** mirror of `Entities` (`client.go:422`); honest (no sub-subject exists for a customer).
- **Alternatives:** 400 on non-user scope — REJECTED (entities returns empty, not error; consistency).
- **Consequences:** session/agent/repo tabs render the empty state, not an error.

### D4 — Rebuild the themory image with Slice 2 before e2e
- **Decision:** rebuild `themory-e2e:latest` from theo-memory `develop` (has `/graph`) and restart the dev stack themory container before running the graph e2e.
- **Rationale:** the running image (2026-06-19) predates Slice 2 → `/graph` 404. The e2e proves the real cross-repo round-trip.
- **Alternatives:** stub the themory `/graph` in e2e — REJECTED (defeats the e2e's purpose: prove the real backend serves it).
- **Consequences:** e2e depends on the rebuilt image; documented in the e2e setup.

### D5 — Empty-array invariant (nodes + edges never null)
- **Decision:** the client + handler coerce nil → `[]` for both `nodes` and `edges`.
- **Rationale:** D3-inheritance from Plan 1; the dashboard never sees null (no NaN/crash).
- **Alternatives:** allow null + handle client-side — REJECTED (entities established the always-array contract).
- **Consequences:** the dashboard renders the empty state cleanly.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| e2e depends on rebuilding the themory image (slow + env-coupled) | Medium | D4 rebuild step documented; unit + contract tests cover logic deps-free so the suite is green without the image; e2e is the final gate | impl |
| Dependency-free SVG layout is static (no zoom/drag) | Low | acceptable for 1–2 hop v1 (D1); data contract stable so richer render is additive, not rework | impl |
| Adding `Graph` to the interface breaks compile of both test fakes | Low | intentional compile-time safety; both fakes extended in the same task (TDD RED catches it) | impl |
| Relation extraction needs a real LLM emitting `relations`; dev stack uses mock-openai | Medium | e2e seeds via remember with the configured LLM; if the mock does not emit relations, the e2e seeds edges deterministically through TheMemory's store path OR uses a real key — documented in the e2e; unit/contract tests do not depend on it | impl |

## Unresolved Questions

- Q1 — Does the dev stack `mock-openai` emit `relations`? If not, the e2e must seed edges via a deterministic path (real LLM key OR direct store seed through themory). Resolved at PREREQ time (T0.1) by inspecting the mock; the e2e adapts.
- Q2 — Sidebar: does the memory section already have an entities nav entry to mirror? (Confirmed yes — `app-sidebar.tsx` references entities; graph entry is additive.)

## Dependency Graph

```
T0.1 (rebuild themory image, inspect mock LLM)
   │
T1.1 (client Graph types+method) ──▶ T1.2 (interface + handler) ──▶ T1.3 (routes SDK+BFF)
                                                                          │
T2.1 (dashboard GraphPage + SVG) ──▶ T2.2 (router + hub card + sidebar)   │
                                                                          ▼
                                                          T3.1 (e2e graph round-trip + full validation)
```

Phase 1 (gateway) + Phase 2 (dashboard) are independent and can interleave; both block Phase 3 (e2e). T0.1 is the prereq for T3.1 only.

---

## Phase 0: Prereq — themory image + mock LLM

### T0.1 — Rebuild themory image with Slice 2 + confirm relation path

#### Objective
The dev stack themory container serves `/graph`; confirm whether the mock LLM emits `relations` (decides the e2e seeding strategy).

#### Why this step
1. **What:** rebuild `themory-e2e:latest` from theo-memory `develop`; restart `theo-cloud-dev-themory-1`; curl `/v1/scopes/user/x/graph` to confirm 200 (not 404); inspect mock-openai response for `relations`.
2. **Why now:** the e2e (T3.1) round-trips against this container; without Slice 2 it 404s. Resolving the mock-relations question (Q1) here decides T3.1's seeding.

#### Files to edit
```
(no source files — docker build + dev-stack restart; findings recorded in the implementation log)
```

#### TDD
```
RED:     curl_graph_before_rebuild_is_404() — GET /v1/scopes/user/probe/graph against the OLD container; const status = before; expect(status).toBe(404)
GREEN:   rebuild image + restart; curl_graph_after_rebuild_is_200() — const status = after; expect(status).toBe(200)
VERIFY:  docker compose -f theo-cloud/docker-compose.dev.yaml up -d --build themory && curl -s -o /dev/null -w '%{http_code}' localhost:<themory>/v1/scopes/user/probe/graph
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `curl -s -o /dev/null -w '%{http_code}' localhost:<themory>/v1/scopes/user/probe/graph` returns 200.
- [ ] Mock-LLM relation capability recorded (emits `relations`? yes/no) → e2e seeding strategy chosen.

#### DoD
- [ ] `docker ps` shows the themory container restarted; probe returns 200; mock-relations finding logged in the implementation md.

---

## Phase 1: Gateway `/v1/memory/graph`

### T1.1 — Client `Graph` types + method

#### Objective
`internal/themory/client.go` gains `GraphNode`/`GraphEdge`/`GraphResult` + `Graph(ctx,userID,scope)` mirroring `Entities`.

#### Why this step
1. **What:** add the three DTOs + the method that GETs `/v1/scopes/user/{userID}/graph`, with `scope!="user"→empty` + nil→`[]` coercion for nodes AND edges.
2. **Why now:** the handler (T1.2) depends on it; it is the transport leaf (DIP: routes depend on this).

#### Evidence
- `internal/themory/client.go:175-186` (`Entity`/`EntitiesResult`) + `:415-435` (`Entities` method) — the exact mirror.

#### Files to edit
```
internal/themory/client.go — add GraphNode, GraphEdge, GraphResult, Graph()
internal/themory/contract_test.go — RED: client maps graph response
```

#### Deep Dives
- `GraphNode{ID,ScopeType,MemoryCount,LastSeenAt}` (= `Entity`), `GraphEdge{Source,Relation,Target,MemoryCount}`, `GraphResult{Nodes []GraphNode; Edges []GraphEdge}` (json `nodes`/`edges`).
- `Graph(ctx,userID,scope)`: `scope!="" && scope!="user"` → `&GraphResult{Nodes:[],Edges:[]}`; else GET `/v1/scopes/user/{escape(userID)}/graph`; nil→`[]` for both slices.

#### TDD
```
RED:     TestClient_Graph_MapsResponse — httptest server returns {nodes:[{id:"John Smith"...}],edges:[{source:"John Smith",relation:"works at",target:"Google",memory_count:1}]}; const res = client.Graph(...); expect res.Edges[0].Target == "Google"
RED:     TestClient_Graph_NonUserScope_Empty — const res = client.Graph(ctx,"u","session"); expect len(res.Edges)==0 && res.Nodes != nil
GREEN:   implement types + method
REFACTOR: None expected
VERIFY:  go test ./internal/themory/...
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — synchronous HTTP client call.

#### Acceptance Criteria
- [ ] `Graph` maps `{nodes,edges}`; non-user scope → empty; nil→`[]`.
- [ ] `go vet ./internal/themory/...` returns 0 issues AND `go test ./internal/themory/...` returns PASS.

#### DoD
- [ ] `go test ./internal/themory/ -run TestClient_Graph` returns PASS; `gofmt -l internal/themory/client.go` prints nothing.

### T1.2 — Interface + `Graph` handler + fakes

#### Objective
`TheMemoryClient` interface + both test fakes gain `Graph`; `MemoryHandler.Graph(w,r)` mirrors `Entities`.

#### Why this step
1. **What:** add `Graph` to the interface (`memory.go:40`), the handler (`memory.go` near `:266`), and extend `fakeTheMemory` + `fakeMemoryClient` with `Graph`.
2. **Why now:** the routes (T1.3) reference the handler; the interface change compile-forces both fakes.

#### Evidence
- `internal/routes/memory.go:42` (interface) + `:266` (`Entities` handler) + `validEntityScopes:62`.
- `tests/unit/memory_handlers_test.go:52` + `tests/unit/dashboard_memory_test.go:65` (the two fakes).

#### Files to edit
```
internal/routes/memory.go — interface += Graph; func (h *MemoryHandler) Graph
tests/unit/memory_handlers_test.go — fake += Graph; RED SDK handler test
tests/unit/dashboard_memory_test.go — fakeMemoryClient += Graph; RED BFF handler test
```

#### Deep Dives
- `Graph(w,r)`: auth check; `scope := query("scope")`; `!validEntityScopes[scope]` → 400 INVALID_SCOPE; `h.client.Graph(...)`; upstream err → 502 MEMORY_UPSTREAM_UNAVAILABLE; nil nodes/edges → `[]`; `writeJSON(200, result)`. Byte-mirror of `Entities`.

#### TDD
```
RED:     TestMemory_Graph_ReturnsNodesEdges — fake returns 1 node+1 edge; const status = rec.Code; expect status == 200 and body has edges
RED:     TestMemory_Graph_InvalidScope_400 — scope=bogus; const status = rec.Code; expect status == 400
RED:     TestMemory_Graph_UpstreamFail_502 — fake errs; const status = rec.Code; expect status == 502
RED:     TestDashboardMemory_Graph_MirrorsPattern — BFF handler; const status = rec.Code; expect status == 200
GREEN:   implement interface + handler + extend both fakes
REFACTOR: None expected
VERIFY:  go test ./internal/routes/... ./tests/unit/...
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — request handler, no shared mutable state.

#### Acceptance Criteria
- [ ] Handler: 200 with nodes+edges; 400 invalid scope; 502 upstream-fail; empty-array fallback.
- [ ] Both fakes implement `Graph` (compile green).
- [ ] `go test ./internal/... ./tests/unit/...` returns PASS for the gateway.

#### DoD
- [ ] `go test ./internal/routes/ ./tests/unit/` returns PASS; `gofmt -l` prints nothing; `go vet ./...` returns 0 issues.

### T1.3 — Register SDK + BFF routes

#### Objective
`GET /v1/memory/graph` (SDK, `memory:read`) + `GET /v1/dashboard/memory/graph` (BFF) registered in `cmd/main.go`.

#### Why this step
1. **What:** add two route lines mirroring `/entities` (`main.go:418` SDK + `:468` BFF).
2. **Why now:** wires the handler into the live server; the e2e + route-table test depend on it.

#### Evidence
- `cmd/main.go:418` (`r.With(RequireScope memory:read).Get("/entities", memoryHandler.Entities)`) + `:468` (`r.Get("/entities", dashboardMemoryHandler.Entities)`).

#### Files to edit
```
cmd/main.go — SDK + BFF /graph route lines
tests/unit/dashboard_memory_test.go — add Graph row to the route-table test (:308)
```

#### TDD
```
RED:     route-table test row {"graph","GET","/v1/dashboard/memory/graph?scope=user",(*routes.DashboardMemoryHandler).Graph}; const ok = routeRegistered; expect(ok).toBe(true)
GREEN:   register both routes
VERIFY:  go build ./... && go test ./tests/unit/...
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — route registration.

#### Acceptance Criteria
- [ ] route-table test asserts both `/v1/memory/graph` + `/v1/dashboard/memory/graph`; `go build ./...` exits 0.

#### DoD
- [ ] `go build ./...` exits 0 AND `go test ./tests/unit/` returns PASS.

---

## Phase 2: Dashboard graph view

### T2.1 — `GraphPage` + dependency-free SVG render

#### Objective
`dashboard/src/pages/memory/graph.tsx` renders `{nodes,edges}` as an SVG node-link with scope tabs + empty state.

#### Why this step
1. **What:** new `GraphPage` mirroring `entities.tsx` (PageShell, scope Tabs, `useSearchParams`, react-query `cloudFetch('/v1/dashboard/memory/graph?scope=...')`) but rendering an SVG node-link instead of a DataTable.
2. **Why now:** the user-visible deliverable; consumes the BFF route from T1.3.

#### Evidence
- `dashboard/src/pages/memory/entities.tsx:1-50` (imports, types, scope tabs, query) — the mirror.

#### Files to edit
```
dashboard/src/pages/memory/graph.tsx (NEW) — GraphPage + GraphSvg component
dashboard/src/pages/memory/graph.test.tsx (NEW) — RED render tests
```

#### Deep Dives
- Types: `GraphNode{id,scope_type,memory_count,last_seen_at?}`, `GraphEdge{source,relation,target,memory_count}`, `GraphResult{nodes,edges}`.
- `GraphSvg({nodes,edges})`: deterministic circular layout — node i at angle `2πi/n` radius R; map name→{x,y}; render `<line>` per edge (source→target coords) with a `<text>` relation label at midpoint; `<circle>`+`<text>` per node. Guard: edges whose endpoints aren't in nodes are skipped (defensive). Empty `nodes` → `EmptyState`.
- Scope tabs (user/session/agent/repo) via `useSearchParams('scope')`; non-user → empty (D3).

#### Pseudo-code / Signatures
```tsx
function layout(nodes: GraphNode[]): Map<string,{x:number;y:number}> {
  const c = 300, R = 220; const m = new Map();
  nodes.forEach((n,i) => { const a = (2*Math.PI*i)/Math.max(nodes.length,1);
    m.set(n.id, { x: c + R*Math.cos(a), y: c + R*Math.sin(a) }); });
  return m;
}
// edges → <line x1 y1 x2 y2> + <text> relation; nodes → <circle> + <text>
```

#### TDD
```
RED:     renders nodes and edges from a fixture — render(<GraphPage/>) with mocked cloudFetch → const svgEdges = screen.getAllByTestId('graph-edge'); expect(svgEdges.length).toBeGreaterThan(0)
RED:     empty state when no nodes — mocked empty → const empty = screen.getByText(/no entit|no graph|nothing/i); expect(empty).toBeTruthy()
RED:     edge label shows the relation — const label = screen.getByText('works at'); expect(label).toBeTruthy()
GREEN:   implement GraphPage + GraphSvg
REFACTOR: extract GraphSvg if graph.tsx > 215 LoC (entities.tsx parity)
VERIFY:  cd dashboard && npx vitest run src/pages/memory/graph.test.tsx
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — pure render.

#### Acceptance Criteria
- [ ] Renders nodes + edges (SVG); relation labels shown; empty state when no nodes; scope tabs present.
- [ ] No new npm dependency (dependency-free SVG).
- [ ] `cd dashboard && npx vitest run src/pages/memory/graph.test.tsx` green; `npx tsc --noEmit` clean; `npx eslint` clean on the new files.

#### DoD
- [ ] `npx vitest run src/pages/memory/graph.test.tsx` returns PASS; `npx tsc --noEmit` returns 0 errors; `npx eslint` returns 0 warnings.

### T2.2 — Router + hub card + sidebar entry

#### Objective
`/memory/graph` route registered; memory hub card + sidebar nav entry link to it.

#### Why this step
1. **What:** lazy-import `GraphPage` + `<Route path="/memory/graph">` in `app.tsx`; add a card in `memory.tsx`; add a sidebar entry.
2. **Why now:** makes the view reachable in the UI (wiring pillar a for the page).

#### Evidence
- `dashboard/src/app.tsx:75` (lazy EntitiesPage) + `pages/memory.tsx:165` (entities card) + `components/layout/app-sidebar.tsx` (entities nav).

#### Files to edit
```
dashboard/src/app.tsx — lazy GraphPage + Route
dashboard/src/pages/memory.tsx — hub card → /memory/graph
dashboard/src/components/layout/app-sidebar.tsx — nav entry
dashboard/src/pages/memory.test.tsx — assert the graph card/link present (if memory.test exists)
```

#### TDD
```
RED:     memory hub shows a Graph card linking to /memory/graph — const link = screen.getByRole('link',{name:/graph/i}); expect(link.getAttribute('href')).toBe('/memory/graph')
GREEN:   add lazy route + card + sidebar entry
VERIFY:  cd dashboard && npx vitest run src/pages/memory.test.tsx
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npx vitest run src/pages/memory.test.tsx` asserts the `/memory/graph` link; route lazy-imported in app.tsx.
- [ ] `npx tsc --noEmit` returns 0 errors in the dashboard.

#### DoD
- [ ] `npx vitest run src/pages/memory.test.tsx` returns PASS; `npx tsc --noEmit` returns 0 errors.

---

## Phase 3: Integration Validation (MANDATORY)

### T3.1 — e2e graph round-trip + full validation chain

#### Objective
`remember → GET /v1/memory/graph` returns non-empty `edges` against the rebuilt themory; full gateway + dashboard suites green.

#### Why this step
1. **What:** add a graph round-trip to `tests/e2e/memory_e2e_test.go` (mirror the entities round-trip `:293`); run full Go + dashboard suites.
2. **Why now:** the Goal metric; proves the real cross-repo integration (gateway → rebuilt themory → pg).

#### Evidence
- `tests/e2e/memory_e2e_test.go:293` (entities round-trip via `cloudGet`).

#### Files to edit
```
tests/e2e/memory_e2e_test.go — graph round-trip (remember a relation, GET /v1/memory/graph, assert edge)
```

#### Deep Dives
- Seed: `remember` "John Smith works at Google" (LLM emits relations per T0.1 finding; if mock can't, seed via the documented deterministic path). Then `cloudGet("/v1/memory/graph?scope=user")` → assert `edges` contains source=John Smith/target=Google OR (if seeding limited) `nodes` non-empty + edges array present.
- Per-customer isolation: a second key's `/graph` does NOT see the first's edges (mirror the entities isolation assertion `:345`).

#### TDD
```
RED:     TestMemoryE2E_GraphRoundTrip — remember relation; const status,body = cloudGet("/v1/memory/graph?scope=user"); expect status==200 and body.edges present (non-empty when LLM emits relations)
GREEN:   (impl done in P1-2; e2e drives the live stack)
VERIFY:  go test ./tests/e2e/... -run GraphRoundTrip (dev stack up, themory rebuilt)
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — sequential e2e.

#### Acceptance Criteria
- [ ] `go test ./tests/e2e/ -run GraphRoundTrip` returns PASS; the second-key `/graph` does NOT see the first key's edges.
- [ ] All suites green (Go unit + contract + e2e; dashboard vitest + tsc + eslint).

#### DoD
- [ ] full chain (`go test ./...` + dashboard `vitest`/`tsc`/`eslint` + e2e) returns PASS; CHANGELOG `[Unreleased]` updated.

### Execution
```
go build ./... && go vet ./... && go test ./internal/... ./tests/unit/...
cd dashboard && npx tsc --noEmit && npx eslint src/pages/memory/graph.tsx src/pages/memory/graph.test.tsx && npx vitest run src/pages/memory/
# e2e (dev stack up + themory rebuilt per T0.1):
go test ./tests/e2e/... -run 'Graph'
```

### Acceptance Criteria
- [ ] Go: build + vet + unit + contract green.
- [ ] Dashboard: tsc + eslint + vitest green.
- [ ] e2e graph round-trip green.
- [ ] No new dependency (Go go.mod + dashboard package.json unchanged except code).

### If Validation Fails
1. Separate plan-caused vs pre-existing failures.
2. Fix plan-caused; re-run.
3. Pre-existing logged in PR.

## Coverage Matrix

| # | Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Gateway client `/graph` | T1.1 | `Graph` method + DTOs |
| 2 | Gateway handler + interface | T1.2 | `Graph` handler + interface + fakes |
| 3 | SDK + BFF routes | T1.3 | both route registrations + route-table test |
| 4 | Dashboard graph view | T2.1 | `GraphPage` + SVG node-link |
| 5 | Reachable in UI | T2.2 | router + hub card + sidebar |
| 6 | themory serves /graph | T0.1 | image rebuild |
| 7 | e2e round-trip | T3.1 | graph round-trip test |
| 8 | D1 no new dep | T2.1 | dependency-free SVG |
| 9 | D3 scope!=user empty | T1.1 | client empty fallback |
| 10 | D5 empty-array invariant | T1.1, T1.2 | nil→[] both layers |
| 11 | per-customer isolation | T3.1 | isolation assertion |

**Coverage: 11/11 (100%)**

## Global Definition of Done
- [ ] All phases complete; all tasks committed.
- [ ] Go: `go build ./...` + `go vet ./...` + `go test ./internal/... ./tests/unit/...` green.
- [ ] Dashboard: `tsc --noEmit` + `eslint` + `vitest` green.
- [ ] e2e graph round-trip green vs rebuilt themory.
- [ ] No new dependency (go.mod + package.json deps unchanged).
- [ ] CHANGELOG updated.
- [ ] Backward compat: existing entities/skills/metrics routes + views unchanged.
- [ ] Plan archived after `/review` READY_TO_MERGE + merge.

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| themory `/graph` (HTTP, gateway client) | upstream 5xx / unreachable | fake client returns error in handler unit test | handler → 502 MEMORY_UPSTREAM_UNAVAILABLE (not 500, not masked 200) |
| themory `/graph` (HTTP) | returns `{}` (null nodes/edges) | httptest server returns `{}` in contract test | client coerces nil→`[]`; dashboard renders empty state |
| dashboard → BFF (fetch) | non-user scope | scope tab switch in graph.test.tsx | empty state, no crash (D3) |

## Final Phase: Integration Validation (MANDATORY)
Covered by T3.1 — e2e round-trip + full Go + dashboard validation chain. Plan NOT done until the e2e graph round-trip is green against the rebuilt themory image.
