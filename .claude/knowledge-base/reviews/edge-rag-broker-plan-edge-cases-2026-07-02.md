# Edge Case Review — edge-rag-broker (M14 implementation plan, theo-cloud)

Date: 2026-07-02
Plan analyzed: .claude/knowledge-base/plans/edge-rag-broker-plan.md
Tasks analyzed: 5 (T1.1, T2.1, T3.1, T4.1, T5.1)
Cases found: 3 (EDGE: 0, NEGATIVE: 3 | MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

> The DISCOVER-phase edge review already absorbed the design edges (EC-1 response parse, EC-2 empty-intersect
> fail-closed, EC-3 minted≠platform, EC-4 refuse-to-start). This review targets NEW implementation-level
> edges in the Go decomposition.

## MUST FIX

### EC-1: a malformed / empty `raw_key` from theo-rag MUST fail closed (not cache an empty secret)
- **Affected task:** T1.1
- **Kind:** NEGATIVE (upstream contract violation)
- **Scenario:** if theo-rag returns a 2xx with a body missing `raw_key` (contract drift, a proxy stripping it, a partial response), `MintKey` would return `MintResult{Secret: ""}` and the broker would cache an EMPTY secret — every proxied request then 401s, and the empty secret is cached for the full TTL (a stuck edge). The plan's Failure-scenarios already names this; it must be a hard guard, not just a note.
- **Impact:** A silent, TTL-long edge outage from an empty cached secret.
- **Suggested fix:** in `MintKey`, after decode: `if resp.RawKey == "" { return nil, fmt.Errorf("rag admin: mint response missing raw_key") }` — so a malformed body fails closed (the broker propagates the error, no cache write). Test: httptest returns `{"key":{"id":"x"}}` (no raw_key) → `MintKey` errors; the broker re-mints on the next call.

## SHOULD TEST

### EC-2: reuse the EXACT `resolve` + `auth.AccountOwnsTenant` collaborators — do not invent a rag-specific resolver
- **Affected task:** T4.1
- **Kind:** NEGATIVE (wiring drift)
- **Suggested test:** the rag `NewForwardAuthHandler` MUST pass the SAME `resolve` (the cloud APIKeyResolver) + `auth.AccountOwnsTenant` that themory (`main.go:284`) and promptly (`main.go:224`) pass — the resolver is capability-agnostic (resolves the cloud account + its granted scopes; the handler gates on `requiredScope="rag:read"`). Inventing a rag-specific resolver would duplicate the cloud-key validation and risk divergence. The refuse-to-start / wiring helper test asserts the handler is constructed with the shared collaborators (or, minimally, that `buildRagForwardAuth` takes them as params rather than constructing a new resolver).

## DOCUMENT

### EC-3: whether cloud keys grant `rag:` scopes is an M15/operational concern, not M14
- **Kind:** NEGATIVE (out-of-scope dependency)
- **Accepted risk / note:** the handler gates on `requiredScope="rag:read"` and mints `intersect(consumer scopes, {read,write,delete})`. For a request to pass, the customer's cloud key must grant `rag:*` scopes — that grant (and the edge routing rag-capability requests to `/internal/authz/forward-rag`) is M15 (edge wiring) + operational key provisioning, NOT M14. M14 proves the broker + wiring in isolation (unit/wiring tests with a stub resolver). Record so the reviewer does not flag "no rag scope grant" as an M14 gap.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 1 (EC-1) | 1 (EC-1) | 0 | 0 |
| T4.1 | 0 | 1 (EC-2) | 0 | 1 (EC-2) | 0 |
| (scope) | 0 | 1 (EC-3) | 0 | 0 | 1 (EC-3) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX (EC-1: hard `raw_key == "" → error` guard in MintKey — fail closed on a malformed body, promote the Failure-scenarios note to a T1.1 test). EC-2 folds into T4.1 (reuse shared collaborators); EC-3 documented. Plan otherwise sound (6/6 Coverage-Matrix items, blueprint-backed).
