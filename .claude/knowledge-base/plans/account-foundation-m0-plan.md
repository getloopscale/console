---
slug: account-foundation-m0
milestone_id: M0
created_at: 2026-06-27
goal: Introduce the Account entity end-to-end (schema + provisioning + UserContext.AccountID), fully NULL-tolerant, so a legacy theo_live_* still resolves (HTTP 200) and a new signup yields exactly one Account owning its default tenant — proven by an integration suite against pg-cloud.
---

# Plan — M0: Account foundation (backward-compatible walking skeleton)

## Goal

Introduce the **Account** entity end-to-end (schema → provisioning → `UserContext.AccountID`),
**fully NULL-tolerant**, such that: (a) a pre-existing single-tenant `theo_live_*` still resolves and
returns HTTP 200, and (b) a new signup yields **exactly one Account owning its default tenant** —
verified by an integration suite that runs `go test ./...` GREEN against the live `pg-cloud`.

**Single observable metric:** `go test ./internal/auth/... ./internal/account/... ./tests/e2e/...`
passes with the new `account_m0` integration test GREEN AND `migrate up` to `000039` then `migrate
down` to `000033` both exit 0 against pg-cloud (round-trip reversible).

## Context

Derived from the locked design `.claude/knowledge-base/adrs/ADR-account-level-tenancy.md` and
`theo-workspace/docs/tenancy-system-design.md`. Scope is **M0 only** (the walking skeleton from
`ROADMAP.md`): add the Account entity additively. **Out of M0** (explicitly): billing per-Account
(M2 — `subscriptions` is NOT touched here), broker `accountID` param (M1), `NOT NULL` enforcement +
JWT `account_id` (M3). Confirmed business rule: an independent developer (Account) provisions 1..N
isolated tenants; v1 is 1:1 user↔account.

## Baseline Context

Verified against current code on `develop` (2026-06-27) via deep review.

### Files that will be touched

| File | Repo | LoC region | Why it changes |
|---|---|---|---|
| `api/internal/db/migrations/000034_create_accounts.{up,down}.sql` | theo (engine) | NEW | the `accounts` table |
| `api/internal/db/migrations/000035_tenants_account_id.{up,down}.sql` | theo | NEW | nullable `account_id` on `tenants` |
| `api/internal/db/migrations/000036_theo_api_keys_account_id.{up,down}.sql` | theo | NEW | nullable `account_id` on `theo_api_keys` |
| `api/internal/db/migrations/000037_backfill_accounts.{up,down}.sql` | theo | NEW | one default Account per `tenants.owner_id` |
| `api/internal/db/migrations/000038_link_tenants_account.{up,down}.sql` | theo | NEW | set `tenants.account_id` from backfill |
| `api/internal/db/migrations/000039_link_keys_account.{up,down}.sql` | theo | NEW | set `theo_api_keys.account_id` via its tenant |
| `internal/account/account.go` | theo-cloud | NEW (~90) | `Account` model + `EnsureAccount(ctx, subject, email)` (1:1 user↔account) |
| `internal/account/account_test.go` | theo-cloud | NEW | unit (sqlmock) for EnsureAccount find/create + race |
| `internal/auth/middleware.go` | theo-cloud | 17-23 | add `AccountID string` to `UserContext` |
| `internal/auth/scope.go` | theo-cloud | 72-76, 100-161 | `apiKeyRow.accountID` + SELECT `account_id` (NULL-tolerant) → `UserContext.AccountID` |
| `internal/auth/scope_resolve_test.go` | theo-cloud | 23-31 (pattern) | NULL account_id legacy-key case + populated case |
| `internal/auth/tenant.go` | theo-cloud | 35-169, 106-108 | `EnsureTenant` calls `EnsureAccount` first; tenant INSERT sets `account_id` |
| `internal/routes/api_keys.go` | theo-cloud | 365-370 | `CreateKey` writes `account_id` **derived from the tenant** via subquery (NULL-tolerant) — revised during review: `/v1/api-keys` is behind `RequireJWT`, whose `UserContext` has no `AccountID` in M0, so the key inherits its tenant's account instead of trusting an empty `user.AccountID` |
| `tests/e2e/account_m0_e2e_test.go` | theo-cloud | NEW | integration vs pg-cloud (legacy 200 + new signup 1 account owns tenant + backfill) |
| `CHANGELOG.md` | both repos | `[Unreleased]` | Added entries |

### Current callers / dependents

