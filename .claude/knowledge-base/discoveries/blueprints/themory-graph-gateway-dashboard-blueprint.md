# Blueprint: TheMemory Graph — Gateway BFF + Dashboard view

**Slug:** themory-graph-gateway-dashboard
**Date:** 2026-06-20
**Method:** in-repo prior-art study (the entities integration is the exact mirror) + theo-memory Slice 2 contract.

## Objective

Expose TheMemory's `GET /v1/scopes/:type/:id/graph` (`{nodes, edges}`, shipped on theo-memory `develop` as Slice 2) through the theo-cloud gateway (`/v1/memory/graph` SDK + `/v1/dashboard/memory/graph` BFF) and render it as a graph view in the dashboard. NO graph DB — two Postgres tables + JOINs already do the work upstream; the gateway is a transport + the dashboard is a renderer.

## The mirror: entities integration is the exact precedent

Slice 1 entities are ALREADY wired end-to-end. Graph mirrors it line-for-line:

| Layer | Entities (exists) | Graph (to build) |
|---|---|---|
| Upstream REST | `GET /v1/scopes/user/{id}/entities` → `{entities:[{id,scope_type,memory_count,last_seen_at}]}` | `GET /v1/scopes/user/{id}/graph` → `{nodes:[…entity shape…], edges:[{source,relation,target,memory_count}]}` |
| Gateway client (`internal/themory/client.go`) | `Entity`/`EntitiesResult` types + `Entities(ctx,userID,scope)` (`:175,:415`); scope!="user" → empty | `GraphNode`/`GraphEdge`/`GraphResult` + `Graph(ctx,userID,scope)`; scope!="user" → empty |
| Client interface (`internal/routes/memory.go:42`) | `Entities(...)` | add `Graph(...)` |
| Handler (`internal/routes/memory.go:266`) | `Entities(w,r)` — `validEntityScopes` 400 guard; `memory:read`; empty-array fallback | `Graph(w,r)` — same guards; nodes+edges empty-array fallback |
| Routes (`cmd/main.go`) | SDK `:418` `r.With(RequireScope memory:read).Get("/entities", …)` + BFF `:468` `r.Get("/entities", dashboardMemoryHandler.Entities)` | add `/graph` on BOTH surfaces |
| Dashboard view | `pages/memory/entities.tsx` (DataTable, scope tabs, `cloudFetch('/v1/dashboard/memory/entities')`, react-query) | `pages/memory/graph.tsx` (SVG node-link, scope tabs, `cloudFetch('/v1/dashboard/memory/graph')`) |
| Router (`dashboard/src/app.tsx:75`) | lazy `EntitiesPage` | lazy `GraphPage` + `<Route path="/memory/graph">` |
| Memory hub (`pages/memory.tsx:165`) | card → `/memory/entities` | card → `/memory/graph` |

## ADRs to lock in the plan

- **D1 — Dependency-free SVG node-link render (NOT cytoscape/react-flow).** The dashboard has NO graph lib today. A 1–2 hop view (blueprint scope) does not justify a ~heavy dep (cytoscape ≈ 400KB, reactflow heavy) — KISS + bundle + zero deps-audit surface. Render nodes on a deterministic circular layout + edges as SVG lines with relation labels. Alternative (cytoscape) REJECTED: over-engineered for 1–2 hop; adds dep + audit.
- **D2 — Shared `Graph` handler on BOTH route surfaces** (SDK `memory:read` + dashboard BFF JWT), exactly like `Entities`. The handler is transport-only; the scope→empty rule lives in the client (mirror).
- **D3 — `scope != "user"` → empty graph** (shared-key model: each customer is one USER subject; session/agent/repo tabs are honestly empty). Mirror of the entities `:422` rule.
- **D4 — Prereq: rebuild the themory image with Slice 2** so the dev/e2e themory backend serves `/graph`. The running `themory-e2e:latest` (2026-06-19) predates Slice 2 → e2e would 404 without rebuild.
- **D5 — Empty-array invariant**: `nodes` and `edges` ALWAYS arrays, never null (D3-inheritance from Plan 1; dashboard never NaN/crash).

## Edges-half DTO (from theo-memory Slice 2 `/graph`)

```json
{ "nodes": [{"id":"John Smith","scope_type":"user","memory_count":2,"last_seen_at":"…"}],
  "edges": [{"source":"John Smith","relation":"works at","target":"Google","memory_count":1}] }
```

## Coverage corners

- **Tests:** Go — `internal/themory/contract_test.go` (client maps graph), `internal/routes` handler test (scope guard + empty fallback + upstream-fail 502); dashboard — `pages/memory/graph.test.tsx` (renders nodes+edges, empty state, scope tabs). e2e — `tests/e2e/memory_e2e_test.go` graph round-trip vs rebuilt themory.
- **Deps:** none new (SVG render dependency-free; Go stdlib + existing chi/react-query/@usetheo/ui).
- **Tools:** existing — `go test`, `vitest`, `playwright` (dashboard e2e), docker compose dev stack.
- **Techniques:** mirror the entities BFF + a deterministic SVG node-link layout.

## Related
- theo-memory Slice 2 plan: `theo-data/theo-memory/.claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md` (the upstream `/graph` contract).
- Entities integration (the in-repo mirror): `internal/routes/memory.go` Entities + `dashboard/src/pages/memory/entities.tsx`.
