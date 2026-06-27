# theo-cloud — Account-level Tenancy Roadmap

> Generated 2026-06-27 from `.claude/knowledge-base/adrs/ADR-account-level-tenancy.md` (the locked design).
> This is a **macro** roadmap. Decomposition into tasks is the job of `/to-plan` per milestone.
> Scope is already locked by the ADR — this roadmap sequences its delivery, it does not re-open the design.

## Vision

Make theo-cloud a true **nested multi-tenant (B2B2C)** control-plane: an independent developer (an
**Account**) can build a solution on Theo and resell it to **N of their own clients**, each a fully
isolated **Tenant** — without any theo-data module (theo-memory, theo-rag, …) changing its
per-tenant contract. Account is added **above** the existing tenant; `workspace_id == tenant_id`
stays true; the data-plane never sees Account.

## Problem

**Root problem:** the control-plane is **flat** today — a `theo_live_*` key resolves directly to one
tenant/workspace (1 key → 1 tenant). There is no **Account** entity grouping multiple isolated
tenants per customer, so an independent developer cannot serve N isolated clients under one
billing/admin identity. Billing is per-tenant (`subscriptions UNIQUE(tenant_id)`), which can't model
"one developer, N projects".

**Whose pain:** independent developers / companies (the paying **Cliente Theo**) who want to resell a
Theo-based solution to several of their own clients with hard data isolation and a single bill.

## Users

- **Primary:** independent developers / small companies (the Account / Cliente Theo) — self-serve, provision 1..N isolated tenants on demand.
- **Secondary:** the Account's own clients (each a Tenant) and their end-users (User tier) — never interact with the Account layer directly.

## Scope

### In scope (V1 — required to call this project alive)

- `accounts` table + `account_id` on `tenants` and `theo_api_keys` (the forward-compat seam, planted on `subject`/`tenant_id`, completed).
- Account provisioning on signup (v1: 1:1 user↔account); an Account provisions **N isolated Tenants** on demand.
- `UserContext.AccountID` + `ResolveAPIKey` resolving `account_id`; broker validates `account → tenant` **lazily** (theo-memory unchanged).
- **Billing per-Account** (`subscriptions` → account) + project (tenant) quota metered per Account.
- **Non-destructive 2-phase migration** (`000034`–`000040`): nullable → backfill → `NOT NULL`. Old `theo_live_*` keep working throughout.
- theo-memory / every theo-data module **unchanged** — Account lives only in the control-plane.

### Explicitly out of scope

