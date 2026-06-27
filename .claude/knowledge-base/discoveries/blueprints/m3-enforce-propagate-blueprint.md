---
slug: m3-enforce-propagate
milestone_id: M3
date: 2026-06-27
generated_by: discover (scoped — design locked in ADR account-level-tenancy)
verdict: SHIPPABLE_WITH_CAVEATS
---

# Discovery blueprint — M3 Enforce + propagate (Phase 2)

## Scope note (honesty — Unbreakable Rule 3)

The roadmap intentionally cloned **no SOTA peers** (`ROADMAP.md` § State-of-the-art
references — KISS/YAGNI; design locked in `account-level-tenancy` ADR, reference model
is Supabase `Organization → Project → users`). Therefore this blueprint's prior art is
**our own M0–M2 implementations** (which already solved the two hard patterns M3 needs)
plus the **OIDC/JWT additive-optional-claim convention**. A heavyweight external
peer-study `/discover-execute` halt-loop would be discovery theatre here. Every citation
below resolves on disk.

## The two patterns M3 reuses (already proven in this codebase)

### Pattern A — NOT NULL after a backfill window, with a pre-flight gate

M2 already did this for `subscriptions.account_id`. The canonical shape:

- Pre-flight `DO $$ … RAISE EXCEPTION IF EXISTS(… IS NULL) … $$` BEFORE the `ALTER … SET NOT NULL`, so the migration **fails loud** instead of erroring opaquely or silently flipping over residual NULLs.
- Source: `theo/api/internal/db/migrations/000043_subscriptions_account_not_null.up.sql` (the NULL guard) and `000042_subscriptions_unique_account.up.sql` (the duplicate guard, M3 review-added).
- The backfill that makes the flip safe already ran in M0: `000038_link_tenants_account.up.sql` (`UPDATE tenants … account_id = a.id …`) and `000039_link_keys_account.up.sql` (`UPDATE theo_api_keys … account_id = t.account_id …`). Verified: on a fully-migrated DB, `COUNT(*) WHERE account_id IS NULL` = 0 for both `tenants` and `theo_api_keys`.

### Pattern B — additive, forward-compatible JWT claim

OIDC/JWT convention: a new claim is **optional** (`json:"…,omitempty"`); a validator that
predates the claim simply ignores the unknown JSON field (Go's `encoding/json` drops
unknown keys), and a token minted before the claim parses fine with the field zero-valued.
This is exactly how Supabase ships `app_metadata`/role claims additively. Applied here:

- `SessionClaims` (the HMAC dashboard token **we mint**) gains `AccountID string json:"account_id,omitempty"`. Source today: `theo-contracts/jwt/validator.go:102-107`.
- `SessionTokenIssuer.Issue` (`theo-contracts/jwt/validator.go:309-332`) gains an `accountID` param.
- Forward-compat holds in BOTH directions: a v0.1.0 validator (the **theo engine**, which only validates — never mints — and stays on `theo-contracts v0.1.0`) ignores the new `account_id`; a pre-M3 token (no `account_id`) validates under the v0.2.0 validator with `AccountID == ""`.
- The RSA `Claims` (Hydra/CLI-issued, `validator.go:85-98`) are **out of scope** — theo-cloud does not mint them (an external IdP does); adding `account_id` there would require Hydra config, not a contract change.

## Coverage corners

### Coverage Corner 1 — Integration / contract tests

- **Consumer-driven contract test in theo-contracts** (the producer module): prove (a) `Issue(...,"")` → token validates, `AccountID == ""`; (b) `Issue(...,acct)` → `ValidateSession` round-trips `AccountID == acct`; (c) a token carrying `account_id` still validates when parsed by a struct that lacks the field (simulates the engine on v0.1.0 — JSON forward-compat). Mirrors the existing property/contract tests at `theo-contracts/jwt/validator_test.go` + `properties_test.go`.
- **Migration test** (theo engine): the existing hermetic-text convention (`theo/api/tests/unit/migration_theo_api_keys_test.go`) + a LIVE apply/round-trip against pg-cloud, mirroring how M2's `000040-000043` were proven.
- **e2e ship-criterion** (theo-cloud): compose M0 (legacy key 200) + M1 (tenant isolation via ForwardAuth) + M2 (per-Account billing) + M3 (NOT NULL holds, JWT carries account_id) into one suite. Hybrid (real pg + in-process `ForwardAuthHandler`, the M1 pattern at `tests/e2e/account_broker_m1_e2e_test.go`) as always-on evidence, plus a gated pure-HTTP LIVE variant (`E2E_CLOUD_URL`/`E2E_EDGE_URL`, auto-skip when the stack is down — the existing `memory_e2e_test.go` pattern).

### Coverage Corner 2 — Dependencies

