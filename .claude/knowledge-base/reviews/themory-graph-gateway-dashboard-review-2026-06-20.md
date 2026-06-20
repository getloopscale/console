# Review: themory-graph-gateway-dashboard

**Date:** 2026-06-20
**Reviewers (spawned agents):** 4 parallel — architecture, tests, wiring+cross-validation, domain (Go API + frontend)
**Diff:** `37e9c87..HEAD` (4 commits: plan docs + Phase 1 gateway + Phase 2 dashboard + Phase 3 e2e + review fixes)
**Findings:** 0 BLOCKER · 0 HIGH · 1 MEDIUM (documented) · 4 LOW (2 closed, 2 accepted) · 3 INFO
**Verdict:** READY_TO_MERGE

## Summary

The graph integration is a faithful, secure line-for-line mirror of the shipped entities integration. All 4 specialist reviewers independently returned **READY**. SOLID/layering clean (client mirrors Entities, handler transport-only, BFF thin mint+delegate, DIP direction respected). All 5 ADRs adhered (D1 dependency-free SVG — confirmed zero new npm deps; D2 shared handler both surfaces; D3 scope!=user→empty; D5 nodes+edges never null at client AND handler). No IDOR (subject from auth, never query). The e2e proves the full cross-repo wire (gateway→rebuilt-themory→pg) including graph round-trip + invalid-scope-400 + per-subject isolation.

## Quality gates (verified)
- Go: `go build ./...` 0 · `go vet ./internal/...` clean · `gofmt -l` clean · `go test ./internal/themory/ ./internal/routes/ ./tests/unit/` PASS.
- Dashboard: `tsc --noEmit` 0 · `eslint` clean · `vitest src/pages/memory/` graph 7/7 + memory 5/5.
- e2e: `make e2e` (THEMORY_IMAGE Slice-2) ALL GREEN — `remember-relation_then_graph_round-trip` PASS, `graph_invalid_scope_returns_400` PASS, `remember-attributed_then_recall-asOf` PASS (adapted), Skills/Browse/Write PASS.

## Findings

### F1 — MEDIUM (documented, non-blocking) — SDK route-table unit test asserts handler, not chi registration
The plan claimed a route-table unit test asserting BOTH `/v1/memory/graph` (SDK) + `/v1/dashboard/memory/graph` (BFF) resolve. The BFF row exists (`tests/unit/dashboard_memory_test.go` SECURITY_GATE table); the SDK route registration (`cmd/main.go` `RequireScope memory:read`) is proven by the **e2e** (a real HTTP GET `/v1/memory/graph` through the live gateway returns 200) rather than a router-mount unit test. **Resolution:** the e2e is the authoritative registration proof (stronger than a unit mux-mount); the entities mirror has the identical unit-test gap (consistent precedent). A brittle router-mount unit test was deliberately NOT added (would require DB + auth middleware in-process). Accepted with e2e coverage.

### F2 — LOW — CLOSED — dashboard error-branch untested
Added `renders an error Alert when the backend is unreachable` (`graph.test.tsx`, `mockRejectedValueOnce`).

### F3 — LOW — CLOSED — non-user scope (D3) not exercised at the view layer
Added `non-user scope shows the empty state` (`graph.test.tsx`, `initialEntries: ['/memory/graph?scope=session']`).

### F4 — LOW (accepted) — e2e graph round-trip is shape-only
Asserts `{nodes,edges}` present + isolation, NOT non-empty edges (the hermetic mock LLM may not emit relations; plan EC-3/D4 honest caveat). The non-empty-edges path is proven upstream by theo-memory Slice 2's GOAL test. Accepted per Inquebrável Rule 3.

### INFO
- OpenAPI `type` enum omits `repo` (`openapi/themory.yaml`) — pre-existing pattern identical across entities/list/metrics; the gateway only ever GETs `/v1/scopes/user/...` (non-user short-circuits client-side), so `repo` never reaches the spec-validated path. Not a graph regression.
- Contract test names diverge from the plan's literal names (behaviorally equivalent, reuse `validateRequest` OpenAPI conformance).
- The diff also adapted the PRE-EXISTING entities e2e assertion from `attributed_to` peer → extracted-entity-node semantics. This is a correct, traceable adaptation to TheMemory Slice 1 entity-extraction (shipped v0.10.0), which changed `/entities` from `attributed_to`-derived to real extracted nodes. Honestly documented in-comment + CHANGELOG `### Changed`. Not scope creep — it is a required consequence of the Slice-2 themory image the graph feature depends on.

## Cross-validation
11/11 Coverage Matrix rows implemented + wired end-to-end. No orphan symbols (interface `Graph` implemented by production Client + both fakes, compile-verified). All 3 dashboard wirings present (route + hub card + sidebar).

## Handoff decision
**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. The single MEDIUM (F1) is covered by the e2e + consistent with the entities precedent. F2/F3 closed in-cycle. All DoDs + acceptance criteria validated:
- Gateway `/v1/memory/graph` + BFF `/v1/dashboard/memory/graph` — DONE, tested, e2e-proven.
- Dashboard graph view at `/memory/graph` (SVG, scope tabs, empty state, reachable) — DONE, tested.
- No new dependency; backward-compat preserved (entities/skills/metrics unchanged).
- Full integration validated against the rebuilt Slice-2 themory image.

## Spawned agents (audit trail)
architecture · tests · wiring+cross-validation · domain(Go-api+frontend) — 4 parallel general-purpose reviewers, 2026-06-20. All verdicts: READY.
