---
slug: m3-enforce-propagate
milestone_id: M3
created_at: 2026-06-27
goal: Close the account-level-tenancy migration — make account_id NOT NULL on tenants/theo_api_keys, propagate account_id into the dashboard JWT additively, and prove the V1 ship-criterion end-to-end.
---

# Plan — M3 Enforce + propagate (Phase 2)

## Goal

Close the `account-level-tenancy` migration (Phase 2):

- **G1** — `account_id` becomes `NOT NULL` on `tenants` and `theo_api_keys` after the M0 backfill window, gated by a pre-flight NULL check that aborts loudly if any NULL remains.
- **G2** — the dashboard JWT carries `account_id` **additively** (optional claim) via `theo-contracts`; tokens minted before the change (no `account_id`) still validate during the transition.
- **G3** — a V1 ship-criterion e2e proves: one Account, two isolated tenants, per-Account billing, and a legacy (NULL-account) key returning 200 — all on a fully-migrated schema.

Source of design: `account-level-tenancy` ADR (locked) + discovery blueprint at `.claude/knowledge-base/discoveries/blueprints/m3-enforce-propagate-blueprint.md`.

## Coverage Matrix

| # | Goal claim | Task(s) | Status |
|---|---|---|---|
| G1 | account_id NOT NULL on tenants + theo_api_keys with pre-flight gate | T2.1, T2.2 | mapped |
| G2a | additive account_id claim minted + validated forward-compat | T1.1, T1.2, T1.3 | mapped |
| G2b | account_id wired through theo-cloud mint path (provisioner→issuer→context) | T3.1, T3.2, T3.3, T3.4 | mapped |
| G3 | V1 ship-criterion e2e (Account, 2 isolated tenants, per-Account billing, legacy key 200) | T4.1 | mapped |

Every goal claim maps to ≥ 1 task. No gap.

## Baseline Context

Deep review of the current state so a junior implementer needs no repo spelunking.

### Files that will be touched

| File | LoC today | Last commit (sha) | Why it changes | Invariants to preserve |
|---|---|---|---|---|
| `theo-contracts/jwt/validator.go` | 507 | ac5b03d | add additive `SessionClaims.AccountID` (102-107) + `Issue` accountID param (309-332) | existing tokens without the claim still validate; signing alg unchanged |
| `theo-cloud/internal/auth/tenant.go` | 269 | 82ffb73 | `EnsureTenant` (37) surfaces accountID it already computes (106) | advisory-lock provisioning race semantics (M0) unchanged |
| `theo-cloud/internal/auth/middleware.go` | 166 | 82ffb73 | HMAC branch (113-125) sets `UserContext.AccountID` from claim | legacy token (no claim) still authenticates 200 |
| `theo-cloud/internal/routes/session_token.go` | 130 | 82ffb73 | `Exchange` (49) passes accountID to `Issue` (114) | TENANT_ERROR path unchanged; no JWT on provisioning failure |
| `theo/api/internal/db/migrations/000044_*` | NEW | 5afcf9ed | NOT NULL flip + pre-flight NULL gate | reversible down; guard aborts on residual NULL |
| `theo-cloud/tests/e2e/ship_criterion_m3_e2e_test.go` | NEW | 82ffb73 | compose M0+M1+M2 ship-criterion | `t.Skip` when DSN unset (no false green) |

### Current callers / dependents

- `SessionTokenIssuer.Issue` has exactly ONE production caller: `internal/routes/session_token.go:114`. The signature change is single-site.
- `TenantProvisioner.EnsureTenant` has 7 callers: `internal/routes/session_token.go:101`, `internal/consent/handler.go:227`, `tests/unit/tenant_test.go:20,141`, `tests/e2e/account_m0_e2e_test.go:97,130,179,215`. All update mechanically for the new return value.
- `theo-contracts v0.1.0` is version-pinned by BOTH `theo-cloud/go.mod:65` AND `theo/api/go.mod:91`, with NO `replace` anywhere — a shared, versioned contract. The engine only *validates* SessionClaims; it never mints and does not read `account_id` (grep-confirmed empty).
- M0 backfill already populated `account_id`: `000038_link_tenants_account.up.sql`, `000039_link_keys_account.up.sql`. Verified on a fully-migrated DB: `COUNT(*) WHERE account_id IS NULL` = 0 for both `tenants` and `theo_api_keys`.

