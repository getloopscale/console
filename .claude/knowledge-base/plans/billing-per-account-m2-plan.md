---
slug: billing-per-account-m2
milestone_id: M2
created_at: 2026-06-27
goal: Move billing from per-tenant to per-Account — subscriptions gains account_id (backfilled), UNIQUE(tenant_id) is retired for UNIQUE(account_id) (one subscription per account), every plan + project-cap resolution reads the account's subscription via tenant→account join (project-creation behavior unchanged) — proven by an integration suite against pg-cloud.
---

# Plan — M2: Billing per-Account (+ project quota)

## Goal

Move billing from per-tenant to **per-Account**: `subscriptions` gains `account_id` (backfilled from
the tenant's Account), `UNIQUE(tenant_id)` is retired in favor of `UNIQUE(account_id)` (one
subscription per Account), and every plan + project-cap resolution reads the **account's**
subscription via a `tenant → account` join (so all of an Account's tenants share one plan, one Stripe
billing record, and one project cap) — with theo-memory and the data-plane unchanged, and **project
creation behavior unchanged**.

**Single observable metric:** `go test ./internal/auth/... ./internal/billing/... ./tests/unit/`
passes AND an integration suite against pg-cloud is GREEN proving: two tenants under one Account
resolve the SAME plan from ONE subscription (account join), `UNIQUE(account_id)` enforces one
subscription per Account, the project cap resolves from the Account's plan, and `migrate up→043 /
down→039` round-trips exit 0.

## Scope revision (2026-06-27 — owner-confirmed)

During implementation, the deep review established that in the current code **`projects` (AI agents,
`projects.tenant_id → tenants`) are created in the engine, NOT theo-cloud**, and **`EnsureTenant`
creates exactly one tenant per user** (no theo-cloud path provisions a 2nd tenant per Account). The
roadmap's "(N+1)th tenant → typed error" conflated the Supabase term *Tenant=Project* with Theo's
code where they are distinct entities. Owner decision: **project-creation behavior must NOT change.**

Therefore M2's enforceable deliverable is **billing + plan (including the project cap) are
per-Account**: the Account's plan now resolves at the account level, so the project cap an agency
(Account) gets is its plan's cap. The **active per-creation quota guard is descoped** — enforcing the
project cap at creation time lives where projects are created (the engine), reading the now-account-
scoped plan; it is a follow-up, not a behavior change in this slice. Phase 3 (the `EnsureTenant` quota
guard) is **removed**; the e2e proves the per-Account billing model at the schema + resolution level.

## Context

Derived from `ROADMAP.md § M2` and the locked ADR. Builds on M0 (accounts + tenants.account_id, released v0.10.0) and is independent of M1. **Out of M2:** moving the `plan` column off `subscriptions` onto `accounts` (kept where it is — the account's single subscription is the source of truth; `accounts.plan` stays a denormalized default, reconciled in a follow-up); JWT changes (M3); `NOT NULL` on `theo_api_keys`/`tenants` account_id (M3).

## Baseline Context

Verified against current code on `develop` (theo-cloud HEAD 90f7c62; theo migrations max 000039).

### Files that will be touched

| File | Repo | LoC region | Why it changes |
|---|---|---|---|
| `api/internal/db/migrations/000040_subscriptions_account_id.{up,down}.sql` | theo | NEW | nullable `account_id` on `subscriptions` + index |
| `api/internal/db/migrations/000041_backfill_subscriptions_account.{up,down}.sql` | theo | NEW | backfill `account_id` from the tenant's account |
| `api/internal/db/migrations/000042_subscriptions_unique_account.{up,down}.sql` | theo | NEW | drop `UNIQUE(tenant_id)`, add `UNIQUE(account_id)` |
| `api/internal/db/migrations/000043_subscriptions_account_not_null.{up,down}.sql` | theo | NEW | `account_id NOT NULL` (after backfill) |
| `internal/billing/provisioner.go` | theo-cloud | 37-42, 69-72, 92 | provision ONE subscription per account (`ON CONFLICT (account_id)`); stripe-customer linkage by account |
| `internal/auth/tenant.go` | theo-cloud | 147-162 | subscription INSERT becomes account-scoped (one per Account) |
| `internal/routes/billing.go` | theo-cloud | 74-77 | dashboard plan read resolves by account |
| `internal/billing/cost_aggregator.go` | theo-cloud | 174-176 | metered-usage plan read resolves by account |
| `tests/unit/tenant_test.go` | theo-cloud | 84-145 | update subscription INSERT expectation (account-scoped) |
| `tests/e2e/billing_per_account_m2_e2e_test.go` | theo-cloud | NEW | integration vs pg-cloud |
| `CHANGELOG.md` | both repos | `[Unreleased]` | Added entries |

### Current callers / dependents

- The canonical plan resolver is `enforcement.sqlLimitsStore.GetTenantPlan` (`store.go:69-72`, `SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status IN ('active','trialing') LIMIT 1`); it backs `PlanLimiter`. Read also at `routes/billing.go:75` (dashboard) and `billing/cost_aggregator.go:175` (cost). All three assume one subscription per tenant — they MUST resolve by account post-M2 (else a 2nd tenant of an account finds no plan).
- `subscriptions` is INSERTed at `tenant.go:156-162` (EnsureTenant) and `billing/provisioner.go:37-42` (ProvisionStarter, called by `routes/billing.go:62`), both `ON CONFLICT (tenant_id) DO NOTHING`.
- The Stripe webhook (`billing/webhook.go`) finds the subscription by `stripe_customer_id` / `stripe_subscription_id` (NOT tenant_id) — unchanged by M2 (one subscription per account; the Stripe ids still resolve the account's row).
- `plan_limits` (`000002`) holds the `projects` hard_limit per plan (starter=1, pro=3, team=10, enterprise=NULL/∞) — resolved per-Account via the account's plan.
- `accounts.plan` exists (M0) but is unused for enforcement; M2 does NOT make it the source of truth (the account's subscription is) — noted in Unresolved.

### Domain glossary

- **Account subscription** — the single `subscriptions` row per account (post-M2 `UNIQUE(account_id)`), carrying plan + Stripe linkage + status/period for ALL the account's tenants.
- **Project cap** — `plan_limits.projects` hard_limit for the Account's plan; resolvable for any of the Account's tenants via the account-scoped subscription. Enforced at project-creation time in the engine (unchanged).

### Architecture boundaries affected

Per `rules/architecture.md`: plan resolution stays in `internal/enforcement` (the canonical store) + `internal/billing`; the quota guard is in `internal/auth` (provisioning) reading `plan_limits` — no new cross-layer dependency. theo-memory/data-plane untouched (billing is control-plane only). The `tenant→account` join keeps the account as the billing boundary while the tenant stays the data-isolation boundary (unchanged).

## Prior Art & Related Work

- M0 plan/impl (`account-foundation-m0`) — the `accounts` table + `tenants.account_id` + the non-destructive migration pattern (nullable→backfill→NOT NULL) M2's schema mirrors; the e2e harness (`seedUser/seedTenant`, `EnsureTenant`) M2's e2e reuses.
- `tests/unit/tenant_test.go` — the sqlmock shape for EnsureTenant's transactional INSERTs M2 extends.
- `internal/enforcement/store_test.go` + `internal/billing/*_test.go` — the plan-resolution + provisioner TDD shapes M2 mirrors.

## ADRs (decisions for this plan)

### ADR-M2-1 — One subscription per Account; plan resolves via `tenant → account` join
`subscriptions` becomes account-scoped (`UNIQUE(account_id)`); the 3 plan-read sites resolve the account's subscription with `JOIN tenants t ON t.account_id = s.account_id WHERE t.id = $tenant`. **Rejected alternative:** keep `WHERE s.tenant_id = $t` — a 2nd tenant of an account would find no subscription → no plan → enforcement silently breaks for it (the exact bug the per-account move must prevent). Cites the Baseline risk.

### ADR-M2-2 — Plan stays on the subscription (not moved to `accounts.plan`) for M2
The account's single subscription carries `plan`; `accounts.plan` is left as a denormalized default. **Rejected alternative:** move plan to `accounts.plan` now — would additionally rewrite the Stripe webhook (which updates `subscriptions.plan`) and risk a billing regression; YAGNI for M2's DoD (plan already resolves at the account level via the join). Reconciliation tracked in Unresolved.

### ADR-M2-3 — Project quota enforced in `EnsureTenant` (provisioning), fail-fast typed error
The (N+1)th-tenant guard lives in `EnsureTenant` inside the provisioning transaction (after the account is known, before the tenant INSERT): `COUNT(*) FROM tenants WHERE account_id=$1` vs `plan_limits.projects` for the account's plan; over → `ErrProjectQuotaExceeded`. **Rejected alternative:** a DB trigger/CHECK — opaque, hard to surface a typed domain error to the caller (Error-Handling: typed + clear).

## Dependency Graph

```
Phase 1 (migrations 040-043: account_id + backfill + unique swap + NOT NULL)
        │
        ▼
Phase 2 (plan resolution by account + per-account provisioning)
        │
        ▼
Phase 3 (project-quota guard in EnsureTenant)
        │
        ▼
Phase 4 (integration vs pg-cloud)
```

Phase 1 tasks T1.1–T1.4 sequential (migration order). Phase 2: T2.1 (resolver) ∥ T2.2 (provisioning) ∥ T2.3 (stripe-link). Phase 3 depends on Phase 1 (account_id present) + Phase 2 (provisioning). Phase 4 depends on all.

## Phase 1 — Schema (non-destructive, reversible)

### T1.1 — `000040` subscriptions.account_id (nullable) + index

#### Files to edit
`theo/api/internal/db/migrations/000040_subscriptions_account_id.{up,down}.sql` (NEW)

#### Why this step
Action: `ALTER TABLE subscriptions ADD COLUMN account_id TEXT REFERENCES accounts(id)` (nullable) + index. Reasoning: the seam for per-account billing; nullable keeps existing rows valid until 041 backfills.

#### TDD
RED: `account_m2 e2e` asserts `information_schema.columns` shows `subscriptions.account_id` `is_nullable='YES'` after up; absent after down.

#### Concurrency tests
(none — single-threaded). golang-migrate serializes DDL.

#### Acceptance criteria
- [ ] `migrate up` to 000040 then `migrate down` to 000039 both exit 0 AND `\d subscriptions` shows nullable `account_id` with FK to `accounts(id)`.

### T1.2 — `000041` backfill subscriptions.account_id from the tenant

#### Files to edit
`theo/api/internal/db/migrations/000041_backfill_subscriptions_account.{up,down}.sql` (NEW)

#### Why this step
Action: `UPDATE subscriptions s SET account_id = t.account_id FROM tenants t WHERE t.id = s.tenant_id AND s.account_id IS NULL`. down: re-NULL. Reasoning: every existing subscription inherits its tenant's account.

#### TDD
RED: e2e seeds a tenant+account+subscription pre-migration; after 041 asserts `SELECT account_id FROM subscriptions WHERE tenant_id=$seed` equals the tenant's account (non-NULL).

#### Concurrency tests
(none — single-threaded). Single UPDATE under the migration lock.

#### Acceptance criteria
- [ ] After 041 every pre-existing `subscriptions` row has non-NULL `account_id` equal to its tenant's account AND `down` re-NULLs them (`SELECT count(*) FROM subscriptions WHERE account_id IS NOT NULL` returns 0 after down).

### T1.3 — `000042` retire UNIQUE(tenant_id), add UNIQUE(account_id)

#### Files to edit
`theo/api/internal/db/migrations/000042_subscriptions_unique_account.{up,down}.sql` (NEW)

#### Why this step
Action: `ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_tenant_id_key, ADD CONSTRAINT subscriptions_account_id_key UNIQUE(account_id)`. down: reverse. Reasoning: enforce one subscription per Account (replacing one per tenant).

#### TDD
RED: e2e asserts a 2nd `INSERT … (account_id=X)` violates `UNIQUE(account_id)` (one per account) AND two subscriptions with the SAME tenant_id are now allowed by the schema (constraint dropped) — verified via `information_schema.table_constraints`.

#### Concurrency tests
(none — single-threaded). DDL under the migration lock.

#### Acceptance criteria
- [ ] `subscriptions_account_id_key UNIQUE(account_id)` present AND `subscriptions_tenant_id_key` absent (`information_schema.table_constraints`); round-trip reverses both.

### T1.4 — `000043` subscriptions.account_id NOT NULL

#### Files to edit
`theo/api/internal/db/migrations/000043_subscriptions_account_not_null.{up,down}.sql` (NEW)

#### Why this step
Action: pre-flight `COUNT(*) WHERE account_id IS NULL` must be 0 (041 backfilled), then `ALTER TABLE subscriptions ALTER COLUMN account_id SET NOT NULL`. down: drop NOT NULL. Reasoning: every subscription is account-scoped post-M2.

#### TDD
RED: e2e asserts `is_nullable='NO'` for `subscriptions.account_id` after up; `'YES'` after down.

#### Concurrency tests
(none — single-threaded). DDL under the migration lock.

#### Acceptance criteria
- [ ] `subscriptions.account_id` is `NOT NULL` after up AND nullable after down AND the full chain `migrate up 039→043 / down 043→039` exits 0 both ways.

## Phase 2 — Plan resolution by Account + per-Account provisioning

### T2.1 — plan resolution resolves the account's subscription

#### Files to edit
`internal/enforcement/store.go` (69-72 `GetTenantPlan`), `internal/routes/billing.go` (74-77), `internal/billing/cost_aggregator.go` (174-176), their `*_test.go`

#### Why this step
Action: change each `… FROM subscriptions WHERE tenant_id=$1 …` to `… FROM subscriptions s JOIN tenants t ON t.account_id = s.account_id WHERE t.id = $1 AND s.status …`. Reasoning: ANY tenant of an account resolves the account's single subscription plan (ADR-M2-1); the 2nd tenant no longer falls through to the default.

#### TDD
RED (sqlmock): `test_gettenantplan_resolves_via_account_join` — a tenant whose account's subscription is `pro` resolves `pro` even though no subscription has that `tenant_id`. Mirror for billing.go + cost_aggregator.go.

#### Concurrency tests
(none — single-threaded). Stateless reads.

#### Failure scenarios (external I/O — pg)
- No subscription for the account (new account mid-provision) → `ErrNoRows` → existing default-plan fallback (assert unchanged behavior).
- DB error → propagated (existing contract), never a silent default.

#### Acceptance criteria
- [ ] `go test ./internal/enforcement/... ./internal/billing/...` exits 0 AND `test_gettenantplan_resolves_via_account_join` asserts a 2nd tenant of a `pro` account resolves `plan == "pro"` via the join (no `WHERE s.tenant_id` remains in the three resolvers — `grep` returns 0).

### T2.2 — provision ONE subscription per Account

#### Files to edit
`internal/auth/tenant.go` (147-162), `internal/billing/provisioner.go` (37-42), their `*_test.go`

#### Why this step
Action: the subscription INSERT carries `account_id` and uses `ON CONFLICT (account_id) DO NOTHING` (one per account); EnsureTenant provisions the subscription against the account (not per tenant). Reasoning: a second tenant of an existing account must NOT create a second subscription (ADR-M2-1; e2e deliverable 3).

#### TDD
RED (sqlmock): `test_ensuretenant_subscription_is_account_scoped` — the subscription INSERT includes `account_id` and `ON CONFLICT (account_id)`. `test_second_tenant_same_account_no_new_subscription` — provisioning a 2nd tenant for an account does NOT insert a 2nd subscription (ON CONFLICT no-op).

#### Concurrency tests
`test_concurrent_first_provision_single_subscription` — two goroutines provision the first tenant of the same new account; assert exactly one subscription (the `UNIQUE(account_id)` + ON CONFLICT + the existing `pg_advisory_xact_lock`). Run with `go test -race` (race detector required).

#### Acceptance criteria
- [ ] `go test -race ./internal/auth/... ./internal/billing/...` exits 0 AND the subscription INSERT uses `ON CONFLICT (account_id)` with an `account_id` value (asserted via sqlmock `WithArgs`) AND a 2nd tenant of the same account yields no 2nd subscription.

### T2.3 — Stripe-customer linkage by Account

#### Files to edit
`internal/billing/provisioner.go` (69-72 select, 92 update)

#### Why this step
Action: `EnsureStripeCustomer`'s `SELECT stripe_customer_id … WHERE` and `UPDATE … WHERE` change from `tenant_id=$1` to `account_id=$1` (the account's single subscription). Reasoning: the Stripe customer is per-account (one billing entity), consistent with one subscription per account.

#### TDD
RED (sqlmock): `test_stripe_customer_linked_by_account` — the select+update target `account_id`, not `tenant_id`.

#### Concurrency tests
(none — single-threaded). Per-request; no shared mutable state introduced.

#### Acceptance criteria
- [ ] `go test ./internal/billing/...` exits 0 AND `EnsureStripeCustomer` resolves + links the customer `WHERE account_id = $1` (asserted via sqlmock).

## Phase 3 — Project quota — DESCOPED (see § Scope revision)

The active per-creation quota guard is **removed** from this slice (owner-confirmed: project-creation
behavior must not change; no theo-cloud path creates a 2nd tenant/project per Account today; projects
are created in the engine). What M2 delivers is that the project CAP is now per-Account — the
Account's plan resolves at the account level (Phase 2), so the cap an Account gets is its plan's
`plan_limits.projects` value, resolvable for any of its tenants. Enforcing the cap at creation time is
a follow-up where projects are actually created (the engine), reading the now-account-scoped plan.
Phase 4 scenario 3 proves the cap resolves from the Account's plan.

## Phase 4 — Integration Validation (eat your own cooking)

### T4.1 — `tests/e2e/billing_per_account_m2_e2e_test.go` vs pg-cloud

#### Why this step
Action: against `E2E_PG_CLOUD_DSN`, drive the real provisioning + resolution. Reasoning: only a real-pg run proves the migrations + Go agree at the account level.

#### Scenarios (each an assertion)
1. **Two tenants, one subscription, shared plan** — provision an account with a `pro` subscription, create a 2nd tenant for it (within quota); assert exactly ONE subscription for the account AND `GetTenantPlan(tenant2)` resolves `pro` (the account's plan) via the join.
2. **Project cap resolves from the Account's plan** — for a `pro` account, the cap resolves via the account's plan to `plan_limits.projects = 3` (the cap is per-Account; enforcement-at-creation is the engine's, unchanged — see § Scope revision).
3. **Backfill + unique swap** — seed a pre-migration subscription; after the full migrate-up assert `account_id` backfilled + `UNIQUE(account_id)` enforced + `UNIQUE(tenant_id)` gone.
4. **Migration round-trip** — `migrate up 039→043` then `down 043→039` exit 0 (reversible).

#### Concurrency tests
`test_m2_concurrent_provision_quota_race` — N goroutines provision tenants for one at-boundary account under `go test -race`; assert the tenant count never exceeds the cap.

#### DoD (Global)
- [ ] `go build ./...` exit 0.
- [ ] `go test -race ./internal/auth/... ./internal/billing/... ./internal/enforcement/... ./tests/unit/` GREEN.
- [ ] `go test -tags=e2e -race ./tests/e2e/ -run BillingPerAccountM2` GREEN vs pg-cloud.
- [ ] `migrate up 039→043` and `down 043→039` exit 0; backfill correct.
- [ ] Wiring triad per changed path (account-scoped subscription INSERT + the 3 account-join resolvers have production callers; integration test = T4.1; runtime: existing provisioning log).
- [ ] `CHANGELOG.md [Unreleased] § Added` in BOTH repos.
- [ ] `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` = READY_TO_MERGE.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| subscriptions gains account_id (backfilled) | T1.1, T1.2 |
| UNIQUE(tenant_id) retired → UNIQUE(account_id) | T1.3, T1.4 |
| plan resolves at the account level (all tenants share) | T2.1, T4.1 (scenario 1) |
| one subscription per account | T2.2, T4.1 (scenario 1) |
| stripe customer per account | T2.3 |
| reversible migration | T1.4, T4.1 (scenario 4) |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A plan-read site missed → a tenant resolves the wrong/default plan | HIGH | grep asserts zero `WHERE s.tenant_id` in the 3 resolvers; e2e scenario 1 proves the 2nd tenant resolves the account plan | impl |
| `UNIQUE(tenant_id)` drop + `UNIQUE(account_id)` add on populated data | HIGH | non-destructive order (backfill before unique-swap); round-trip test; 1:1 today makes backfill collision-free | impl |
| Quota race lets an (N+1)th tenant slip past the cap | MEDIUM | count+insert under the existing `pg_advisory_xact_lock(owner)`; concurrency test at the boundary | impl |
| Stripe webhook updates the wrong row after the move | MEDIUM | webhook keys by stripe ids (unchanged); one sub per account keeps it unambiguous; assert webhook path untouched | impl |
| `accounts.plan` drifts from the subscription plan | LOW | documented denormalization; not read for enforcement; reconcile follow-up | impl |

## Unresolved Questions

- Whether to make `accounts.plan` the single source of truth (and drop `plan` from `subscriptions`) — deferred: M2 keeps plan on the account's subscription and resolves by join; `accounts.plan` reconciliation is a follow-up (it is not read for any enforcement decision today). (none other — every M2 decision is resolved by the ADR + ROADMAP.)

## Failure scenarios (external I/O — pg-cloud + Stripe)

| Dependency | Failure mode | Reproduced by | Expected behavior |
|---|---|---|---|
| pg (plan resolve) | no subscription for the account | sqlmock ErrNoRows | default-plan fallback (existing contract), not an error |
| pg (plan resolve) | DB error | sqlmock error | propagated, never a silent default |
| pg (quota) | `plan_limits` row missing | sqlmock no-row | fail closed (typed config error), never silent-unlimited |
| pg (quota) | DB error on count | sqlmock error | propagated, no tenant created |
| pg (provision) | concurrent first provision | 2 goroutines, real pg | exactly one subscription (UNIQUE + ON CONFLICT + advisory lock) |

## Global Definition of Done

Complete when Phase 4 DoD holds: the full `-race` chain GREEN against pg-cloud, two tenants of one
account share one subscription + plan, the (N+1)th tenant is rejected with a typed error, migrations
reverse cleanly, wiring triad satisfied, CHANGELOG updated in both repos, `/code-quality` not
FAIL_HARD/INVALID, and `/review` returns READY_TO_MERGE.
