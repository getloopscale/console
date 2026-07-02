# Discovery Plan: Model-B RAG broker + ForwardAuth wiring — M14 (edge-integration)

> **Version 1.0** (2026-07-02) — Investigate theo-cloud's EXISTING Model-B broker implementations
> (`internal/themory/*` — reference; `internal/promptly/*` — the second copy) and theo-rag's M12 mint API
> contract, then decide the minimal correct `internal/rag/{admin_client,broker}.go` + config + `cmd/main.go`
> wiring so the gateway mints per-tenant `rag_live_*` keys via theo-rag's `POST /v1/admin/keys` with
> least-privilege scopes, fail-closed, and registers `NewForwardAuthHandler(resolve, ragBroker,
> AccountOwnsTenant, "rag:read", logger)` at `/internal/authz/forward-rag`.
>
> **CRITICAL FINDING (drives ADR D2):** theo-rag M12 returns a NESTED response
> `{"key":{"id","scopes",...},"raw_key":"rag_live_..."}` (verified: `admin-keys.ts:130` returns
> `CreateApiKeyResult{key: ApiKeyPublic, raw_key}` verbatim), whereas the themory/promptly `AdminClient`
> parses a FLAT `{"id","secret"}`. So `internal/rag/admin_client.go` is NOT a verbatim copy — its response
> parsing must map `raw_key → Secret`, `key.id → ID`, `key.scopes → Scopes`, keeping the broker verbatim.

**Slug:** `edge-rag-broker`
**Owner:** paulohenriquevn
**Created:** 2026-07-02
**Repo:** theo-cloud (Go) — NATIVE. All artifacts + code + commits live in theo-cloud, not theo-rag.
**Time budget:** 1.5h (themory/promptly broker reference 0.5h; theo-rag M12 contract 0.3h; config + main wiring + forward-auth 0.4h; tests 0.3h)

## Context

ROADMAP-edge-integration.md § M14 (deps M12 — theo-rag mint endpoint shipped in v0.0.0-rc.45) is the FIRST
theo-cloud-native milestone: the Model-B credential broker that mints per-tenant `rag_live_*` keys so the
edge (Traefik ForwardAuth) can strip the customer key and inject a gateway-minted per-tenant key (closing
CWE-441 half (a) — the edge half). theo-cloud ALREADY has two working Model-B brokers:
`internal/themory/{admin_client,broker,client}.go` (the reference) and `internal/promptly/*` (the second
copy). M14 adds a THIRD (`internal/rag/`), following the exact pattern. The ForwardAuth handler is generic
(`internal/routes/forward_auth.go:64` — `NewForwardAuthHandler(resolve, minter, authorize, requiredScope,
logger)`); M14 wires a rag instance. The `broker.go` (LRU + singleflight + fail-closed + `intersectScopes`)
is response-shape-agnostic (it only sees the `minter` interface + `MintResult.Secret`), so it copies
verbatim; the `admin_client.go` is where theo-rag's nested `{key, raw_key}` response is parsed (ADR D2).
Boundaries: `.claude/rules/architecture.md` (control/data-plane split, NIST AC-5/6), `.claude/rules/error-handling.md`
(fail-closed), `.claude/rules/testing.md` (least-privilege + fail-closed matrix).

## Objective

Let M14's `/to-plan` decide, with cited reference shapes: (a) the `AdminClient` (holds `rag:platform-admin`,
`MintKey(ctx, workspaceID, name, scopes)` → POST `/v1/admin/keys` with `{name, scopes, workspace_id}`,
parsing theo-rag's `{key, raw_key}` response — the shape adaptation); (b) the `Broker` (verbatim copy —
LRU + singleflight + fail-closed + `intersectScopes(want, allowed)`); (c) config `RAG_BASE_URL` +
`RAG_PLATFORM_ADMIN_KEY` (base-url set ⇒ admin-key required in prod); (d) `cmd/main.go` wiring +
`NewForwardAuthHandler(..., "rag:read", ...)` at `/internal/authz/forward-rag` + refuse-to-start on broker
error; (e) that `client.go` (data-plane) is OUT of scope (the edge proxies; the handler only mints).

- [ ] All research questions answered with citations
- [ ] Cross-cutting comparison (themory flat `{id,secret}` vs theo-rag nested `{key,raw_key}` response)
- [ ] ≥ 1 concrete decision proposal per question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| theo-cloud (in-repo) | `internal/themory/{admin_client,broker}.go` + tests (reference), `internal/promptly/*` (2nd copy), `internal/routes/forward_auth.go`, `internal/config/config.go`, `cmd/main.go` | The exact pattern M14 copies + wires |
| theo-rag (sibling — deployed API) | `packages/api/src/server/handlers/admin-keys.ts` (M12 mint), `store/api-keys-store.ts` (CreateApiKeyResult/ApiKeyPublic response shape) | The mint API contract the AdminClient calls |

### Out-of-Scope (explicit)

| Item | Why excluded |
|---|---|
| `internal/rag/client.go` (data-plane request client) | YAGNI — Model B: the edge (Traefik) forwards the request with the injected key; the ForwardAuth handler only mints + returns headers. themory's client.go proxies theo-memory data; M14 does not need it. |
| Edge/Traefik dynamic config (the actual `forwardauth` middleware) | M15 (theo-workspace — native) |
| theo-rag-side changes | done (M10–M13, shipped) |
| MCP proxy / BFF | M16/M17 |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** themory/promptly broker reference 0.5h; theo-rag M12 contract 0.3h; config+main+forward-auth 0.4h; tests 0.3h.
**Stop condition — per question:** reference path unreadable after 2 retries → BLOCKED, continue. Never fabricate (Rule 3).

