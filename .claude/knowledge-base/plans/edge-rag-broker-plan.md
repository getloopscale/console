---
slug: edge-rag-broker
milestone_id: M14
roadmap: ../theo-data/theo-rag/ROADMAP-edge-integration.md
created_at: 2026-07-02
goal: Add internal/rag/{admin_client,broker}.go (broker verbatim from themory; admin_client adapts theo-rag M12 {key,raw_key} response) + RAG_BASE_URL/RAG_PLATFORM_ADMIN_KEY config + cmd/main wiring of NewForwardAuthHandler(resolve, ragBroker, AccountOwnsTenant, "rag:read", logger) at /internal/authz/forward-rag with refuse-to-start — verified by go test ./... + go vet green (least-privilege, singleflight, fail-closed, minted≠platform, response-parse, refuse-to-start).
---

# Plan: Model-B RAG broker + ForwardAuth wiring — M14 (edge-integration, theo-cloud)

> **v1.1** (2026-07-02) — absorbed `/edge-case-plan` EC-1 MUST FIX: `MintKey` hard-guards `raw_key == "" →
> error` (fail closed on a malformed theo-rag body instead of caching an empty secret) + a T1.1 test. EC-2
> (reuse the shared `resolve`/`auth.AccountOwnsTenant` collaborators) folds into T4.1; EC-3 (cloud keys
> granting `rag:` scopes is M15) documented. See
> `.claude/knowledge-base/reviews/edge-rag-broker-plan-edge-cases-2026-07-02.md`.
>
> **v1.0** (2026-07-02) — from blueprint `.claude/knowledge-base/discoveries/blueprints/edge-rag-broker-blueprint.md` (SHIPPABLE 100). Repo: theo-cloud (Go, native).

## Goal

