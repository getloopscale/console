---
slug: engine-project-cap-enforcement
milestone_id: M4
created_at: 2026-06-28
goal: Enforce the per-Account project cap at the theo engine's project-creation path — reject the (N+1)th project beyond the Account's plan cap with a typed 422 error, atomically and observably, mirroring the canonical Red Team #101 scale-cap pattern.
---

# Plan — M4 Engine project-cap enforcement

> Implementation repo: **theo** (engine, Go under `api/`, sha 98fed9b4). Artifacts tracked in the theo-cloud account-tenancy knowledge-base (like M2/M3 migrations).

## Goal

Make the per-Account project cap actually BIND at project creation:

- **G1** — project creation resolves the Account's cap (`tenant → account → subscription.plan → plan_limits.projects`) and rejects the (N+1)th project beyond the cap with a typed error + HTTP 422 (`PROJECTS_EXCEED_PLAN`), mirroring the canonical `REPLICAS_EXCEED_PLAN` (#101). The existing per-TENANT 402 projects enforcement is replaced.
- **G2** — the cap check is ATOMIC with the insert (two concurrent creations at the boundary cannot both succeed), via a per-account advisory lock; proven under `-race`. Enterprise (cap=NULL) is never blocked; grandfathered over-cap accounts keep existing projects (block-new-only).
- **G3** — a runtime metric (`plan_limit_violations{metric="max_projects_per_account"}`) increments on rejection; the whole path is proven by unit (httptest) + e2e (real pg).

Source: discovery blueprint `.claude/knowledge-base/discoveries/blueprints/engine-project-cap-enforcement-blueprint.md` + the `account-level-tenancy` ADR.

## Coverage Matrix

| # | Goal claim | Task(s) | Status |
|---|---|---|---|
| G1a | typed error PROJECTS_EXCEED_PLAN → 422 + ProjectCapChecker (account-scoped plan/cap resolution) | T1.1, T1.2 | mapped |
| G1b | replace per-tenant 402 projects middleware with per-Account 422 enforcement at create | T2.1, T3.1 | mapped |
| G2 | atomic cap check+insert (advisory lock) + unlimited/grandfathered handling, -race proof | T2.1, T2.2, T3.2 | mapped |
| G3 | metric on rejection + unit + e2e proof | T1.2, T3.1, T3.2 | mapped |

Every goal claim maps to ≥ 1 task. No gap.

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit (sha) | Why it changes | Invariants to preserve |
|---|---|---|---|---|
| `theo/api/pkg/errors/errors.go` | 779 | 98fed9b4 | add `NewProjectsExceedPlan` + `PROJECTS_EXCEED_PLAN` sentinel (mirror `NewReplicasExceedPlan`) | existing error codes unchanged |
| `theo/api/pkg/errors/http/mapping.go` | 146 | 98fed9b4 | map `PROJECTS_EXCEED_PLAN` → 422 | existing mappings unchanged |
| `theo/api/pkg/enforcement/store.go` | 102 | 98fed9b4 | add `GetAccountPlan(tenantID)` (account-scoped sibling of `GetTenantPlan:64`) | `GetTenantPlan` unchanged (other callers) |
| `theo/api/internal/routes/projects.go` | 496 | 98fed9b4 | inject `ProjectCapChecker`; resolve cap before insert; map typed error to 422 | existing Create validation/paths unchanged |
| `theo/api/internal/db/project_wrapper.go` | — | 98fed9b4 | atomic guard: advisory lock + per-account count + insert in one tx | `CreateProject` signature compatible; `UNIQUE(tenant_id,name)` honored |
| `theo/api/internal/server/router.go` | 601 | 98fed9b4 | remove the per-tenant `projects` enforcement middleware (`:220-228,320`) — superseded | build/env/seat enforcement middlewares unchanged |
| `theo/api/cmd/setup_orchestrator.go` | 302 | 98fed9b4 | wire `SetProjectCapChecker(planCap)` after `EnsureProductionWired` (mirror `:222-230`) | scale checker wiring unchanged |
| `theo/api/internal/routes/projects_test.go` | NEW/extend | 98fed9b4 | unit tests (over-cap→422, under→2xx, nil→noop, Starter cap=1) | — |
| `theo/api/internal/metrics/metrics.go` | — | 98fed9b4 | reuse `PlanLimitViolations` (`:625`) — no change, new label value only | metric shape unchanged |

### Current callers / dependents