### Domain glossary

- **Account** — Cliente Theo (billing entity); `acct-{16hex}`; lives only in the control-plane.
- **Tenant** — data-isolation boundary (`== workspace_id` in theo-memory); unchanged by M3.
- **SessionClaims** — the HMAC JWT theo-cloud mints for the dashboard (`theo-contracts/jwt/validator.go:102`).
- **Additive claim** — an optional JWT field (`json:",omitempty"`) older validators ignore and older tokens omit; the forward-compat seam.

### Architecture boundaries affected

Per `rules/architecture.md`: the contract type lives in `theo-contracts` (shared module); the minting wiring stays in theo-cloud `internal/routes` + `internal/auth` (composition + provisioning); the NOT NULL enforcement is a `theo` engine migration. theo-memory / data-plane untouched (`workspace_id == tenant_id` invariant holds). No new cross-layer dependency: `account_id` already flows through `UserContext` (M0); M3 only adds the JWT-path population that the API-key path already had.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `github.com/golang-jwt/jwt/v5` | (as pinned) | go | JWT mint/validate — already used in `theo-contracts/jwt` |
| `github.com/jackc/pgx/v5` | (as pinned) | go | e2e pg driver — already used in `tests/e2e` |
| `github.com/DATA-DOG/go-sqlmock` | (as pinned) | go | unit DB mocking — already used |

### Changed — version bump only

| Package | From | To | Ecosystem | Rule 9 rationale |
|---|---|---|---|---|
| `github.com/usetheodev/theo-contracts` | v0.1.0 | v0.2.0 | go | NOT a new dep — the additive SessionClaims change ships as a new minor of the existing shared contract; theo-cloud bumps its `require`. No alternative evaluated because reinventing the contract module is out of the question (Rule 9). |

### New

(none — M3 introduces no new dependency.)

### Removed

(none)

## Tasks

### Phase 1 — theo-contracts: additive account_id claim (G2a)

### T1.1 — Add `SessionClaims.AccountID` + `Issue` accountID param

#### Files to edit
`theo-contracts/jwt/validator.go`

#### Why this step
Action: add `AccountID string json:"account_id,omitempty"` to `SessionClaims` and an `accountID` parameter to `SessionTokenIssuer.Issue`, set on the minted claims. Reasoning: the claim must be carried by the token theo-cloud mints; `omitempty` keeps it forward-compatible so a pre-change token (no field) and a v0.1.0 validator (no field in its struct) both still work (ADR-M3-2).

#### TDD
RED: `TestSessionIssuer_CarriesAccountID` asserts `Issue(sub,email,name,tenant,"acct-x")` then `ValidateSession` returns `claims.AccountID == "acct-x"`. Fails to compile/parse until the field + param exist.

#### Concurrency tests
(none — single-threaded). Pure token construction/parse, no shared state.

#### Failure scenarios (external I/O — none in this task)
(none — no external I/O touched; signing is in-process HMAC.)

#### Acceptance criteria
- [ ] `go test ./jwt/ -run TestSessionIssuer_CarriesAccountID` exits 0 AND asserts `ValidateSession` returns the minted `account_id`.

### T1.2 — Consumer-driven contract test (forward-compat both directions)

#### Files to edit
`theo-contracts/jwt/validator_test.go` (or a new `account_id_contract_test.go`)

#### Why this step
Action: add tests proving (a) `Issue(...,"")` → token validates with `AccountID == ""` (a transition token without an account); (b) a token carrying `account_id` parsed by a struct WITHOUT the field still validates (simulates the engine on v0.1.0 — `encoding/json` drops unknown keys). Reasoning: this is the locked forward-compat contract (ADR-M3-2, risk-2); without it the additive guarantee is unproven.

