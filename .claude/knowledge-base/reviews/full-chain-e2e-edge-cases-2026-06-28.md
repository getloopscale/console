# Edge Case Review — M6 Full-chain e2e

Date: 2026-06-28
Plan: .claude/knowledge-base/plans/full-chain-e2e-plan.md
Tasks analyzed: 5 (T1.1, T2.1, T2.2, T3.1, T3.2)
Cases found: 6 (EDGE: 2, NEGATIVE: 4 | MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: pg-cloud DSN realignment (`theocloud` → `theo`) silently breaks the existing memory e2e
- **Affected task:** T1.1
- **Kind:** NEGATIVE (config drift)
- **Family:** State / Integration
- **Scenario:** the existing `memory_e2e_test.go` + `run.sh` use `E2E_PG_CLOUD_DSN` with user/db `theocloud`. Realigning pg-cloud to `theo` (required for the engine migrations) without updating EVERY reference leaves the memory tests pointing at a non-existent DB → false failures or silent skips.
- **Impact:** the team's existing e2e suite breaks.
- **Suggested fix (absorbed):** `E2E_PG_CLOUD_DSN` is the single source in `run.sh`; update it + the compose `POSTGRES_*` + the theo-cloud `DATABASE_URL` together in T1.1, and RE-RUN the full `make e2e` suite (memory + tenancy) green before merge. Verify no test hardcodes `theocloud`.

## SHOULD TEST

### EC-2: stack-readiness race (login runs before Kratos is ready)
- **Affected task:** T1.1 / T2.1
- **Kind:** NEGATIVE (timing)
- **Suggested test:** rely on `docker compose --wait` gating on the `kratos` `/health/ready` healthcheck; the Go test only starts post-`--wait`. Assert the helper retries the flow-init once on a connection refusal (cheap) rather than failing on a cold edge.

### EC-3: pre-verified identity already exists across re-runs (duplicate-identity 409)
- **Affected task:** T2.1
- **Kind:** EDGE (idempotent re-run)
- **Suggested test:** the provisioning helper treats a 409 from `POST /admin/identities` as "already provisioned" (look up the id) rather than failing; teardown `DELETE`s it. Assert two consecutive `go test` runs both pass (the double-run oracle in the acceptance criteria).

### EC-4: port collision on the host (e.g. 55432 taken by another stack)
- **Affected task:** T1.1
- **Kind:** NEGATIVE (resource)
- **Suggested handling:** the compose ports are `${E2E_*_PORT:-default}` overridable; document that a collision is resolved by exporting `E2E_PG_CLOUD_PORT`. (Observed in the spike: theolens held 55432 → remapped to 55442.) DOCUMENT in run.sh/README, do not hardcode.

## DOCUMENT

### EC-5: the full-chain cannot exercise the engine project-cap
- **Kind:** NEGATIVE (coverage boundary)
- **Accepted risk:** the engine is not in the theo-cloud stack (ADR-M6-3); the cap is engine-proven (M5). Documented in the seam README so coverage is not over-read.

### EC-6: CI cannot be executed from the dev box
- **Kind:** NEGATIVE (verification boundary)
- **Accepted risk:** `make e2e` green locally is the proxy oracle; the workflow's first real run is on push. Honestly noted in the workflow comment + the PR.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 2 | 1 | 2 | 0 |
| T2.1 | 1 | 1 | 0 | 1 | 0 |
| T2.2 | 1 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 1 | 0 | 0 | 1 |
| T3.2 | 0 | 0 | 0 | 0 | 1 |

**Coverage check:** the infra/test tasks consider both EDGE (idempotent re-run, self-recall boundary) and NEGATIVE (DSN drift, readiness race, port collision, CI boundary) lenses.

**Verdict:** PLAN NEEDS ADJUSTMENT — EC-1 (DSN realignment full-suite re-run) absorbed into T1.1; EC-3 (409 idempotency) into T2.1 acceptance (double-run oracle already present).