- **No new dependencies.** `github.com/golang-jwt/jwt/v5` already present (`theo-contracts/jwt/validator.go`); `pgx`/`lib/pq` already present in theo-cloud e2e; `go-sqlmock` already present for unit. The only dependency *version* change is theo-cloud bumping `github.com/usetheodev/theo-contracts v0.1.0 → v0.2.0` (`theo-cloud/go.mod:65`). Rule 9: nothing reinvented.

### Coverage Corner 3 — Tools

- `golang-migrate` (engine migration apply), `psql` against the `theo-workspace-pg-cloud-1` container for LIVE migration proof, `go test -race`, `go-sqlmock` (unit), real pg (`E2E_PG_CLOUD_DSN`). All already used by M0–M2.

### Coverage Corner 4 — Techniques

- **accountID source-of-truth at mint:** `EnsureTenant` already computes `accountID` internally (`internal/auth/tenant.go:106` via `account.EnsureAccount`) but returns `role`, not the account. Surface it from the provisioner (truthful single source, no extra query — parsimony rung 4/5) rather than a second `SELECT`. 7 call sites update mechanically (`tests/unit/tenant_test.go`, `tests/e2e/account_m0_e2e_test.go` ×4, `internal/consent/handler.go:227`, `internal/routes/session_token.go:101`).
- **Cross-module contract release:** theo-contracts is version-pinned by BOTH theo-cloud and the theo engine (`theo/api/go.mod:91`) with no `replace` — so the SessionClaims change ships as **theo-contracts v0.2.0**, consumed by a theo-cloud `go get` bump. The engine stays on v0.1.0 (forward-compat).
- **Pre-flight NULL gate:** mirror `000043` for `000044` over `tenants` + `theo_api_keys`.

## ADRs (decisions for downstream plan)

### ADR-M3-1 — Surface accountID from EnsureTenant (not a second resolver)
`EnsureTenant` returns `(tenantID, accountID, role, err)`. **Rejected:** a standalone
`ResolveAccountID(tenantID)` — adds a redundant query for data the provisioner already
holds; violates parsimony. The early-return "already has a tenant" branches must also
`SELECT account_id` from the existing row so the contract holds for returning users.

### ADR-M3-2 — Additive SessionClaims.AccountID shipped as theo-contracts v0.2.0; engine stays v0.1.0
The claim is optional (`omitempty`). theo-cloud (the minter) bumps to v0.2.0. The engine
(validator only) keeps v0.1.0 — it ignores the additive claim (JSON forward-compat). A
consumer-driven contract test in theo-contracts locks this both-directions compatibility.
**Rejected:** bumping the engine too — YAGNI (the engine has no account_id use yet) and it
would couple M3 to an engine release.

### ADR-M3-3 — SessionClaims only; RSA/Hydra Claims untouched
theo-cloud mints only the HMAC SessionClaims. The RSA Claims are Hydra-issued; propagating
account_id there is an IdP-config change, out of M3 scope. **Rejected:** adding account_id
to RSA Claims now — no minter in our control populates it; it would be dead.

### ADR-M3-4 — Ship-criterion e2e: hybrid always-on + gated pure-HTTP LIVE
The committed, reproducible evidence is the hybrid suite (real pg + in-process handlers,
the M1 pattern), run under `-race`. A pure-HTTP LIVE variant is provided but gated on
`E2E_CLOUD_URL` (auto-skip without `tilt up`), because a full-stack run costs 15-25 min
cold-start and is not reproducible in CI. **Honesty:** "passes LIVE" is satisfied by the
gated variant when the stack is up; the always-on hybrid is the merge-gating evidence.

## Drawbacks & risks

1. **NOT NULL flip with residual NULLs** → pre-flight `COUNT … IS NULL` gate aborts the migration (mirrors 000043). Mitigated.
2. **SDK breakage from the JWT change** → claim is optional; v0.1.0 validators ignore it; contract test locks forward-compat. Mitigated.
3. **Cross-module release ordering** → theo-contracts v0.2.0 must be tagged/available before theo-cloud's `go get` bump resolves. Mitigated by tagging theo-contracts first, then bumping theo-cloud.

## Unresolved questions

- (none) — every M3 decision is resolved by the ADRs above + the locked `account-level-tenancy` ADR.

## References (all resolve on disk)

- `theo/api/internal/db/migrations/000043_subscriptions_account_not_null.up.sql` (NULL-guard pattern)
- `theo/api/internal/db/migrations/000038_link_tenants_account.up.sql`, `000039_link_keys_account.up.sql` (backfill that makes the flip safe)
- `theo-contracts/jwt/validator.go:102-107` (SessionClaims), `:309-332` (Issue)
- `theo-cloud/internal/auth/tenant.go:106` (accountID computed internally), `internal/auth/middleware.go:17-24,113-125` (UserContext + HMAC branch)
- `theo-cloud/tests/e2e/account_broker_m1_e2e_test.go` (hybrid e2e pattern), `account_m0_e2e_test.go` (legacy-key-200 proof), `billing_per_account_m2_e2e_test.go` (per-Account billing proof)
- `account-level-tenancy` ADR (locked design)