#### TDD
RED: `TestSessionClaims_ForwardCompat_LegacyTokenValidates` (no account_id → valid, empty) plus `TestSessionClaims_ForwardCompat_UnknownFieldIgnored` (extra `account_id` parsed by a fieldless struct → valid). Both fail until T1.1 ships and the test is written.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios (external I/O — none)
(none — no external I/O touched.)

#### Acceptance criteria
- [ ] `go test -race ./jwt/ -run TestSessionClaims_ForwardCompat` exits 0 with both directions asserted (legacy token valid; unknown field ignored).

### T1.3 — Release theo-contracts v0.2.0

#### Files to edit
`theo-contracts/CHANGELOG.md`

#### Why this step
Action: add a CHANGELOG `[Unreleased] § Added` entry; commit on `develop`; tag annotated `v0.2.0`; push tag. Reasoning: theo-cloud consumes theo-contracts by version (no replace); the bump in T3.1 needs `v0.2.0` resolvable (ADR-M3-2 ordering, EC-3).

#### TDD
(release task — no RED test; gated by T1.1/T1.2 GREEN plus `go vet ./...` clean before tag.)

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios (external I/O — git push)
- Tag already exists → halt; never overwrite (mirror cycle-release tag invariant).

#### Acceptance criteria
- [ ] `git -C theo-contracts tag --list v0.2.0` is non-empty AND `git -C theo-contracts tag -v v0.2.0` resolves (annotated).

### Phase 2 — theo engine: migration 000044 NOT NULL (G1)

### T2.1 — Migration `000044` SET NOT NULL with pre-flight gate

#### Files to edit
`theo/api/internal/db/migrations/000044_tenants_keys_account_not_null.up.sql` (NEW), `…down.sql` (NEW)

#### Why this step
Action: a `DO $$ … RAISE EXCEPTION IF any tenants.account_id OR theo_api_keys.account_id IS NULL … $$` guard, then `ALTER TABLE tenants ALTER COLUMN account_id SET NOT NULL` plus the same for `theo_api_keys`. Down: `DROP NOT NULL` on both. Reasoning: closes the M0 nullable window; the guard makes residual NULLs fail loud, never a silent flip (risk-1; mirrors `000043`).

#### TDD
RED (LIVE, mirrors M2): on a fully-backfilled DB the migration applies; on a DB with a seeded NULL the guard RAISES with a specific message. Asserted in T2.2.

#### Concurrency tests
(none — single-threaded). DDL runs in one migration transaction.

#### Failure scenarios (external I/O — pg)
- Residual NULL present → guard aborts with `tenants.account_id/theo_api_keys.account_id has NULLs — backfill (000038/000039) must complete first`.
- Down then up → reversible (`SET NOT NULL` re-applies cleanly).

#### Acceptance criteria
- [ ] Applying `000044` on a fully-migrated DB exits 0 AND `information_schema.columns` shows `is_nullable='NO'` for both `tenants.account_id` and `theo_api_keys.account_id`.

### T2.2 — LIVE migration proof (apply + round-trip + guard-negative)

#### Files to edit
(evidence task — no source; proof captured in the implementation log + review)

#### Why this step
Action: apply `000044` on the migrated `m2test` DB; verify both columns NOT NULL; round-trip `down`→`up`; in an isolated transaction seed a NULL and confirm the guard RAISES, then ROLLBACK. Reasoning: M0/M2 proved migrations LIVE against real pg-cloud (no committed bash per theo gates); M3 holds the same bar (EC-5).

#### TDD
RED: the guard-negative check expects an EXCEPTION; GREEN when the specific message fires.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios (external I/O — pg)
- Covered by T2.1 failure scenarios; this task is the live verification of them.

#### Acceptance criteria
- [ ] LIVE: `000044` apply → both columns `is_nullable='NO'`; `down`→`up` reversible; seeded-NULL guard RAISES the specific message (captured in the review report).

### Phase 3 — theo-cloud: wire account_id through mint (G2b)

