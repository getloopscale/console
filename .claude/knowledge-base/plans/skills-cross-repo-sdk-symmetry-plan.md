---
slug: skills-cross-repo-sdk-symmetry
milestone_id: M3
created_at: 2026-06-23
repo: theo-cloud
goal: Expose the cross-repo flat skills listing on the programmatic SDK surface — mount GET /v1/memory/skills/all under Bearer + RequireScope("memory:read") delegating to the EXISTING generic MemoryHandler.ListSkillsAll — so an SDK-key consumer (not only the dashboard BFF) can list all skills for its subject across every repo, measured by a Go test that the handler-under-RequireScope("memory:read") returns 403 without the scope and 200 with it (bare-subject passthrough + 502-on-upstream already covered), plus an e2e cross-repo flat-list through the real gateway mux, with the BFF route + handler + themory contract UNCHANGED.
---

# Plan: skills-cross-repo-sdk-symmetry (M3)

> Closes the programmatic-vs-dashboard asymmetry surfaced by the `skills-cross-repo-flat-list-gateway` `/review` (F7/F-2, LOW/INFO): the cross-repo flat skills listing is exposed ONLY on the dashboard BFF (`/v1/dashboard/memory/skills/all`, JWT/session) — NOT on the programmatic SDK surface (`/v1/memory/*`, Bearer + `RequireScope`) — even though the per-repo `ListSkills` is on BOTH. The themory provider endpoint (`GET /v1/scopes/skill/:subject/all`, themory v0.21.0) and the gateway handler (`MemoryHandler.ListSkillsAll`) already exist and are tested; this is a thin **one-route** addition that wires the existing generic handler onto the SDK route block. No handler change, no themory change.

## Goal

> "Mount `GET /v1/memory/skills/all` on the programmatic SDK surface (`/v1/memory` block, `auth.RequireScope(db, "memory:read")`) delegating to the EXISTING `MemoryHandler.ListSkillsAll`, measured by `tests/unit/memory_skills_all_route_test.go` asserting the handler under `RequireScope("memory:read")` returns **403 without** the scope and **200 with** it, plus an e2e cross-repo flat-list through the real gateway mux — with `MemoryHandler.ListSkillsAll`, the BFF `/v1/dashboard/memory/skills/all` route, and the themory contract ALL byte-unchanged."

## Context

`MemoryHandler.ListSkillsAll` (`internal/routes/memory.go:447`) is fully generic and already handler-tested (`tests/unit/memory_handlers_test.go:1071+`): it passes the BARE authenticated `user.Subject` (ignoring any `?subject` query param — anti-spoof, ADR D1 of the gateway cycle), forwards `limit`/`offset`/`q`/`includeSuperseded`, returns 200 with per-row `repoId`, 401 unauthenticated, 502 on upstream error, and coalesces nil skills to `[]`. It is currently wired ONLY to the dashboard BFF (`internal/routes/dashboard_memory.go:159` → `cmd/main.go:509`). The per-repo `GET /v1/memory/skills` IS already on the SDK surface (`cmd/main.go:454`). M3 adds the missing SDK route for the cross-repo variant, at scope parity with the per-repo route.

This is theo-cloud work; the repo has NO `/plan-confidence` scorer (the cycle skills are theo-memory-only), so the cycle DISCIPLINE is driven manually: this plan doc + TDD Go test + manual `/review` agents.

## Baseline Context (current state)

### Files that will be touched

| File | Why it exists today | Change | Invariant to preserve |
|---|---|---|---|
| `cmd/main.go` | route registration; SDK `/v1/memory` block at `:440-491`; per-repo skills at `:454` (`RequireScope("memory:read").Get("/skills", memoryHandler.ListSkills)`); BFF block at `:496+` (`:509` mounts `/skills/all` on the BFF) | ADD one line in the SDK block: `r.With(auth.RequireScope(db, "memory:read")).Get("/skills/all", memoryHandler.ListSkillsAll)` | every existing route UNCHANGED; BFF `/skills/all` UNCHANGED; place the static `/skills/all` so it does not collide with `/skills` or `/skills/{skillID}` (chi: distinct static segment, no collision) |
| `tests/unit/memory_skills_all_route_test.go` (NEW) | — | route-gating test: handler under `RequireScope("memory:read")` → 403 without scope, 200 with (sqlmock + the real `ListSkillsAll` + `fakeTheMemory`) | mirrors `scope_middleware_test.go` sqlmock pattern |
| `tests/e2e/memory_e2e_test.go` | end-to-end through the real gateway mux; per-repo skills e2e at `:445` (`TestMemoryE2E_SkillsBrowse`) | ADD `TestMemoryE2E_SkillsAllCrossRepo`: seed 2 repos under one subject → `/v1/memory/skills/all` returns both with `repoId`; a 2nd customer sees none (isolation) | mirror `seedSkill`/`seedAPIKey`/`cloudGet` helpers; no helper change |
| `CHANGELOG.md` | Inquebrável Rule 6 | `[Unreleased] § Added` entry | — |

