# Blueprint — M5 Hermetic project-cap (close deploy-path bypass #106)

**Slug:** hermetic-project-cap · **Milestone:** M5 · **Date:** 2026-06-28
**Repo under change:** `theo` engine (Go under `api/`)
**Cycle:** DISCOVER (internal-architecture investigation — prior art is M4 + Red Team #101, both internal)
**Verdict target downstream:** READY_TO_MERGE

## Problem

M4 enforced the per-Account project cap at the explicit creation API (`POST /api/v1/projects` → `PostgresProjectStore.CreateProject`). A **second** project-row insertion path exists: the deploy/build-submit flow auto-creates the project via `EnsureProject`, which does **not** consult the cap. So `theo deploy <new-name>` creates a project beyond the Account's plan cap — the bypass tracked as `usetheodev/theo-cloud#106`. M5 closes it **deadlock-safely**, with parity to the M4 typed error + metric.

## Evidence map (real file:line)

### Coverage Corner 1 — Integration / Tests

- M4 integration test pattern to mirror: `theo/api/tests/integration/project_cap_m4_test.go` — `testPool(t)` skips gracefully without pg; 4 scenarios under `-race` (per-account-across-tenants, enterprise-unlimited, grandfathered, 8-racer concurrency). M5 adds a deploy-path equivalent driving `SubmitBuild`/`EnsureProject`.
- Build-submit handler: `theo/api/internal/routes/builds.go:454` (`h.orch.SubmitBuild`) → error via `mapBuildError` (`builds.go:464`, `:560`).
- Orchestrator submit: `theo/api/internal/services/build_orchestrator_submit.go:41` (`SubmitBuild`), `:102` (`EnsureProject` inside the env-lock'd tx).

### Coverage Corner 2 — Dependencies

- **No new dependency.** Reuses `pgx` (already used), `prometheus` metric `theo_plan_limit_violation_total` (`theo/api/internal/metrics/metrics.go:621-629`), and the existing typed error.
- DB: no new migration. Reuses `projects`, `tenants.account_id` (NOT NULL since M3 000044), `subscriptions` (account-scoped since M2).

### Coverage Corner 3 — Tools

- `go test -race` (unit + integration), `go vet`, project linters, `task quality:gates` (pre-existing team debt: `unhomed-logic`, `caddyfile-csp` — not M5).
- Metric assertion in tests: `prometheus/testutil.ToFloat64` (used in M4 e2e).

### Coverage Corner 4 — Techniques

- **Atomic count+insert under a per-account advisory lock** — `pg_advisory_xact_lock(hashtext(accountID))`, the canonical engine pattern (`theo/api/internal/db/project_wrapper.go:126` in `createProjectCapped`; sibling of `internal/lock/environment_lock.go:97`).
- **Typed-error surfacing through the build path** — `*TheoError` returned from inside the lock callback is dispatched by `mapBuildError`'s `*TheoError` ladder branch (`builds.go:561`); the #101 `enforceScaling` → `ErrReplicasExceedPlan` already uses this exact path (`build_orchestrator_submit.go:77-90`). `wrapSubmitBuildError` has an EC-3 guard that short-circuits any `*TheoError` (defense-in-depth).

## Lock-order analysis (the crux — deadlock safety)

Current locks (xact-scoped advisory) and their keyspaces — all orthogonal:

| Lock | Key | Acquired in | Holds-then-wants |
|---|---|---|---|
| env-lock | `hashtext("{tenant}:{project}:{env}")` | `SubmitBuild` (env mutations) | env → (EnsureProject insert) |
| account-lock | `hashtext(accountID)` | `createProjectCapped` (API create) | account only |
| placement-lock | const `0x706C636D746C636B` | placement serializer | placement only (NOT in SubmitBuild tx — confirmed) |

`SubmitBuild` acquires **only** the env-lock, then calls `EnsureProject` inside that same tx (`build_orchestrator_submit.go:54` `WithLock` → `:102`). Placement/`AssignCell` is **not** in the submit tx (grep-confirmed). Adding the account-lock **after** the env-lock yields a single global order **env → account**; the API path takes **account alone**; nothing takes **account → env**. → **acyclic, no deadlock**.

**The trap (and the rule):** acquiring the account-lock on a **second tx/connection** while the build-submit tx (connection 1) holds the env-lock can self-deadlock (two pooled connections, same logical work). The safe design acquires the account-lock on the **same `tx`** handed to `EnsureProject` (connection 1) — never a nested `BeginTx`. The env-lock path already sets `SET LOCAL lock_timeout = '5s'` (`internal/lock/environment_lock.go:77`), so pathological same-account contention fails fast with a typed lock-timeout error instead of hanging.

## Root cause of #106 — the wiring gap

Two distinct `PostgresProjectStore` instances:

- `theo/api/cmd/setup_database.go:67` → `projectStore`; `:91` calls `SetProjectCapChecker(&planLimiterCapAdapter{...})` → serves `POST /api/v1/projects` (capped).
- `theo/api/cmd/setup_orchestrator.go:95` → a **separate** `&db.PostgresProjectStore{DB: dbAdapter}` for `BuildOrchestrator` → **no** cap checker → deploy path uncapped.

Even with a cap-aware `EnsureProject`, the orchestrator's store must have the checker wired. Fix options: (a) share one `projectStore` instance, or (b) call `SetProjectCapChecker` on the orchestrator store too. (a) is DRY (single source of truth, no drift) and preferred if the wiring allows passing the configured store into orchestrator setup.

## ADRs

### ADR-M5-1 — Enforce the cap inside `EnsureProject` on the same build-submit tx (no nested lock/connection)

**Context:** the cap must be atomic across (a) two deploys of different new projects of the same account (different env-locks → no serialization) and (b) a deploy racing a `POST /api/v1/projects` (env-lock vs account-lock → no serialization). Only an account-level lock shared by both paths serializes count+insert.

**Decision:** make `EnsureProject` cap-aware. On the bounded-plan + genuinely-new-project branch, acquire `pg_advisory_xact_lock(hashtext(accountID))` **on the `tx` it is handed** (the env-lock'd build-submit tx), then existence-check → count → cap-check → insert. Never open a second tx/connection.

**Why not a second advisory lock layer / SERIALIZABLE / counter row:** advisory lock is the canonical engine pattern (Rule 9, DRY with `createProjectCapped`); SERIALIZABLE would change isolation for the whole heavy build-submit tx; a counter row adds schema + a migration for no benefit.

**Consequences:** global lock order is env → account (acyclic). Same-account deploy concurrency serializes briefly; `lock_timeout=5s` bounds worst case with a typed error.

### ADR-M5-2 — Existing projects are never blocked (existence-check short-circuit)

**Context:** `EnsureProject` is idempotent (`INSERT ... ON CONFLICT (tenant_id,name) DO NOTHING`). A re-deploy to an existing project must not be blocked even when the account is already at/over cap (grandfathered).

**Decision:** under the account-lock, first `SELECT 1 FROM projects WHERE tenant_id=$1 AND name=$2`; if it exists → return nil (no-op, never count/block). Only a genuinely-new project triggers the cap gate. Mirrors M4 ADR-M4-4 block-new-only.

### ADR-M5-3 — Reuse the #101 typed-error surfacing; parity on error + metric

**Decision:** return `theoerrors.NewProjectsExceedPlan(plan, cap, count, accountID)` (`*TheoError`, code `PROJECTS_EXCEED_PLAN` → 422) from `EnsureProject`; `wrapSubmitBuildError`'s EC-3 `*TheoError` short-circuit + `mapBuildError`'s `*TheoError` branch surface it as 422 to the CLI (not a silent 500) — exactly as `enforceScaling`/#101 does. Increment `metrics.PlanLimitViolations.WithLabelValues("max_projects_per_account", plan)` on the deploy-path rejection (parity with M4 `project_wrapper.go:141`).

### ADR-M5-4 — Wire the cap checker on the orchestrator store (close the gap)

**Decision:** share the single configured `projectStore` (with the cap checker) into `BuildOrchestrator` instead of a second unconfigured instance — or, if the wiring forbids sharing, call `SetProjectCapChecker` on the orchestrator store. The store stays nil-checker-safe (dev/tests unenforced) and `cap < 0` unlimited skips the lock+count (EC-6 parity).

## Out of scope (YAGNI)

- The full-chain e2e harness (that is **M6**).
- Changing M4's `CreateProject` (already airtight).
- theo-memory / theo-cloud changes (none needed).
- GitHub App auto-deploy path beyond what `SubmitBuild` already covers (it shares `SubmitBuild`, so it is covered by construction).

## Citations resolve

All paths above are under `/home/paulo/Projetos/usetheo/theo-cloud/theo/` and were read during discovery (2026-06-28). Key anchors: `api/internal/services/build_orchestrator_submit.go:{41,54,77,102}`, `api/internal/routes/builds.go:{454,560,561}`, `api/internal/db/project_wrapper.go:{59,100,126,165}`, `api/internal/lock/environment_lock.go:{77,97}`, `api/cmd/setup_database.go:{67,91}`, `api/cmd/setup_orchestrator.go:95`, `api/internal/metrics/metrics.go:621`, `pkg/errors/errors.go:428`, `pkg/errors/http/mapping.go:101`.