- `UserContext` constructed in `internal/auth/scope.go:149-161` (ResolveAPIKey) and the JWT/session path; consumed across `internal/routes/*`. Adding a field is additive (no caller breaks).
- `EnsureTenant` (`internal/auth/tenant.go:35-169`) called from exactly two sites: `internal/consent/handler.go:227` (Hydra consent, non-fatal) and `internal/routes/session_token.go:101` (fail-closed). Both must keep working unchanged at the call site (signature stays `EnsureTenant(ctx, subject, email) → (tenantID, _, err)`).
- `theo_api_keys` rows written ONLY via `internal/routes/api_keys.go` CreateKey (`:365-370`) and RotateKey (`:519`); read via `lookupAPIKey` (`:100-141`). No ad-hoc inserts (verified).
- `subscriptions` created in `internal/auth/tenant.go:147-152` and `internal/billing/provisioner.go:38-42` — **NOT modified in M0** (account_id on subscriptions is M2).

### Domain glossary

- **Account** (`acct-{16hex}`) — the Cliente Theo (independent developer); 1:1 with a user owner in v1; groups 1..N tenants.
- **Tenant** (`tn-{16hex}`) — the hard data-isolation boundary (= `workspace_id` in theo-memory). Unchanged.
- **NULL-tolerant** — a read path that returns `account_id` may receive SQL NULL for legacy rows; it maps to empty `AccountID` and never errors.

### Architecture boundaries affected

Per `rules/architecture.md`: `internal/account` is a new domain-ish package depending only on `database/sql` + the project logger (same shape as `internal/auth/tenant.go`). No theo-data module changes — the Account never crosses to the data-plane (`workspace_id == tenant_id` invariant preserved).

## Prior Art & Related Work

- `.claude/knowledge-base/adrs/ADR-account-level-tenancy.md` — the locked design (Supabase Org→Project→User mapping).
- `internal/auth/tenant.go` `EnsureTenant`/`generateTenantID` — the exact shape `EnsureAccount`/`generateAccountID` mirrors (find-or-create, `prefix-{16hex}`).
- `tests/e2e/edge_forward_auth_e2e_test.go:32-51` — the integration-test harness (real pg via `E2E_PG_CLOUD_DSN`, raw-SQL seeding) the new e2e mirrors.
- golang-migrate convention from `000024`/`000030`/`000031` (up/down pairs, `IF NOT EXISTS`, additive `ALTER TABLE ADD COLUMN`).

## ADRs (decisions for this plan)

### ADR-M0-1 — `accounts.owner_id → users`, NOT `users.account_id`
The Account references its owner (`owner_id`), matching the source ADR's 1:1 model; a user's account is found via `accounts.owner_id = subject`. **Rejected alternative:** add `account_id` to `users` — would imply a user belongs to one account by column, foreclosing the v2 multi-membership path and duplicating the relationship. (Cites `rules/architecture.md` — model the relationship in one authoritative place.)

### ADR-M0-2 — `account_id` is added NULLABLE in M0; no `NOT NULL`, no `subscriptions` change
Backward-compat: legacy rows and the legacy JWT (no `account_id`) keep working. `NOT NULL` is M3; `subscriptions`→account is M2. **Rejected alternative:** make `account_id NOT NULL` now — breaks every legacy `theo_live_*` and the existing JWT immediately (YAGNI/Drawbacks). Cites ADR § non-destructive 2-phase migration.

### ADR-M0-3 — `EnsureAccount` is idempotent find-or-create, called inside `EnsureTenant` before the tenant INSERT
Keeps the two existing provisioning call sites unchanged (`consent/handler.go:227`, `session_token.go:101`). **Rejected alternative:** a separate account-provisioning route — adds a third provisioning path to keep consistent (SRP/over-engineering).

## Dependency Graph

```
Phase 1 (migrations 000034–000039)  ── must land first (schema present + reversible)
        │
        ▼
Phase 2 (Go: account pkg + UserContext.AccountID + scope + EnsureTenant + CreateKey)
        │
        ▼
Phase 3 (Integration validation vs pg-cloud)   ← the "eat your own cooking" gate
```

Phase 1 tasks T1.1–T1.6 are sequential (migration ordering). Phase 2 T2.1–T2.5: T2.1 (account pkg) and T2.2 (UserContext field) parallel; T2.3 (scope), T2.4 (EnsureTenant), T2.5 (CreateKey) depend on T2.1/T2.2. Phase 3 depends on all.

