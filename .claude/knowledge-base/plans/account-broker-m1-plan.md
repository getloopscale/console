---
slug: account-broker-m1
milestone_id: M1
created_at: 2026-06-27
goal: Make the per-tenant credential broker + ForwardAuth Account-aware — KeyForTenantScoped takes accountID and keys the cache by it, and ForwardAuth rejects a cross-account credential (account_id not owning tenant_id) with 403 — while the minted key's workspace stays == tenantID (theo-memory seam unchanged) and legacy NULL-account keys keep working, proven by go test -race + an integration suite against pg-cloud.
---

# Plan — M1: Broker per-Account-scoped mint (lazy validation)

## Goal

Make the broker + ForwardAuth **Account-aware**: `KeyForTenantScoped(ctx, accountID, tenantID,
scopes)` includes `accountID` in the cache key, and ForwardAuth **rejects a credential whose
`account_id` does not own the targeted `tenant_id`** (cross-account → 403) — while (a) the minted
key's `workspace_id` stays `== tenantID` (theo-memory seam unchanged), and (b) legacy NULL-account
keys still mint and return 200 (M0 backward-compat). The broker **lazily trusts** the
ForwardAuth-validated `account → tenant` relationship (validation lives in ForwardAuth, not the broker).

**Single observable metric:** `go test -race ./internal/themory/... ./internal/auth/... ./internal/routes/... ./tests/unit/`
passes, AND a new integration suite against pg-cloud is GREEN proving: account-aware key mints
(workspace == tenant), cross-account credential → 403, legacy NULL-account key → 200, and the Model B
round-trip still isolates by tenant.

## Context

Derived from `ROADMAP.md § M1` and `.claude/knowledge-base/adrs/ADR-account-level-tenancy.md`. Builds
on M0 (released v0.10.0): `theo_api_keys.account_id` exists (nullable, derived from the tenant);
`UserContext.AccountID` is populated by `ResolveAPIKey`. **Out of M1:** billing per-Account (M2),
`NOT NULL` enforcement + JWT `account_id` (M3). The data-plane (theo-memory) is **not touched** — the
Account never crosses the `openapi/themory.yaml` seam; `workspace_id == tenant_id` stays invariant.

## Baseline Context

Verified against current code on `develop` (HEAD f939f9e, post-M0) via deep review.

### Files that will be touched

| File | LoC region | Why it changes |
|---|---|---|
| `internal/themory/broker.go` | 31-33, 74, 84-111, 94 | `KeyForTenantScoped(ctx, accountID, tenantID, want)` + cache key includes accountID; `KeyForTenant` wrapper gains accountID; minter interface unchanged |
| `internal/themory/broker_test.go` | 21-69 | update `countingMinter`/`newTestBroker` callers; add account-in-cache-key concurrency test |
| `internal/auth/ownership.go` | NEW (~40) | `AccountOwnsTenant(ctx, db, accountID, tenantID) (bool, error)` — `SELECT 1 FROM tenants WHERE id=$1 AND account_id=$2` |
| `internal/auth/ownership_test.go` | NEW | unit (sqlmock): owns→true, not-owns→false, db-error→error |
| `internal/routes/routes.go` | 38 | `TenantKeyMinter` interface gains `accountID` param |
| `internal/routes/forward_auth.go` | 47-58, 60-100, 80 | `ForwardAuthHandler` gains an injected `authorize` owner-check; cross-account → 403 (skipped when accountID==""); calls `KeyForTenantScoped(ctx, uc.AccountID, uc.TenantID, scopes)` |
| `internal/routes/forward_auth_test.go` | 23-46, 60-203 | update `stubMinter` signature + `resolveTo`; add cross-account-403 + legacy-200 tests; race test stays green |
| `cmd/main.go` | 254, 265-272 | inject the `authorize` closure (db-captured); data-path `KeyForTenant(ctx, u.AccountID, u.TenantID)` |
| `tests/e2e/account_broker_m1_e2e_test.go` | NEW | integration vs pg-cloud (account-aware mint, cross-account 403, legacy 200, isolation) |
| `CHANGELOG.md` | `[Unreleased]` | Added entry |

### Current callers / dependents