### Current callers / dependents

- **`MemoryHandler.ListSkillsAll`** (`internal/routes/memory.go:447`) — generic; passes bare `user.Subject`; already handler-tested (bare-subject/401/502). UNCHANGED.
- **`auth.RequireScope(db, required)`** (`internal/auth/scope.go:67`) — the shared Bearer scope middleware fronting every `/v1/memory/*` route; SELECTs `theo_api_keys` by `key_hash`, 403 (`scope_required`) when `scopes` lacks `required`, fires a fire-and-forget `last_used_at` UPDATE ONLY on grant. UNCHANGED.
- **`Client.ListSkillsAll`** (`internal/themory/client.go:603`) — `GET /v1/scopes/skill/:subject/all` against themory; tested in `internal/themory/skills_all_test.go`. UNCHANGED.
- **BFF `DashboardMemoryHandler.ListSkillsAll`** (`internal/routes/dashboard_memory.go:159`) — mints a key + delegates to the same handler; mounted at `cmd/main.go:509`. UNCHANGED.

### Domain glossary

- **SDK surface** — `/v1/memory/*`, authenticated by `theo_live_*` Bearer keys, each route gated by `auth.RequireScope(db, <scope>)`. The programmatic consumer path (vs the dashboard BFF, JWT/session).
- **bare subject** — the cross-repo list uses the authenticated subject directly as the themory `:subject` path segment (no `{subject}:{repoId}` namespacing); themory prefix-scans `agent_id LIKE '{subject}:%'` and returns each row's bare `repoId`.

### Architecture boundaries affected

- **No DIP/layer boundary crossed.** The change is one route-registration line in `cmd/main.go` (composition root) + tests. No handler, client, or themory contract change. No new public type.
- **Scope parity:** the new route reuses the IDENTICAL `auth.RequireScope(db, "memory:read")` middleware expression as the per-repo `/v1/memory/skills` route and every other read route — scope semantics inherited, not redefined.

## Prior Art & Related Work

- **In-repo precedent:** the per-repo `GET /v1/memory/skills` (`cmd/main.go:454`) is the exact sibling — same handler family, same `memory:read` scope, same `MemoryHandler`. M3 mirrors it for the cross-repo variant.
- **The BFF mount** (`cmd/main.go:509`, `GET /v1/dashboard/memory/skills/all`) is the dashboard-side companion already shipped (theo-cloud v0.8.0); M3 is its SDK-surface twin.
- **Test patterns:** `scope_middleware_test.go` (sqlmock + `RequireScope` 403/200) for the unit gating test; `TestMemoryE2E_SkillsBrowse` (`tests/e2e/memory_e2e_test.go:445`) for the e2e mount + isolation proof.

## ADRs

### D1 — Reuse the existing generic `MemoryHandler.ListSkillsAll`; add ONLY a route line

- **Decision:** wire the existing handler onto the SDK block; no new handler, no handler change.
- **Rationale:** the handler is already generic (bare subject from the session, not the path/query) and fully tested; the BFF already delegates to it. KISS + DRY — a second handler would duplicate logic. The asymmetry is purely a missing route registration.
- **Alternatives rejected:** (a) a separate SDK-specific handler — duplicates the BFF handler for no behavioral difference; (b) a themory contract change — unnecessary, the provider endpoint already exists.

### D2 — Scope `memory:read`, mirroring the per-repo SDK `/v1/memory/skills`

- **Decision:** gate with `auth.RequireScope(db, "memory:read")`.
- **Rationale:** the cross-repo list is a READ of skills; the per-repo `/skills` SDK route uses `memory:read`; parity is correct and least-surprising. Listing all skills for the subject is no more privileged than listing one repo's.
- **Alternatives rejected:** a new `memory:read:skills` sub-scope — over-segmentation (YAGNI); no other route sub-divides read by resource.

