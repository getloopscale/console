# Edge Case Review — m3-enforce-propagate

Date: 2026-06-27
Tasks analyzed: 8 (T1.1–T1.3, T2.1–T2.2, T3.1–T3.4, T4.1)
Cases found: 6 (EDGE: 2, NEGATIVE: 4 | MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: EnsureTenant fast-path + in-lock re-check SELECTs do NOT read account_id
- **Affected task:** T3.2
- **Kind:** NEGATIVE (returning user silently gets empty accountID)
- **Family:** State
- **Scenario:** `EnsureTenant` has THREE return points for an existing tenant: the fast-path SELECT (`tenant.go:44-48`), the in-lock re-check (`tenant.go:77-81`), and the create path (`tenant.go:181`). The plan's T3.2 must change ALL THREE to surface `account_id`. The two existing-tenant SELECTs currently read only `t.id, tm.role` — if only the create path is updated, every *returning* user (the 99% case) mints a JWT with `account_id == ""`.
- **Impact:** account_id propagation (G2) silently fails for all existing users; the ship-criterion e2e would catch it only if it exercises a returning user.
- **Suggested fix:** in T3.2, change both existing-tenant SELECTs to `SELECT t.id, t.account_id, tm.role …` and return the account_id; the e2e (T4.1) must mint a token for a *returning* tenant and assert the claim is non-empty.

### EC-2: consent/handler.go EnsureTenant caller must not break on the new signature
- **Affected task:** T3.2
- **Kind:** NEGATIVE (compile break / dropped value)
- **Family:** Integration
- **Scenario:** `internal/consent/handler.go:227` calls `EnsureTenant` and uses `tenantID, _, err`. With the new 4-value signature it becomes `tenantID, _, _, err`. If the consent flow also needs account_id later it is out of M3 scope, but the call MUST be updated or the build breaks.
- **Impact:** build failure if missed; silent drop is acceptable here (consent flow does not mint the dashboard JWT).
- **Suggested fix:** update the call site to `tenantID, _, _, err` (explicit discard); note in the plan that consent does not need account_id in M3.

### EC-3: theo-contracts v0.2.0 must be tagged BEFORE theo-cloud `go get` (ordering)
- **Affected task:** T1.3 → T3.1
- **Kind:** NEGATIVE (unresolvable dependency)
- **Family:** Integration
- **Scenario:** theo-cloud pins theo-contracts by version with no `replace`. If T3.1 (`go get @v0.2.0`) runs before T1.3 pushes the tag, the module is unresolvable and the build halts.
- **Impact:** Phase 3 cannot build.
- **Suggested fix:** the plan already orders T1.3 before T3.1; the implement halt-loop must honor phase order. For LOCAL iteration before the tag is pushed, a temporary `replace github.com/usetheodev/theo-contracts => ../theo-contracts` is acceptable but MUST be removed before T3.1's acceptance (no `replace` in the committed go.mod).

## SHOULD TEST

### EC-4: legacy token (no account_id claim) must still authenticate — not just resolve empty
- **Affected task:** T3.4
- **Kind:** EDGE (valid token at the pre-M3 boundary)
- **Suggested test:** `test_middleware_legacy_session_token_without_account_id_authenticates` — a token minted by the v0.1.0 issuer (no `account_id`) yields `UserContext.AccountID == ""` AND `next` is served (200), never a 401. Asserts the additive guarantee at the read boundary.

### EC-5: NOT NULL migration is NOT idempotent on re-apply if a NULL is introduced between apply and re-run
- **Affected task:** T2.1
- **Kind:** NEGATIVE (operational)
- **Suggested test:** the guard-negative LIVE check (T2.2) — seed a NULL in a transaction, run the guard, assert it RAISES the specific message, ROLLBACK. Proves the guard actually fires (the M2 lesson: a guard that never fires is untested).

## DOCUMENT

### EC-6: RSA/Hydra Claims deliberately not carrying account_id
- **Kind:** NEGATIVE (consumer expecting account_id on a CLI token)
- **Accepted risk:** ADR-M3-3 — theo-cloud does not mint RSA Claims; adding account_id there would be dead code. A future CLI that needs account_id is a separate cycle (Hydra config). Documented, not addressed.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T1.3 | 0 | 1 | 1 (EC-3) | 0 | 0 |
| T2.1 | 0 | 1 | 0 | 1 (EC-5) | 0 |
| T3.2 | 0 | 2 | 2 (EC-1, EC-2) | 0 | 0 |
| T3.4 | 1 | 0 | 0 | 1 (EC-4) | 0 |
| T4.1 | 1 | 0 | 0 | 0 | 0 |
| (cross) | 0 | 0 | 0 | 0 | 1 (EC-6) |

**Coverage check:** every task touching an input boundary has both lenses considered; EC-6 documents the one deliberate omission.

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1, EC-2, EC-3 as MUST-FIX into the plan (T3.2 explicit three-return-point fix + consent caller; T1.3→T3.1 ordering + no-replace acceptance).