- `POST /api/v1/projects` → `ProjectHandler.Create` (`projects.go:207`) → `store.CreateProject(CreateProjectInput{TenantID,Name,CreatedBy})`. The route currently has `projectEnforcement` middleware (`router.go:320`) returning 402.
- The #101 canonical to mirror: `ScaleReplicasChecker` (`scale.go:78`), `enforceReplicaCap` (`scale.go:351-370`), `NewReplicasExceedPlan` (`errors.go:418`), `mapping.go:100` (422), `PlanLimitViolations` (`metrics.go:625`), wiring `cmd/setup_orchestrator.go:222-230`, tests `scale_test.go` RedTeam101.
- `enforcement.PlanLimiter.CheckValue(tenantID, metric, requested)` (`limiter.go:148`) resolves plan via `GetTenantPlan` (`store.go:70`, `WHERE tenant_id`). M4 adds an account-scoped resolution.
- `plan_limits` row `metric='projects'` already holds caps: starter=1, pro=10, team=10, enterprise=NULL (`000002` seed + `000032` re-assert). `tenants.account_id` is NOT NULL since M3 `000044`.

### Domain glossary

- **Account** — billing/cap entity (M2); `acct-{16hex}`; all its tenants share one plan + one cap.
- **Project cap** — `plan_limits.hard_limit WHERE metric='projects'` for the Account's plan; NULL = unlimited (enterprise).
- **ProjectCapChecker** — injectable interface (mirror `ScaleReplicasChecker`) that resolves an Account's plan + project cap; testable with a fake.
- **Block-new-only** — enforcement bars NEW creation when count ≥ cap; never deletes/breaks existing projects or fails reads.

### Architecture boundaries affected

Per `rules/architecture.md`: the cap policy lives in `pkg/enforcement` (plan/cap resolution) + `pkg/errors` (typed error) — the canonical SoT the #101 path already uses; the create-path wiring stays in `internal/routes` + `internal/db` (the atomic guard); composition in `cmd/setup_orchestrator.go`. No new package, no cross-service call (the engine's own DB holds accounts/subscriptions/plan_limits/projects/tenants). theo-cloud untouched.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `github.com/jackc/pgx/v5` | (as pinned) | go | advisory lock + DB — already used |
| `github.com/prometheus/client_golang` | (as pinned) | go | `PlanLimitViolations` metric — already used |
| `github.com/DATA-DOG/go-sqlmock` | (as pinned) | go | unit DB mocking — already used |

### New

