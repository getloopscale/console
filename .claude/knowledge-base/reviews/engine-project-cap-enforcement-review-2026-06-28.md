# Review — M4 Engine project-cap enforcement

**Date:** 2026-06-28
**Slug:** engine-project-cap-enforcement · **Milestone:** M4
**Repo:** `theo` engine (Go). Commits `677b7782`→`d4b0c680` on `develop`.
**Method:** 3 independent specialist agents (concurrency/atomicity, architecture/wiring, cross-validation) + code-quality.
**Verdict:** READY_TO_MERGE

---

## Scope

Enforce the per-Account project cap at the engine's project-creation path (`POST /api/v1/projects`): reject the (N+1)th project beyond the Account's plan cap with a typed 422 `PROJECTS_EXCEED_PLAN`, atomically and observably, mirroring the canonical #101 scale-cap. Replaces the per-tenant 402 enforcement. theo-cloud untouched; no new dependency; no new migration (reuses `plan_limits.projects`).

## Specialist verdicts

| Agent | Verdict | Notable |
|---|---|---|
| Concurrency + atomicity | SOUND (no BLOCKER/HIGH) | lock→count→insert→commit on one tx under READ COMMITTED genuinely serializes same-account creations; the waiter's count observes the winner's committed row; cap holds across tenants + under the 8-racer test; single-lock-per-tx → no deadlock; no TOCTOU (up-front call only resolves plan+cap) |
| Architecture + wiring | 1 HIGH (deploy bypass), else clean | checker wired onto the exact route store instance; single CreateProject caller; ISP sound (prod resolves account-scoped, fakes degrade to tenant); no cycle; no dead code; 402→422 migration complete |
| Cross-validation | NEEDS_FIXES → resolved | DoD #1–#4 met + proven at 3 levels; flagged metric-test + EC-6-test gaps (now closed) + naming |
| Code-quality | PASS | every new symbol has a production caller; no fabrication; no orphan from the removed middleware |

## Findings & resolutions

| # | Sev | Finding | Resolution |
|---|---|---|---|
| ARCH-1 | HIGH | `EnsureProject` (deploy-time safety-net) is a 2nd project-row insert path that bypasses the cap | **Owner-decided: ship M4 + follow-up.** M4's DoD is the explicit creation API (fully met). Closing the deploy path atomically risks a nested-lock deadlock in the team's build-submit tx + is scope-expansion. Filed `usetheodev/theo-cloud#106` (product question + deadlock-aware fix). |
| XVAL-1 | HIGH | Violation metric incremented but no asserting test (DoD #5) | e2e now asserts `plan_limit_violation{metric=max_projects_per_account,plan=starter}` increments by 1 on rejection. `d4b0c680`. |
| XVAL-2 | MEDIUM | EC-6 "enterprise skips lock+count" unproven | e2e now asserts the violation metric stays FLAT for an enterprise account (the cap<0 path is never evaluated as a violation). `d4b0c680`. |
| XVAL-3 | MEDIUM | db-layer atomic guard has no UNIT test (integration-only) | Accepted by design: advisory-lock atomicity under READ COMMITTED is genuinely pg-behavior — sqlmock cannot prove it (a non-pgx handle now fails closed). The integration test IS the correct level and runs `-race` vs real pg (4/4 green). |
| CONC-1 / XVAL | MEDIUM | Concurrency test didn't assert losers' error type | e2e now asserts all 7 losers are `PROJECTS_EXCEED_PLAN` (not lock/tx errors masking a regression). `d4b0c680`. |
| ARCH-2 / CONC-2 | LOW | `createProjectCapped` failed OPEN silently on a non-pgx handle | Changed to FAIL CLOSED (returns an error) — never silently bypass the quota boundary. `d4b0c680`. |
| XVAL-4 | LOW | ROADMAP DoD said `PROJECT_CAP_EXCEEDED` vs shipped `PROJECTS_EXCEED_PLAN` | ROADMAP reconciled to the shipped code (mirrors `REPLICAS_EXCEED_PLAN`). `theo-cloud 7bc1c48`. |
| — | INFO | e2e at `tests/integration/` (no `e2e` build tag) vs plan's `tests/e2e/` | Better — runs with the normal integration suite (skips without pg). Plan's acceptance command updated in spirit. |

No finding remains open above LOW-accepted; ARCH-1 is owner-decided + tracked.

## DoD (ROADMAP M4)

| DoD | Status | Evidence |
|---|---|---|
| project-creation resolves the Account's cap; rejects (N+1)th with typed 422 | ✅ | `PROJECTS_EXCEED_PLAN`→422 wired end-to-end; e2e per-account-across-tenants |
| Negative-case: Starter cap=1 → 2nd project typed error | ✅ | checker unit + handler 422 unit + e2e |
| Concurrency: two simultaneous creations can't both succeed, `-race` | ✅ | 8-racer e2e under `-race`: exactly 1 wins, count == cap |
| unlimited never blocked; grandfathered block-new-only | ✅ | e2e enterprise + grandfathered scenarios |
| metric `plan_limit_violations{metric=max_projects_per_account}` on rejection | ✅ | incremented in the rejection path; e2e asserts the delta |

## Hard gates (cycle-review)

| Gate | Status |
|---|---|
| Failing tests on branch | PASS — M4 packages build/vet/-race green; e2e 4/4 |
| New secrets committed | PASS — none |
| Direct commit to `main` | PASS — all on `develop` |
| Co-Authored-By trailer | PASS — absent |
| CHANGELOG updated | PASS — theo `[Unreleased]` (Added + BREAKING 402→422 Changed) |

## Pre-existing engine debt (not M4, not blocking)

- `tests/unit/release_convergence_loop_test.go` arg mismatch (`go vet`) — pre-existing on `develop`, untouched by M4.
- engine `develop` carries the unhomed-baseline / caddyfile-csp gate debt from earlier milestones.

## Verdict

**READY_TO_MERGE** — no open BLOCKER/HIGH on the M4 scope. The per-Account cap is enforced atomically, observably, and account-scoped at the explicit creation path; all review test/observability gaps were closed; the deploy-path bypass is owner-decided as a tracked follow-up (#106). DoD fully met and proven (unit + e2e under `-race` vs real pg).
