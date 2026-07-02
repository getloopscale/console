# Review — mcp-proxy-rag (M16, ROADMAP-edge-integration)

**Date:** 2026-07-02
**Slug:** mcp-proxy-rag · **milestone_id:** M16 · **Repos:** theo-cloud (native) + theo-traefik-mcp + theo-rag + theo-workspace
**Commits:** theo-traefik-mcp `a712a10`+`<fix>` · theo-cloud `aef723b` · theo-rag `f3700d1`+`<fix>` · theo-workspace `5bee28a`
**Verdict:** **READY_TO_MERGE**

## Specialist agents (2, parallel)

| Agent | Verdict | Findings |
|---|---|---|
| security + architecture (adversarial) | **NO BLOCKER / NO HIGH** — 7 invariants sound + tests real | 1 MEDIUM (**fixed**), 3 LOW, 3 INFO (1 **fixed**) |
| cross-validation + test-quality | **CLEAN — READY_TO_MERGE** | 4/4 DoD, 6/6 gates exit 0, all tests have teeth, no contamination |

## Security — every multi-tenant invariant confirmed (adversarial)

1. **Confused-deputy / per-verb scope (#77 gap):** `rag:read` exposes ONLY {ask,list_collections,retrieve}; the test asserts BOTH read-present AND write-ABSENT (`create_collection`/`ingest_document`), non-vacuous. Defense-in-depth: the downstream minted key keeps raw scopes so theo-rag REST re-gates per verb (M11).
2. **Cross-capability cache isolation (the key M16 property):** the mint-cache key is `capability\x00apiKey` — a memory-minted cred is never served for `/mcp/rag` with the same consumer key. `TestMintCache_IsolatesByCapability` proves distinct creds + 2 upstream calls, green under `-race`.
3. **Per-session tenant isolation:** each MCP session binds a RagClient from THAT session's minted bearer; session only on `initialize`+valid bearer; no-bearer → 401 fail-closed; two tenants → two clients (tested).
4. **capability-via-context:** `/mcp/rag` sends `X-Theo-Capability: rag` (not the hardcoded default); the shared `Resolve(ctx,key)` interface is unchanged (static/JWT resolver tests stayed green).
5. **Fail-closed/fail-fast:** non-localhost without TLS refused; `--tls-cert`/`--tls-key` both-or-neither; gateway 503s (not 401) on broker outage.
6. **Secret hygiene:** no key/bearer/platform-key logged; `THEORAG_API_KEY` NOT needed for the HTTP listener (per-session keys come from the bearer).
7. **Decoupling:** the MCP-resolve handler is built when ANY capability is configured; memory + rag register independently; `ragBroker` used, no nil-deref.

### Findings resolved in-cycle

| Sev | Finding | Resolution |
|---|---|---|
| **MEDIUM** | `readJsonBody` buffered the entire pre-auth body → unauthenticated memory-exhaustion DoS (CWE-400) | **FIXED** — `MAX_BODY_BYTES` (256 KiB) enforced INCREMENTALLY → 413 before buffering the whole body; `MAX_SESSIONS` (1024) cap → 503. New test asserts the 413. |
| **INFO** | gateway capability not charset-validated before becoming a cache-key component / header (emergent-safe only) | **FIXED** — `validCapability` (`^[a-z0-9_-]{1,64}$`) rejects NUL/control/junk at the edge; new `TestValidCapability`. |
| LOW | listener has no per-request auth after initialize (routed by Mcp-Session-Id) | Accepted/documented — the gateway re-validates + re-mints per request (revoked keys denied upstream); prod MUST network-isolate the listener to the gateway (not exposed). |
| LOW | no session idle-TTL reaper | Partially addressed — `MAX_SESSIONS` bounds memory; a full idle reaper is a follow-up (LOW). |
| INFO | `RagMCPTools` is a hand-maintained mirror of theo-rag `tools.ts` with no cross-repo drift test | Noted — the one-bucket test enforces internal consistency; a generated cross-repo contract test is a future improvement. Currently in sync (5 tools). |

## Cross-validation — 4/4 DoD with evidence; 6/6 gates exit 0

| # | DoD item | Evidence |
|---|---|---|
| 1 | `MCPCapabilityBinding["rag"]` + ScopeTools read/write/delete | theo-cloud `cmd/main.go` (binding) + `internal/routes/rag_mcp.go` (production map) |
| 2 | rag-mcp streamable-HTTP + dev-TLS listener; gateway `/mcp/rag` per-tenant via broker | theo-rag `packages/mcp/src/transports/streamable-http.ts` + `cli.ts`; theo-traefik-mcp `proxy.go`+`capability_ctx.go`+`broker_resolver.go`; theo-workspace `compose.yaml` |
| 3 | Go test: rag:read no write tool; every tool in one bucket | theo-cloud `mcp_resolve_test.go` (both tests, production map) |
| 4 | 4× CHANGELOG; /review READY_TO_MERGE | all 4 CHANGELOGs; this report |

**Gates:** theo-traefik-mcp `go test -race` **0** (18 pkgs) · theo-cloud `go test` **0** (17 pkgs) + `go vet` clean · theo-rag `vitest` 53/53 + `tsc` **0** + `eslint` **0** · theo-workspace `check-compose.sh` **0**.

**Test-teeth (all REAL):** confused-deputy asserts both halves; one-bucket has 4 independent teeth (double/unmapped/non-canonical/count); cross-capability cache proven under `-race`; per-session isolation proves distinct clients; the HTTPS boot test does a genuine MCP handshake over TLS; CLI tests cover TLS xor / unknown transport / port range.

**Hygiene:** all commits on `develop`, none on `main`, no Co-Authored-By, no secrets (the TLS test generates an ephemeral cert + cleans up), no concurrent-work contamination in any commit.

## Honest caveat (accepted, not a gap)

The live per-tenant MCP proxy proof (gateway + broker + rag-mcp + TLS end-to-end) needs the full multi-service stack. M16 ships the unit/integration proofs (per-session isolation, cross-capability cache, confused-deputy, real TLS handshake) + the static drift-guard; the automated hermetic isolation proof through the real gateway is **M18** (`make e2e-edge`, invariant #6) — as with M15. Documented in all 4 CHANGELOGs.

## Verdict

**READY_TO_MERGE** — the 4-repo multi-tenant boundary is architecturally sound and its security-critical properties (per-verb scope translation, cross-capability cache isolation, per-session tenant binding, fail-closed auth) are correctly built and honestly tested. The MEDIUM (pre-auth body DoS) + the INFO (capability charset) were fixed in-cycle; the remaining LOWs are documented deployment/hardening notes. Both agents concur; no BLOCKER/HIGH. Next in the roadmap: M17 (BFF dashboard read routes, theo-cloud) or the keystone M18 (hermetic ForwardAuth e2e).
