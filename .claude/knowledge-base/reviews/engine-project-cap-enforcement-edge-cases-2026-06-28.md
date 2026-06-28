# Edge Case Review — engine-project-cap-enforcement (M4)

Date: 2026-06-28
Tasks analyzed: 6 (T1.1, T1.2, T2.1, T2.2, T3.1, T3.2)
Cases found: 7 (EDGE: 2, NEGATIVE: 5 | MUST FIX: 4, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: `CreateProject` has NO transaction today — the atomic guard must add one
- **Affected task:** T2.1
- **Kind:** NEGATIVE (race / correctness)
- **Family:** State
- **Scenario:** `internal/db/project_wrapper.go:51` `CreateProject` issues a single sqlc `InsertProject` via `bridge.GeneratedDB()` — there is NO surrounding transaction. The plan's atomic guard (advisory lock + count + insert) CANNOT be atomic unless `CreateProject` (or a new `CreateProjectWithCap`) begins a transaction, takes `pg_advisory_xact_lock` (xact-scoped → auto-released on commit/rollback), counts, then inserts — all on the SAME tx handle. The codebase's tx-composition pattern is `EnsureProject(ctx, tx DBTX, …)` (`project_wrapper.go`) which accepts an explicit tx.
- **Impact:** without the tx, `pg_advisory_xact_lock` would release immediately (not xact-scoped) and the count+insert would not be atomic — the race stays open.
- **Suggested fix:** T2.1 explicitly begins a tx in the cap-enforcing create path; advisory lock + count + insert run on that tx; commit. Mirror `theo-cloud/internal/auth/tenant.go` (BeginTx → advisory lock → re-check → insert → commit).

### EC-2: `UserContext` has no `AccountID` — resolve from `tenants.account_id`
- **Affected task:** T1.2, T2.1
- **Kind:** NEGATIVE (missing data at the boundary)
- **Family:** Input
- **Scenario:** `internal/middleware/auth.go:52` `UserContext` carries `TenantID` only. The cap path needs the Account. Resolve it from `tenants.account_id` (NOT NULL since M3 `000044`) in the checker/guard query — do NOT thread a new `AccountID` field unless a 2nd consumer appears (parsimony rung 1/4).
- **Impact:** if not resolved, the cap cannot be account-scoped.
- **Suggested fix:** the account-scoped queries (plan resolve + count) JOIN through `tenants.account_id` from the request's `tenantID` — a single resolution, no UserContext change. Guard: a tenant with NULL account_id (impossible post-M3, but defensive) → treat as no-cap-resolved → fail-closed OR default plan (decide: default to the free/starter cap, never silently unlimited).

### EC-3: 402 → 422 behavior change — find and update any 402 assertion
- **Affected task:** T3.1
- **Kind:** NEGATIVE (contract change)
- **Family:** Integration
- **Scenario:** the per-tenant middleware returned 402 `PLAN_LIMIT_EXCEEDED`; M4 returns 422 `PROJECTS_EXCEED_PLAN`. Unit tests: `grep` of `projects_test.go` found NO 402 assertion (low unit risk). BUT a LIVE bash e2e or a dashboard client may assert 402 on the projects cap.
- **Impact:** a consumer scripting on 402 for the projects cap sees 422.
- **Suggested fix:** T3.1 greps the engine repo for `402`/`PaymentRequired`/`PLAN_LIMIT_EXCEEDED` tied to `/api/v1/projects` and updates any; the CHANGELOG documents the 402→422 change prominently. (Both are 4xx; 422 is the canonical theo cap status per #101.)

### EC-4: the typed 422 message must carry the upgrade URL (mirror the canonical)
- **Affected task:** T1.1
- **Kind:** EDGE (UX of the error)
- **Family:** Format
- **Scenario:** every canonical theo cap/upgrade error message includes "Upgrade at https://usetheo.dev/pricing" (`errors.go:422` replicas, `:578` plan-upgrade). `NewProjectsExceedPlan` must do the same so the client gets an actionable path.
- **Impact:** a bare "cap exceeded" without the upgrade URL is a worse UX than the 402 middleware (which included `upgradeURL`).
- **Suggested fix:** `NewProjectsExceedPlan` message: "Account '%s' has %d projects — the %s plan allows up to %d. Upgrade at https://usetheo.dev/pricing or delete a project." (mirror `NewReplicasExceedPlan`).

## SHOULD TEST

### EC-5: advisory-lock keyspace shared with tenant creation
- **Affected task:** T2.1
- **Kind:** NEGATIVE (operational)
- **Suggested test:** N/A (correctness unaffected) — `pg_advisory_xact_lock(hashtext(accountID))` shares the 64-bit advisory keyspace with `tenant.go`'s `hashtext(userID)`. A hash collision only causes BENIGN extra serialization (two unrelated ops wait on each other briefly), never a correctness bug. The concurrency test (T2.1) proves the cap holds regardless; document the shared keyspace as accepted.

### EC-6: enterprise (unlimited) must skip the lock + count entirely
- **Affected task:** T2.2
- **Kind:** EDGE (extreme of valid — unlimited plan)
- **Suggested test:** `test_create_project_enterprise_takes_no_lock_no_count` — when the resolved cap is NULL (unlimited), the create path does NOT take the advisory lock NOR run the count query (perf + correctness: an enterprise account with thousands of projects must not pay the count cost). Assert via sqlmock that only the INSERT is issued for the unlimited path.

## DOCUMENT

### EC-7: parallel team work on the engine `develop` (merge-coordination)
- **Kind:** NEGATIVE (cross-team)
- **Accepted risk:** the engine `develop` is the team's active sprint (Red Team #101 scale-cap touched `pkg/enforcement` + `internal/routes/scale.go` + `cmd/setup_orchestrator.go` — the SAME files M4 touches). Expect merge friction on `setup_orchestrator.go` (both add a checker wiring) and `errors.go`/`mapping.go` (both add a typed error). Mitigation: keep M4 commits small + rebase-friendly; resolve conflicts preserving BOTH (the #101 replicas checker AND the M4 projects checker coexist). Not blocking; documented so the implement phase expects it.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-4) | 0 | 0 |
| T1.2 | 0 | 1 | 1 (EC-2 shared) | 0 | 0 |
| T2.1 | 0 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| T2.2 | 1 | 0 | 0 | 1 (EC-6) | 0 |
| T3.1 | 0 | 1 | 1 (EC-3) | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 | 0 |
| (cross) | 0 | 1 | 0 | 0 | 1 (EC-7) |

**Coverage check:** every task touching an input/state boundary has both lenses considered.

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (explicit tx in CreateProject), EC-2 (account_id resolution + NULL-account fail-closed), EC-3 (402→422 grep + CHANGELOG), EC-4 (upgrade URL in message) as MUST-FIX into the plan; EC-5/EC-6 as SHOULD-TEST; EC-7 documented.
