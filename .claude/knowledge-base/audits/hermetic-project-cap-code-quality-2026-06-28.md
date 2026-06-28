# Code-Quality Audit — M5 Hermetic project-cap

**Date:** 2026-06-28 · **Slug:** hermetic-project-cap · **Repo:** `theo` engine
**Commits:** `79459bd7`→`b105d38d` on `develop` · **Verdict:** PASS

## Detectors

| Detector | Result | Evidence |
|---|---|---|
| D1 — Dead code | PASS | All new symbols have callers: `resolveAccountAndLock` (createProjectCapped + ensureProjectCapped), `enforceProjectCapTx` (both), `ensureProjectInsert` (EnsureProject + ensureProjectCapped), `ensureProjectCapped` (EnsureProject). No orphan exports (all unexported, intra-package). Test helper `mustEnsure` used by all 6 scenarios. |
| D2 — Symbol fabrication | PASS | `go build ./...` exits 0 → every referenced symbol resolves (PgxTxAdapter, NewProjectsExceedPlan, PlanLimitViolations, ErrNoRows all real). |
| D3 — Cross-package wiring | PASS | `buildProjectStore` wired into `BuildOrchestratorDeps.ProjectStore` (setup_orchestrator.go); the cap checker reaches the deploy path (proven by integration). |
| D4 — Mutation/test quality | PASS (manual) | Unit + 6 integration `-race` scenarios; negative + edge + concurrency + boundary-inclusive all covered. |

## go vet

- Touched packages (`internal/db`, `internal/routes`, `internal/services`, `cmd`): **clean**.
- `tests/unit/release_convergence_loop_test.go:270` arg-mismatch: **PRE-EXISTING team debt** on `develop`, untouched by M5 (same item flagged in the M4 review). Not introduced here; not in M5's scope.

## DRY / SRP

- The advisory-lock + count SQL each appear exactly ONCE (`pg_advisory_xact_lock`: 1, `count(*) FROM projects`: 1) — shared via `resolveAccountAndLock` + `enforceProjectCapTx`, called by both the API and deploy paths. No duplicated knowledge.

## Verdict

**PASS** — no dead code, no fabrication, wiring complete, DRY respected. The only vet failure is pre-existing unrelated team debt. Proceed to `/review`.
