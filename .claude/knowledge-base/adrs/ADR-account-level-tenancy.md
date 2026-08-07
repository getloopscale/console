# ADR — Account-level tenancy (Supabase-style 3-level: Account → Tenant → User)

**Status:** Proposed (model decided; implementation to be planned via cycle-plan)
**Date:** 2026-06-26
**Scope:** theo-cloud (control-plane). theo-memory is NOT changed by this ADR.
**Related:** `theo-workspace/docs/tenancy-contract.md` (the platform-wide contract this ADR implements)

## Context

The platform is offered as **nested multi-tenant (B2B2C)**: a **Cliente Theo** (who subscribes
to Theo) may or may not serve **its own clients** — each fully isolated. We model this on
**Supabase** (`Organization → Project → users`), a **3-level** model:

```
Theo (platform)
└── Cliente Theo      = Account   (Supabase Organization) — billing/admin, groups tenants
    └── seu cliente   = Tenant    (Supabase Project)      — the HARD data-isolation boundary; 1..N
        └── end-user  = User      (auth.users)            — identities within a tenant
```

> We did NOT model this on WorkOS/Clerk/Auth0 "Organizations" — those are predominantly
> **2-level** (Organization == the tenant → Users). The 3-level (Account → isolated Tenant →
> User) is the Supabase shape, which is what B2B2C requires.

**Today the flow is FLAT** (verified in code): `theo_live_*` → `ResolveAPIKey` →
`UserContext{Subject, TenantID}` → `broker.KeyForTenantScoped(workspace_id = TenantID)` →
theo-memory `workspace = TenantID`. **1 credential → 1 Tenant → 1 workspace.** There is **no
Account** grouping multiple isolated tenants. The `theo_api_keys.subject`/`tenant_id` columns
were planted as the forward-compat seam for exactly this.

## Decision

Introduce an **Account** level ABOVE the existing Tenant. **The current `TenantID` keeps its
meaning** — it remains the hard data-isolation boundary (= Supabase Project = theo-memory
`workspace_id`). A Tenant is now **unique per Account** (two Accounts may each name a tenant
"production"; they are distinct).

### Data model (pg-cloud)

```sql
-- NEW: the Account (Cliente Theo)
CREATE TABLE accounts (
    id           TEXT PRIMARY KEY,                       -- acct-{16hex}
    display_name TEXT NOT NULL,
    plan         TEXT NOT NULL DEFAULT 'starter',
    owner_id     TEXT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants        ADD COLUMN account_id TEXT REFERENCES accounts(id);  -- nullable → NOT NULL after backfill
ALTER TABLE theo_api_keys  ADD COLUMN account_id TEXT REFERENCES accounts(id);  -- nullable → NOT NULL after backfill
```

`tenants.owner_id` stays for now (ownership semantics migrate to the Account over time).
`account_members` (RBAC at the Account level) is **deferred to a follow-up** — v1 is 1:1
user↔account.

### Auth flow

- **`UserContext`** (and the JWT) gains **`AccountID`** → resolves to a `Principal{AccountID,
  TenantID, Subject, Role, Scopes}`.
- **`ResolveAPIKey`** reads `account_id` from `theo_api_keys` and (DB FK already guarantees it)
  the key's `account_id` matches its tenant's `account_id`.
- **ForwardAuth / broker** — `TenantKeyMinter.KeyForTenantScoped(ctx, accountID, tenantID,
  scopes)`. The cache key includes `accountID`. **Lazy validation**: the broker trusts the
  resolver's already-validated `account→tenant` relationship and mints as today.
- **`theo-memory` is UNCHANGED.** `workspace_id` == `tenant_id` as before; the Account lives only
  in the control-plane. The per-tenant minted key still scopes by tenant; cross-tenant isolation
  is the same hard boundary. (No `account_id` is sent to theo-memory; the `openapi/themory.yaml`
  seam does not change.)

### Provisioning (v1) — CONFIRMED by product (2026-06-26)

