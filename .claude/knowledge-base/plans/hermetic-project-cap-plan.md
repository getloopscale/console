---
slug: hermetic-project-cap
milestone_id: M5
created_at: 2026-06-28
goal: Enforce the per-Account project cap on the engine's deploy-time project-creation path (EnsureProject), atomically and deadlock-safely, closing the #106 bypass with parity to the M4 typed 422 + metric.
---

# Plan — M5 Hermetic project-cap (close deploy-path bypass #106)

## Goal

Make the per-Account project cap **airtight on both creation paths**: extend the engine's deploy-time `EnsureProject` to consult the same per-Account cap that M4 enforces on `POST /api/v1/projects`, rejecting a genuinely-new project beyond the Account's plan cap with the typed `PROJECTS_EXCEED_PLAN` (HTTP 422) error and the `theo_plan_limit_violation_total{metric="max_projects_per_account"}` metric, enforced **atomically** under the existing build-submit transaction (no nested lock/connection → deadlock-safe), without blocking deploys to already-existing projects. Measurable: a `theo deploy <new>` beyond cap returns 422 (not 500/silent); two concurrent new-project deploys for one account at the boundary never both succeed (`-race`); existing-project re-deploys and enterprise/unlimited plans are never blocked; `#106` closed with verification evidence.

## Baseline Context

Engine repo `theo` at `develop` sha `d4b0c680`. Account-level tenancy M0–M4 already shipped; M4 enforces the cap on `CreateProject` only.

### Files that will be touched