- **`account_members` / multi-user-per-Account RBAC** — *why excluded:* v1 is 1:1 user↔account; team membership is a v2 follow-up (ADR § Still open #1).
- **JWT major version bump** — *why excluded:* `account_id` is added **additively** (forward-compat) in `theo-contracts`; a breaking token version is not needed for V1 (ADR § Still open #2).
- **Changing data-plane workspace semantics** — *why excluded:* the `workspace_id == tenant_id` invariant and the Model B per-tenant mint (CWE-441 closure) are preserved; no theo-memory change is in scope.

> Items in this list are off-limits for V1. To reconsider, write a new roadmap revision — do not silently expand scope.

## Constraints

| Category | Constraint |
|---|---|
| Stack | theo-cloud control-plane (Go) + pg-cloud (PostgreSQL); migrations live in the `theo` engine repo (`api/internal/db/migrations`); data-plane (theo-memory, TS) untouched |
| Compliance / legal | Pre-release governance; CWE-441 per-tenant isolation must be preserved; migration MUST be non-destructive (no downtime, legacy keys keep working) |
| Deadline | None hard; pre-release cadence |
| Team | 1 developer (owner) + LLM pair (Claude) |
| Runtime target | local-env (`make up-local` + `make memory-up`) for LIVE validation; cloud = EKS via Helm charts |
| Budget | n/a (uses existing pg-cloud + control-plane infra) |

## Success criteria

**V1 ship criterion (measurable):** an LIVE e2e in which **one Account provisions two isolated
Tenants**, a `theo_live_*` resolves to `{AccountID, TenantID}`, each tenant's data is isolated in
theo-memory (cross-tenant read returns nothing), **both tenants are billed under the one Account's
subscription** with project-count metered per Account, AND a pre-existing single-tenant `theo_live_*`
still returns 200 (backward-compat holds).

**North-star metric (tracked post-launch):** number of Accounts provisioning **≥ 2 isolated tenants**
self-served (the independent-developer-reselling usage that the Account layer exists to enable).

---

## Milestones

> Each milestone has a checkbox in its header. Flip `[ ]` → `[x]` as you complete it (or let `cycle-release` flip it post-merge when the plan carries `milestone_id`). Status lives in this document.

### M0 — [x] Account foundation (walking skeleton, backward-compatible)

**Objective:** introduce the Account entity end-to-end (schema → provisioning → `UserContext.AccountID`) with everything NULL-tolerant, so the architecture is proven without breaking any existing flow.

**Definition of done (all must hold):**

- [ ] Migrations `000034` (`accounts` table, `acct-{16hex}`) + `000035/036` (nullable `account_id` on `tenants`/`theo_api_keys`) + `000037` backfill (one default Account per tenant owner) + `000038/039` link — applied; pg-cloud green.
- [ ] On signup, `TenantProvisioner` creates the Account (1:1 user↔account v1) + a default Tenant inside it; an Account can provision an additional isolated Tenant.
- [ ] `UserContext.AccountID` populated; `ResolveAPIKey` reads `account_id`; reads tolerate NULL (legacy keys); a pre-existing single-tenant `theo_live_*` still resolves and returns 200.
- [ ] Wiring triad per new symbol (caller + integration test + runtime metric); CHANGELOG `[Unreleased]` updated.

**Dependencies:** none (foundation).

**Top risks:**

1. Backfill picks the wrong owner→Account mapping → assert one Account per distinct `tenants.owner_id`; integration test on a seeded multi-tenant fixture.
2. A read path forgets NULL-tolerance and 500s on a legacy key → negative-case test with a pre-migration key.

### M1 — [x] Broker per-Account-scoped mint (lazy validation)

**Objective:** make ForwardAuth/broker Account-aware — authorize `account → tenant` ownership and mint the per-tenant downstream key with `accountID` in the cache key — while theo-memory stays unchanged.

**Definition of done:**

- [ ] `TenantKeyMinter.KeyForTenantScoped(ctx, accountID, tenantID, scopes)`; cache key includes `accountID`; broker **lazily** trusts the resolver's validated `account→tenant` relationship.
- [ ] ForwardAuth rejects a credential whose `account_id` does not own the targeted `tenant_id` (cross-account attempt → 403); the minted key carries only the Tenant (no `account_id` crosses to the data-plane).
- [ ] Model B / CWE-441 round-trip still green: client key stripped, per-tenant key injected; theo-memory `openapi/themory.yaml` seam unchanged.

**Dependencies:** M0.

**Top risks:**

1. Cache-key collision if `accountID` omitted → unit test proving two accounts with same tenant-name mint distinct keys.
2. Lazy validation trusting an unvalidated relationship → ensure the resolver (not the broker) is the single authorization point; integration test for the cross-account 403.

### M2 — [x] Billing per-Account (+ project quota)

**Objective:** move billing from per-tenant to per-Account so all of an Account's tenants share one plan + metered usage, with tenant (project) count quotaed per Account.

**Definition of done:**

- [ ] `subscriptions` gains `account_id` (backfilled from the tenant's Account); plan + metered usage + project-quota resolve at the Account level; `UNIQUE(tenant_id)` retired in favor of per-Account.
- [ ] Provisioning an (N+1)th tenant beyond the Account's plan quota fails with a typed error (negative-case test).
- [ ] e2e: two tenants under one Account aggregate usage under that Account's single subscription.

**Dependencies:** M0 (M1 not required — billing is independent of the mint path).

**Top risks:**

1. Double-billing during the per-tenant→per-Account cutover → migrate read path behind a flag; reconcile test on seeded subscriptions.
2. Quota check race when two tenants provision concurrently → concurrency test (atomic quota decrement / row lock).

### M3 — [x] Enforce + propagate (Phase 2)

**Objective:** close the migration — make `account_id` `NOT NULL` and propagate `account_id` into the JWT (additive) so SDKs adopt it in parallel.

**Definition of done:**

- [ ] Migration `000040` sets `account_id` `NOT NULL` on `tenants`/`theo_api_keys` after the backfill window; no NULLs remain (verified pre-flight).
- [ ] JWT carries `account_id` (additive, forward-compat) via `theo-contracts`; existing tokens without it still validate during the transition.
- [ ] Full V1 ship-criterion e2e passes LIVE (one Account, two isolated tenants, per-Account billing, legacy key 200).

**Dependencies:** M0, M1, M2.

**Top risks:**

1. `NOT NULL` flip with residual NULLs → pre-flight `COUNT(*) WHERE account_id IS NULL` gate before the migration; abort if non-zero.
2. SDK breakage from JWT change → keep `account_id` optional in the contract for the transition; consumer-driven contract test in `theo-contracts`.

---

## State-of-the-art references

No peers were cloned for this roadmap: the design is locked in the ADR and the reference model is
**Supabase** (`Organization → Project → users`), documented in
`.claude/knowledge-base/adrs/ADR-account-level-tenancy.md` and `theo-workspace/docs/tenancy-system-design.md`.
A SOTA peer clone (the normal `/roadmap-init` step) was intentionally skipped per KISS/YAGNI — there
is no implementation to study beyond the documented Supabase mapping.

---

## Revision protocol

- **Marking progress:** flip the checkbox in the milestone header (or let `cycle-release` flip it when the plan carries `milestone_id: M<N>`).
- **Adjusting a milestone's DoD:** edit in place, note the date in CHANGELOG.md.
- **Adding a milestone post-M3:** use `/roadmap-feature` to append `## M4 — [ ]` without renumbering.
- **Removing a milestone:** mark it `~~M<N> — [-] name (cancelled YYYY-MM-DD — reason)~~` rather than deleting.

## Unresolved at inception

- `account_members` (multi-user-per-Account RBAC) timing — deferred to v2; resolve before any team-membership milestone.
- JWT versioning strategy (`account_id` additive vs. token major bump) — coordinate in `theo-contracts` before M3.