## Phase 1 — Schema (additive + reversible)

### T1.1 — `000034` create `accounts`

#### Files to edit
`theo/api/internal/db/migrations/000034_create_accounts.up.sql` (NEW), `..._.down.sql` (NEW)

#### Why this step
Action: create the `accounts` table (`id acct-…`, `display_name`, `plan default 'starter'`, `owner_id → users`, timestamps). Reasoning: the Account is the new root entity (ADR § data model); everything else references it. Mirrors the `tenants` DDL shape from `000001`.

#### TDD
RED: `account_m0_e2e_test.go` asserts `SELECT to_regclass('public.accounts') IS NOT NULL` after `migrate up` — fails before the migration exists.
GREEN: the up SQL creates the table; down SQL `DROP TABLE accounts`.
Test literal: `test_migration_000034_creates_accounts_table`.

#### Concurrency tests
(none — single-threaded). golang-migrate serializes DDL.

#### Acceptance criteria
- [ ] `migrate up` to 000034 then `migrate down` to 000033 both exit 0 (reversible).
- [ ] `accounts` has FK `owner_id → users(id)`, `plan NOT NULL DEFAULT 'starter'`, PK `id`.

#### DoD
`task db:migrate` (or `migrate -path … up`) applies cleanly; `\d accounts` shows the columns; down removes it.

### T1.2 — `000035` `tenants.account_id` (nullable) + index

#### Files to edit
`theo/api/internal/db/migrations/000035_tenants_account_id.{up,down}.sql` (NEW)

#### Why this step
Action: `ALTER TABLE tenants ADD COLUMN account_id TEXT REFERENCES accounts(id)` (nullable) + `CREATE INDEX idx_tenants_account_id ON tenants(account_id)`. Reasoning: the tenant must point at its Account; nullable keeps legacy rows valid until 000038 backfills (ADR-M0-2).

#### TDD
RED: `test_migration_000035_adds_nullable_account_id_to_tenants` asserts `information_schema.columns` shows `tenants.account_id` with `is_nullable='YES'` after up; absent after down.
GREEN: the up/down SQL. 

#### Concurrency tests
(none — single-threaded). golang-migrate serializes DDL.

#### Acceptance criteria
- [ ] `account_id` is **nullable** (`is_nullable='YES'`); FK to `accounts(id)`; index present; down reverses; round-trip exits 0.

### T1.3 — `000036` `theo_api_keys.account_id` (nullable) + index

#### Files to edit
`theo/api/internal/db/migrations/000036_theo_api_keys_account_id.{up,down}.sql` (NEW)

#### Why this step
Action: same additive `ALTER TABLE theo_api_keys ADD COLUMN account_id TEXT REFERENCES accounts(id)` (nullable) + index. Reasoning: the key carries its Account (read by ResolveAPIKey, T2.3); nullable so legacy keys stay valid.

#### TDD
RED: `test_migration_000036_adds_nullable_account_id_to_keys` (mirrors T1.2 assertion on `theo_api_keys`).
GREEN: up/down SQL.

#### Concurrency tests
(none — single-threaded). golang-migrate serializes DDL.

#### Acceptance criteria
- [ ] `account_id` nullable; FK to `accounts(id)`; index present; down reverses; round-trip exits 0.

### T1.4 — `000037` backfill: one default Account per `tenants.owner_id`

#### Files to edit
`theo/api/internal/db/migrations/000037_backfill_accounts.{up,down}.sql` (NEW)

#### Why this step
Action: `INSERT INTO accounts (id, display_name, plan, owner_id, …) SELECT 'acct-'||encode(gen_random_bytes(8),'hex'), u.display_name, 'starter', u.id, … FROM (SELECT DISTINCT owner_id FROM tenants) d JOIN users u ON u.id = d.owner_id` (guard `pgcrypto`; rely on `accounts UNIQUE(owner_id)` + `ON CONFLICT (owner_id) DO NOTHING`). Reasoning: every existing tenant owner needs exactly one Account so 000038/039 can link.

#### TDD
RED: e2e seeds 2 tenants for 1 owner + 1 tenant for another owner pre-migration; after 000037 asserts `COUNT(DISTINCT accounts.id) = COUNT(DISTINCT tenants.owner_id)` and **exactly one account per owner**. Test literal: `test_backfill_one_account_per_owner`.

#### Concurrency tests
(none — single-threaded). The migration runs once under golang-migrate's advisory lock.

