# Review — M0: Account foundation

**Date:** 2026-06-27
**Slug:** account-foundation-m0 (milestone M0)
**Verdict:** **READY_TO_MERGE**
**Repos / commits:**
- theo-cloud (Go): `07de4c5` (roadmap+plan) · `f974c78` (feat) · `b4d3097` (wiring log) · `75b5b4e` (review fixes) · `8614ff7` (deploy-order doc) · `61d7214` (plan doc align)
- theo (pg-cloud migrations): `cc89e60a` (migrations 000034–000039) · `8f6e47a2` (down fix + migration itest)

## Cycle executed (full, no step skipped)

| Phase | Skill | Result |
|---|---|---|
| Discover | deep-review of current code (baseline) | file:line baseline (ADR is the locked design; SOTA-clone skipped — KISS) |
| Plan | `/to-plan` | plan written, Coverage Matrix 100% |
| Plan gates | `/edge-case-plan` · `/deps-audit` · `/plan-confidence` | MUST-FIX absorbed · no new deps · **SHIPPABLE 97.6** |
| Implement | TDD (RED→GREEN→REFACTOR→WIRING→COMMIT) | 6 migrations + Go account pkg + 5 edits |
| Code-quality | build/vet/dead-code/wiring | **PASS** (no dead code, no fabrication, wiring triad complete) |
| Review | 4 specialist agents ×2 rounds | **READY_TO_MERGE** |

## Severity matrix (round 1 → round 2)

| Reviewer | Round 1 | Round 2 (after fixes) |
|---|---|---|
| Architecture | ARCH_CONCERNS (1 HIGH, 2 MED, 1 LOW) | HIGH (deploy-order) documented + fail-closed; others addressed |
| Tests | TESTS_CONCERNS (1 BLOCKER, 2 HIGH, 4 MED) | **TESTS_OK** (0/0/0) |
| Cross-validation | XVAL_CONCERNS (1 BLOCKER, 2 HIGH, 3 MED) | **XVAL_OK** (0/0/0, 2 LOW advisory) |
| Security | SEC_CONCERNS (1 HIGH, 1 MED, 2 LOW) | **SEC_OK** (0/0/0) |

### Findings resolved (with evidence)

- **BLOCKER — 14 `tests/unit` RED** (I had run only `./internal/...`). Mocks updated for the new `account_id` SELECT/INSERT + EnsureAccount query. → `go test ./internal/... ./tests/unit/` = **12 pkgs ok, 0 fails**.
- **HIGH — new keys persisted `account_id=NULL`** (`/v1/api-keys` is behind `RequireJWT`, no AccountID). Fixed: `CreateKey` derives `account_id` from the tenant via subquery `(SELECT account_id FROM tenants WHERE id=$3)`. Regression test `TestAccountM0_NewKeyInheritsTenantAccount` drives the real handler → key inherits tenant's account (non-NULL).
- **HIGH — migration backfill/reversibility had no in-repo test.** Added `theo/infra/tests/check-m0-account-migrations_test.sh` (committed, runnable, PASS): one-account-per-owner, linkage, idempotency, full down-reversibility.
- **HIGH — deploy ordering** (binary reads `account_id` before migration lands). Documented in CHANGELOG; fail-closed (503 `ErrBackendUnavailable`, never silent) confirmed.
- **MEDIUM — RequireScope dropped AccountID** → now set (scope.go:243). **000037 down over-delete + misleading comment** → honest comment + documented dev-only rollback. **EnsureAccount create-error untested** → `TestEnsureAccount_PropagatesCreateError`.

### LOW (accepted, advisory)

- RequireScope AccountID propagation has no dedicated middleware-context assertion; the code is identical to `ResolveAPIKey` (`row.accountID.String`), which has explicit populate+NULL unit tests. Accepted (KISS).

## Evidence (real, reproducible)

- **Migrations** vs real pg-cloud: RED → up 34→39 → 2 accounts (1/owner), 3 tenants + 2 keys linked, backfill idempotent, **full round-trip reversible**. (`check-m0-account-migrations_test.sh` PASS)
- **Go unit/integration**: build+vet clean; 12 pkgs ok, 0 fails.
- **e2e `-race` vs real pg**: legacy key resolves (AccountID ""), new signup → 1 account owns tenant, new key inherits tenant account, N distinct signups → N accounts, concurrent same-subject → 1 account+1 tenant (no data race).
- **plan-confidence**: SHIPPABLE 97.6, 0 hard caps.

## DoD — all met

- [x] migrations apply + reverse (000033↔000039) exit 0 vs pg-cloud
- [x] `go test ./internal/... ./tests/unit/ ./tests/e2e/(-race)` GREEN
- [x] wiring triad per new symbol (caller + integration test + runtime log)
- [x] legacy `theo_live_*` still 200, AccountID ""
- [x] CHANGELOG `[Unreleased] § Added` in both repos
- [x] `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` = READY_TO_MERGE

## Next

Cut the release via `/release` (develop→main PR, human-approved) — it will flip `ROADMAP.md` M0 `[ ]`→`[x]` post-merge (plan carries `milestone_id: M0`). Then M1 (broker per-Account lazy validation).