- `Broker.KeyForTenantScoped` has exactly two transitive callers: `forward_auth.go:80` (the edge authz path) and `Broker.KeyForTenant` (`broker.go:74`, the in-process data path called at `cmd/main.go:254`). Both must pass `accountID`.
- `TenantKeyMinter` interface (`routes.go:38`) is implemented by `*themory.Broker` and the test `stubMinter` (`forward_auth_test.go:23`). Changing it touches both.
- `minter` interface (`broker.go:31-33`, `MintKey`) is **unchanged** — the broker still mints with `workspace_id == tenantID`; `*AdminClient.MintKey` (`admin_client.go:60`) and `countingMinter` are unaffected by the signature change (accountID never reaches MintKey).
- `auth.ResolveAPIKey` (`scope.go:152-166`) already returns `UserContext{AccountID, TenantID}` (M0). No resolver change needed; M1 only consumes `AccountID`.
- The data path `cmd/main.go:254` `themoryBroker.KeyForTenant(ctx, u.TenantID)` — `u` is a `*auth.UserContext` with `AccountID` available.

### Domain glossary

- **Account-aware key** — a `theo_live_*` whose row has a non-NULL `account_id` (minted post-M0).
- **Legacy key** — a `theo_live_*` with NULL `account_id` (pre-M0); resolves with `AccountID == ""`. Must keep working (M0 contract).
- **Lazy validation** — the broker does NOT re-check `account → tenant`; it trusts ForwardAuth, which authorized it. The broker only mints + caches.
- **Cross-account credential** — a resolved `{AccountID, TenantID}` where `AccountID` does not own `TenantID` (data drift, or a tampered/inconsistent key). Rejected at ForwardAuth with 403.

### Architecture boundaries affected

Per `rules/architecture.md`: the **ownership authorization** is a domain check (`internal/auth`), injected into the interface layer (`ForwardAuthHandler`) as a function (DIP) — ForwardAuth depends on an injected `authorize func`, not on `*sql.DB` directly. The **broker stays free of the ownership concern** (it lazily trusts) — SRP. The minter→theo-memory boundary (`admin_client.MintKey`, `workspace_id`) is **unchanged**: Account never crosses to the data-plane.

## Prior Art & Related Work

- M0 plan/impl (`account-foundation-m0`) — the `account_id` column + `UserContext.AccountID` this builds on; the e2e harness (`tests/e2e/account_m0_e2e_test.go`, `seedUser/seedTenant/seedAPIKey`) M1's e2e mirrors.
- `internal/themory/broker_test.go` (`countingMinter`, singleflight/cache tests) — the broker TDD shape M1 mirrors.
- `internal/routes/forward_auth_test.go` (`stubMinter`, `resolveTo`, ALLOW/DENY asserts) — the ForwardAuth TDD shape M1 mirrors.
- `tests/e2e/edge_forward_auth_e2e_test.go` — the Model B CWE-441 round-trip M1 must keep green.

## ADRs (decisions for this plan)

### ADR-M1-1 — Ownership validation lives in ForwardAuth; the broker lazily trusts
The `account → tenant` ownership check runs in `ForwardAuthHandler` (an injected `authorize` func); the broker only mints + caches (SRP, ROADMAP "broker lazily trusts the resolver's validated relationship"). **Rejected alternative:** put the check in the broker — couples the broker to the `tenants` table + a DB handle, and re-validates on every cache miss (the broker is meant to be a thin cache-aside minter). Cites `rules/architecture.md` (DIP — inject the authorizer).

### ADR-M1-2 — Legacy NULL-account keys SKIP the ownership check (preserve M0 backward-compat)
When `AccountID == ""` (legacy key), ForwardAuth does NOT run the ownership check and mints as before. **Rejected alternative:** require ownership for all keys — would 403 every pre-M0 `theo_live_*` (the ownership query `account_id = ''` matches no tenant), breaking the M0 contract that legacy keys keep working. The cross-account guard applies only to account-aware keys.

### ADR-M1-3 — `accountID` enters the cache key but NOT the mint (workspace stays tenantID)
Cache key becomes `accountID + "\x00" + tenantID + "\x00" + scopes`; the minted key's `workspace_id` stays `tenantID` (admin_client unchanged). **Rejected alternative:** mint with an account-scoped workspace — would change the theo-memory isolation unit from tenant to account, contradicting the invariant (`workspace_id == tenant_id`) and requiring a data-plane change (out of M1).

## Dependency Graph

```
Phase 1 (broker: accountID param + cache key)  ── interface + signature change
        │
        ▼
Phase 2 (ownership helper + ForwardAuth authorize + wiring)  ── consumes the new broker signature
        │
        ▼
Phase 3 (integration vs pg-cloud)  ── the eat-your-own-cooking gate
```

