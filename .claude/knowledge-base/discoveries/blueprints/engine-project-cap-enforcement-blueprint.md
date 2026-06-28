---
slug: engine-project-cap-enforcement
milestone_id: M4
date: 2026-06-28
generated_by: discover (scoped — pattern locked by the Red Team #101 canonical + the M2 per-Account model)
verdict: SHIPPABLE_WITH_CAVEATS
repo: theo (engine, Go under api/) — sha 98fed9b4
---

# Discovery blueprint — M4 Engine project-cap enforcement

## Scope note (honesty — Rule 3)

The design is locked by TWO existing in-repo canonicals; no SOTA peer clone is warranted (KISS/YAGNI):
1. **Red Team theo-cloud#101 scale-cap fix** — the canonical per-plan cap-enforcement shape (typed error → 422 + metric + checker interface wired after `EnsureProductionWired`).
2. **M2 per-Account billing model** — the account-scoped plan/cap resolution (`subscriptions WHERE account_id = (tenant→account)`), now NOT NULL (M3).

Every citation below resolves on disk. The engine has its **own** Postgres DB containing `accounts`, `subscriptions`, `plan_limits`, `projects`, `tenants` — so M4 enforces entirely in-engine, no cross-service call.

## The reframing (critical — M4 is a MIGRATION, not a greenfield)

Project creation is **already capped**, but PER-TENANT:
- `api/internal/server/router.go:220-228` wires `projectEnforcement := enforcement.Middleware(cfg.PlanLimiter, OperationCheck{Metric:"projects", CountFn: ListByTenant(tenantID)})` on `POST /api/v1/projects` (`router.go:320`).
- It returns **HTTP 402** `PLAN_LIMIT_EXCEEDED` (`pkg/enforcement/middleware.go:44` `w.WriteHeader(http.StatusPaymentRequired)`).
- Plan is resolved **per-tenant**: `pkg/enforcement/store.go:70` `SELECT plan FROM subscriptions WHERE tenant_id=$1`.

M2 made the billing/cap entity the **Account** (all of an Account's tenants share one plan + one cap). So the per-TENANT projects cap is now the WRONG granularity. **M4 migrates it to per-Account**, adopting the #101 canonical (422 typed error + metric), and closes a latent race the middleware approach has (count is outside the insert transaction).

## The two patterns M4 composes

### Pattern A — #101 canonical cap enforcement (mirror exactly)

| #101 (scale) | M4 (projects) |
|---|---|
| `ScaleReplicasChecker` iface `CheckReplicasValue(tenantID, requested) (allowed, plan, cap)` — `internal/routes/scale.go:78` | `ProjectCapChecker` iface `CheckProjectsValue(tenantID, requested) (allowed, plan, cap)` |
| `enforceReplicaCap` builds typed err + metric — `scale.go:351-370` | per-Account cap check in the create path |
| `NewReplicasExceedPlan(...)` → code `REPLICAS_EXCEED_PLAN`, `pkg/errors/errors.go:418` | `NewProjectsExceedPlan(...)` → code `PROJECTS_EXCEED_PLAN` |
| `mapping.go:100` `"REPLICAS_EXCEED_PLAN":422` | add `"PROJECTS_EXCEED_PLAN":422` |
| `metrics.PlanLimitViolations.WithLabelValues("max_replicas_per_service", plan).Inc()` — `metrics.go:625` (labels: metric, plan) | `…WithLabelValues("max_projects_per_account", plan).Inc()` |
| wired in `cmd/setup_orchestrator.go` via `SetReplicasChecker(planCap)` AFTER `EnsureProductionWired()` (`:222-230`) | `SetProjectCapChecker(planCap)` after `EnsureProductionWired` |
| reuses `enforcement.PlanLimiter.CheckValue(tenantID, metric, requested)` — `limiter.go:148` | reuse `CheckValue` but ACCOUNT-scoped (new account resolver) |

### Pattern B — account-scoped resolution + atomic count (M2 + advisory lock)

- **Plan per-Account:** mirror M2's `SELECT plan FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id=$1) AND status IN ('active','trialing')` (the M2 e2e query, `billing_per_account_m2_e2e_test.go:55`). Add an account-scoped sibling to `store.go:GetTenantPlan` (e.g. `GetAccountPlan`).
- **Count per-Account:** `SELECT COUNT(*) FROM projects WHERE tenant_id IN (SELECT id FROM tenants WHERE account_id=$1)` (projects table has `tenant_id`, not `account_id`; tenants carry `account_id`, NOT NULL since M3 000044).
- **Atomicity (close the middleware's race):** the existing middleware counts BEFORE the handler inserts (two requests can both pass). M4 wraps count+insert in the create transaction guarded by `pg_advisory_xact_lock(hashtext(accountID))` — the exact pattern `theo-cloud/internal/auth/tenant.go` uses for race-safe tenant creation. Fast-path check (no lock) gives the common-case 422; the in-lock re-count is the race backstop.

## Coverage corners

### Coverage Corner 1 — Integration / contract tests
- **Unit (httptest + fake checker), mirroring `scale_test.go` RedTeam101**: over-cap→422 `PROJECTS_EXCEED_PLAN`; under-cap→2xx; nil-checker→no-enforcement (backward-compat); Starter cap=1 negative case.
- **Concurrency (`-race`)**: N goroutines create projects for one at-boundary Account; assert the account's project count never exceeds the cap (atomic guard). Mirrors `account_m0_e2e` concurrency tests.
- **e2e (real pg)**: seed a Starter Account (cap=1) with 2 tenants; creating a 2nd project in EITHER tenant → 422; enterprise (cap=NULL) Account → unlimited; grandfathered over-cap Account keeps existing projects (block-new-only).

### Coverage Corner 2 — Dependencies
- **No new dependency.** Reuses `pkg/enforcement` (`PlanLimiter`, `CheckValue`), `pkg/errors` (`TheoError`), `internal/metrics` (`PlanLimitViolations`), `pgx` (advisory lock), `go-sqlmock`/httptest (tests). Rule 9: nothing reinvented; mirrors the #101 infra.

### Coverage Corner 3 — Tools
- `go test -race`, httptest, go-sqlmock (unit), real pg-cloud (`E2E_PG_CLOUD_DSN`) for e2e, `golang-migrate` only if a migration is needed (it is NOT — see Techniques). All already used by the engine.

### Coverage Corner 4 — Techniques
- **No new migration.** The `plan_limits` row `metric='projects'` already holds the caps (starter=1, pro=10, team=10, enterprise=NULL — `000002` seed + `000032` re-assert). M4 only changes the RESOLUTION+COUNT scope (tenant→account) at the app layer, plus the error/metric. Parsimony rung 1: the cap data already exists.
- **402 → 422 behavior change** for the projects cap (the #101 canonical is 422). Documented; edge-case-plan must weigh client expectations of 402.
- **AccountID threading:** the engine's `middleware.UserContext` (`api/internal/middleware/auth.go:52`) has `TenantID` but NO `AccountID`. The cap path resolves account_id from `tenants.account_id` (one extra query, or extend UserContext). Parsimony: resolve in the checker (single query joins tenant→account→subscription), avoid threading a new field unless a 2nd consumer appears.

## ADRs (for downstream plan)

### ADR-M4-1 — Mirror the #101 ProjectCapChecker pattern (422 typed error), account-scoped
Add `ProjectCapChecker` + `NewProjectsExceedPlan` (code `PROJECTS_EXCEED_PLAN`, 422) + `PlanLimitViolations{metric:"max_projects_per_account"}`, wired via `SetProjectCapChecker` after `EnsureProductionWired`. **Rejected:** a bespoke check — the codebase has ONE canonical cap pattern (#101); diverging is Rule-9/consistency debt.

### ADR-M4-2 — Replace the per-tenant 402 projects middleware with per-Account 422 enforcement
The per-tenant `projectEnforcement` middleware is superseded by per-Account enforcement (the M2 cap entity is the Account). **Rejected:** keeping BOTH (per-tenant 402 AND per-account 422) — double enforcement with inconsistent status codes for the same resource; confusing and redundant once the Account is the cap entity. Behavior change 402→422 is documented in CHANGELOG.

### ADR-M4-3 — Atomic check+insert via per-account advisory lock (no new migration)
Wrap the cap re-count + project insert in the create transaction under `pg_advisory_xact_lock(hashtext(accountID))` (the tenant.go pattern). **Rejected:** a `UNIQUE`/partial-index guard — cannot express "≤ N rows per account" as a constraint without a counter table; the advisory lock is the established, simplest correct primitive. **Rejected:** a new migration — `plan_limits.projects` already holds the cap; M4 is app-layer only.

### ADR-M4-4 — Block-new-only for grandfathered / downgraded accounts
Enforcement bars NEW creation when count ≥ cap; it NEVER deletes/breaks existing projects or fails reads. Enterprise (cap=NULL) is never blocked. **Rejected:** retroactive deletion/migration of over-cap accounts — destructive, out of scope, and a support nightmare.

## Drawbacks & risks
1. **402→422 behavior change** — a client scripting against 402 for the projects cap sees 422. Mitigated: documented in CHANGELOG; 422 is the canonical theo cap status (#101); both are 4xx client errors.
2. **Check-then-create race** — closed by the in-transaction advisory lock + re-count (ADR-M4-3); proven by the `-race` concurrency test.
3. **Account resolution cost** — one extra join (tenant→account→subscription) per create. Negligible (create is rare, not a hot path).

## Unresolved questions
- (none) — every M4 decision is resolved by ADRs M4-1..M4-4 + the locked account-level-tenancy ADR.

## References (all resolve on disk)
- `theo/api/internal/routes/projects.go:207` (Create), `internal/server/router.go:220,320` (existing per-tenant projects middleware), `pkg/enforcement/middleware.go:44` (402)
- `theo/api/internal/routes/scale.go:78,351-370` (#101 checker + enforce), `pkg/errors/errors.go:418` (NewReplicasExceedPlan), `pkg/errors/http/mapping.go:100` (422 map), `internal/metrics/metrics.go:625` (PlanLimitViolations), `cmd/setup_orchestrator.go:222-230` (wiring), `internal/routes/scale_test.go` (RedTeam101 tests)
- `pkg/enforcement/limiter.go:148` (CheckValue), `pkg/enforcement/store.go:64,70` (GetTenantPlan — tenant-scoped, to get an account sibling)
- `theo/api/internal/db/migrations/000002_seed_data.up.sql:8` + `000032_plan_caps_m2.up.sql:48-50` (projects caps), `000035_tenants_account_id.up.sql` (tenants.account_id), `000044_*` (account_id NOT NULL)
- `theo-cloud/internal/auth/tenant.go` (advisory-lock race-safe pattern), `billing_per_account_m2_e2e_test.go:55` (account-scoped plan query)