Add `internal/rag/{admin_client,broker}.go` (broker copied verbatim from `internal/themory`; admin_client
adapts theo-rag's M12 nested `{key, raw_key}` mint response), `RAG_BASE_URL`/`RAG_PLATFORM_ADMIN_KEY`
config with prod validation, and `cmd/main.go` wiring of `NewForwardAuthHandler(resolve, ragBroker,
auth.AccountOwnsTenant, "rag:read", logger)` at `/internal/authz/forward-rag` with refuse-to-start on
broker error — verified by `go test ./...` + `go vet ./...` green (admin_client response-parse,
least-privilege intersect, singleflight, fail-closed, minted≠platform, config validate + refuse-to-start).

## Context

ROADMAP-edge-integration.md § M14 (deps M12 — theo-rag mint shipped in v0.0.0-rc.45) is the first
theo-cloud-native milestone. The DISCOVER cycle produced
`.claude/knowledge-base/discoveries/blueprints/edge-rag-broker-blueprint.md` (SHIPPABLE 100), which
resolved: copy the `internal/themory` broker verbatim (response-shape agnostic); adapt ONLY the
admin_client's response parse to theo-rag's nested `{key:{id,scopes}, raw_key}` (a verbatim flat-`{id,secret}`
copy would cache an EMPTY secret and 401 the whole edge); config gated by `RAG_BASE_URL` with refuse-to-start;
`client.go` (data-plane) out of scope (the edge proxies). This plan implements the blueprint's 6
Recommendations. Decisions resolved upstream (blueprint ADRs D1–D3).

## Baseline Context

### Files that will be touched

| File | Role |
|---|---|
| `internal/rag/admin_client.go` (NEW) | AdminClient (holds `rag:platform-admin`; MintKey → POST /v1/admin/keys; parses `{key, raw_key}`) |
| `internal/rag/admin_client_test.go` (NEW) | httptest: parses theo-rag's exact response; request shape + auth header |
| `internal/rag/broker.go` (NEW) | Broker (verbatim copy of themory: LRU + singleflight + fail-closed + intersect) |
| `internal/rag/broker_test.go` (NEW) | least-privilege / singleflight / fail-closed / TTL / minted≠platform |
| `internal/config/config.go` | Add `RagBaseURL` + `RagPlatformAdminKey` + prod validate |
| `internal/config/config_test.go` | validate: base-url set + empty admin-key in prod → error |
| `internal/routes/forward_auth.go` (or routes const file) | `AuthzForwardRagPath = "/internal/authz/forward-rag"` |
| `cmd/main.go` | construct rag broker (refuse-to-start) + register forward-rag handler |

### Reference (read-only) — verified

| Reference | path:line | Proves |
|---|---|---|
| Broker to copy | `internal/themory/broker.go` | NewBroker/KeyForTenantScoped/intersectScopes/fail-closed |
| AdminClient to copy+adapt | `internal/themory/admin_client.go` | AdminClient/do()/MintKey |
| theo-rag M12 response | theo-rag `packages/api/src/server/handlers/admin-keys.ts:130` + `store/api-keys-store.ts` (CreateApiKeyResult/ApiKeyPublic) | the nested `{key, raw_key}` shape |
| Forward-auth handler | `internal/routes/forward_auth.go:64` | `NewForwardAuthHandler(resolve, minter, authorize, requiredScope, logger)` |
| main wiring (themory) | `cmd/main.go:244-284,470-478` | broker construct + route mount pattern |
| config fields (promptly) | `internal/config/config.go:118-128,231` | RagBaseURL/RagPlatformAdminKey mirror + prod validate |

### Current callers / dependents — verified

- `NewForwardAuthHandler` is already used by themory (`main.go:284`) + promptly (`main.go:224`) — M14 adds a third instance with the SAME collaborators (`resolve`, `auth.AccountOwnsTenant`).
- Route mount: `main.go:470-478` registers `AuthzForwardPath`/`AuthzForwardPromptlyPath`; M14 adds `AuthzForwardRagPath`.
- `golang.org/x/sync/singleflight` + `github.com/hashicorp/golang-lru/v2` already in `go.mod` (themory/promptly).

### Domain glossary

| Term | Definition |
|---|---|
| AdminClient | control-plane client holding `rag:platform-admin`; mints per-tenant keys; NEVER on the data path. |
| Broker | caches + lazily mints per-tenant `rag_live_*` keys; least-privilege intersect; fail-closed. |
| minted ≠ platform | the broker returns minted `rag_live_*` secrets; the platform key lives only in AdminClient (NIST AC-5/6). |
| workspace_id == tenant_id | the broker mints with workspace_id = tenantID (theo-rag's isolation unit). |

### Architecture boundaries affected

- `internal/rag` is a new gateway control-plane package (mirrors `internal/themory`). The platform key is confined to the AdminClient (control plane); the Broker + handler are data-adjacent but hold no platform key (`.claude/rules/architecture.md` — control/data-plane split). Fail-closed per `.claude/rules/error-handling.md`.

## Prior Art & Related Work

- Internal blueprint `.claude/knowledge-base/discoveries/blueprints/edge-rag-broker-blueprint.md` (design source; 4 corners + 3 ADRs).
- Reference: theo-cloud `internal/themory/*` (the Model-B broker) + `internal/promptly/*` (the 2nd copy) — copied (Rule 9).
- Consumer contract: theo-rag M12 `POST /v1/admin/keys` (shipped v0.0.0-rc.45) — the mint API the AdminClient calls.

## ADRs

### D1 — Copy the broker verbatim; `client.go` out of scope

**Decision:** `broker.go` is a byte-for-byte copy (package + error-prefix only); no `internal/rag/client.go`.

**Rationale:** the broker's least-privilege/singleflight/fail-closed is production-validated across themory+promptly; re-deriving invites drift (Rule 9). Model B: the edge forwards with the injected key — no Go data-plane client (YAGNI).

**Alternatives considered:** create a rag data-plane client (rejected — YAGNI, the edge proxies).

### D2 — Adapt ONLY the admin_client's response parse to theo-rag's `{key, raw_key}`

**Decision:** `MintResult{ID, Secret, Scopes}`; `MintKey` unmarshals theo-rag's nested `{key:{id,scopes}, raw_key}` and maps `raw_key→Secret`, `key.id→ID`, `key.scopes→Scopes`.

**Rationale:** theo-rag M12 returns `CreateApiKeyResult{key, raw_key}` (verified) — a flat-`{id,secret}` copy would cache an EMPTY secret and 401 the whole edge (EC-1). Isolating the delta in admin_client keeps the broker a pure copy.

**Alternatives considered:** change the broker to read nested (rejected — couples broker to shape); change theo-rag M12 to flat (rejected — shipped contract, wrong repo).

### D3 — Config gated + refuse-to-start; least-privilege mint of the consumer's own scopes

**Decision:** `RagBaseURL` unset → rag forward-auth not wired; set → `RagPlatformAdminKey` required in prod; a broker construction error REFUSES to start. Handler passes `"rag:read"` as the edge gate; broker mints `intersect(consumer scopes, {read,write,delete})`.

**Rationale:** mirrors themory/promptly; refuse-to-start prevents a silent unauthenticated edge (fail-closed at boot); least-privilege mint closes intra-tenant scope escalation.

**Alternatives considered:** default-on wiring (rejected — fails without theo-rag deployed); mint full scopes always (rejected — least-privilege breach).

## Dependencies

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | `singleflight` + `golang-lru/v2` already in go.mod (themory/promptly); admin_client uses stdlib only. | Zero new module. |

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `golang.org/x/sync/singleflight` | (existing) | go | broker coalescing |
| `github.com/hashicorp/golang-lru/v2` | (existing) | go | broker LRU |

## Dependency Graph

```
Phase 1 (admin_client.go + response-parse test) ──┐ (stdlib only)
Phase 2 (broker.go verbatim + test) ──────────────┤ (needs P1 minter/MintResult)
        ↓                                          │
Phase 3 (config RagBaseURL/RagPlatformAdminKey) ───┤ (independent)
        ↓                                          │
Phase 4 (routes const + main wiring + refuse-to-start test) ─┤ (needs P1+P2+P3)
        ↓                                          │
Phase 5 (Integration Validation: go test ./... + go vet) ────┘ (needs all)
```

## Phase 1 — `internal/rag/admin_client.go` (response-shape adaptation)

### T1.1 — AdminClient + MintKey parsing theo-rag's `{key, raw_key}`

#### Why this step
The admin_client is where theo-rag's nested mint response is parsed; a verbatim flat-`{id,secret}` copy would cache an empty secret and 401 the whole edge (EC-1). Reasoning: isolating the shape delta here keeps the broker a pure copy; the platform key is confined to this control-plane type (NIST AC-5/6).

#### Files to edit
- `internal/rag/admin_client.go` (NEW); `internal/rag/admin_client_test.go` (NEW).

#### Deep file dependency analysis
Copy `internal/themory/admin_client.go` (AdminClient{baseURL, platformKey, httpClient}, NewAdminClient, do() with `Authorization: Bearer <platformKey>`, Error/ErrNotFound). `MintResult{ID, Secret, Scopes}`; a private `mintResponse{Key struct{ID,Scopes}` json:"key"`; RawKey string` json:"raw_key"`}`; `MintKey(ctx, workspaceID, name, scopes)` sends `{name, scopes, workspace_id}` to POST `/v1/admin/keys`, unmarshals `mintResponse`; **EC-1 guard: `if resp.RawKey == "" { return nil, fmt.Errorf("rag admin: mint response missing raw_key") }`** (fail closed on a malformed body — never return an empty Secret the broker would cache); returns `MintResult{ID: resp.Key.ID, Secret: resp.RawKey, Scopes: resp.Key.Scopes}`. Package `rag`.

#### TDD
RED: `TestMintKey_ParsesNestedResponse` (httptest returns `{"key":{"id":"akey_x","scopes":["rag:read"]},"raw_key":"rag_live_abc"}` → `MintResult{ID:"akey_x", Secret:"rag_live_abc", Scopes:["rag:read"]}`); `TestMintKey_SendsCorrectRequest` (POST /v1/admin/keys, body has name/scopes/workspace_id, header `Authorization: Bearer <platformKey>`); `TestMintKey_PropagatesHTTPError` (500 → error, not empty result); `TestMintKey_MissingRawKey_FailsClosed` (EC-1 — 2xx body `{"key":{"id":"x"}}` without `raw_key` → error, NOT a `MintResult{Secret:""}`). GREEN: implement. REFACTOR: none.

#### Concurrency tests
(none — single-threaded) — a stateless HTTP client call.

#### Acceptance criteria
- `MintKey` against an httptest stub returning theo-rag's exact shape yields `MintResult{ID, Secret=raw_key, Scopes}` (non-empty Secret); the request is POST `/v1/admin/keys` with `{name,scopes,workspace_id}` + Bearer platform key; an HTTP ≥400 → error.

#### DoD
`go test ./internal/rag/...` green for admin_client; `go vet ./internal/rag/...` clean.

## Phase 2 — `internal/rag/broker.go` (verbatim copy)

### T2.1 — Broker (LRU + singleflight + fail-closed + intersect)

#### Why this step
The broker caches + lazily mints per-tenant keys with least-privilege scopes and fails closed; copying themory verbatim (Rule 9) avoids re-deriving the singleflight/fail-closed logic. Reasoning: it consumes the `minter` interface + `MintResult.Secret` (filled from raw_key by T1.1), so it needs no shape awareness.

#### Files to edit
- `internal/rag/broker.go` (NEW); `internal/rag/broker_test.go` (NEW).

#### Deep file dependency analysis
Copy `internal/themory/broker.go` byte-for-byte, changing only `package rag` + error prefix `themory broker:`→`rag broker:`. Keep `minter` interface, `cachedSecret`, `Broker`, `NewBroker(admin, size, ttl, scopes)`, `KeyForTenant`, `KeyForTenantScoped(want)` (`intersectScopes(want, b.scopes)`, empty-scope + empty-tenant fail-closed, singleflight, cache key `account\x00tenant\x00scopes`), `intersectScopes`, `Evict`.

#### TDD
RED: `TestKeyForTenantScoped_LeastPrivilege` (want=["rag:read"], allowed=[read,write,delete] → mints only ["rag:read"]); `TestKeyForTenantScoped_Singleflight` (N concurrent cold → minter called once); `TestKeyForTenantScoped_FailClosed_MintError` (mint err → "", no cache write, re-mint next call); `TestKeyForTenantScoped_FailClosed_EmptyIntersect` (want ∩ allowed = ∅ → error, minter never called); `TestKeyForTenantScoped_EmptyTenant_Error`; `TestKeyForTenant_TTLExpiry` (injected clock re-mints past ttl); `TestBroker_MintedSecretDiffersFromPlatform` (EC-3 — returned secret is the minted rag_live_*, broker holds no platform key). GREEN: copy. REFACTOR: none.

#### Concurrency tests
Singleflight — `TestKeyForTenantScoped_Singleflight` launches N goroutines against a cold (tenant,scopes) and asserts the stub minter's call count is EXACTLY 1 (race-aware: run with `go test -race`). This is the concurrency invariant a single-threaded test would miss.

#### Acceptance criteria
- least-privilege intersect mints only the granted subset; N concurrent cold misses → one mint; mint error / empty intersect / empty tenant → `("", error)` with no cache write; TTL expiry re-mints; the returned secret is a minted key, never the platform key. `go test -race ./internal/rag/...` green.

#### DoD
`go test -race ./internal/rag/...` green; `go vet` clean.

## Phase 3 — config

### T3.1 — `RagBaseURL` + `RagPlatformAdminKey` + prod validate

#### Why this step
The broker is gated by config; the prod validate (base-url set ⇒ admin-key required) prevents a half-configured edge. Reasoning: mirrors the promptly/themory config fields + `config.go:231` validate.

#### Files to edit
- `internal/config/config.go`; `internal/config/config_test.go`.

#### Deep file dependency analysis
Add `RagBaseURL string` + `RagPlatformAdminKey Secret`; load `envOr("RAG_BASE_URL","")` + `Secret(envOr("RAG_PLATFORM_ADMIN_KEY",""))`; in `Validate()` (prod branch): `if cfg.RagBaseURL != "" && cfg.RagPlatformAdminKey == "" { return error }`.

#### TDD
RED: `TestValidate_RagBaseURLWithoutAdminKey_ProdError` (base-url set, admin-key empty, prod → error); `TestLoad_RagFields` (env → fields). GREEN: implement. REFACTOR: none.

#### Concurrency tests
(none — single-threaded) — config load/validate.

#### Acceptance criteria
- prod + `RAG_BASE_URL` set + empty `RAG_PLATFORM_ADMIN_KEY` → `Validate()` returns an error; env vars load into the fields.

#### DoD
`go test ./internal/config/...` green.

## Phase 4 — main wiring + forward-rag route

### T4.1 — routes const + `cmd/main.go` broker construct + register + refuse-to-start

#### Why this step
The wiring makes the broker reachable at `/internal/authz/forward-rag`; refuse-to-start on broker error prevents a silent unauthenticated edge. Reasoning: mirrors themory `main.go:244-284,470-478`; the `nil`-skip is ONLY when `RagBaseURL` is unset (feature off), NOT on a construction error.

#### Files to edit
- `internal/routes/forward_auth.go` (add `AuthzForwardRagPath` const); `cmd/main.go`.

#### Deep file dependency analysis
`const AuthzForwardRagPath = "/internal/authz/forward-rag"`. In `main.go`: `if cfg.RagBaseURL != "" { ragAdmin := rag.NewAdminClient(cfg.RagBaseURL, cfg.RagPlatformAdminKey.Value(), ragHTTP); ragBroker, err := rag.NewBroker(ragAdmin, 1024, time.Hour, []string{"rag:read","rag:write","rag:delete"}); if err != nil { return fmt.Errorf("rag broker: %w", err) }; ragForwardAuthHandler = routes.NewForwardAuthHandler(resolve, ragBroker, auth.AccountOwnsTenant, "rag:read", logger) }`. Route mount: `if ragForwardAuthHandler != nil { r.Get(routes.AuthzForwardRagPath, ...); r.Post(...) }`.

#### TDD
RED: `TestMain_RagBrokerConstructError_RefusesToStart` (a broker construct error propagates — the main-wiring helper returns the error, not nil). If main is not unit-testable directly, extract the rag-wiring into a testable helper `buildRagForwardAuth(cfg, resolve, auth, logger) (*ForwardAuthHandler, error)` and test THAT (returns error on bad config; nil-handler when RagBaseURL unset; non-nil when configured). GREEN: implement. REFACTOR: extract the helper if needed.

#### Concurrency tests
(none — single-threaded) — boot-time wiring.

#### Acceptance criteria
- `AuthzForwardRagPath` registered when `RagBaseURL` set; a broker construction error refuses to start (returns error, never nil-skips a configured rag); unset `RagBaseURL` → handler nil (feature off, no route).

#### DoD
`go test ./...` green; `go vet ./...` clean.

## Phase 5 — Integration Validation

### T5.1 — Full-chain gates

#### Why this step
Prove the package compiles, all tests pass (incl. -race for singleflight), vet is clean, and no existing theo-cloud test regressed. Reasoning: a new package + main wiring can break the build; the full `go test ./...` catches it.

#### Files to edit
- (none new) — runs `go test ./...`, `go test -race ./internal/rag/...`, `go vet ./...`.

#### Failure-scenarios chaos pass
The admin_client calls theo-rag's HTTP mint endpoint (external I/O). Failure modes: (a) HTTP ≥400 → typed `Error`, propagated (broker fails closed, no cache write); (b) network error → error propagated; (c) theo-rag returns a malformed body → decode error propagated. All covered by T1.1 + T2.1 tests (the broker's fail-closed path re-mints on the next call).

#### Concurrency tests
(none — single-threaded) — the integration gate runs the suite; the concurrency invariant (broker singleflight) is covered by T2.1's `go test -race` test. No new shared mutable state here.

#### Acceptance criteria
- `go test ./...` + `go test -race ./internal/rag/...` + `go vet ./...` green; `/deps-audit` PASS (0 new module); theo-cloud CHANGELOG updated; theo-cloud `/review` = READY_TO_MERGE.

#### DoD
Full chain green; theo-cloud CHANGELOG `[Unreleased]` has the M14 entry.

## Coverage Matrix

| DoD item (ROADMAP M14) | Task(s) |
|---|---|
| `admin_client.go` (MintKey; platform key never on data path — structural split) | T1.1 |
| `broker.go` (KeyForTenantScoped LRU + singleflight + fail-closed; scopes = intersect(want, allowed)) | T2.1 |
| `config.go`: `RAG_BASE_URL` + `RAG_PLATFORM_ADMIN_KEY` (base-url ⇒ admin-key required in prod) | T3.1 |
| `cmd/main.go`: construct broker + register handler; refuse-to-start on broker error | T4.1 |
| `go test ./...` + `go vet` green — least-privilege, singleflight, fail-closed, minted≠platform, refuse-to-start | T1.1, T2.1, T4.1, T5.1 |
| theo-cloud CHANGELOG; theo-cloud `/review` READY_TO_MERGE | T5.1 |

**Coverage: 6/6 DoD items mapped (100%).**

## Failure scenarios

- **theo-rag mint returns HTTP ≥400 (bad platform key / 403):** `admin_client.do()` returns a typed `Error`; the broker propagates it (fail-closed — no cache write, empty secret). Reproduced by an httptest stub returning 403 (T1.1) + the broker fail-closed test (T2.1).
- **theo-rag mint returns a malformed / flat body:** the `mintResponse` decode yields empty `Key`/`RawKey`; MintKey still returns a MintResult, but with an empty Secret — the broker would cache an empty secret. Mitigation: T1.1 asserts the exact theo-rag shape parses to a NON-empty Secret; a follow-up guard (`if resp.RawKey == "" { return error }`) is added so a malformed body fails closed rather than caching empty.
- **network error to theo-rag:** `do()` returns the wrapped error; broker fails closed. Reproduced by pointing the client at a closed port (T1.1 optional).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Verbatim admin_client copy caches an empty secret (theo-rag's nested response) → whole edge 401s | HIGH | D2 adapts the response parse + a `raw_key == "" → error` guard; T1.1 asserts non-empty Secret against theo-rag's exact shape | paulohenriquevn |
| Platform-admin key leaks onto the data path (confused deputy) | HIGH | structural control/data split (platform key only in AdminClient); T2.1 minted≠platform test | paulohenriquevn |
| Scope-superset mint (least-privilege breach) | MEDIUM | `intersectScopes(want, allowed)` + T2.1 least-privilege test | paulohenriquevn |
| Half-configured edge (base-url without admin-key) boots silently | MEDIUM | config prod-validate + refuse-to-start (D3); T3.1 + T4.1 | paulohenriquevn |

## Unresolved Questions

(none — every decision is resolved at plan time: the broker-verbatim + client.go-out-of-scope (D1), the
admin_client response adaptation (D2), and the config-gated refuse-to-start (D3) are locked by the
blueprint. Deferred items — the edge/Traefik middleware (M15) — are named milestones, not open questions.)

## Global Definition of Done

Per `.claude/rules/testing.md` + `.claude/rules/architecture.md` + `.claude/rules/error-handling.md` +
ROADMAP M14 DoD: all 6 Coverage-Matrix items delivered; `go test ./...` + `go test -race ./internal/rag/...`
+ `go vet ./...` green; `/deps-audit` PASS (0 new module); theo-cloud CHANGELOG updated; the least-privilege
/ singleflight / fail-closed / minted≠platform / response-parse / refuse-to-start tests green; theo-cloud
`/review` = READY_TO_MERGE.

## Final Phase: Integration Validation

T5.1 is the integration gate — the plan is NOT complete until `go test ./...` + `-race` + `go vet` pass. A
broken build or a failing race test on the singleflight path means the broker's core invariant is violated.
