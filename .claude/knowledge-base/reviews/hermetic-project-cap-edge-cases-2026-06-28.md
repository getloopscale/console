# Edge Case Review — M5 Hermetic project-cap

Date: 2026-06-28
Plan: .claude/knowledge-base/plans/hermetic-project-cap-plan.md
Tasks analyzed: 3 (T1.1, T1.2, T2.1)
Cases found: 7 (EDGE: 3, NEGATIVE: 4 | MUST FIX: 1, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: `EnsureProject` called with a nil tx while the cap is bounded
- **Affected task:** T1.1
- **Kind:** NEGATIVE (the signature permits `tx == nil`, falling back to `s.DB`)
- **Family:** State / Resource
- **Scenario:** `EnsureProject(ctx, nil, ...)` is legal per its signature. The production caller (`build_orchestrator_submit.go:102`) always passes the env-lock'd tx, but a nil tx + bounded cap cannot enforce atomically on the auto-commit pool (each `Exec` is its own implicit tx → `pg_advisory_xact_lock` released between statements → count+insert NOT atomic).
- **Impact:** silent cap bypass OR a lock that doesn't serialize.
- **Suggested fix (absorbed):** in `EnsureProject`, when enforcement is needed (checker present, cap≥0) and `tx == nil`, open a dedicated tx from the pgx pool (the same `adapter.Pool.BeginTx` path `createProjectCapped` uses) and run the shared `enforceProjectCapTx` helper on it; if no pgx pool is available → fail closed (error), never bypass. When `tx != nil`, run the helper on the caller's tx (env-lock already held). Add a unit test for the nil-tx-with-pool branch in addition to the existing fail-closed-without-pool test.

## SHOULD TEST

### EC-2: cap boundary exactly at the limit (count == cap)
- **Affected task:** T2.1
- **Kind:** EDGE (largest valid is cap; first invalid is cap+1)
- **Suggested test:** `TestProjectCapHermeticM5_DeployBlocksNewBeyondCap` already asserts count==cap blocks the (N+1)th. Also assert the (N)th — the last allowed — SUCCEEDS (boundary-inclusive: a new project bringing count to exactly cap is allowed; only count≥cap blocks a further new one). Assert the *correct result at the boundary*, not just the rejection past it.

### EC-3: lock_timeout fires under same-account contention
- **Affected task:** T1.1 / T2.1
- **Kind:** NEGATIVE (resource: lock unavailable within 5s)
- **Suggested test:** `test_ensure_project_surfaces_lock_timeout` — hold `pg_advisory_xact_lock(hashtext(accountID))` from a second session, then call the deploy path; assert it returns a *wrapped/typed error* (not a hang, not a silent insert) and rolls back. Assert the specific error shape, not merely "it errors".

### EC-4: deploy of a NEW project races an API `CreateProject` for the same account at the boundary
- **Affected task:** T2.1
- **Kind:** EDGE (two valid creations, last slot)
- **Suggested test:** `TestProjectCapHermeticM5_DeployAndApiCreateShareTheCap` (already in plan) — proves both paths serialize on the SAME `hashtext(accountID)` keyspace; exactly one wins. Assert the loser is typed `PROJECTS_EXCEED_PLAN`.

### EC-5: two DIFFERENT accounts deploy new projects concurrently
- **Affected task:** T2.1
- **Kind:** EDGE (no cross-account contention)
- **Suggested test:** assert (or document) that distinct accounts take distinct `hashtext(accountID)` locks → both proceed without blocking (the cap is per-Account, not global). Lightweight assertion or a DOCUMENT note if covered implicitly by the per-account isolation in other scenarios.

## DOCUMENT

### EC-6: env→account lock order is the only global order (deadlock-safety invariant)
- **Kind:** NEGATIVE (timing)
- **Accepted risk / invariant:** the build-submit tx holds the env-lock then acquires the account-lock on the SAME connection; the API path takes the account-lock alone; placement-lock is not in the submit tx. No path takes account→env. The invariant MUST be preserved by any future code: never acquire the env-lock while holding the account-lock. Documented in the blueprint lock-order table + a code comment at the new lock site.

### EC-7: `ON CONFLICT DO NOTHING` vs explicit existence check
- **Kind:** EDGE
- **Accepted risk:** the explicit `SELECT 1 ... (tenant_id,name)` under the lock short-circuits existing projects before counting; the subsequent insert keeps `ON CONFLICT DO NOTHING` as defense-in-depth against a benign racing identical insert (idempotency preserved). The existence key equals the ON CONFLICT target, so the two cannot disagree.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 | 3 | 1 | 1 | 1 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 1 | 0 | 3 | 1 |

**Coverage check:** every task touching the DB boundary considered both an EDGE (boundary value, last-allowed slot, cross-account) and a NEGATIVE (nil-tx, lock-timeout, account-resolve-fail) case. T1.2 is pure wiring (no input boundary).

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (nil-tx handling) into T1.1 acceptance criteria; EC-2 boundary-inclusive assertion into T2.1. (Absorbed below.)