### T3.1 — Bump go.mod to theo-contracts v0.2.0

#### Files to edit
`theo-cloud/go.mod`, `theo-cloud/go.sum`

#### Why this step
Action: `go get github.com/usetheodev/theo-contracts@v0.2.0 && go mod tidy`. Reasoning: theo-cloud must resolve the new `SessionClaims.AccountID` + `Issue` signature (ADR-M3-2). Engine stays on v0.1.0 (forward-compat).

#### TDD
(dependency bump — validated by Phase-3 tests compiling/passing against v0.2.0.)

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios (external I/O — module fetch)
- v0.2.0 not yet pushed (T1.3 incomplete) → `go get` fails; ordering guard (do T1.3 first, EC-3).

#### Acceptance criteria
- [ ] `grep 'theo-contracts v0.2.0' theo-cloud/go.mod` matches AND `go build ./...` exits 0 AND `grep -c 'replace.*theo-contracts' theo-cloud/go.mod` is 0 (EC-3 — no local `replace` in the committed go.mod).

### T3.2 — `EnsureTenant` returns accountID (+ update 7 callers)

#### Files to edit
`theo-cloud/internal/auth/tenant.go`, `internal/consent/handler.go`, `internal/routes/session_token.go`, `tests/unit/tenant_test.go`, `tests/e2e/account_m0_e2e_test.go`

#### Why this step
Action: change `EnsureTenant` to `(tenantID, accountID, role string, err error)`. There are THREE existing-tenant return points that ALL must surface account_id (EC-1): the fast-path SELECT (`tenant.go:44-48`), the in-lock re-check SELECT (`tenant.go:77-81`), and the create path (`tenant.go:181`, which already has `accountID`). The two existing-tenant SELECTs today read only `t.id, tm.role` — change both to `SELECT t.id, t.account_id, tm.role FROM tenants t JOIN tenant_members tm …`. Then update all 7 call sites; `internal/consent/handler.go:227` becomes `tenantID, _, _, err` (explicit discard — consent does not mint the dashboard JWT, EC-2). Reasoning: the mint needs the accountID the provisioner already computes (`tenant.go:106`) — surfacing it from ALL return points is truthful and avoids a redundant query (ADR-M3-1, parsimony rung 4).

#### TDD
RED: `tenant_test` asserts `EnsureTenant` returns the seeded/derived `account_id` as the 2nd value for BOTH the new-tenant branch AND the existing-tenant fast-path branch (sqlmock: the fast-path SELECT now scans `id, account_id, role`). A returning-user mock with a non-empty `account_id` must surface it (guards EC-1).

#### Concurrency tests
(none — single-threaded). The provisioning race (advisory lock) is unchanged from M0 and already covered by `account_m0_e2e_test.go` concurrency scenarios.

#### Failure scenarios (external I/O — pg)
- Existing-tenant SELECT returns NULL account_id (pre-backfill) → empty string surfaced (NULL-tolerant, like M0), never an error.

#### Acceptance criteria
- [ ] `go test ./internal/auth/... ./tests/unit/` exits 0 AND `EnsureTenant`'s 2nd return equals the tenant's `account_id` in both branches.

### T3.3 — session_token passes accountID to Issue

#### Files to edit
`theo-cloud/internal/routes/session_token.go`

#### Why this step
Action: capture `accountID` from `EnsureTenant` and pass it to `h.issuer.Issue(sub, email, name, tenantID, accountID)`. Reasoning: this is where the minted dashboard JWT gains the claim (G2).

#### TDD
RED: a handler/unit test mints via the real issuer and asserts the resulting token's `account_id` claim equals the provisioned account (or a focused issuer test if the handler needs Kratos — assert at the `Issue` boundary).

#### Concurrency tests
(none — single-threaded). One request per goroutine; no shared mutable state.

#### Failure scenarios (external I/O — Kratos whoami + DB)
- `EnsureTenant` error → existing `TENANT_ERROR` 500 path unchanged (no JWT minted).