The **Account is the independent developer / company** that subscribes to Theo. On signup,
`TenantProvisioner` creates the Account (billing + members live here) and a default Tenant inside
it. The Account is **free to provision N Tenants on demand** — one per each of its own clients, each
fully isolated. The "may or may not have its own clients" case is the **core use case** (an
independent dev reselling a solution to N clients), not an edge case — so the Account-groups-N-tenants
shape is a confirmed requirement, not speculative (NOT YAGNI). **Project (Tenant) count and plan are
metered per Account.** Modules in theo-data only ever see the isolated Tenant; they never special-case
1-vs-N.

### Non-destructive migration (flat → nested)

Phase 1 (backward-compat): `000034` create `accounts`; `000035/000036` add **nullable**
`account_id` to `tenants`/`theo_api_keys`; code writes `account_id` on new ops, **tolerates NULL**
on reads; `000037` backfill one default Account per `tenants.owner_id`; `000038/000039` link
tenants + keys to their Account. Phase 2 (enforce, ~1 sprint later): `000040` set `account_id`
`NOT NULL`; code requires it. No downtime; old `theo_live_*` keep working throughout.

## Supabase ↔ Theo mapping

| Supabase | Theo | Where it lives |
|---|---|---|
| Organization | **Account** (Cliente Theo) | NEW `accounts` table (pg-cloud) |
| Project | **Tenant** (`tenant_id`/`workspace_id`) | existing `tenants`; theo-memory `workspace` (unchanged) |
| `auth.users` | **User** | existing `users` / `tenant_members` |
| anon/service_role key | `theo_live_*` | existing `theo_api_keys` (+ new `account_id`) |

## Files that change (from the code review)

`internal/auth/middleware.go` (UserContext.AccountID), `internal/auth/scope.go` (resolve
account_id), `internal/auth/tenant.go` (account provisioning), `internal/routes/forward_auth.go`
(resolver/minter signatures), `internal/themory/broker.go` (accountID param + cache key),
`internal/routes/api_keys.go` (account_id on create/list/revoke), `cmd/main.go` (keyResolver),
`internal/routes/memory.go` (none — data-plane via broker). New migrations `000034`–`000040`.
JWT schema (`theo-contracts`): add `account_id` (forward-compat) so SDKs adapt in parallel.

## Alternatives considered & rejected

- **Tenant == Account, add Project BELOW.** Rejected: re-models the isolation boundary; forces
  re-scoping every theo-memory query; contradicts the Supabase shape (isolation is at Project).
- **Broker does DB membership check / theo-memory enforces account.** Rejected for v1: the
  themory-enforced variant breaks the cloud↔theo-data `openapi/themory.yaml` seam. Lazy
  validation in the broker (resolver already proved `account→tenant`) is simpler and keeps
  theo-memory untouched.
- **`account_members` RBAC + multi-membership now.** Deferred: v1 is 1:1 user↔account; the
  team/org membership model is a follow-up.

## Decisions resolved by product (2026-06-26)

1. **Billing model → per-Account (RESOLVED).** `subscriptions` moves from 1:1-with-`tenant`
   (`UNIQUE(tenant_id)` today) to **per-Account**: the plan + metered usage + project (tenant) quota
   live on the Account. Migration: add `account_id` to `subscriptions`, backfill from the tenant's
   Account, then move the uniqueness/plan to the Account. (Implementation detail for the plan cycle.)
2. **N tenants per Account is a core requirement (RESOLVED).** The independent-developer-reselling
   case is the primary use case — the Account-groups-N-tenants shape is confirmed, not YAGNI.

## Still open

1. **Multi-membership / `account_members`.** v1 is 1:1 user↔account; team membership (multiple users
   per Account with roles) is a v2 follow-up — confirm timing.
2. **JWT versioning.** Add `account_id` now (forward-compat) vs. a major token bump — coordinate in
   `theo-contracts`.

## Consequences

- theo-memory and every other module keep their **per-tenant** isolation contract unchanged — the
  Account is purely a control-plane grouping + authorization layer. The `tenancy-contract.md`
  "Account level" gap is now **designed** (this ADR); implementation is a separate cycle.
- Effort: ~MODERATE (design + 7 migrations + code in ~8 files + tests); breaking only when
  `account_id` becomes `NOT NULL` (Phase 2) and when the JWT requires it (SDK coordination).
