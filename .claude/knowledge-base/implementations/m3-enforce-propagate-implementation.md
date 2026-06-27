# Implementation log — M3 Enforce + propagate (Phase 2)

**Slug:** m3-enforce-propagate · **Milestone:** M3 · **Date:** 2026-06-27
**Plan:** `.claude/knowledge-base/plans/m3-enforce-propagate-plan.md` (plan-confidence SHIPPABLE)

Three repos changed:
- `theo-contracts` — additive `account_id` session claim → released **v0.2.0** (tag `v0.2.0`, commits `197c432`, `bf0c73c`).
- `theo` (engine) — migration **000044** NOT NULL on `tenants`/`theo_api_keys` (commit `578b0660`).
- `theo-cloud` — wire `account_id` through the mint path + ship-criterion e2e (commits `95986a5`, `fcff5ee`, `674e9f3`).

## Per-task wiring triad

| Task | Caller (production) | Test (boundary) | Observability |
|---|---|---|---|
| T1.1 `SessionClaims.AccountID` + `Issue(accountID)` | `session_token.go:116` | `jwt/account_id_contract_test.go` (3 cases) | n/a (contract type) |
| T2.1 migration 000044 NOT NULL + guard | applied by `golang-migrate` in deploy | ship-criterion scenarios 5+6 (LIVE) | migration RAISE message |
| T3.2 `EnsureTenant` returns accountID | `session_token.go:102`, `consent/handler.go:227` | `tenant_test.go` (returning-user EC-1) | `tenant.go:180` log on create |
| T3.3 mint carries accountID | `session_token.go:116` | `account_id_propagation_test.go` (Exchange decodes claim) | — |
| T3.4 middleware surfaces AccountID | `cmd/main.go` broker `KeyForTenant(u.AccountID, …)` | `account_id_propagation_test.go` (RequireJWT) | `middleware.go` slog |
| T4.1 ship-criterion | — (test) | `ship_criterion_m3_e2e_test.go` (6 scenarios) | — |

`account_id` flows end-to-end: `EnsureTenant` (DB) → `session_token.Exchange` → `Issue` → HMAC token → `RequireJWT` → `UserContext.AccountID` → broker. No orphan; the contract reviewer confirmed the real reader at `cmd/main.go`.

## LIVE evidence (captured — DoD #1 + #3, EC-5)

All against the real pg-cloud container `theo-workspace-pg-cloud-1`, DB `m2test` migrated through 000044 (DSN `postgres://theo:theo@10.0.18.3:5432/m2test`).

### Migration 000044 (T2.1 / T2.2 / G1)

```
# pre-state: tenants/keys account_id nullable, 0 NULLs (M0 backfill complete)
tenants|YES   theo_api_keys|YES   nulls=0|0
# apply 000044 up
applied OK → tenants|NO   theo_api_keys|NO
# round-trip: down → nullable; up → NOT NULL (reversible)
down OK → tenants|YES theo_api_keys|YES ; up OK → tenants|NO theo_api_keys|NO
# guard-negative (LIVE, rolled back): seed a NULL tenant, run the guard
psql ERROR: tenants.account_id has NULLs — run the 000038 backfill before enforcing NOT NULL
# m2test left intact after rollback: tenants|NO theo_api_keys|NO  nulls=0
```

### Ship-criterion e2e (T4.1 / G3) — `go test -tags=e2e -race -run ShipCriterionM3`

```
--- PASS: TestShipCriterionM3
    --- PASS: /AccountOwnsTwoTenants            (one Account owns 2 tenants)
    --- PASS: /CrossAccountIsolation            (ACME key→200 workspace==tenant; cross-account→403 no-mint, real ForwardAuth)
    --- PASS: /PerAccountBilling                (both tenants resolve 'pro' from ONE subscription via account-join)
    --- PASS: /LegacyJWTWithoutAccountID_200    (pre-M3 token, no account_id claim → 200, AccountID=="")
    --- PASS: /AccountIDNotNullEnforced         (SQLSTATE 23502 on account_id, tenants AND theo_api_keys)
    --- PASS: /PreflightGuardFiresOnResidualNull (000044 guard RAISEs P0001 on a residual NULL; rolled back)
ok  github.com/usetheodev/theo-cloud/tests/e2e
```

Idempotent (passes on re-run). The whole M0+M1+M2+M3 account e2e suite is green under `-race` against the 000044-migrated DB.

### Unit + contract (`-race`)

- `theo-contracts`: `go test -race ./jwt/` → ok (incl. `TestSessionIssuer_CarriesAccountID`, `TestSessionClaims_ForwardCompat_LegacyTokenValidates`, `TestSessionClaims_ForwardCompat_UnknownFieldIgnored`).
- `theo-cloud`: `go build ./...` clean; `go vet ./internal/...` clean; `go test -race ./internal/... ./tests/unit/` → all pass.

## Forward-compat seam (DoD #2 / G2)

- theo-cloud `go.mod` → `theo-contracts v0.2.0`; theo engine `go.mod` stays `v0.1.0`. **Zero `replace`** in either (`grep -c replace.*theo-contracts` = 0). The engine ignores the additive claim (JSON unknown-key drop), proven by the fieldless-consumer contract test.

## Schema-reconciliation note (consequence of 000044)

Making `account_id` NOT NULL eliminated the NULL-account DB state. Two prior e2e tests that seeded a NULL (`account_m0_e2e` Scenario 1, `account_broker_m1_e2e` Scenario 3) were removed — that state is now impossible by construction. Their defensive-code coverage remains at the unit layer (`scope_resolve_test.go::TestResolveAPIKey_ToleratesNullAccountID`, `forward_auth_test.go::TestForwardAuth_LegacyNullAccount_SkipsCheck_200`). The shared seed helpers `seedTenant`/`seedAPIKey` now provision+set `account_id` so every e2e seed produces a valid post-M3 row (a key's account owns its tenant).

## Known pre-existing item (not M3)

`TestMemoryExports_CreateIgnoresClientFilename` is flaky under `-race` (TempDir cleanup races an async exports worker) — pre-existing, unrelated to M3. Filed as `usetheodev/theo-cloud#104`. M3's own tests are deterministic green under `-race`.