#### Acceptance criteria
- [ ] `go test ./internal/routes/...` exits 0 AND a minted session token decodes to carry the provisioned `account_id`.

### T3.4 — middleware populates UserContext.AccountID from the claim

#### Files to edit
`theo-cloud/internal/auth/middleware.go`

#### Why this step
Action: in the HMAC session-JWT branch, set `AccountID: claims.AccountID` on the `UserContext`. Reasoning: the JWT path must surface account_id like the API-key path already does (M0); legacy tokens (no claim) yield `""` (additive, EC-4).

#### TDD
RED: `middleware` test — a request bearing a session token WITH `account_id` yields `UserContext.AccountID == acct`; a token WITHOUT it yields `""` and still authenticates (no 401).

#### Concurrency tests
(none — single-threaded). One request per goroutine; no shared mutable state.

#### Failure scenarios (external I/O — none in the read path)
- Token without `account_id` → `AccountID == ""`, request still authorized (legacy compat, EC-4).

#### Acceptance criteria
- [ ] `go test ./internal/auth/...` exits 0 AND asserts both: account-bearing token → populated AccountID; legacy token → empty AccountID + still 200.

### Phase 4 — theo-cloud: V1 ship-criterion e2e (G3)

### T4.1 — Compose the ship-criterion e2e (hybrid always-on + gated LIVE)

#### Files to edit
`theo-cloud/tests/e2e/ship_criterion_m3_e2e_test.go` (NEW)

#### Why this step
Action: one suite that, against the fully-migrated real pg, proves: (1) one Account owns two tenants; (2) the two tenants are isolated — cross-account credential → 403 via the in-process `ForwardAuthHandler` (M1 hybrid pattern); (3) per-Account billing — both tenants resolve one subscription/plan (M2 query); (4) a legacy NULL-account key resolves 200 via `ResolveAPIKey`; (5) NOT NULL holds (insert with NULL account_id rejected). A gated pure-HTTP variant (`E2E_CLOUD_URL`) auto-skips when the stack is down. Reasoning: G3 — the V1 ship-criterion (ADR-M3-4).

#### TDD
RED: each of the 5 assertions fails before its slice is wired; GREEN when composed. Reuses `seedUser/seedTenant/seedAccount/seedAccountKey/ResolveAPIKey/ForwardAuthHandler`. The Account-owns-2-tenants slice mints for a RETURNING tenant to guard EC-1.

#### Concurrency tests
`go test -race` — the suite runs under the race detector (the M1 hybrid handler path is exercised); no new shared mutable state introduced.

#### Failure scenarios (external I/O — pg + in-process handler)
- `E2E_PG_CLOUD_DSN` unset → `t.Skip` (no false green).
- NULL-account insert into a NOT NULL column → rejected (asserts T2.1 holds).

#### Acceptance criteria
- [ ] `E2E_PG_CLOUD_DSN=… go test -tags=e2e -race ./tests/e2e/ -run ShipCriterionM3` exits 0 with all 5 assertions (Account owns 2 tenants; cross-account 403; per-Account billing; legacy key 200; NOT NULL rejects NULL).

## ADRs (decisions for this plan)

### ADR-M3-1 — Surface accountID from EnsureTenant (not a second resolver)
`EnsureTenant` returns `(tenantID, accountID, role, err)`. **Rationale & alternatives:** the provisioner already computes `accountID` at `tenant.go:106`; returning it is the single truthful source. **Rejected alternative:** a standalone `ResolveAccountID(tenantID)` resolver — adds a redundant `SELECT` for data already in hand (parsimony rung 4 violation) and a second code path to keep consistent.

### ADR-M3-2 — Additive SessionClaims.AccountID as theo-contracts v0.2.0; engine stays v0.1.0
The claim is optional (`omitempty`); theo-cloud (minter) bumps to v0.2.0, the engine (validator-only) stays v0.1.0 and ignores the additive claim. **Rationale & alternatives:** JSON forward-compat makes both directions safe; a contract test locks it. **Rejected alternative:** bump the engine too — YAGNI (no engine account_id use) and it couples M3 to an engine release.