### D2 — Copy the broker verbatim; adapt ONLY the admin_client's response parsing to theo-rag's `{key, raw_key}`
**Decision:** `internal/rag/broker.go` is a verbatim copy (memory:→rag:) — it consumes `minter.MintKey → MintResult.Secret` and is response-shape-agnostic. `internal/rag/admin_client.go` parses theo-rag's NESTED response internally and returns `MintResult{ID: key.id, Secret: raw_key, Scopes: key.scopes}`, so the broker stays a pure copy.
**Rationale:** the broker's least-privilege/singleflight/fail-closed logic is production-validated (#77/promptly); re-deriving invites drift (Rule 9). The ONLY theo-rag delta is the response envelope, which is naturally isolated in the admin_client's `do()`/`MintKey`.
**Alternatives considered:** change the broker to read a different field (rejected — couples the broker to the response shape); make theo-rag M12 return a flat `{id, secret}` to match themory (rejected — theo-rag M12 is shipped/released; changing its contract now is a breaking change + out of this repo).

## Research Questions

| # | Question | Corner | Reference | Fase A | Fase B | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What is themory's `AdminClient` (MintKey + do + MintResult), and how must the RAG version parse theo-rag's `{key, raw_key}` response? | techniques | theo-cloud themory + theo-rag M12 | Read `internal/themory/admin_client.go` (full) + theo-rag `admin-keys.ts:130` + `api-keys-store.ts` CreateApiKeyResult | Capture MintKey (POST `/v1/admin/keys`, body `{name,scopes,workspace_id}`) + the RAG MintResult that maps `raw_key→Secret`, `key.id→ID`, `key.scopes→Scopes`; the control/data-plane split (platform key only in AdminClient) | The `admin_client.go` design + the nested-response struct, with citations |
| Q2 | What is themory's `Broker` (LRU+singleflight+fail-closed+intersect), copied verbatim? | techniques | theo-cloud themory | Read `internal/themory/broker.go` (full) | Capture `NewBroker(admin, size, ttl, scopes)`, `KeyForTenantScoped(want)` = `intersectScopes(want, allowed)`, cache key `account\x00tenant\x00scopes`, fail-closed (mint err → empty secret, no cache write), singleflight coalescing | The verbatim `broker.go` (memory:→rag:), with citation |
| Q3 | How are config + main wiring + the forward-auth registration done (5-arg handler, refuse-to-start)? | techniques | theo-cloud | Read `internal/config/config.go` (Themory* + validate), `cmd/main.go:244-284` (themory broker + handler), `internal/routes/forward_auth.go:64` | Decide: `RagBaseURL`+`RagPlatformAdminKey` (base-url set ⇒ admin-key required in prod, mirror `config.go:231`); `cmd/main.go` constructs `rag.NewAdminClient`+`rag.NewBroker` (refuse-to-start on err) + `NewForwardAuthHandler(resolve, ragBroker, auth.AccountOwnsTenant, "rag:read", logger)` at `/internal/authz/forward-rag` | The config + main + route registration, with citations |
| Q4 | How is the broker tested (least-privilege intersect, singleflight, fail-closed, minted≠platform, refuse-to-start, response-parse)? | tests | theo-cloud themory | Read `internal/themory/{broker_test,admin_client_test}.go` + `internal/config/config_test.go` | Test set: `intersectScopes` least-privilege; singleflight (one mint under N concurrent); fail-closed (mint err → empty secret, no cache write); admin_client parses theo-rag `{key,raw_key}` (httptest stub); minted key ≠ platform key (structural); config validate (base-url set + empty admin-key in prod → error); main refuse-to-start | The test plan, with citations |
| Q5 | New dependencies? (expected: none — singleflight + golang-lru already used by themory) | deps | theo-cloud | Read `go.mod` + themory imports (`golang.org/x/sync/singleflight`, `github.com/hashicorp/golang-lru/v2`) | Confirm zero new deps (both libs already in go.mod for themory/promptly) | deps-audit seed: zero new dep |
| Q6 | Tooling? (go test/vet; where the forward-rag route mounts) | tools | theo-cloud | Read the route mux where `/internal/authz/forward-*` handlers register + Makefile/go test targets | Confirm `go test ./...` + `go vet`; the rag handler mounts alongside the themory/promptly forward-auth routes | the test-run + route-mount, with citation |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)** — techniques 3 (admin_client+response-adaptation, broker verbatim, config+main+forward-auth), tests 1, deps 1, tools 1. Question count: 6 (≤ 15, ≤ 3 per corner).

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | the cited file exists + is readable | Mark Qx BLOCKED, continue |
| After answering Qx | section has ≥ 1 citation | Re-iterate Qx (1 retry) |
| Q1 specifically | the theo-rag `{key, raw_key}` response shape is pinned (not assumed flat) | Re-iterate Q1 until the nested shape + the MintResult mapping is captured |
| Q3 specifically | refuse-to-start on broker error is captured (not silently degraded) | Re-iterate Q3 |
| Before promising complete | all 4 corners populated + the response-shape adaptation designed | Refuse promise, continue |

## Acceptance Criteria

- [ ] All 6 questions answered OR BLOCKED with reason
- [ ] Every citation resolves (theo-cloud paths or theo-rag M12 paths)
- [ ] Blueprint has: admin_client (with the nested-response mapping), broker (verbatim), config, main+forward-auth wiring, test plan
- [ ] ≥ 1 ADR (expected: copy-broker-verbatim; adapt-admin_client-response; client.go out-of-scope)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

Per `.claude/rules/discover-blueprint-golden-rule.md`: 4 coverage corners populated, zero fabricated citations, ≥ 1 ADR.