Phase 1 T1.1 is the keystone (signature). Phase 2: T2.1 (ownership helper) parallel to nothing; T2.2 (ForwardAuth) depends on T1.1 + T2.1; T2.3 (wiring) depends on T2.2. Phase 3 depends on all.

## Phase 1 — Broker Account-aware

### T1.1 — `KeyForTenantScoped(ctx, accountID, tenantID, want)` + cache key includes accountID

#### Files to edit
`internal/themory/broker.go` (31-33 minter unchanged, 74 KeyForTenant wrapper, 84-111 KeyForTenantScoped, 94 cache key), `internal/themory/broker_test.go`

#### Why this step
Action: add `accountID string` as the first id param to `KeyForTenantScoped` and to the `KeyForTenant` wrapper; change the cache key to `accountID + "\x00" + tenantID + "\x00" + strings.Join(scopes, ",")`. The mint call (`b.admin.MintKey(ctx, tenantID, "gw-"+tenantID, scopes)`) is **unchanged** — accountID never reaches the minter (theo-memory seam invariant, ADR-M1-3). Reasoning: the cache must not collide across accounts (defense-in-depth) and the broker must accept the accountID the ForwardAuth validated.

#### TDD
RED (mirror `broker_test.go`): `test_keyfortenantscoped_threads_accountid` — call with `(accA, tnX, scopes)`; assert the minter received `workspaceID == tnX` (NOT accA) and `name == "gw-"+tnX` via the existing `countingMinter`. `test_cache_key_includes_account` — two calls `(accA, tnX)` then `(accB, tnX)` produce **2 mints** (distinct cache entries), while `(accA, tnX)` twice → **1 mint** (cache hit).
GREEN: the signature + cache-key change.

#### Concurrency tests
`test_broker_concurrent_distinct_accounts_no_collision` — N goroutines call `KeyForTenantScoped` with distinct `(accountID, tenantID)` pairs concurrently; assert each mints exactly once and no secret bleeds across pairs (singleflight keyed by the new cache key). Run with `go test -race` (race detector required) — the LRU + singleflight are shared mutable state.

#### Failure scenarios (external I/O — admin HTTP mint)
- Mint error (admin API down) → `KeyForTenantScoped` returns error, **no cache write** (existing fail-closed; re-asserted with the new signature via `countingMinter{fail:true}`).
- (no DB in the broker — the ownership DB check is in ForwardAuth, T2.x.)

#### Acceptance criteria
- [ ] `go test -race ./internal/themory/...` exits 0 AND `test_keyfortenantscoped_threads_accountid` asserts the captured `MintKey` `workspaceID == tenantID` (NOT accountID).
- [ ] `test_cache_key_includes_account` asserts `(accA,tnX)` then `(accB,tnX)` yields exactly 2 mints AND `(accA,tnX)` twice yields exactly 1 mint (`countingMinter.mints == 1`).

#### DoD
`go test -race ./internal/themory/...` GREEN; `grep` confirms `MintKey` call still passes `tenantID` (not accountID).

## Phase 2 — Ownership validation + ForwardAuth

### T2.1 — `auth.AccountOwnsTenant` helper

#### Files to edit
`internal/auth/ownership.go` (NEW), `internal/auth/ownership_test.go` (NEW)

#### Why this step
Action: `AccountOwnsTenant(ctx, db, accountID, tenantID string) (bool, error)` runs `SELECT 1 FROM tenants WHERE id = $1 AND account_id = $2`; returns `(true,nil)` on a row, `(false,nil)` on `ErrNoRows`, `(false, wrapped)` on a real DB error. Reasoning: the single authoritative `account → tenant` ownership check, injected into ForwardAuth (ADR-M1-1).

#### TDD
RED (sqlmock, mirror `scope_resolve_test.go`): `test_account_owns_tenant_true` (row → true), `test_account_owns_tenant_false_when_no_row` (ErrNoRows → false, no error), `test_account_owns_tenant_db_error_propagates` (generic error → false + wrapped error, NOT a silent false).

#### Concurrency tests
(none — single-threaded). A stateless read; no shared mutable state.

#### Failure scenarios (external I/O — pg)
- `ErrNoRows` → `(false, nil)` (not-owns, the 403 path) — asserted.
- DB connection error → `(false, error)` so ForwardAuth fails **closed** (503), never a silent allow — asserted (negative case).

#### Acceptance criteria
- [ ] `go test ./internal/auth/...` exits 0 AND `AccountOwnsTenant` returns `(true,nil)` on a matching row, `(false,nil)` on `sql.ErrNoRows`, and `(false, non-nil)` on a DB error (asserted distinct in `ownership_test.go`).