#### Acceptance criteria
- [ ] One account per distinct `tenants.owner_id`; no duplicates; idempotent (re-run no-op).
- [ ] down: `DELETE FROM accounts` scoped to backfilled rows only (created_at window documented in the migration).

### T1.5 — `000038` link `tenants.account_id`

#### Files to edit
`theo/api/internal/db/migrations/000038_link_tenants_account.{up,down}.sql` (NEW)

#### Why this step
Action: `UPDATE tenants t SET account_id = a.id FROM accounts a WHERE a.owner_id = t.owner_id AND t.account_id IS NULL`. down: `UPDATE tenants SET account_id = NULL WHERE …`. Reasoning: link each existing tenant to its backfilled Account.

#### TDD
RED: `test_link_tenants_sets_account_id` — after up, every pre-existing tenant has non-NULL `account_id` matching its owner's Account.

#### Concurrency tests
(none — single-threaded). Single UPDATE under the migration lock.

#### Acceptance criteria
- [ ] Every pre-existing `tenants` row has non-NULL `account_id`; down re-NULLs; round-trip exits 0.

### T1.6 — `000039` link `theo_api_keys.account_id`

#### Files to edit
`theo/api/internal/db/migrations/000039_link_keys_account.{up,down}.sql` (NEW)

#### Why this step
Action: `UPDATE theo_api_keys k SET account_id = t.account_id FROM tenants t WHERE t.id = k.tenant_id AND k.account_id IS NULL`. down re-NULLs. Reasoning: link each existing key to its tenant's Account (the key inherits the tenant's Account).

#### TDD
RED: `test_link_keys_sets_account_id` — after up, every pre-existing key has non-NULL `account_id` equal to its tenant's `account_id`.

#### Concurrency tests
(none — single-threaded). Single UPDATE under the migration lock.

#### Acceptance criteria
- [ ] Every pre-existing `theo_api_keys` row has non-NULL `account_id`; down re-NULLs; full round-trip 000033↔000039 exits 0 both ways.

## Phase 2 — Go (additive, NULL-tolerant)

### T2.1 — `internal/account` package: `EnsureAccount`
#### Files to edit
`internal/account/account.go` (NEW), `internal/account/account_test.go` (NEW)
#### Why this step
Action: `EnsureAccount(ctx, db, subject, email) (accountID string, err error)` — find `accounts WHERE owner_id=$1`; if none, INSERT `acct-{16hex}` (mirror `generateTenantID` `tenant.go:226-233`). Reasoning: single authoritative provisioning of the Account, reused by `EnsureTenant` (ADR-M0-3).
#### TDD
RED (sqlmock, mirror `scope_resolve_test.go:23-31`): `test_ensure_account_returns_existing_when_owner_has_account` (SELECT returns id → no INSERT); `test_ensure_account_creates_when_absent` (SELECT empty → expect INSERT with `acct-` prefix).
#### Concurrency tests
`test_ensure_account_idempotent_under_concurrent_callers` — two goroutines call EnsureAccount for the same subject; assert (via `INSERT … ON CONFLICT (owner_id) DO NOTHING RETURNING id` + re-select) exactly one account row results. RED proves the race; GREEN uses the unique constraint `accounts UNIQUE(owner_id)` (add to 000034) + ON CONFLICT path. Run with `go test -race` (race detector required) — single-thread TDD cannot prove this.
#### Acceptance criteria
- [ ] find-or-create correct; ID format `^acct-[0-9a-f]{16}$`; concurrent callers → 1 row.
#### DoD
`go test ./internal/account/...` GREEN; `check_wiring.py --symbol EnsureAccount` pillar (a) satisfied by T2.4 caller.

### T2.2 — `UserContext.AccountID`

#### Files to edit
`internal/auth/middleware.go` (17-23)

#### Why this step
Action: add `AccountID string` to `UserContext`. Reasoning: the resolved Account must travel with the request principal so CreateKey (T2.5) and downstream can read it. Additive — no caller breaks.

#### TDD
RED: `test_usercontext_has_account_id_field` — a compile-time/struct assertion that `UserContext{AccountID: "acct-x"}.AccountID == "acct-x"`; existing scope tests stay GREEN.

#### Concurrency tests
(none — single-threaded). A struct field, no shared mutable state.

#### Acceptance criteria
- [ ] field present; `go build ./...` green; all existing tests pass (no caller breaks).

### T2.3 — `scope.go`: SELECT + populate `account_id` (NULL-tolerant)