## Dependency Graph

```
T1.1 (RED: route-gating unit test) ── precedes ──▶ T1.2 (GREEN: add the SDK route line) ── precedes ──▶ T1.3 (e2e case + build/vet/test)
```

Single phase, strictly sequential (TDD).

## Phase 1 — Mount the cross-repo flat list on the SDK surface

### T1.1 — RED: route-gating unit test

#### Why this step
**Action:** add `tests/unit/memory_skills_all_route_test.go` mounting the real `MemoryHandler.ListSkillsAll` under `auth.RequireScope(db, "memory:read")` (sqlmock-backed `theo_api_keys` lookup, mirroring `scope_middleware_test.go`): case A — a `theo_live_*` key whose `scopes` include `memory:read` → 200 (handler reached, fake returns a skill); case B — a key whose `scopes` are `["memory:write"]` only → 403 `scope_required`, handler NOT reached.
**Reasoning:** the handler unit tests deliberately bypass middleware ("RequireScope is plugged in main.go"), so the SDK acceptance criterion "403 without memory:read" is currently unproven for this handler. This test closes that gap deterministically without a running stack. RED: before the route line + with the test written against the wiring, it documents the contract (the handler itself has no scope check, so the test only passes once wrapped — it asserts the MIDDLEWARE gates, which is the deliverable's contract).

#### Files to edit
- `tests/unit/memory_skills_all_route_test.go` (NEW)

#### TDD
- `TestMemorySkillsAllRoute_Forbidden_WithoutMemoryRead` — key scopes `["memory:write"]` → 403, `fake.lastSkillsAllSubject == ""` (handler not reached).
- `TestMemorySkillsAllRoute_Ok_WithMemoryRead` — key scopes `["memory:read"]` → 200, body contains `"repoId"`, `fake.lastSkillsAllSubject == "<subject from key>"` (bare subject from the authed session).

#### Concurrency tests
(none — single-threaded; the middleware's async `last_used_at` UPDATE is fire-and-forget and is matched by the existing sqlmock success-path expectation.)

#### Acceptance criteria
- Running `go test ./tests/unit/ -run TestMemorySkillsAllRoute` exits zero with both cases passing once the route contract holds.

#### DoD
- `go test ./tests/unit/ -run TestMemorySkillsAllRoute -v` → 2 passed.

### T1.2 — GREEN: add the SDK route line

#### Why this step
**Action:** in `cmd/main.go`, inside the `/v1/memory` block (next to the per-repo `/skills` route), add:
`r.With(auth.RequireScope(db, "memory:read")).Get("/skills/all", memoryHandler.ListSkillsAll)`.
**Reasoning:** this is the deliverable — the missing SDK route. `chi` matches the static `/skills/all` distinctly from `/skills` and the wildcard `/skills/{skillID}` (DELETE), so no route collision. The handler + scope are reused verbatim.

#### Files to edit
- `cmd/main.go` (one line in the `/v1/memory` block)

#### TDD
- T1.1 route-gating test stays green; `go build ./...` compiles (handler method exists).

#### Concurrency tests
(none — single-threaded.)

#### Acceptance criteria
- `git diff cmd/main.go` shows exactly one added route line in the `/v1/memory` block; the BFF `/skills/all` line is untouched; per-repo `/skills` untouched.

#### DoD
- `go build ./...` clean; `go vet ./...` clean.

### T1.3 — e2e cross-repo flat list through the real mux + full validation

#### Why this step
**Action:** add `TestMemoryE2E_SkillsAllCrossRepo` to `tests/e2e/memory_e2e_test.go` mirroring `TestMemoryE2E_SkillsBrowse`: seed 2 skills under one subject's namespace for two DIFFERENT bare repoIds (`alpha:repo-a`, `alpha:repo-b`) → `cloudGet(alphaKey, "/v1/memory/skills/all")` returns BOTH with correct per-row `repoId`; `cloudGet(betaKey, ...)` returns `"skills":[]` (cross-customer isolation). Then run `go build`, `go vet`, `go test ./tests/unit/...`.
**Reasoning:** the e2e proves the route is ACTUALLY mounted in `cmd/main.go` (not just a unit replica) + scope-gated (the seeded key carries `memory:read`) + bare-subject + isolation, end-to-end through the real gateway → real themory. This is the end-to-end mount proof the unit test cannot give.

#### Files to edit
- `tests/e2e/memory_e2e_test.go` (NEW test func; reuses existing `seedSkill`/`seedAPIKey`/`cloudGet`)

#### TDD
- `TestMemoryE2E_SkillsAllCrossRepo` GREEN when the dev stack runs the gateway built WITH the new route.

#### Concurrency tests
(none.)

#### Acceptance criteria
- Unit suite green (`go test ./tests/unit/...`); `go build`/`go vet` clean; the e2e passes against the dev stack OR, if the stack cannot be brought up locally, the test is committed (it gates CI) with honest disclosure that local execution was blocked (the stated unit-level acceptance is fully satisfied without it).

#### DoD
- `go build ./... && go vet ./... && go test ./tests/unit/...` all green; e2e run-or-honestly-disclosed.

## Coverage Matrix

| Goal claim / requirement | Task |
|---|---|
| `GET /v1/memory/skills/all` mounted in SDK block with `RequireScope("memory:read")` | T1.2 |
| Go test: scope-gated 403 without `memory:read` | T1.1 |
| Go test: 200 with `memory:read` + bare-subject passthrough | T1.1 (+ existing handler tests) |
| 502 on upstream error | existing handler test (`memory_handlers_test.go`) — unchanged |
| BFF route + handler UNCHANGED; no themory change; per-repo `/skills` UNCHANGED | T1.2 (diff scope) |
| End-to-end mount + cross-customer isolation | T1.3 (e2e) |
| CHANGELOG `Added` | Final Phase |

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | chi route collision between `/skills/all` and `/skills`/`/skills/{skillID}` | LOW | chi matches static segments before wildcards; `/skills/all` (GET) vs `/skills` (GET) vs `/skills/{skillID}` (DELETE) are distinct — verified by go build + e2e | implementer |
| 2 | e2e not runnable locally (dev-stack image-build flakiness — sharp/libvips CDN; gateway rebuild needed for the new route) | MEDIUM | the STATED acceptance (403/bare-subject/502) is fully unit-covered without the stack; the e2e is committed for CI + run if the stack comes up; honest disclosure per Rule 3 if blocked | implementer |
| 3 | Unit route-gating test is a wrapper replica, not the cmd/main.go registration | LOW | the e2e (T1.3) is the real-registration proof; the route line uses the identical pattern as 8 sibling routes; go build proves the handler+route compile | implementer |

## Unresolved Questions

(none — every decision is resolved at plan time: the handler/client/BFF already exist + are tested; the only deliverable is the route line + its gating proof, mirroring the per-repo `/skills` sibling.)

## Failure scenarios

External I/O touched: the gateway → themory HTTP call (only in the e2e; unit uses the fake). Scenarios:

| Dependency | Failure mode | Test reproduces? | Expected behavior |
|---|---|---|---|
| themory upstream | connection refused / 5xx | yes (existing `TestMemorySkillsAll_UpstreamErrorReturns502` handler test) | 502 `MEMORY_UPSTREAM_UNAVAILABLE` |
| auth DB (theo_api_keys lookup) | key missing / wrong scope | yes (T1.1 route-gating + `scope_middleware_test`) | 401 (bad/missing key) / 403 (`scope_required`) |
| dev stack down | gateway unreachable | e2e errors (not skipped) — run only when stack up | n/a (CI gate) |

## Global Definition of Done

- [ ] `go build ./...` clean.
- [ ] `go vet ./...` clean.
- [ ] `go test ./tests/unit/...` green (incl. the new route-gating test).
- [ ] `cmd/main.go` diff = exactly one added SDK route line; BFF + per-repo routes untouched.
- [ ] e2e cross-repo test added (run against the stack OR honestly disclosed as CI-gated).
- [ ] `CHANGELOG.md` `[Unreleased] § Added` entry.
- [ ] No themory change; no handler change.
- [ ] Manual `/review` (architecture + tests + cross-validation + domain) → READY_TO_MERGE.

## Final Phase: Integration Validation

- `go build ./... && go vet ./... && go test ./tests/unit/...`
- e2e `TestMemoryE2E_SkillsAllCrossRepo` against the dev stack (rebuild the gateway binary + image with the new route) — run or honestly disclose.
- The plan is NOT complete until the above pass AND manual `/review` is READY_TO_MERGE.