### T2.2 — ForwardAuth: inject `authorize`, reject cross-account (403), pass accountID to the broker

#### Files to edit
`internal/routes/routes.go` (38 `TenantKeyMinter`), `internal/routes/forward_auth.go` (47-58 struct+ctor, 60-100 flow, 80 call site), `internal/routes/forward_auth_test.go`

#### Why this step
Action: (a) `TenantKeyMinter.KeyForTenantScoped` gains `accountID`; (b) `ForwardAuthHandler` gains an injected `authorize func(ctx, accountID, tenantID string) (bool, error)`; (c) after the scope check, **if `uc.AccountID != ""`** run `authorize` — on `false` → 403 `CROSS_ACCOUNT` (no Authorization header), on error → 503 fail-closed; legacy `AccountID == ""` skips the check (ADR-M1-2); (d) call `KeyForTenantScoped(ctx, uc.AccountID, uc.TenantID, scopes)`. Reasoning: the milestone's cross-account rejection, backward-compat preserved.

#### TDD
RED (mirror `forward_auth_test.go`): `test_forwardauth_account_owns_tenant_mints_200` (authorize→true → 200 + minted Authorization, minter received accA); `test_forwardauth_cross_account_403_no_authorization` (authorize→false → 403, **no Authorization header**, minter NOT called); `test_forwardauth_legacy_null_account_skips_check_200` (AccountID="" → authorize NOT called → 200); `test_forwardauth_authorize_db_error_503_failclosed` (authorize→error → 503, no Authorization); existing mint-fail 503 + valid-key 200 stay green with the new minter signature.

#### Concurrency tests
`test_forwardauth_concurrent_same_account_tenant` — the existing N-goroutine race test, updated to the new signatures; assert all 200 + minted header, no data race. Run with `go test -race` (race detector required).

#### Failure scenarios (external I/O — DB ownership check + admin mint)
- `authorize` returns error (DB down) → 503, no Authorization (fail-closed) — asserted.
- cross-account (authorize false) → 403, no Authorization, **minter never called** (no wasted mint) — asserted.
- mint error (existing) → 503, no Authorization — re-asserted with new signature.

#### Acceptance criteria
- [ ] `go test -race ./internal/routes/...` exits 0 AND ForwardAuth returns HTTP `200` (account owns tenant) / `403` (cross-account, `Authorization` header empty, minter call count == 0) / `200` (legacy `AccountID==""`) / `503` (authorize DB error, `Authorization` header empty) — each asserted by a named test.

### T2.3 — `cmd/main.go` wiring

#### Files to edit
`cmd/main.go` (254 data-path call, 265-272 ForwardAuth construction)

#### Why this step
Action: construct `NewForwardAuthHandler(resolve, broker, authorize, "memory:read", logger)` where `authorize := func(ctx, acc, ten string) (bool, error) { return auth.AccountOwnsTenant(ctx, db, acc, ten) }` (db captured); update the data path `themoryBroker.KeyForTenant(ctx, u.AccountID, u.TenantID)`. Reasoning: wire the real DB-backed authorizer + thread accountID on the in-process path.

#### TDD
RED: covered by `go build ./...` (compile) + the existing route/integration tests; the wiring itself is exercised by the e2e (T3.1). No new unit test (composition root).

#### Concurrency tests
(none — single-threaded). Composition-root wiring, no shared mutable state.

#### Acceptance criteria
- [ ] `go build ./...` exits 0 AND `grep -n 'AccountOwnsTenant' cmd/main.go` returns 1 line (the injected authorizer) AND `grep 'KeyForTenant(ctx, u.AccountID, u.TenantID)' cmd/main.go` returns the threaded data-path call.

## Phase 3 — Integration Validation (eat your own cooking)

### T3.1 — `tests/e2e/account_broker_m1_e2e_test.go` vs pg-cloud

#### Why this step
Action: against `E2E_PG_CLOUD_DSN` (the live pg-cloud), drive the real `ForwardAuthHandler` (with the real `AccountOwnsTenant` + a stub/real broker) across the scenarios. Reasoning: only a real-pg run proves the ownership SQL + the wiring agree.