#### Files to edit
`internal/auth/scope.go` (72-76 `apiKeyRow`, 100-141 lookup, 149-161 ResolveAPIKey), `internal/auth/scope_resolve_test.go`

#### Why this step
Action: add `accountID sql.NullString` to `apiKeyRow`; `SELECT id, subject, tenant_id, account_id, scopes, expires_at`; set `UserContext.AccountID = row.accountID.String` (empty when NULL). Reasoning: the key carries the Account; legacy keys (NULL) must not error (ADR-M0-2).

#### TDD
RED: `test_resolve_apikey_populates_account_id` (sqlmock returns account_id) and `test_resolve_apikey_tolerates_null_account_id` (sqlmock returns NULL → AccountID == "", no error). Mirrors existing error-contract tests.

#### Concurrency tests
(none — single-threaded). `ResolveAPIKey` is a stateless read, no shared mutable state introduced.

#### Failure scenarios (external I/O — DB)
- DB returns NULL `account_id` (legacy row) → AccountID empty, **no error** (asserted above).
- `account_id` column absent (pre-000036 DB) → query errors; surfaced as `ErrBackendUnavailable` (existing contract), NOT a silent empty — asserted by `test_resolve_apikey_errors_if_column_missing` (negative case).
- DB connection drop mid-query → existing `ErrBackendUnavailable` path unchanged (no regression test added beyond existing).

#### Acceptance criteria
- [ ] populated + NULL-tolerant both proven; existing `scope_resolve_test.go` cases stay GREEN.

### T2.4 — `EnsureTenant` calls `EnsureAccount`; tenant INSERT sets `account_id`

#### Files to edit
`internal/auth/tenant.go` (35-169, INSERT at 106-108)

#### Why this step
Action: before the tenant INSERT, call `account.EnsureAccount(ctx, db, subject, email)`; pass `accountID` into the INSERT column list. Reasoning: a new tenant must belong to its owner's Account (ADR-M0-3); the two call sites (`consent/handler.go:227`, `session_token.go:101`) stay unchanged.

#### TDD
RED: `test_ensure_tenant_provisions_account_then_tenant` (sqlmock) — expects an EnsureAccount query then a tenant INSERT carrying a non-empty `account_id`.

#### Concurrency tests
`test_ensure_tenant_concurrent_first_login_single_account` — two goroutines invoke EnsureTenant for the same new subject; assert exactly one account AND one tenant result (relies on `accounts UNIQUE(owner_id)` + the existing tenant uniqueness). Single-thread TDD cannot prove the first-login race; race-aware test required (run with `go test -race`).

#### Acceptance criteria
- [ ] new tenant rows carry `account_id`; concurrent first-login → 1 account + 1 tenant; `consent/handler.go`/`session_token.go` compile and their existing tests pass.

### T2.5 — `CreateKey` writes `account_id` (NULL-tolerant)

#### Files to edit
`internal/routes/api_keys.go` (365-370)