| File | LoC (pre) | Role | Change |
|---|---|---|---|
| `theo/api/internal/db/project_wrapper.go` | 332 | `PostgresProjectStore` (CreateProject capped, EnsureProject uncapped) | Make `EnsureProject` cap-aware on the bounded+new-project branch; extract a shared `enforceProjectCapTx` helper reused by `createProjectCapped` (DRY) |
| `theo/api/cmd/setup_orchestrator.go` | 314 | Builds the orchestrator's `PostgresProjectStore` (line 95) with NO cap checker | Wire `SetProjectCapChecker` onto that store, reusing the `planLimiter` already passed in |
| `theo/api/tests/integration/project_cap_m4_test.go` | (M4) | Sibling integration test pattern (`testPool`, `-race`) | New sibling test file for the deploy path (do not edit M4's) |
| `theo/CHANGELOG.md` | — | Public contract | `[Unreleased]` Added + Fixed (#106) |

### Current callers / dependents

- `EnsureProject` — defined `theo/api/internal/db/project_wrapper.go:165`; **only** production caller is `theo/api/internal/services/build_orchestrator_submit.go:102`, inside `WithLock` (env-lock'd tx, `:54`). Receives the build-submit `tx db.DBTX`.
- `SubmitBuild` error → `theo/api/internal/routes/builds.go:464` `mapBuildError` → `:561` `*TheoError` ladder branch (surfaces typed code+status). `wrapSubmitBuildError` short-circuits any `*TheoError` (EC-3 guard, `build_orchestrator_submit.go:85-90`).
- M4 cap guard `createProjectCapped` — `theo/api/internal/db/project_wrapper.go:100`; advisory lock `pg_advisory_xact_lock(hashtext($1=accountID))` at `:126`; account resolve `SELECT account_id FROM tenants WHERE id=$1`.
- Cap resolution: `planLimiterCapAdapter.CheckProjectsValue` (`theo/api/cmd/setup_orchestrator.go:38`) → `enforcement.PlanLimiter.CheckProjectsValue` → `GetAccountPlanByTenant` (`theo/pkg/enforcement/store.go:82`).

### Domain glossary

- **Account** — billing/cap entity; `tenants.account_id` (NOT NULL since M3 000044); one `subscriptions` row per account (M2 `UNIQUE(account_id)`).
- **EnsureProject** — idempotent deploy-time auto-create (`INSERT ... ON CONFLICT (tenant_id,name) DO NOTHING`).
- **env-lock** — `pg_advisory_xact_lock(hashtext("{tenant}:{project}:{env}"))`, held by the build-submit tx.
- **account-lock** — `pg_advisory_xact_lock(hashtext(accountID))`, the M4 cap-serialization lock.
- **Block-new-only** — at/over cap: new project blocked; existing projects readable + re-deployable (grandfathered).

### Architecture boundaries affected

- `internal/db` (persistence adapter) — the cap gate lives here, reusing the engine advisory-lock pattern. No domain/interface change beyond the existing `ProjectCapChecker`.
- `cmd` (composition root) — wiring only (`setup_orchestrator.go`).
- No new migration, no new dependency, no theo-cloud/theo-memory change, no API-shape change (reuses `PROJECTS_EXCEED_PLAN`→422).

## Coverage Matrix

| # | Goal claim | Task(s) | Status |
|---|---|---|---|
| 1 | Deploy-time new project beyond cap → typed 422 `PROJECTS_EXCEED_PLAN` (not 500/silent) | T1.1, T1.3, T2.1 | Planned |
| 2 | Enforcement is atomic under the existing build-submit tx — no nested lock/connection (deadlock-safe, env→account order) | T1.1, T2.1 | Planned |
| 3 | Existing-project re-deploys never blocked (existence-check short-circuit) | T1.1, T2.1 | Planned |
| 4 | Enterprise/unlimited (cap<0) never blocked; nil-checker dev path unenforced | T1.1, T2.1 | Planned |
| 5 | Concurrency: two simultaneous new-project deploys for one account can't both succeed (`-race`) | T1.1, T2.1 | Planned |
| 6 | Metric `theo_plan_limit_violation_total{metric="max_projects_per_account"}` increments on deploy-path rejection (parity with M4) | T1.1, T2.1 | Planned |
| 7 | The orchestrator's project store has the cap checker wired (closes the #106 wiring gap) | T1.2, T2.1 | Planned |
| 8 | `#106` closed with verification evidence | T2.1 | Planned |

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `github.com/jackc/pgx/v5` | (current in go.mod) | Go | Advisory lock + tx — already the engine's pg driver |
| `github.com/prometheus/client_golang` | (current) | Go | `theo_plan_limit_violation_total` metric (reused) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | M5 is an internal refactor reusing M4's pattern; no new capability requires a dependency | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Critical paths

- `EnsureProject` bounded+new-project branch (the new cap gate) — atomicity + correctness here is the whole milestone; 100% covered by unit + integration + concurrency tests.
- The advisory-lock ordering (env→account on one connection) — the deadlock-safety guarantee; covered by the concurrency integration test under `-race`.

## Tasks

### T1.1 — Make `EnsureProject` cap-aware (atomic, on the caller's tx)

#### Why this step

`EnsureProject` is the deploy-path project-insert that bypasses the cap (#106 root behavior). It must enforce the per-Account cap **atomically** for genuinely-new projects, reusing the M4 advisory-lock pattern, on the **same tx** it is handed (the env-lock'd build-submit tx) so no second connection/lock can deadlock (ADR-M5-1). Existing projects must short-circuit before any count/block (ADR-M5-2). DRY: extract the shared "resolve account → advisory-lock → count → cap-check" sequence into a helper `enforceProjectCapTx(ctx, tx, accountID|tenantID, plan, cap) error` reused by both `createProjectCapped` and `EnsureProject`.

#### Files to edit

- `theo/api/internal/db/project_wrapper.go` — add the cap-gate to `EnsureProject`; extract `enforceProjectCapTx` shared helper; reuse `theoerrors.NewProjectsExceedPlan` + `metrics.PlanLimitViolations`.

#### TDD

RED tests in `theo/api/internal/db/project_wrapper_m5_test.go` (sqlmock-driven where possible; the truly-atomic advisory-lock path is proven at integration in T2.1):

- `test_ensure_project_blocks_new_when_account_at_cap` — Given a cap-checker reporting plan=starter cap=1 and an account with 1 existing project, When `EnsureProject` is asked to create a *second, new* project, Then it returns `*TheoError` code `PROJECTS_EXCEED_PLAN` and does NOT insert. Assert the metric `theo_plan_limit_violation_total{metric="max_projects_per_account",plan="starter"}` incremented by 1.
- `test_ensure_project_allows_existing_project_at_cap` — Given account at cap=1 with project "p" existing, When `EnsureProject(tenant,"p")` (re-deploy), Then returns nil, no error, no metric increment (existence short-circuit).
- `test_ensure_project_unlimited_skips_cap` — Given cap-checker reports cap<0 (enterprise), When `EnsureProject` for a new project, Then inserts, no count/lock, no metric.
- `test_ensure_project_nil_checker_unenforced` — Given `capChecker==nil`, When `EnsureProject`, Then original ON-CONFLICT-DO-NOTHING behavior (no cap).
- `test_ensure_project_failclosed_when_cap_needed_without_pgx_tx` — Given a bounded cap but a tx/handle that cannot hold an advisory lock, Then returns an error (never silently bypasses the quota) — mirrors M4 `createProjectCapped` fail-closed.

#### Concurrency tests

Real race-aware coverage (NOT single-threaded): the atomic guarantee (two concurrent new-project `EnsureProject` for the same account at the boundary → exactly one inserts) is proven against real Postgres in **T2.1** `TestProjectCapHermeticM5_ConcurrentDeploysNeverExceedCap` under `go test -race` (sqlmock cannot prove `pg_advisory_xact_lock` semantics — same rationale as M4 XVAL-3). The unit layer asserts the decision logic; the integration layer asserts the atomicity.

#### Acceptance criteria

- `EnsureProject` returns a `*TheoError` with code `PROJECTS_EXCEED_PLAN` for a new over-cap project, returns `nil` for an existing project, and inserts a row for the under-cap / unlimited / nil-checker cases — asserted by the five `test_ensure_project_*` unit tests passing.
- A single `enforceProjectCapTx` helper is called by both `createProjectCapped` and `EnsureProject` with no duplicated lock/count SQL — verified by `grep -c` showing exactly the two call sites and the lock/count SQL appearing only inside the helper.
- The metric `theo_plan_limit_violation_total{metric="max_projects_per_account"}` increments by exactly 1 on a genuine rejection and stays flat for allow/existing/unlimited cases — asserted via `prometheus/testutil.ToFloat64` delta checks in the unit tests.
- **EC-1 (nil-tx handling):** when enforcement is needed (checker present, cap≥0) and `tx == nil`, `EnsureProject` opens a dedicated tx from the pgx pool and runs the helper there; if no pgx pool is reachable it returns an error (no insert) — asserted by `test_ensure_project_failclosed_when_cap_needed_without_pgx_tx` (no-pool) and the nil-tx-with-pool integration path both passing.
- `go test -race ./api/internal/db/...` exits 0.

### T1.2 — Wire the cap checker onto the orchestrator's project store

#### Why this step

The orchestrator builds its own `PostgresProjectStore` with no cap checker (`setup_orchestrator.go:95`) — the wiring gap that makes #106 reachable even with a cap-aware `EnsureProject`. Wire `SetProjectCapChecker` on that store, reusing the `planLimiter` already passed into `setupOrchestrator` (ADR-M5-4, option b — minimal/local).

#### Files to edit

- `theo/api/cmd/setup_orchestrator.go` — build the store as a named var; when `planLimiter != nil`, build one `planLimiterCapAdapter` and use it for BOTH `planCap` and `store.SetProjectCapChecker`; pass the configured store to `BuildOrchestratorDeps.ProjectStore`.

#### TDD

- `test_orchestrator_project_store_has_cap_checker_when_limiter_present` — a wiring/unit assertion (constructor-level) that, given a non-nil limiter, the store handed to the orchestrator has a non-nil cap checker. If the store's checker is unexported, assert behaviorally via the T2.1 integration path instead (the real proof is T2.1 rejecting a deploy). Document which.

#### Concurrency tests

(none — single-threaded). Wiring only; no shared mutable runtime state introduced — the concurrency guarantee is entirely in T1.1/T2.1's advisory lock.

#### Acceptance criteria

- With a non-nil limiter, the store handed to `BuildOrchestrator` rejects an over-cap deploy with `PROJECTS_EXCEED_PLAN` — asserted by `TestProjectCapHermeticM5_DeployBlocksNewBeyondCap` passing (the rejection is impossible unless the checker is wired onto that store instance).
- With a nil limiter, the store's `capChecker` is nil and `EnsureProject` runs the original `ON CONFLICT DO NOTHING` path with no panic — asserted by `test_ensure_project_nil_checker_unenforced` passing and `go build`/`go vet` exiting 0.
- `go build ./...` and `go vet ./...` exit 0.

### T2.1 — Integration e2e: deploy-path cap, atomic, observable (`-race` vs real pg)

#### Why this step

The DoD demands evidence the cap binds through the REAL path (account-scoped, atomic, observable) — not a unit assertion. Mirror the M4 integration test (`testPool`, skips without pg) but drive the deploy/`EnsureProject` path.

#### Files to edit

- `theo/api/tests/integration/project_cap_hermetic_m5_test.go` (NEW) — scenarios under `-race`, real pg, idempotent seed/teardown.

#### TDD

- `TestProjectCapHermeticM5_DeployBlocksNewBeyondCap` — Starter cap=1, account with 1 project; a deploy that would create a *second new* project → rejected with `PROJECTS_EXCEED_PLAN`; project NOT inserted; metric `{metric="max_projects_per_account",plan="starter"}` +1. **EC-2 boundary-inclusive:** also assert that, starting from 0 projects (cap=1), the deploy creating the *first* new project (count→1, exactly cap) SUCCEEDS — only a further new project is blocked.
- `TestProjectCapHermeticM5_ExistingProjectRedeployNeverBlocked` — account at cap=1, project "p" exists; deploy to "p" → succeeds (no error, no metric increment).
- `TestProjectCapHermeticM5_EnterpriseUnlimited` — cap<0; 5 new-project deploys, none blocked; violation metric stays FLAT (EC-6 parity).
- `TestProjectCapHermeticM5_DeployAndApiCreateShareTheCap` — a deploy of a new project and a `CreateProject` of another new project for the SAME account at the boundary cannot both succeed (proves the two paths share the account-lock keyspace).

#### Concurrency tests

- `TestProjectCapHermeticM5_ConcurrentDeploysNeverExceedCap` — N (≥8) concurrent new-project `EnsureProject` calls across ≥2 tenants of one Account at the last cap slot, under `go test -race`: exactly 1 succeeds, the other N−1 all return `PROJECTS_EXCEED_PLAN` (NOT lock/tx errors masking a regression), final project count == cap. Proves the advisory-lock atomicity on the deploy path and the env→account ordering does not deadlock.

#### Acceptance criteria

- All T2.1 scenarios pass under `go test -race` against real pg; SKIP gracefully without `DATABASE_URL` (testPool pattern).
- Concurrency test: exactly one winner, losers all typed `PROJECTS_EXCEED_PLAN`, count == cap.
- After green: `#106` closed with the verification comment + evidence (scenario names + `-race` output), no secrets.

## Failure scenarios

External-I/O touched: Postgres via pgx (advisory lock, count, insert). Resilience requirements:

| Scenario | Expected behavior | Test |
|---|---|---|
| Account resolve (`SELECT account_id`) fails / returns no row | Return a wrapped error; never insert without a resolved account; never silently bypass the cap | T1.1 unit (sqlmock error) + fail-closed path |
| Advisory lock acquisition errors OR times out (`lock_timeout=5s` from the env-lock path) | Surface the error (deploy fails fast with a typed/wrapped error), no partial insert; the build-submit tx rolls back | T2.1 (lock held externally → waiter times out) / T1.1 unit |
| Cap mis-resolved as 0 (misconfig) | Fail closed (count ≥ 0 ≥ 0 → block), never insert unbounded | T1.1 unit (cap=0 path) |
| Non-pgx DBTX handed while cap enforcement needed | Fail closed (error), as M4 `createProjectCapped` does | T1.1 `test_ensure_project_failclosed_*` |

## Drawbacks & Risks

| Risk / Drawback | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Adding the account-lock inside the build-submit tx introduces a deadlock | Low | High | Lock-order analysis (blueprint): env→account is the only order; nothing takes account→env; acquired on the SAME tx/connection (no nested BeginTx). Proven by `-race` concurrency test (T2.1). |
| Same-account deploy concurrency now serializes on the account-lock, adding latency | Low | Low | Lock is held only across count+insert (microseconds); `lock_timeout=5s` bounds the worst case with a typed error rather than a hang. |
| The build-submit tx is heavier than M4's create tx; a long-held account-lock could stall other same-account creates | Low | Medium | The cap gate runs at Step 2.5 (early, before the workflow submit); the lock spans only the existence-check+count+insert, not the whole build pipeline. |
| Existence short-circuit wrong → blocks a legitimate re-deploy | Low | Medium | Dedicated test `ExistingProjectRedeployNeverBlocked`; existence check is `(tenant_id,name)` exact, the same key as the ON CONFLICT target. |

## Prior Art

- **Red Team #101** — `enforceScaling` → `ErrReplicasExceedPlan` returned from inside the same build-submit lock callback, surfaced as 422 via `mapBuildError` (`build_orchestrator_submit.go:77-90`, `builds.go:561`). M5 reuses this exact surfacing path.
- **M4 (engine-project-cap-enforcement)** — `createProjectCapped` advisory-lock atomic guard (`project_wrapper.go:100-160`); M5 reuses the helper + error + metric and extends them to the deploy path.
- **`internal/lock/environment_lock.go`** — the canonical engine advisory-lock pattern (`pg_advisory_xact_lock`, `lock_timeout`).

## Unresolved Questions

(none — every decision is resolved at plan time)

## Test Plan

- **Unit** (`api/internal/db/...`, `-race`): EnsureProject decision logic (block-new, existing-skip, unlimited-skip, nil-checker, fail-closed), metric increment.
- **Integration** (`api/tests/integration/...`, `-race`, real pg, SKIP without DATABASE_URL): deploy blocks new beyond cap, existing re-deploy allowed, enterprise unlimited (metric flat), deploy+API share the cap, concurrency 8-racer (exactly one winner, losers typed, count==cap).
- **Build/vet/lint:** `go build ./...`, `go vet ./...`, project linters green on touched packages.
- **Surfacing:** assert the deploy-path rejection reaches HTTP 422 (handler-level or via mapBuildError unit) with code `PROJECTS_EXCEED_PLAN`.

## Global DoD

Each item names its verifier (oracle) so it is mechanically checkable.

- [ ] Coverage Matrix is 100% — verified by `plan-confidence` reporting `coverage_pct == 100`.
- [ ] `EnsureProject` returns `PROJECTS_EXCEED_PLAN` for a new over-cap project and `nil` for an existing project — verified by unit tests `test_ensure_project_blocks_new_when_account_at_cap` and `test_ensure_project_allows_existing_project_at_cap` passing.
- [ ] `EnsureProject` inserts (no block) for unlimited (cap<0) and nil-checker — verified by `test_ensure_project_unlimited_skips_cap` and `test_ensure_project_nil_checker_unenforced` passing.
- [ ] `EnsureProject` fails closed (returns an error, no insert) when bounded enforcement is needed but no pgx pool is available — verified by `test_ensure_project_failclosed_when_cap_needed_without_pgx_tx` passing.
- [ ] A single shared `enforceProjectCapTx` helper is called by both `createProjectCapped` and `EnsureProject` — verified by `grep` showing both call sites and no duplicated lock/count SQL.
- [ ] The orchestrator's project store has a non-nil cap checker when a limiter is present — verified by integration test `TestProjectCapHermeticM5_DeployBlocksNewBeyondCap` rejecting a deploy (which is impossible unless the checker is wired).
- [ ] A deploy of a new over-cap project returns HTTP 422 with code `PROJECTS_EXCEED_PLAN` (not 500, not silent) — verified by a handler/`mapBuildError` unit test asserting `status == 422` and `code == "PROJECTS_EXCEED_PLAN"`.
- [ ] `theo_plan_limit_violation_total{metric="max_projects_per_account",plan="starter"}` increments by exactly 1 on a deploy-path rejection — verified by `testutil.ToFloat64` delta assertion in `TestProjectCapHermeticM5_DeployBlocksNewBeyondCap`.
- [ ] Concurrency: with ≥8 simultaneous new-project deploys for one account at the last slot under `go test -race`, exactly 1 succeeds, the rest return `PROJECTS_EXCEED_PLAN`, and final project count == cap — verified by `TestProjectCapHermeticM5_ConcurrentDeploysNeverExceedCap` passing.
- [ ] Deadlock-safety: the env→account lock order on a single tx is preserved (no nested `BeginTx`) — verified by the `-race` concurrency test passing AND a code comment at the new lock site stating the invariant.
- [ ] All touched-package tests pass under `go test -race`, and `go build ./...` + `go vet ./...` exit 0 — verified by capturing the command exit codes.
- [ ] `CHANGELOG.md` `[Unreleased]` has an `### Added` and a `### Fixed (#106)` entry — verified by `grep` of the section.
- [ ] `#106` is closed with a verification comment containing the passing scenario names + `-race` evidence and no secrets — verified by the issue state being CLOSED with the comment present.
