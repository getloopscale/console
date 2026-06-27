# Review — M1: Broker per-Account-scoped mint (lazy validation)

**Date:** 2026-06-27
**Slug:** account-broker-m1 (milestone M1)
**Verdict:** **READY_TO_MERGE**
**Repo / commits:** theo-cloud — `1fa42c5` (plan) · `0df25dc` (impl) · `8aa8163` (review fixes)

## Cycle executed (full, no step skipped)

| Phase | Result |
|---|---|
| Discover | deep-review of broker + ForwardAuth (file:line baseline) |
| Plan | `/to-plan` → **plan-confidence SHIPPABLE 100.0** (0 hard caps) |
| Plan gates | edge-cases absorbed; no new deps |
| Implement | TDD `-race`: broker accountID + cache key; `auth.AccountOwnsTenant`; ForwardAuth authorizer + 403; cmd/main wiring; both brokers' Evict |
| Code-quality | **PASS** (build/vet clean, no dead code, wiring triad complete) |
| Review | 3 specialist agents — **ARCH_OK · XVAL_OK · SEC_OK · TESTS_OK (after fixes)** |

## Severity matrix (round 1 → after fixes)

| Reviewer | Round 1 | After fixes |
|---|---|---|
| Architecture | ARCH_OK (1 LOW) | LOW closed (themory Evict test) |
| Tests | TESTS_CONCERNS (1 MEDIUM, 2 LOW) | **TESTS_OK** (MEDIUM + symmetry LOW closed) |
| Cross-validation | XVAL_OK | XVAL_OK |
| Security | SEC_OK (1 LOW) | LOW confirmed safe (FK) |

**No BLOCKER, no HIGH at any point.**

### Findings resolved
- **MEDIUM (tests)** — `themory.Evict` behavior changed (middle-segment match) + CHANGELOG-advertised but untested. Fixed: `TestBroker_EvictForcesRemint` added to `internal/themory/broker_test.go` (mirrors promptly).
- **LOW (tests, symmetry)** — themory broker lacked an empty-tenant guard test. Fixed: `TestBroker_EmptyTenantRejected`.
- **LOW (security)** — an empty-string `account_id` would also skip the ownership check. Confirmed **safe**: `account_id` is FK-constrained (`000036 … REFERENCES accounts(id)`), so `''` cannot exist without an account row id `''`. Re-confirm when M3 adds `NOT NULL`.
- **INFO** — the plan's Baseline file table omits `internal/promptly/broker.go`; its change is compiler-forced by the shared `TenantKeyMinter` interface (not scope creep). The promptly handler is correctly wired with the same authorizer.

## Key invariants verified

- **Seam preserved (the keystone):** the minted key's `workspace_id == tenantID`; `accountID` is threaded into the **cache key** but **never reaches `MintKey`** / theo-memory / theo-promptly. Proven by `TestBroker_…WorkspaceStaysTenant` + e2e scenario 1 (capturing minter) + grep of both brokers/admin_clients.
- **Cross-account isolation airtight:** parameterized `SELECT 1 FROM tenants WHERE id=$1 AND account_id=$2`; `!owns` → 403, **no mint, no Authorization** (e2e scenario 2 asserts all three).
- **Backward-compat not fail-open:** legacy `AccountID==""` skips the check (M0 keys only); a post-M0 key's `account_id` is non-NULL (derived from its tenant); attacker cannot null it without DB write.
- **Fail-closed on every DENY:** authorize DB-error → 503; mint error → 503; empty mint → 503; resolver backend-unavailable → 503 — none set Authorization.
- **Broker lazily trusts** (ADR-M1-1): the broker holds no DB handle and never queries `tenants`.

## Evidence (real, reproducible)

- `go build ./...` exit 0; `go vet` clean.
- `go test -race ./internal/themory/... ./internal/auth/... ./internal/routes/... ./internal/promptly/... ./tests/unit/` GREEN; full `./internal/... ./tests/unit/` = **12 pkgs ok, 0 fails**.
- `go test -tags=e2e -race ./tests/e2e/ -run AccountBrokerM1` vs real pg-cloud: account-owns→200 (workspace==tenant), cross-account→403 no-mint, legacy→200, concurrent→all 200 no-race.
- plan-confidence: SHIPPABLE 100.0.

## DoD — all met

- [x] `KeyForTenantScoped(accountID,…)` + cache key includes accountID; minter still `workspace_id==tenantID`
- [x] `AccountOwnsTenant` + ForwardAuth cross-account 403; legacy 200; authorize-error 503
- [x] `-race` unit + e2e GREEN against pg-cloud; Model B round-trip unchanged
- [x] wiring triad per new symbol (caller + integration test + slog metric)
- [x] CHANGELOG `[Unreleased] § Added` updated
- [x] `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` = READY_TO_MERGE

## Next

Cut the release via `/release` (theo-cloud develop→main, next minor v0.11.0) — flips ROADMAP M1 `[ ]`→`[x]` post-merge. Then M2 (billing per-Account).