#### Why this step
Action: add `account_id` to the INSERT, **derived from the tenant** via a correlated subquery `(SELECT account_id FROM tenants WHERE id = $3)` (NULL when the tenant's is NULL). Reasoning (revised during review): the `/v1/api-keys` route is behind `RequireJWT`, whose `UserContext` carries no `AccountID` in M0 — trusting `user.AccountID` would write NULL for every dashboard-minted key. Deriving from the tenant makes the key inherit the correct Account; `$3` is the authenticated `user.TenantID`, not request input.

#### TDD
RED (sqlmock): `test_create_key_writes_account_id_when_present` + `test_create_key_writes_null_when_absent`.

#### Concurrency tests
(none — single-threaded). CreateKey is a single INSERT per request, no shared mutable state; key-hash uniqueness already enforced by the DB.

#### Acceptance criteria
- [ ] new keys carry the caller's `account_id`; a caller without one still creates a key (NULL); existing api_keys tests stay GREEN.

## Phase 3 — Integration Validation (eat your own cooking)

### T3.1 — `tests/e2e/account_m0_e2e_test.go` vs pg-cloud
#### Why this step
Action: against `E2E_PG_CLOUD_DSN` (the live `pg-cloud`), run the full chain. Reasoning: unit tests mock the DB; only a real-pg run proves the migrations + Go agree (the M0 ship metric).
#### Scenarios (each an assertion)
1. **Legacy key still 200** — seed a pre-migration-style key with `account_id IS NULL`; `ResolveAPIKey` returns a `UserContext` with `TenantID` set, `AccountID == ""`, no error.
2. **New signup → 1 Account owns its tenant** — call `EnsureTenant(ctx, newSubject, email)`; assert exactly one `accounts` row for that owner AND the created tenant's `account_id` equals it.
3. **Backfill correctness** — seed 2 tenants for owner A + 1 for owner B before 000037; after the full migrate-up assert one account per owner and all tenants/keys linked.
4. **Migration round-trip** — `migrate up` 000033→000039 then `migrate down` 000039→000033 exits 0 (reversible), asserted via the runner.

#### Concurrency tests
`test_account_m0_concurrent_signups_distinct_accounts` — N goroutines run EnsureTenant for N distinct new subjects concurrently against the real pg-cloud (`go test -race`); assert N accounts + N tenants, each tenant linked to its own account, no cross-contamination. Proves the provisioning path is race-safe end-to-end (not just at the unit level).

#### DoD (Global)
- [ ] `go build ./...` exit 0 (theo-cloud); migrations compile/apply on theo.
- [ ] `go test ./internal/account/... ./internal/auth/... ./tests/e2e/...` GREEN (incl. the new account_m0 e2e).
- [ ] `migrate up→000039` and `migrate down→000033` both exit 0 against pg-cloud.
- [ ] Wiring triad per new symbol (`EnsureAccount` caller = EnsureTenant; integration test = T3.1; runtime metric = a `slog` line / counter on account-create) — `check_wiring.py` green.
- [ ] `CHANGELOG.md [Unreleased] § Added` updated in BOTH repos.
- [ ] `/code-quality` verdict ∉ {FAIL_HARD, INVALID}; `/review` = READY_TO_MERGE.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| `accounts` table exists | T1.1 |
| nullable `account_id` on tenants + keys | T1.2, T1.3 |
| backfill one account per owner; links | T1.4, T1.5, T1.6 |
| `EnsureAccount` find-or-create (1:1, race-safe) | T2.1 |
| `UserContext.AccountID` | T2.2 |
| ResolveAPIKey populates + NULL-tolerant | T2.3 |
| signup provisions Account then Tenant | T2.4 |
| CreateKey writes account_id | T2.5 |
| legacy key 200 + new signup 1-account-owns-tenant + backfill + reversible | T3.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Cross-repo change (theo migrations + theo-cloud Go) must land coherently | HIGH | Migrations land first + are reversible; Go tolerates NULL so order-independence holds; CHANGELOG in both | impl |
| Backfill mis-maps owner→account (duplicates) | HIGH | `UNIQUE(owner_id)` on accounts + `ON CONFLICT DO NOTHING`; `test_backfill_one_account_per_owner` | impl |
| A read path 500s on NULL account_id (legacy) | MEDIUM | `sql.NullString` everywhere; `test_resolve_apikey_tolerates_null_account_id`; e2e scenario 1 | impl |
| down-migration deletes non-backfilled accounts | MEDIUM | 000037 down scoped to backfilled rows only (documented marker) | impl |
| Concurrent first-login double-creates an account | MEDIUM | `UNIQUE(owner_id)` + ON CONFLICT; concurrency test in T2.1 | impl |

## Unresolved Questions

- Whether `accounts.display_name` for backfilled rows should be the user's `display_name` or a derived label — defaulting to `users.display_name`; cosmetic, revisit if product objects. (Does not block M0.)
- (none other — every M0 decision is resolved by the ADR.)

## Failure scenarios (external I/O — pg-cloud)

| Dependency | Failure mode | Reproduced by | Expected behavior |
|---|---|---|---|
| pg-cloud | NULL `account_id` (legacy row) | sqlmock NULL + e2e seed | empty `AccountID`, no error |
| pg-cloud | `account_id` column missing (pre-000036) | sqlmock query error | typed `ErrBackendUnavailable`, not silent empty |
| pg-cloud | connection drop mid-resolve | existing harness | existing `ErrBackendUnavailable` path (no regression) |
| pg-cloud | concurrent EnsureAccount | 2 goroutines, real pg | exactly one account row (UNIQUE+ON CONFLICT) |

## Global Definition of Done

The plan is complete when Phase 3 DoD holds: full chain GREEN against pg-cloud, migrations reversible,
wiring triad satisfied, CHANGELOG updated in both repos, `/code-quality` not FAIL_HARD/INVALID, and
`/review` returns READY_TO_MERGE. No step is "done" on unit tests alone — the integration gate is the proof.
