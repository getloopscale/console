# Review — M3 Enforce + propagate (Phase 2)

**Date:** 2026-06-27
**Slug:** m3-enforce-propagate · **Milestone:** M3
**Repos:** `theo-contracts` (v0.2.0), `theo` (engine, migration 000044), `theo-cloud` (control-plane)
**Method:** 4 independent specialist agents (architecture/wiring, test-auditor, security+migration, cross-validation) + code-quality.
**Verdict:** READY_TO_MERGE

---

## Scope

Close the account-level-tenancy migration: (G1) `account_id` NOT NULL on `tenants`/`theo_api_keys` with a pre-flight NULL guard; (G2) the dashboard JWT carries `account_id` additively (forward-compat), shipped as `theo-contracts v0.2.0`; (G3) a V1 ship-criterion e2e against real pg-cloud. theo-memory / data-plane untouched.

## Specialist verdicts

| Agent | Verdict | Notable |
|---|---|---|
| Architecture + wiring | CLEAN (no BLOCKER/HIGH) | `account_id` fully wired end-to-end to the broker (`cmd/main.go`); all 3 `EnsureTenant` return points surface it; DIP correct; additive claim genuinely forward-compatible; NULL scan safe |
| Security + migration | CLEAN (no BLOCKER/HIGH) | account_id is **server-minted from a DB query + HMAC-signed** (client can't forge/strip); the M1 cross-account guard uses the **DB-resolved API-key** account_id, not the JWT claim; migration guard fails loud on both tables; no secret in logs |
| Test-auditor | PASS after fixes | confirmed the removed NULL-tolerance coverage genuinely survives at unit level; EC-1 returning-user fast path proven; flagged 2 MEDIUM (now fixed — see below) |
| Cross-validation | PASS after fixes | DoD #2 fully met; flagged 2 HIGH on missing LIVE evidence + weak NOT NULL assertion (now closed); judged the "legacy key 200"→"legacy JWT 200" reinterpretation HONEST and defensible |

## Findings & resolutions

| # | Sev | Finding | Resolution |
|---|---|---|---|
| H1 | HIGH | Ship-criterion runs LIVE but no green run was **recorded** in an artifact; suite skips wholesale without DSN | Implementation log `m3-enforce-propagate-implementation.md` captures the LIVE migration apply/round-trip/guard-negative + the 6-scenario ship-criterion green run (commands + output). The behaviors are also unit-covered always-on. |
| H2 | HIGH | Pre-flight guard RAISE path + `theo_api_keys` NOT NULL had no automated test; scenario 5 accepted ANY error (false-green) | Scenario 5 now asserts **SQLSTATE 23502 on `account_id`** for **both** `tenants` AND `theo_api_keys`. New scenario 6 executes the exact 000044 guard against a seeded NULL (rolled-back tx) and asserts it **RAISEs P0001** (EC-5 closed). `674e9f3`. |
| TM1 | MEDIUM | Scenario 5 accepted any error | Closed by H2 fix (specific SQLSTATE + column). |
| TM2 | MEDIUM | Per-Account "ONE subscription" write-invariant only at sqlmock, not e2e | Accepted: the write-dedup (`ON CONFLICT (account_id)`) is the **M2** guarantee, already proven in `billing_per_account_m2_e2e_test.go::OneSubscriptionPerAccount` + `tenant_test.go`. M3's ship-criterion proves the **read** join. No M3 regression. |
| CM1 | MEDIUM | ADR-M3-4 overstated the suite as "always-on CI merge gate" | ADR-M3-4 reworded: DSN-gated, skips cleanly (no false green); behaviors also unit-covered. Plan updated. |
| AL1 | LOW | Stale comment `api_keys.go:368` ("UserContext has no AccountID until M3") | Comment corrected; tenant-subquery remains the source of truth. `674e9f3`. |
| AL2 | LOW | No metric distinguishing account-carrying vs legacy session mints | Accepted (observability nice-to-have; pre-release). Backlog. |
| I1/I3 | INFO | ROADMAP DoD says migration `000040`; LoC drift in Baseline | Honest staleness — M2 consumed 000040-000043; M3 is 000044. No action. |

No finding remains open above LOW-accepted.

## Edge cases (EC-1..EC-6) — all verified by cross-validation

EC-1 (all 3 `EnsureTenant` return points surface account_id) ✓ · EC-2 (consent caller discard) ✓ · EC-3 (no `replace`, release ordering) ✓ · EC-4 (legacy token authenticates) ✓ · EC-5 (guard-negative fires — now automated, scenario 6) ✓ · EC-6 (RSA Claims untouched) ✓.

## DoD (ROADMAP M3)

| DoD | Status | Evidence |
|---|---|---|
| Migration NOT NULL after backfill; no NULLs (pre-flight verified) | ✅ | 000044 + per-table guard; LIVE apply/round-trip/guard-negative captured; 0 NULLs confirmed |
| JWT carries account_id additively; existing tokens still validate | ✅ | `SessionClaims.AccountID` omitempty; contract test both directions; engine stays v0.1.0, no replace |
| Full V1 ship-criterion e2e passes (Account, 2 isolated tenants, per-Account billing, legacy→200) | ✅ | `ShipCriterionM3` 6 scenarios green under `-race` vs migrated pg; "legacy key 200" honestly reinterpreted as "legacy JWT (no account_id claim) → 200" because 000044 makes NULL-account keys impossible (documented, ADR-M3-4) |

## Hard gates (cycle-review)

| Gate | Status |
|---|---|
| Failing tests on branch | PASS — unit/integration/contract/e2e green under `-race` |
| New secrets committed | PASS — none |
| Direct commit to `main` | PASS — all on `develop` (+ theo-contracts `develop`, theo `develop`) |
| Co-Authored-By trailer | PASS — absent |
| CHANGELOG updated (3 repos) | PASS — theo-contracts `[0.2.0]`, theo `[Unreleased]`, theo-cloud `[Unreleased]` |

## Pre-existing item (tracked, not blocking)

`TestMemoryExports_CreateIgnoresClientFilename` flaky under `-race` (TempDir vs async worker) — pre-existing, unrelated to M3, filed `usetheodev/theo-cloud#104`.

## Verdict

**READY_TO_MERGE** — no BLOCKER, no open HIGH. Both review HIGHs (recorded LIVE evidence; strong NOT NULL + guard assertions) closed with code + captured evidence. The per-Account tenancy migration is closed end-to-end; data-plane and project-creation paths unchanged.

**Release ordering (3 repos):** `theo-contracts v0.2.0` is tagged (done). The `theo` migration `000044` must be applied to pg-cloud **before** the theo-cloud binary that reads NOT NULL `account_id` is rolled out (resolvers/INSERTs assume it). theo-cloud release is the M3 milestone release (develop→main, human-approved).
