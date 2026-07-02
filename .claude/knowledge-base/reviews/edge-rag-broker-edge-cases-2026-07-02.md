# Discover Edge Case Review — edge-rag-broker (M14, theo-cloud)

Date: 2026-07-02
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/edge-rag-broker-plan.md
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

> Tooling note (surfaced separately): theo-cloud's `discover-plan-confidence` scorer returns `INVALID` for
> ANY plan because `_parse_thresholds` splits on `|` while `discover-plan-thresholds.txt` uses `=`
> (bands parse to `{}` → verdict fallback). The plan scored dimensions 100/100/100/100, zero hard caps,
> 4/4 corners — structurally SHIPPABLE. Verdict token is a false negative from the parser bug, not a plan
> defect.

## MUST FIX

### EC-1: the RAG `AdminClient` MUST parse theo-rag's NESTED `{key, raw_key}` response — a verbatim copy is broken
- **Affected question:** Q1
- **Family:** Format / Interpretation
- **Scenario:** themory/promptly `MintResult` is flat `{"id","secret"}`; a verbatim copy would unmarshal theo-rag's `{"key":{"id","scopes"},"raw_key":"rag_live_..."}` into `ID=""`, `Secret=""` (no top-level `secret`), `Scopes=nil` — the broker would then cache an EMPTY secret and every proxied request would 401. This is the milestone's #1 correctness trap.
- **Impact:** Silent total failure — the broker caches empty secrets; the whole edge path 401s despite a "successful" mint.
- **Suggested fix:** Q1's blueprint pins the RAG response struct `{Key struct{ID string `json:"id"`; Scopes []string `json:"scopes"`} `json:"key"`; RawKey string `json:"raw_key"`}` and `MintKey` returns `MintResult{ID: resp.Key.ID, Secret: resp.RawKey, Scopes: resp.Key.Scopes}` — isolating the shape delta in `admin_client.go` so `broker.go` stays a verbatim copy. Test with an `httptest` stub returning theo-rag's exact shape.

### EC-2: empty intersect(want, allowed) MUST fail closed (never mint an unscoped key)
- **Affected question:** Q2, Q4
- **Family:** Permission / State
- **Scenario:** `KeyForTenantScoped(want)` computes `intersectScopes(want, b.scopes)`; if a consumer's `want` shares NO scope with the gateway's allowed set, the intersection is empty. themory's broker returns `("", error)` on empty scopes (no mint, no cache write). The RAG copy MUST preserve this — minting a key with `[]` scopes (theo-rag M12 accepts empty scopes → a zero-access key) would be a silent downgrade, but worse, minting with the FULL `b.scopes` on empty-want would be a privilege ESCALATION.
- **Impact:** Either a confusing zero-access key OR (if mis-copied) a least-privilege breach.
- **Suggested fix:** preserve themory's `if len(scopes) == 0 { return "", fmt.Errorf(...) }` guard verbatim; test empty-intersect → error, no mint call, no cache write.

## SHOULD TEST

### EC-3: the minted key MUST NOT equal the platform key (structural control/data-plane split)
- **Affected question:** Q4
- **Suggested test:** a test asserts the broker's returned secret (a `rag_live_*` minted key) is DISTINCT from the `RAG_PLATFORM_ADMIN_KEY` — proving the platform-admin credential never leaks onto the data path (NIST AC-5/6). The AdminClient holds the platform key; the Broker only ever returns minted secrets.

### EC-4: refuse-to-start on broker construction error (boot-failure)
- **Affected question:** Q3, Q4
- **Suggested test:** when `RAG_BASE_URL` is set but `RAG_PLATFORM_ADMIN_KEY` is empty in prod, `config.Validate()` errors; and `cmd/main.go` MUST refuse to start (not silently skip the rag forward-auth route) — a boot-failure test asserts the error propagates. Mirror `config_test.go:52` (themory) + the main refuse-to-start pattern.

## DOCUMENT

### EC-5: `workspace_id == tenant_id`; `accountID` in cache key but NEVER sent to the minter; `client.go` out of scope
- **Accepted risk / note:** the broker mints with `workspace_id = tenantID` (theo-rag's isolation unit); `accountID` is part of the LRU cache key (defense-in-depth) but is NEVER passed to `MintKey` (mirrors themory `broker.go` M1 comment). theo-rag M12 requires `workspace_id` in the body for a platform-admin caller — the AdminClient always sends it. `internal/rag/client.go` (data-plane) is OUT of scope (Model B: the edge/Traefik forwards with the injected key; the handler only mints). Record so nobody adds a data-plane client (YAGNI).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 (EC-1) | 0 | 0 |
| Q2 | 1 | 1 (EC-2) | 0 | 0 |
| Q3 | 1 | 0 | 1 (EC-4) | 0 |
| Q4 | 2 | 0 | 2 (EC-3,4) | 0 |
| (design) | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — 2 MUST FIX absorb into v1.1: EC-1 (RAG AdminClient parses the nested `{key, raw_key}` response — the #1 trap) + EC-2 (empty-intersect fails closed, never mints unscoped/full-scope). EC-3/EC-4 fold into the Q4 test plan; EC-5 documented. Plan otherwise sound (4/4 corners, 6 ≤ 15; reference verified: theo-cloud themory/promptly + theo-rag M12 all exist).