#### Scenarios (each an assertion)
1. **Account-aware mint (workspace == tenant)** — provision an account+tenant (M0 EnsureTenant), mint a key, drive ForwardAuth → 200 + minted Authorization; assert the broker minted with `workspace_id == tenantID` (NOT accountID) via a capturing minter (Account never crosses to the data-plane).
2. **Cross-account → 403** — seed a key whose `account_id` is UPDATEd to an account that does NOT own its tenant (inconsistent/drift); drive ForwardAuth → 403, no Authorization, no mint.
3. **Legacy NULL-account → 200** — seed a key with `account_id IS NULL`; drive ForwardAuth → 200 (ownership check skipped), minted Authorization.
4. **Model B round-trip still green** — the existing `edge_forward_auth_e2e_test.go` tenant-isolation assertion still passes (cross-tenant recall empty).

#### Concurrency tests
`test_m1_concurrent_account_aware_mints_race` — N goroutines drive ForwardAuth for N distinct accounts/tenants against real pg under `go test -race`; assert all 200, distinct minted keys, no data race.

#### DoD (Global)
- [ ] `go build ./...` exit 0.
- [ ] `go test -race ./internal/themory/... ./internal/auth/... ./internal/routes/... ./tests/unit/` GREEN (incl. updated stubs).
- [ ] `go test -tags=e2e -race ./tests/e2e/ -run 'AccountBrokerM1|EdgeForwardAuth'` GREEN against pg-cloud.
- [ ] minter still receives `workspace_id == tenantID` (theo-memory seam unchanged; grep + the capturing-minter assertion).
- [ ] Wiring triad per new symbol (`AccountOwnsTenant` caller = ForwardAuth; integration test = T3.1; runtime metric = a `slog` line on cross-account 403).
- [ ] `CHANGELOG.md [Unreleased] § Added` updated.
- [ ] `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` = READY_TO_MERGE.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| `KeyForTenantScoped(accountID, tenantID, scopes)` + cache key includes accountID | T1.1 |
| minted key workspace stays == tenantID (theo-memory unchanged) | T1.1, T3.1 (scenario 1) |
| `AccountOwnsTenant` ownership check | T2.1 |
| ForwardAuth rejects cross-account → 403 | T2.2, T3.1 (scenario 2) |
| legacy NULL-account key still 200 | T2.2, T3.1 (scenario 3) |
| broker lazily trusts (validation in ForwardAuth) | T2.1, T2.2 (ADR-M1-1) |
| wiring + DB-backed authorizer | T2.3 |
| Model B round-trip green | T3.1 (scenario 4) |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Ownership check 403s legacy keys (breaks M0 compat) | HIGH | skip check when `AccountID == ""` (ADR-M1-2); `test_forwardauth_legacy_null_account_skips_check_200` + e2e scenario 3 | impl |
| accountID accidentally sent to theo-memory (workspace becomes account) | HIGH | mint call unchanged (`workspaceID == tenantID`); capturing-minter assertion (T1.1, T3.1 scenario 1) | impl |
| Cache collision across accounts | MEDIUM | accountID in cache key; `test_cache_key_includes_account` + concurrency test | impl |
| DB error on ownership check silently allows | MEDIUM | error → 503 fail-closed (never silent allow); `test_forwardauth_authorize_db_error_503` | impl |
| 4 call-site signature change misses one | MEDIUM | compiler catches (interface change); `go build ./...` + full suite | impl |

## Unresolved Questions

- Whether to cache the ownership result (today: one `SELECT 1` per ForwardAuth request). For M1 it is a single indexed lookup per edge request — acceptable; caching is a perf follow-up, not needed now (YAGNI). (none other — every M1 decision is resolved by the ADR + ROADMAP.)

## Failure scenarios (external I/O — pg-cloud + admin HTTP)

| Dependency | Failure mode | Reproduced by | Expected behavior |
|---|---|---|---|
| pg (ownership) | not-owns (no row) | cross-account seed / sqlmock ErrNoRows | 403, no Authorization, no mint |
| pg (ownership) | connection error | sqlmock error / e2e | 503 fail-closed, no Authorization |
| admin HTTP (mint) | admin down | `countingMinter{fail:true}` / stub err | 503 fail-closed, no cache write, no Authorization |
| pg (ownership) | legacy NULL account | seed `account_id IS NULL` | check skipped → 200 |

## Global Definition of Done

Complete when Phase 3 DoD holds: full `-race` chain GREEN against pg-cloud, the minter still scopes by
tenant (Account never crosses the seam), cross-account 403 + legacy 200 both proven, Model B round-trip
green, wiring triad satisfied, CHANGELOG updated, `/code-quality` not FAIL_HARD/INVALID, `/review` READY_TO_MERGE.
