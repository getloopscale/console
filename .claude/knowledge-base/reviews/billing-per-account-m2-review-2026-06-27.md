# Review — Billing per-Account (M2)

**Date:** 2026-06-27
**Slug:** billing-per-account-m2
**Milestone:** M2 (account-level tenancy — billing per-Account)
**Repos under review:** `theo-cloud` (control-plane Go) + `theo` (pg-cloud migrations)
**Verdict:** READY_TO_MERGE

---

## Scope

Move billing from per-tenant to per-Account: `subscriptions` becomes account-scoped
(`UNIQUE(account_id)` replaces `UNIQUE(tenant_id)`), and every plan / project-cap /
usage-metering resolver reads the Account's single subscription via a
`tenant → account` join, so all of an Account's tenants share one plan, one Stripe
billing record, and one project cap. Project-creation behavior and the
`workspace_id == tenant_id` data-plane invariant are unchanged. Active per-tenant
quota enforcement was descoped (owner-confirmed — the cap is per-Account and enforced
where projects are created, in the engine).

Changed surface:
- `theo`: migrations `000040`–`000043` (`account_id` nullable → backfill → unique-swap → NOT NULL, both enforcement steps guarded).
- `theo-cloud`: `internal/billing/{provisioner,cost_aggregator,stripe}.go`, `internal/routes/billing.go`, `internal/metering/reporter.go`, `internal/auth/tenant.go`; tests in `internal/billing/provisioner_test.go`, `tests/unit/tenant_test.go`, `tests/e2e/billing_per_account_m2_e2e_test.go`.

---

## Findings & resolutions

All findings surfaced in this review were fixed in this cycle (commits `theo-cloud d0b9009`, `theo 5afcf9ed`). No finding remains open.

| # | Severity | Finding | Resolution | Evidence |
|---|---|---|---|---|
| HIGH-1 | HIGH | `metering/reporter.go` drained usage with `JOIN subscriptions ON s.tenant_id` — a 2nd tenant of an Account (owns no subscription) was silently dropped → **under-billing the Account**. | Join `tenant → account → subscription` (`s.account_id = t.account_id`). | e2e `ReporterBillsAllTenantsOfAccount` — both tenants' usage drained via the account join. |
| HIGH-2 | HIGH | Phase-2 resolvers + provisioner had no unit-level coverage of the account-scoping. | `provisioner_test.go` (account-scoped INSERT + `ON CONFLICT (account_id)`); `tenant_test.go` asserts the same; 4 e2e scenarios under `-race`. | `go test -race` GREEN; e2e 4/4 GREEN. |
| SEC-1 | MEDIUM | Duplicate-Stripe-customer race: two tenants of one Account hitting `/portal` could each create a customer. | `EnsureStripeCustomer` resolves the Account once; `CreateCustomer` keys idempotency on `{accountID}-create-customer` + `metadata[account_id]`; subscription INSERT `ON CONFLICT (account_id)`. | Code review; e2e `OneSubscriptionPerAccount` asserts the single-row invariant. |
| XVAL-1 | MEDIUM | `theo/CHANGELOG.md` M2 entry claimed control-plane "enforces a per-Account project quota" — contradicts the descope. | Rewritten: resolves plan + cap at Account level; active quota enforcement descoped (engine, follow-up). | `theo/CHANGELOG.md` L49. |
| XVAL-2 | MEDIUM | Plan Baseline cited a non-existent `internal/enforcement/store.go` `GetTenantPlan` / `PlanLimiter` (fabricated citation). | Baseline now cites the real resolvers (`cost_aggregator.go`, `routes/billing.go`, `metering/reporter.go`) and states explicitly there is no `internal/enforcement` package. | Plan §Baseline; `grep` of plan returns no fabricated symbol/package/file. |
| MIG-1 | LOW | `000042` unique-swap lacked a pre-flight guard (opaque error on duplicate). | DO-block aborts with a specific message if any Account owns >1 subscription. | Live: guard fires on a seeded duplicate; silent on clean data; 040–043 round-trip reversible. |
| LOG-1 | LOW | `routes/billing.go` swallowed a real DB error into `plan="starter"`. | `slog.Warn` on non-`ErrNoRows`; `ErrNoRows` stays the silent happy-path default. | `routes/billing.go` L79. |
| TST-1 | LOW | `tenant_test` did not assert `ON CONFLICT (account_id)`. | Mock regex now requires `account_id` + `ON CONFLICT (account_id)`. | `tests/unit/tenant_test.go` L134. |

---

## Evidence (re-run 2026-06-27, this cycle)

- **Build + vet:** `go build ./...` + `go vet ./internal/...` clean.
- **Unit + integration (`-race`):** 12 packages `ok`, no failures.
- **e2e (`-race`, real pg-cloud, fully migrated schema with the real product seed), idempotent on re-run:**
  - `TwoTenantsResolveAccountPlan` — PASS
  - `OneSubscriptionPerAccount` — PASS (UNIQUE(account_id) rejects a 2nd subscription)
  - `ProjectCapResolvesFromAccountPlan` — PASS (join-resolved cap == direct `pro` cap; no magic number)
  - `ReporterBillsAllTenantsOfAccount` — PASS (HIGH-1 regression guard)
- **Migrations:** all 43 up-migrations apply cleanly into a fresh DB (incl. the new 000042 guard); `040→043` down/up round-trip restores `UNIQUE(tenant_id)` + drops `account_id`, then re-enforces the M2 end-state — reversible.
- **000042 guard negative test (live):** fires with `subscriptions has >1 row for account_id=… — resolve the duplicate before enforcing UNIQUE(account_id)`; DB left intact (rolled back).

DSN used for e2e: `postgres://theo:theo@<pg-cloud>/m2test` (dedicated test DB; production data untouched).

---

## Hard gates (cycle-review)

| Gate | Status |
|---|---|
| Failing tests on branch | PASS — none |
| New secrets committed | PASS — none |
| Direct commit to `main` | PASS — both commits on `develop` |
| Co-Authored-By trailer | PASS — absent |
| CHANGELOG updated for production changes | PASS — both repos' `[Unreleased]` |

---

## Verdict

**READY_TO_MERGE** — no BLOCKER, no open HIGH. All review findings closed with code fixes
and re-verified evidence (unit `-race`, 4 e2e scenarios vs real pg, migration round-trip,
guard negative test). The per-Account billing model is proven end-to-end; the data-plane
and project-creation paths are unchanged.

Deploy ordering (unchanged from M0/M1): apply the `theo` migrations `000040`–`000043`
to pg-cloud **before** rolling out the theo-cloud binary (the resolvers read `account_id`).