(none — M4 introduces no new dependency; mirrors the #101 infrastructure.)

### Removed

(none — the per-tenant projects middleware is removed from the route wiring, but `enforcement.Middleware` stays for build/env/seat.)

## Tasks

### Phase 1 — typed error + account-scoped checker (G1a)

### T1.1 — `NewProjectsExceedPlan` typed error + 422 mapping

#### Files to edit
`theo/api/pkg/errors/errors.go`, `theo/api/pkg/errors/http/mapping.go`

#### Why this step
Action: add a `PROJECTS_EXCEED_PLAN` sentinel + `NewProjectsExceedPlan(plan string, limit, current int, accountID string) *TheoError` (mirror `NewReplicasExceedPlan:418`), and map the code to 422 in `mapping.go` (mirror `:100`). EC-4: the message MUST carry the upgrade URL like every canonical cap error (e.g. "Account '%s' has %d projects — the %s plan allows up to %d. Upgrade at https://usetheo.dev/pricing or delete a project."), so the client gets an actionable path (the 402 middleware included `upgradeURL`). Reasoning: the canonical theo cap status is 422 with a typed, actionable message (#101); reusing the exact shape is Rule-9 consistency.

#### TDD
RED: `TestNewProjectsExceedPlan_Message_And_422` — the error carries code `PROJECTS_EXCEED_PLAN`, an actionable message naming the plan + cap, and `http.Status(err) == 422`.

#### Concurrency tests
(none — single-threaded). Pure value construction + status mapping.

#### Failure scenarios (external I/O — none)
(none — no external I/O touched.)

#### Acceptance criteria
- [ ] `go test ./pkg/errors/...` exits 0 AND asserts code `PROJECTS_EXCEED_PLAN` maps to HTTP 422.

### T1.2 — `ProjectCapChecker` + account-scoped plan resolution

#### Files to edit
`theo/api/pkg/enforcement/store.go`, `theo/api/internal/routes/projects.go` (interface decl), `theo/api/cmd/setup_orchestrator.go` (adapter)

#### Why this step
Action: add `GetAccountPlan(ctx, tenantID)` to the store — `SELECT plan FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id=$1) AND status IN ('active','trialing') LIMIT 1` (the M2 canonical join). Declare `ProjectCapChecker` interface `CheckProjectsValue(tenantID string, currentCount int) (allowed bool, plan string, cap int)` (mirror `ScaleReplicasChecker:78`) and an adapter over `PlanLimiter` that resolves the account plan + `plan_limits.projects` cap; `allowed = (cap is unlimited) || currentCount < cap`. Reasoning: account-scoped resolution is the M2 model; the injectable interface mirrors #101 for testability (fake checker).

#### TDD
RED: `TestProjectCapChecker_AccountScoped` (sqlmock) — a Starter Account (cap=1) with `currentCount=1` returns `allowed=false, plan="starter", cap=1`; an enterprise account (cap=NULL) returns `allowed=true` regardless of count; a 2nd tenant of the account resolves the SAME account plan.

#### Concurrency tests
(none — single-threaded). Stateless resolution; the count is supplied by the caller (the atomic count happens in T2.1).

#### Failure scenarios (external I/O — pg)
- No active subscription for the account → resolves the default/free plan (mirror `GetTenantPlan` behavior), never a 500.
- DB error → propagated as an internal error (existing contract), never a silent allow.

#### Acceptance criteria
- [ ] `go test ./pkg/enforcement/... ./internal/routes/...` exits 0 AND the checker resolves cap account-scoped (Starter→1, enterprise→unlimited, 2nd tenant→same plan).

### Phase 2 — atomic enforcement at create (G1b, G2)

### T2.1 — Atomic cap guard in `CreateProject` (advisory lock + per-account count)

#### Files to edit
`theo/api/internal/db/project_wrapper.go`, `theo/api/internal/routes/projects.go`

#### Why this step
Action: `CreateProject` has NO transaction today (`project_wrapper.go:51` is a single sqlc insert) — EC-1: the cap-enforcing create path MUST begin a transaction (`BeginTx`) so the lock is xact-scoped. In that tx: `SELECT pg_advisory_xact_lock(hashtext($accountID))`, then `SELECT count(*) FROM projects WHERE tenant_id IN (SELECT id FROM tenants WHERE account_id=$accountID)`, call `ProjectCapChecker.CheckProjectsValue(tenantID, count)`; if `!allowed` rollback + return the typed `NewProjectsExceedPlan` error; else insert + commit. account_id resolved from `tenants.account_id` (NOT NULL since M3) — EC-2: a NULL/absent account_id (defensive, impossible post-M3) fails CLOSED to the starter cap, never silently unlimited. The handler maps the typed error to 422 + increments the metric. Reasoning: the existing middleware counts OUTSIDE the insert tx (two requests can both pass — a real race, ADR-M4-3); the advisory lock makes count+insert atomic, the exact `theo-cloud/internal/auth/tenant.go` pattern.

#### TDD
RED: `TestCreateProject_OverCap_Returns422` (sqlmock) — fake checker cap=1, existing count=1 → `CreateProject` returns the typed error, NO INSERT issued; `TestCreateProject_UnderCap_Inserts` — count=0 → INSERT runs. The advisory-lock + count SQL is asserted via sqlmock expectation order.

#### Concurrency tests
`go test -race` — `TestCreateProject_ConcurrentAtBoundary_NeverExceedsCap`: N goroutines create projects for one Account at the cap boundary against real pg (advisory lock serializes); assert the account's final project count == cap, exactly one creation succeeds when count==cap-1 and the rest get 422. Single-thread tests do NOT prove this — the race detector + real pg interleaving does.

#### Failure scenarios (external I/O — pg)
- Advisory lock contention → serialized, not failed (lock waits within the tx).
- `UNIQUE(tenant_id,name)` collision → existing `ErrProjectExists` path unchanged (cap guard runs before insert; name collision still surfaces).
- DB error mid-tx → rollback, internal error; no partial project.

#### Acceptance criteria
- [ ] `go test ./internal/db/... ./internal/routes/...` exits 0 AND over-cap → typed error + no insert; under-cap → insert. Concurrency `-race` test asserts count never exceeds cap.

### T2.2 — Unlimited + grandfathered handling

#### Files to edit
`theo/api/internal/db/project_wrapper.go` (guard branch), `theo/api/internal/routes/projects_test.go`

#### Why this step
Action: when the resolved cap is unlimited (enterprise, `plan_limits.hard_limit IS NULL` → checker `allowed=true`), skip the count entirely (no lock needed — never blocked). When an account is already AT/OVER cap (grandfathered or post-downgrade), the guard blocks only NEW creation; existing projects + reads are untouched. Reasoning: ADR-M4-4 block-new-only; enterprise must never pay the lock/count cost.

#### TDD
RED: `TestCreateProject_Enterprise_NeverBlocked` (cap=unlimited → insert always); `TestCreateProject_Grandfathered_BlocksNewOnly` (count=5 > cap=1 → 422 on new, but a list/read of the 5 existing still works); EC-6 `TestCreateProject_Enterprise_TakesNoLockNoCount` (sqlmock asserts the unlimited path issues ONLY the INSERT — no advisory lock, no count query — so an enterprise account with thousands of projects pays no count cost).

#### Concurrency tests
(none — single-threaded). Covered by T2.1's `-race` test for the bounded-cap path; the unlimited path takes no lock (EC-6).

#### Failure scenarios (external I/O — pg)
- Cap mutated (downgrade) between reads → the in-lock re-count uses the current cap; block-new-only holds.

#### Acceptance criteria
- [ ] `go test ./internal/routes/...` exits 0 AND enterprise → unlimited; grandfathered over-cap account → new creation 422 but existing projects readable.

### Phase 3 — wiring, metric, replace middleware, e2e (G1b, G3)

### T3.1 — Wire checker + metric; remove the per-tenant projects middleware

#### Files to edit
`theo/api/cmd/setup_orchestrator.go`, `theo/api/internal/server/router.go`, `theo/api/internal/routes/projects.go`

#### Why this step
Action: construct the `ProjectCapChecker` adapter (reuse the `planLimiterCapAdapter` pattern) and `SetProjectCapChecker(planCap)` on the project handler AFTER `EnsureProductionWired` (mirror `:222-230`); on rejection the handler increments `PlanLimitViolations.WithLabelValues("max_projects_per_account", plan)`. Remove the per-tenant `projectEnforcement` middleware from the `/api/v1/projects` route (`router.go:220-228,320`) — superseded by the account guard (ADR-M4-2; 402→422 behavior change). EC-3: `grep` the engine repo for `402`/`PaymentRequired`/`PLAN_LIMIT_EXCEEDED` tied to `/api/v1/projects` and update any assertion; document the 402→422 change prominently in CHANGELOG. Reasoning: single canonical enforcement at the Account granularity.

#### TDD
RED: `TestProjects_NilChecker_NoEnforcement` (no `SetProjectCapChecker` → creation never blocked, backward-compat for dev/tests — mirror #101 nil-checker test); `TestProjects_OverCap_IncrementsMetric` (rejection bumps the counter).

#### Concurrency tests
(none — single-threaded). Wiring only; atomicity is proven in T2.1's `-race` test.

#### Failure scenarios (external I/O — none in wiring)
- `planCap == nil` (dev without DB) → checker not set → no enforcement (explicit backward-compat).

#### Acceptance criteria
- [ ] `go build ./...` exits 0 AND `grep -c 'projectEnforcement' internal/server/router.go` is 0 (middleware removed) AND nil-checker → no enforcement AND rejection increments the metric.

### T3.2 — e2e against real pg (ship proof)

#### Files to edit
`theo/api/tests/e2e/project_cap_m4_e2e_test.go` (NEW, build-tag `e2e`)

#### Why this step
Action: against a migrated real pg, seed a Starter Account (cap=1) with 2 tenants; create 1 project in tenant A (200), then a 2nd project in tenant B → **422 PROJECTS_EXCEED_PLAN** (proves the cap is per-ACCOUNT, not per-tenant). Seed an enterprise Account → create >cap projects, all 200. Seed a grandfathered Account (2 existing projects, cap=1) → new creation 422, existing 2 still listable. Reasoning: G3 — the per-Account ship proof on real schema.

#### TDD
RED: each assertion fails before the slice is wired; GREEN when composed. Reuses the engine's e2e seed helpers (or inline seeds: users/accounts/tenants/subscriptions/plan_limits/projects).

#### Concurrency tests
`go test -tags=e2e -race` — the suite runs under the race detector; the T2.1 concurrency scenario is also exercised here against real pg if feasible.

#### Failure scenarios (external I/O — pg)
- `E2E_PG_CLOUD_DSN` unset → `t.Skip` (no false green).

#### Acceptance criteria
- [ ] `E2E_PG_CLOUD_DSN=… go test -tags=e2e -race ./tests/e2e/ -run ProjectCapM4` exits 0 with all assertions (per-account 422 across tenants; enterprise unlimited; grandfathered block-new-only).

## ADRs (decisions for this plan)

### ADR-M4-1 — Mirror the #101 ProjectCapChecker pattern (422 typed error), account-scoped
`ProjectCapChecker` + `NewProjectsExceedPlan` (`PROJECTS_EXCEED_PLAN`, 422) + `PlanLimitViolations{metric:"max_projects_per_account"}`, wired via `SetProjectCapChecker` after `EnsureProductionWired`. **Rationale & alternatives:** the codebase has ONE canonical cap pattern (#101); reusing it is Rule-9 consistency + testability. **Rejected alternative:** a bespoke ad-hoc check — diverging from the canonical is consistency debt and re-invents the typed-error + metric plumbing.

### ADR-M4-2 — Replace the per-tenant 402 projects middleware with per-Account 422 enforcement
**Rationale & alternatives:** M2 made the Account the cap entity; a per-TENANT projects cap is now the wrong granularity, and double enforcement (402 tenant + 422 account) for one resource is confusing. **Rejected alternative:** keep both — inconsistent status codes for the same cap; redundant once the Account is canonical. The 402→422 change is documented in CHANGELOG.

### ADR-M4-3 — Atomic check+insert via per-account advisory lock (no new migration)
**Rationale & alternatives:** the existing middleware counts outside the insert tx (real check-then-create race); `pg_advisory_xact_lock(hashtext(accountID))` + in-tx re-count + insert is the established race-safe primitive (tenant.go). `plan_limits.projects` already holds the cap, so NO migration. **Rejected alternative:** a UNIQUE/partial-index guard — cannot express "≤ N rows per account"; a counter table is heavier than the advisory lock.

### ADR-M4-4 — Block-new-only for grandfathered / downgraded accounts
**Rationale & alternatives:** bar NEW creation when count ≥ cap; never delete/break existing projects or fail reads; enterprise (NULL) never blocked. **Rejected alternative:** retroactive deletion/migration of over-cap accounts — destructive, out of scope.

## Drawbacks & Risks

| # | Risk / drawback | Likelihood | Mitigation | Owner |
|---|---|---|---|---|
| R1 | 402→422 behavior change breaks a client scripting on 402 for the projects cap | LOW | documented in CHANGELOG; 422 is the canonical theo cap status (#101); both 4xx | T3.1 |
| R2 | Check-then-create race lets the cap be exceeded | MEDIUM | in-tx advisory lock + re-count (ADR-M4-3); `-race` concurrency test (T2.1) | T2.1 |
| R3 | Grandfathered/downgraded account locked out of its own data or existing projects broken | MEDIUM | block-new-only (ADR-M4-4); read/list paths untouched; tested (T2.2) | T2.2 |
| R4 | Account resolution adds a join per create | LOW | create is rare (not a hot path); single join; enterprise skips the count | T1.2 |

Absorbed edge cases (review `.claude/knowledge-base/reviews/engine-project-cap-enforcement-edge-cases-2026-06-28.md`): EC-1 (explicit tx in CreateProject — T2.1), EC-2 (account_id resolved from tenants.account_id, NULL fails-closed to starter — T1.2/T2.1), EC-3 (402→422 grep + CHANGELOG — T3.1), EC-4 (upgrade URL in the 422 message — T1.1), EC-5 (shared advisory keyspace — benign, documented — T2.1), EC-6 (enterprise skips lock+count — T2.2). EC-7 (parallel team work on engine develop — merge-coordination) documented; expect friction on `setup_orchestrator.go`/`errors.go`/`mapping.go` and resolve preserving BOTH the #101 replicas checker and the M4 projects checker.

## Unresolved Questions

- (none — every decision is resolved at plan time): every M4 decision is resolved by ADRs M4-1..M4-4 and the locked `account-level-tenancy` ADR.

## Test Plan

- **Unit (`-race`):** `go test -race ./pkg/errors/... ./pkg/enforcement/... ./internal/routes/... ./internal/db/...` — typed error/422, account-scoped checker, over/under-cap, nil-checker, enterprise, grandfathered.
- **Concurrency (`-race`):** N goroutines at the cap boundary never exceed the cap (advisory lock).
- **e2e (real pg):** `go test -tags=e2e -race ./tests/e2e/ -run ProjectCapM4` — per-account 422 across tenants, enterprise unlimited, grandfathered block-new-only.
- **Global DoD:** `go build ./...`; CHANGELOG `[Unreleased]` updated (theo engine); per-tenant projects middleware removed; metric increments on rejection.
