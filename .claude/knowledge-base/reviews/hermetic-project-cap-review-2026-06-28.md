# Review — M5 Hermetic project-cap (close deploy-path bypass #106)

**Date:** 2026-06-28
**Slug:** hermetic-project-cap · **Milestone:** M5
**Repo:** `theo` engine (Go). Commits `79459bd7`→`HEAD` on `develop`.
**Method:** 3 independent specialist agents (concurrency/atomicity/deadlock, architecture/wiring/DRY, cross-validation) + code-quality + empirical RLS probe.
**Verdict:** READY_TO_MERGE

---

## Scope

Close the #106 deploy-path bypass: the deploy-time `EnsureProject` (`theo deploy <new-name>` / GitHub auto-deploy) now enforces the SAME per-Account project cap as M4's `POST /api/v1/projects`, atomically and deadlock-safely, with typed 422 + metric parity. theo-cloud untouched; no new dependency; no new migration.

## Specialist verdicts

| Agent | Verdict | Notable |
|---|---|---|
| Concurrency + atomicity + deadlock | SOUND (+ 1 HIGH latent, resolved) | env→account is the ONLY multi-lock order across the whole engine — acyclic, no opposite-order path, no nested connection. Existence-under-lock + count+insert atomic; 8-racer proven. HIGH: cross-tenant count is RLS-subject on the build-submit tx (see below). |
| Architecture + wiring + DRY | CLEAN | No second uncapped project-creation path (every `PostgresProjectStore{` classified; controller's is delete/reconcile-only). DRY refactor behavior-preserving (unique-violation→ErrProjectExists intact). Fail-closed verified. |
| Cross-validation | GAPS_FOUND → resolved | All DoD claims implemented + tested EXCEPT the #106 wiring line had no regression test. Now fixed. |
| Code-quality | PASS | No dead code (all new symbols called), no fabrication (build clean), DRY (lock/count SQL each appear once). Only vet failure is pre-existing unrelated team debt (`release_convergence_loop_test.go`). |

## Findings & resolutions

| # | Sev | Finding | Resolution |
|---|---|---|---|
| CONC-1 | HIGH (latent) | The cross-tenant cap count runs inside the build-submit tx, which sets `app.tenant_id` (projects RLS policy). If counted under an RLS-subject role it degrades to per-tenant. | **Empirically verified NOT manifest:** the submit path's role has `rolbypassrls=true` (probed on the live DB: `current_user=theo force_rls=false bypassrls=true`); the count returned identical results with `app.tenant_id` set vs cleared. The restricted `theo_worker` role is background-loops-only, never the submit path. **Resolved by:** (a) documenting the BYPASSRLS/owner invariant load-bearingly at `enforceProjectCapTx`; (b) an integration guard `...CrossTenantCountUnaffectedByRLSContext` that reproduces the RLS context (sets `app.tenant_id`=deploying tenant) and asserts the cap still binds cross-tenant; (c) tracked follow-up for SECURITY-DEFINER hardening IF the submit path ever moves to a non-BYPASSRLS role (`theo-cloud#111`). |
| XVAL-1 | MEDIUM | The #106 root-cause wiring line (`SetProjectCapChecker` on the orchestrator store) had no regression test — the integration test builds its own store. | **Structural fix:** extracted `wireProjectCap` — the SINGLE path BOTH project-creating stores wire through, so they can never diverge again (divergence was the #106 root cause). + `cmd/wire_project_cap_test.go` pins that the helper installs the checker (bounded → fail-closed) and that nil leaves it unenforced. |
| ARCH-1 | MEDIUM | Bounded-plan deploys now add an account-lock + ~3 round-trips + a new account-level serialization point — undocumented cost. | Documented at `EnsureProject` (cost note): low-QPS, DB-only locked window, enterprise/nil-checker stay zero-overhead. |
| ARCH-2 | LOW | The controller's orchestrator store is uncapped. | Safe (reconcile-only, never ensures projects); added a defensive comment explaining why + when to wire it. |
| CONC-2 | LOW | Account-lock timeout (55P03) surfaces as a generic `StageEnsureProject` build error, not typed `ErrLockTimeout`. | Accepted: it fails fast + honestly (not a hang/silent insert — `lock_timeout=5s` from the env tx applies); typing it is a non-blocking observability nicety. |
| CONC-3 | LOW | API-path `createProjectCapped` returns `PROJECTS_EXCEED_PLAN` instead of `ErrProjectExists` when recreating an existing project on an over-cap account. | Pre-existing M4 behavior (out of M5 scope); cosmetic error-precedence; noted. |

No finding remains open above LOW-accepted; CONC-1 is verified-not-manifest + documented + guard-tested + tracked.

## DoD (ROADMAP M5) — all verified with evidence

| DoD | Status | Evidence |
|---|---|---|
| `EnsureProject` consults the cap; over-cap new project → typed rejection (not silent 500) | ✅ | `ensureProjectCapped`→`enforceProjectCapTx`→`NewProjectsExceedPlan`; `mapBuildError`/`wrapSubmitBuildError` unit tests assert HTTP **422** + code |
| Deadlock-safe (no nested advisory lock; reuse build-submit tx lock order) | ✅ | account-lock on the caller's tx (env→account); `...DeployWithHeldEnvLock_EnforcesCapNoDeadlock` + full-engine lock-order graph (SOUND) |
| Existing-project deploys never blocked (cap applies to NEW only) | ✅ | existence-check UNDER the lock; `...ExistingProjectRedeployNeverBlocked` incl. grandfathered-over-cap |
| Concurrency: a deploy racing a create can't both succeed (`-race`) | ✅ | `...DeployAndApiCreateShareTheCap` (1 wins) + `...ConcurrentDeploysNeverExceedCap` (8 racers, 1 wins, 7 typed-rejected, count==cap) |
| Metric increments on deploy-path rejection (parity w/ M4) | ✅ | `theo_plan_limit_violation_total{metric="max_projects_per_account"}` asserted via `testutil.ToFloat64` delta (unit + integration) |
| `#106` closed with verification + evidence | ✅ | issue comment with scenario names + `-race` output; no secrets |

## Test footprint (all green, `-race`)

- Unit `internal/db`: `enforceProjectCapTx` (at-cap/under-cap/cap-zero-fail-closed/count-error), `resolveAccountAndLock` (lock+resolve-error), `EnsureProject` fail-closed-without-pool.
- Unit `internal/routes`: `mapBuildError` PROJECTS_EXCEED_PLAN → 422.
- Unit `internal/services`: `wrapSubmitBuildError` preserves PROJECTS_EXCEED_PLAN (would otherwise 500).
- Unit `cmd`: `wireProjectCap` wiring guard.
- Integration `tests/integration` (real pg, `-race`): 7 scenarios incl. the RLS-context guard.

## Hard gates (cycle-review)

| Gate | Status |
|---|---|
| Failing tests on branch | PASS — M5 packages build/vet/-race green; integration 7/7 |
| New secrets committed | PASS — none |
| Direct commit to `main` | PASS — all on `develop` |
| Co-Authored-By trailer | PASS — absent |
| CHANGELOG updated | PASS — `[Unreleased]` Added (M5) + Fixed (#106) |

## Verdict

**READY_TO_MERGE** — the per-Account project cap is now hermetic across BOTH creation paths (API + deploy), enforced atomically and deadlock-safely (full-engine lock-order graph proven acyclic), observably (metric parity), and surfaced as a typed 422 through the deploy path. The one HIGH (RLS exposure of the cross-tenant count) was empirically verified non-manifest (submit runs on a BYPASSRLS role), documented as a load-bearing invariant, guard-tested, and tracked for hardening if the role assumption ever changes. The #106 wiring root cause is structurally eliminated (single `wireProjectCap` path) and regression-tested. DoD fully met and proven (unit + integration under `-race`).