### ADR-M3-3 — SessionClaims only; RSA/Hydra Claims untouched
**Rationale & alternatives:** theo-cloud mints only the HMAC SessionClaims; the RSA Claims are Hydra-issued. **Rejected alternative:** add account_id to RSA Claims — no minter we control populates it; it would be dead code (KISS/YAGNI).

### ADR-M3-4 — Ship-criterion e2e: hybrid pg-backed suite, DSN-gated
**Rationale & alternatives:** the committed evidence is the hybrid suite (real pg + in-process handlers, M1 pattern) under `-race`. It is **gated on `E2E_PG_CLOUD_DSN`** (build tag `e2e`): it runs in the CI db-stage that provides a fully-migrated pg-cloud, and **skips cleanly (no false green)** when the DSN is unset — it is NOT "always-on" in a unit-only run. The behaviors it composes are ALSO covered always-on at the unit layer (the legacy-JWT-200 case by `tests/unit/account_id_propagation_test.go`, the forward-compat contract by `theo-contracts/jwt/account_id_contract_test.go`), so no behavior is unprotected if the e2e stage is skipped. **Rejected alternative:** require a full `tilt up` HTTP LIVE run as the merge gate — 15-25 min cold-start, not reproducible. Honesty: "passes LIVE" means against the real migrated pg-cloud (proven, captured in the implementation log), not against the full HTTP stack.

## Drawbacks & Risks

| # | Risk / drawback | Likelihood | Mitigation | Owner |
|---|---|---|---|---|
| R1 | NOT NULL flip with residual NULLs (risk-1) corrupts the migration | LOW | pre-flight `COUNT(*) WHERE account_id IS NULL` gate aborts with a specific message (mirrors `000043`); verified 0 NULLs on a fully-migrated DB | T2.1 |
| R2 | SDK / engine breakage from the JWT change (risk-2) | LOW | claim is optional; v0.1.0 validators ignore it; consumer-driven contract test (T1.2) locks forward-compat both directions | T1.2 |
| R3 | Cross-module release ordering — theo-cloud `go get` before the tag exists (EC-3) | MEDIUM | T1.3 (tag v0.2.0) precedes T3.1 (`go get`); no `replace` left in the committed go.mod | T1.3 |
| R4 | Returning-user account_id silently empty if a return point is missed (EC-1) | MEDIUM | all THREE existing-tenant return points surface account_id (T3.2); e2e mints for a returning tenant | T3.2 |
| R5 | "passes LIVE" overclaimed when the stack is down | LOW | hybrid suite is the always-on merge gate; pure-HTTP LIVE variant auto-skips and is explicitly secondary (ADR-M3-4) | T4.1 |

Absorbed edge cases (review `.claude/knowledge-base/reviews/m3-enforce-propagate-edge-cases-2026-06-27.md`): EC-1 (three return points — T3.2), EC-2 (consent caller signature — T3.2), EC-3 (release ordering + no-replace — T1.3/T3.1), EC-4 (legacy token authenticates — T3.4 AC), EC-5 (guard-negative fires — T2.2 AC). EC-6 (RSA Claims untouched) documented in ADR-M3-3.

## Unresolved Questions

- (none — every decision is resolved at plan time): every M3 decision is resolved by ADRs M3-1..M3-4 and the locked `account-level-tenancy` ADR.

## Test Plan

- **theo-contracts:** `go test -race ./jwt/` — issuer carries account_id; forward-compat both directions.
- **theo engine:** LIVE migration apply + round-trip + guard-negative against pg-cloud `m2test`.
- **theo-cloud:** `go test -race ./internal/... ./tests/unit/` (EnsureTenant return, session_token mint, middleware UserContext) plus `go test -tags=e2e -race ./tests/e2e/ -run ShipCriterionM3` against real pg.
- **Global DoD:** all three repos build; CHANGELOG `[Unreleased]` updated in each touched repo; no NULLs remain (pre-flight verified); legacy token + legacy key still 200.
