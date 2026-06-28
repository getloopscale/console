# Implementation log — M4 Engine project-cap enforcement

**Slug:** engine-project-cap-enforcement · **Milestone:** M4 · **Date:** 2026-06-28
**Plan:** `.claude/knowledge-base/plans/engine-project-cap-enforcement-plan.md` (plan-confidence SHIPPABLE)
**Repo:** `theo` engine (Go under `api/`), branch `develop`. Commits `677b7782` → `d4b0c680`.

## What shipped

Project creation (`POST /api/v1/projects`) now enforces the project cap at the **Account** granularity (M2 made the Account the billing/cap entity), mirroring the canonical Red Team #101 scale-cap pattern:

- `pkg/errors`: `NewProjectsExceedPlan` + `PROJECTS_EXCEED_PLAN` sentinel → HTTP **422** (`mapping.go`), message carries the upgrade URL (EC-4).
- `pkg/enforcement`: `PlanLimiter.CheckProjectsValue(tenantID, current)` resolves the cap **account-scoped** (`GetAccountPlanByTenant` — the M2 `tenant → account → subscription.plan` join) + `plan_limits.projects`; `cap < 0` = unlimited. Account resolution is an OPTIONAL store capability (`accountPlanResolver`, ISP) so no `LimitsStore` fake had to change. EC-2: missing account subscription fails CLOSED to starter.
- `internal/db`: `PostgresProjectStore.CreateProject` enforces atomically — resolve cap up-front; unlimited (`cap<0`) skips the lock+count (EC-6); bounded plans run `BeginTx → pg_advisory_xact_lock(hashtext(accountID)) → count → check → insert → commit` in ONE transaction (the canonical engine `WithEnvironmentLock` pattern), so two concurrent creations at the boundary can never both succeed. Over the cap → metric + `NewProjectsExceedPlan`. Fail-CLOSED on a non-pgx handle (no silent bypass).
- `internal/routes`: the handler surfaces the typed `*TheoError` as 422 (not 500).
- `cmd/setup_database.go`: wires `SetProjectCapChecker` onto the route's store once the PlanLimiter is built.
- `internal/server/router.go`: the per-tenant `projectEnforcement` middleware (402, `ListByTenant`) was REMOVED — superseded by the per-Account 422 guard (ADR-M4-2; 402→422 behavior change documented in CHANGELOG).

## Wiring triad

| Pillar | Evidence |
|---|---|
| Caller | `POST /api/v1/projects` → `ProjectHandler.Create` (`projects.go:230`) → `store.CreateProject` — the ONLY production caller of CreateProject |
| Integration test | `tests/integration/project_cap_m4_test.go` — 4 scenarios vs real pg |
| Runtime metric | `theo_plan_limit_violation_total{metric="max_projects_per_account", plan}` incremented on rejection (`project_wrapper.go`), asserted in the e2e |

## Evidence (captured)

- **Build + vet:** `go build ./...` clean.
- **Unit (`-race`):** `pkg/errors` (typed error + 422), `pkg/enforcement` (account-scoped checker: Starter cap=1 deny, enterprise unlimited→Limit=-1, 2nd tenant same plan), `internal/routes` (handler maps typed error → 422 + upgrade URL), `internal/db`, `cmd` — all `ok`.
- **e2e (`-race`, real pg, m2test fully migrated):** `TestProjectCapM4` 4/4 PASS, idempotent:
  - `PerAccount_BlocksAcrossTenants` — Starter cap=1: 1st project OK; 2nd project under the OTHER tenant of the same account → 422 `PROJECTS_EXCEED_PLAN` (proves the cap is per-ACCOUNT, the M2-descoped bullet) + the violation metric increments (DoD #5).
  - `Enterprise_Unlimited` — 5 creates, none blocked, violation metric stays FLAT (EC-6 — unlimited skips the cap path).
  - `Grandfathered_BlockNewOnly` — 2 pre-existing projects (cap=1) survive + readable; new creation blocked (block-new-only, ADR-M4-4).
  - `ConcurrentAtBoundary_NeverExceedsCap` — 8 racers across 2 tenants of one account for the last slot: exactly 1 wins, the other 7 are all `PROJECTS_EXCEED_PLAN` (not lock/tx errors), final count == cap (the advisory-lock atomic guard holds).

## Edge cases (EC-1..EC-7)

EC-1 (explicit tx — the store had none) ✓ · EC-2 (account NULL fails closed to starter) ✓ · EC-3 (402→422, no 402 test broke, CHANGELOG documents it) ✓ · EC-4 (upgrade URL in message) ✓ · EC-5 (shared advisory keyspace — benign, documented) ✓ · EC-6 (enterprise skips lock+count — proven via metric-stays-flat) ✓ · EC-7 (parallel team work — the adapter carries BOTH #101 CheckReplicasValue and M4 CheckProjectsValue) ✓.

## Known follow-up (owner-decided)

The deploy-time `EnsureProject` safety-net (`build_orchestrator_submit.go`) is a SECOND project-row insertion path that does not consult the cap (potential bypass via `theo deploy <new-name>`). M4's DoD covers the explicit creation API; closing the deploy path atomically risks a nested-lock deadlock in the team's build-submit tx and is scope-expansion. **Owner decision: ship M4 + track as follow-up `usetheodev/theo-cloud#106`** (the product question "does deploy-time auto-create count against the cap?" + a deadlock-aware fix).

## Pre-existing engine debt (not M4)

`go vet ./...` flags `tests/unit/release_convergence_loop_test.go` (arg mismatch) — pre-existing team debt on `develop`, untouched by M4. The engine `develop` also carries the unhomed-baseline / caddyfile-csp gate debt surfaced in earlier milestones.
