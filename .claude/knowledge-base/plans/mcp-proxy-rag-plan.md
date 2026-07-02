---
slug: mcp-proxy-rag
milestone_id: M16
roadmap: ../../../theo-data/theo-rag/ROADMAP-edge-integration.md
created_at: 2026-07-02
goal: Expose theo-rag's MCP tools per-tenant through the Theo MCP Gateway — theo-traefik-mcp capability-via-context resolver, theo-cloud MCPCapabilityBinding[rag] (+expose ragBroker), theo-rag @usetheo/rag-mcp streamable-HTTP+dev-TLS listener, and theo-workspace wiring — verified by green go test (both Go repos) + a vitest HTTP/TLS boot test (theo-rag) + a drift-guard, with the live per-tenant proxy proof deferred to M18.
---

# Plan: MCP proxy end-to-end via the MCP gateway — M16 (edge-integration, 4 repos)

> **v1.0** (2026-07-02) — from blueprint `.claude/knowledge-base/discoveries/blueprints/mcp-proxy-rag-blueprint.md` (SHIPPABLE 99.5). Spans theo-traefik-mcp (Go), theo-cloud (Go), theo-rag (TS), theo-workspace (config).

## Goal

Expose theo-rag's MCP tools per-tenant through the Theo MCP Gateway by delivering, across 4 repos:
(1) theo-traefik-mcp **capability-via-context** (the broker resolver sends the per-request `X-Theo-Capability`
+ mint-cache key includes capability); (2) theo-cloud `MCPCapabilityBinding["rag"]` with the `ragBroker` as
Minter and read/write/delete `ScopeTools`; (3) a theo-rag `@usetheo/rag-mcp` streamable-HTTP + dev-TLS listener
(today stdio); (4) theo-workspace `THEO_MCP_UPSTREAMS += rag` + TLS mount + `rag-up.sh --mcp` — verified by
green `go test` in both Go repos + a vitest HTTP/TLS boot test in theo-rag + a `check-compose.sh` drift-guard.

## Context

ROADMAP-edge-integration.md § M16 (deps M14 — theo-cloud rag broker; M11 — theo-rag per-verb scope). DISCOVER
(SHIPPABLE 99.5) surfaced the scope-defining fact: the gateway is a walking skeleton hardcoded to
`brokerCapability="memory"` (`theo-traefik-mcp/cmd/theo-mcp-gateway/main.go:65,668-670,673`), so `/mcp/rag`
would resolve against the memory binding (cross-capability defect). M16 makes the gateway capability-aware
(the author's noted "capability-via-context" follow-up) and adds the rag binding + listener + wiring. The blueprint
locked ADRs D1 (capability-via-context, not an interface change), D2 (expose ragBroker), D3 (mirror theo-memory's
HTTP/TLS transport, Rule 9), D4 (rag ScopeTools buckets, delete empty).

## Baseline Context

### Files that will be touched

| Repo | File | Role |
|---|---|---|
| theo-traefik-mcp | `internal/auth/capability_ctx.go` (NEW) | WithCapability / capabilityFromContext helpers |
| theo-traefik-mcp | `internal/auth/broker_resolver.go` | resolveRemote reads ctx capability; cache key includes capability |
| theo-traefik-mcp | `internal/gateway/proxy.go` | ServeHTTP puts parsed capability in the resolve ctx |
| theo-cloud | `cmd/main.go` | buildRagForwardAuth returns broker; add MCPCapabilityBinding["rag"] |
| theo-cloud | `internal/routes/mcp_resolve_test.go` | rag translate + one-bucket tests |
| theo-cloud | `cmd/main_test.go` | buildRagForwardAuth-exposes-broker test |
| theo-rag | `packages/mcp/src/transports/streamable-http.ts` (NEW) | HTTP+TLS transport |
| theo-rag | `packages/mcp/src/index.ts` | CLI: --transport/--port/--host/--tls-cert/--tls-key; stdio default |
| theo-workspace | `compose.yaml` | THEO_MCP_UPSTREAMS += rag |
| theo-workspace | `dev/rag-up.sh` | --mcp mode (start rag-mcp HTTP/TLS) |
| theo-workspace | `dev/check-compose.sh` | drift-guard: rag in THEO_MCP_UPSTREAMS |
| (each repo) | `CHANGELOG.md` | M16 entry |

### Reference (read-only) — verified

| Reference | path | Proves |
|---|---|---|
| memory MCP binding | theo-cloud `cmd/main.go:356-366` | the MCPCapabilityBinding + ScopeTools shape |
| grantedTools | theo-cloud `internal/routes/mcp_resolve.go:137-158` | scope→tool translation |
| memory resolve test | theo-cloud `internal/routes/mcp_resolve_test.go:81` | the translate/one-bucket test pattern |
| broker resolver | theo-traefik-mcp `internal/auth/broker_resolver.go:76-95` | resolveRemote + X-Theo-Capability header |
| gateway parse+serve | theo-traefik-mcp `internal/gateway/proxy.go:189,204` | parsePath + resolver call site |
| walking-skeleton note | theo-traefik-mcp `cmd/theo-mcp-gateway/main.go:65,668-673` | the single-capability limitation |
| memory HTTP/TLS transport | theo-memory `packages/mcp/src/transports/streamable-http.ts` | the listener shape (Rule 9) |
| memory run-mcp-server | theo-memory `packages/mcp/src/run-mcp-server.ts:111-118,170-187,350-354` | transport selection + port/host/TLS |
| rag-mcp tools | theo-rag `packages/mcp/src/tools.ts:12-18` | the 5 tool names + read/write split |
| rag broker (M14) | theo-cloud `cmd/main.go:46-68` | buildRagForwardAuth (the refactor target) |
| upstreams env | theo-workspace `compose.yaml:155` | THEO_MCP_UPSTREAMS shape |

### Current callers / dependents

- **theo-cloud `buildRagForwardAuth`** — called once in `main()` (M14, `cmd/main.go:267`); the refactor to return the broker updates that one call site + adds the MCP binding consumer.
- **theo-traefik-mcp `BrokerResolver.Resolve`** — called at `proxy.go:204` (the only Model-B call site); static/JWT/reloadable resolvers share the interface and ignore the new ctx value.
- **theo-rag `createServer(client)`** — the transport-agnostic factory (`packages/mcp/src/server.ts`); the stdio entrypoint (`index.ts`) is the only caller; the new HTTP entrypoint is an added branch.

### Domain glossary

- **capability-via-context** — the gateway carries the parsed `/mcp/<cap>` capability in the request context so the shared resolver interface stays unchanged; the broker resolver reads it (D1).
- **MCPCapabilityBinding** — theo-cloud struct binding a capability to its broker (Minter), RequiredScope, and the scope→tool ScopeTools map.
- **ScopeTools** — maps each data scope (`rag:read`) to the MCP tool names it grants; the gateway allowlist matches tool==name exactly.
- **mint cache** — the gateway's TTL cache of minted per-tenant creds; its key MUST include capability (cross-capability isolation).

### Architecture boundaries affected

- Per `.claude/rules/architecture.md` (DIP + composition root): theo-cloud's binding is wired at `main()` (composition root), not in business code; the broker is injected. Per **DRY** (Rule 12) the rag binding + the rag listener copy the memory shapes; per **KISS/YAGNI** (Rules 10/11) capability-via-context avoids an interface change 3 of 4 resolvers don't need, and zero new deps. The mint-cache-key-includes-capability is the CWE-441-adjacent isolation guarantee (a memory-minted key must never serve a rag request).

## Prior Art & Related Work

- Internal blueprint `.claude/knowledge-base/discoveries/blueprints/mcp-proxy-rag-blueprint.md` (design source; 4 corners + D1–D4).
- Reference: theo-memory's shipped streamable-HTTP+dev-TLS MCP listener (mirrored, Rule 9); theo-cloud's memory MCP binding (mirrored); M14's rag broker (reused).

## ADRs

### D1 — capability-via-context (theo-traefik-mcp), not an interface change
**Decision:** carry the parsed capability in the request context; `BrokerResolver` reads it for the `X-Theo-Capability` header + the mint-cache key; fallback to the constructed default.
**Rationale:** `CredentialResolver.Resolve(ctx,key)` is shared by static/JWT/reloadable resolvers that are capability-agnostic; a context value leaves them untouched and matches the author's own "capability-via-context" note. Cache-key-includes-capability is a security requirement (no cross-capability cred reuse).
**Alternatives:** interface change `Resolve(ctx,key,cap)` (rejected — ripples to 4 resolvers + mocks for a value 3 ignore); per-capability resolver map (rejected — duplicates JWT-chain + reloadable per cap).

### D2 — expose ragBroker from buildRagForwardAuth (one broker, two consumers)
**Decision:** `buildRagForwardAuth` returns `(*ForwardAuthHandler, routes.TenantKeyMinter, error)`; main() feeds the same broker to ForwardAuth + the MCP binding.
**Rationale:** mirrors memory (`themoryBroker` feeds both); ONE broker = ONE mint cache = consistent per-tenant keys across REST + MCP; preserves M14's nil/refuse-start branches.
**Alternatives:** a second rag broker for MCP (rejected — two caches, duplicated nil/refuse logic).

### D3 — rag-mcp HTTP/TLS listener mirrors theo-memory (Rule 9)
**Decision:** copy theo-memory's `streamable-http.ts` transport + the `--transport/--port/--host/--tls-cert/--tls-key` CLI; stdio stays default.
**Rationale:** theo-memory's HTTP/TLS MCP listener is shipped; `createServer(client)` is already transport-agnostic (DIP); re-deriving invites drift (Rule 9).
**Alternatives:** hand-roll HTTP transport (rejected — the SDK ships `StreamableHTTPServerTransport`).

### D4 — rag ScopeTools buckets, delete empty today
**Decision:** `rag:read`→{ask,list_collections,retrieve}; `rag:write`→{create_collection,ingest_document}; `rag:delete`→{}.
**Rationale:** the 5 tools' verbs are unambiguous; an empty delete bucket is honest + future-ready; the one-bucket test asserts each tool mapped exactly once.
**Alternatives:** omit delete key (rejected — the test wants all three data scopes present).

## Dependencies

### New — to be introduced
| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | Go: reuse rag.NewBroker + BrokerResolver + context stdlib. TS: `@modelcontextprotocol/sdk/server/streamableHttp.js` (^1.29.0, already a dep) + node:http/https/crypto (stdlib). | Zero new dependency in any repo. |

### Existing — use as-is
| Package | Version | Ecosystem | Why |
|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.29.0 | npm | the streamable-HTTP transport submodule (theo-rag) |
| golang-lru / singleflight | (existing) | go | reused by the rag broker (theo-cloud, M14) |

## Dependency Graph

```
Phase 1 (theo-traefik-mcp capability-via-context) ──┐ (Go; independent)
Phase 2 (theo-cloud binding[rag] + expose broker) ──┤ (Go; independent of P1)
Phase 3 (theo-rag HTTP/TLS listener) ───────────────┤ (TS; independent)
        ↓                                            │
Phase 4 (theo-workspace wiring: upstreams+TLS+up.sh) ┤ (config; needs P1+P3 to run live)
        ↓                                            │
Phase 5 (Integration Validation: go test ×2 + vitest + drift-guard + documented smoke) ─┘
```

## Phase 1 — theo-traefik-mcp: capability-via-context

### T1.1 — Broker resolver reads capability from context (header + cache key)

#### Why this step
The gateway must send the per-request `X-Theo-Capability` so `/mcp/rag` resolves against theo-cloud's rag binding, and the mint cache must isolate by capability so a memory-minted cred is never served for a rag request. Reasoning: the interface is shared by capability-agnostic resolvers (D1), so a context value is the minimal correct carrier; the cache-key composition is the security-critical half (cross-capability isolation).

#### Files to edit
- `internal/auth/capability_ctx.go` (NEW); `internal/auth/broker_resolver.go`; `internal/gateway/proxy.go`.

#### Deep file dependency analysis
`capability_ctx.go`: `WithCapability(ctx,cap)` + `capabilityFromContext(ctx,fallback)`. `broker_resolver.go`: `resolveRemote` uses `cap := capabilityFromContext(ctx, r.capability)` for the header; `Resolve` composes the cache key `cap + "\x00" + apiKey`. `proxy.go` `ServeHTTP`: `ctx := auth.WithCapability(r.Context(), capability); cred, err := g.resolver.Resolve(ctx, key)`.

#### TDD
- RED: `TestBrokerResolver_UsesCapabilityFromContext` — a `httptest.Server` captures the `X-Theo-Capability` header; assert it equals the ctx capability (`rag`), not the constructed default (`memory`).
- RED: `TestMintCache_IsolatesByCapability` — resolve `memory` for key K (cache), then resolve `rag` for the same K → a SECOND upstream hit (not the memory-cached cred). Assert distinct downstream keys.
- RED: `TestBrokerResolver_FallsBackToDefaultCapability` — no ctx value → uses `r.capability` (backward-compat).
- GREEN: implement the helpers + wiring.

#### Concurrency tests
`TestMintCache_IsolatesByCapability` must hold under `-race` (the cache is concurrent). Add a `go test -race` assertion in validation; the mint cache already has a concurrency test (`mint_cache_test.go:100`) — extend the key to include capability so the race test covers the composite key.

#### Failure-scenarios chaos pass
Broker unreachable → `ErrBackendUnavailable` (unchanged); an empty capability in ctx → fallback to default (no empty header). Reproduced by a resolver with no ctx value + a stubbed 503 upstream.

#### Acceptance criteria
- `X-Theo-Capability` reflects the per-request capability; the mint-cache key includes capability; static/JWT resolvers unaffected (their tests still pass); `go test ./... -race` green.

#### DoD
`go test ./internal/auth/... ./internal/gateway/... -race` green; `go vet` clean.

## Phase 2 — theo-cloud: MCPCapabilityBinding["rag"] + expose ragBroker

### T2.1 — Refactor buildRagForwardAuth to expose the broker + add the rag MCP binding

#### Why this step
The MCP resolve binding needs the rag broker as its Minter; exposing it from the existing builder (rather than a second broker) keeps one mint cache across REST + MCP (D2). Reasoning: mirrors the memory path where `themoryBroker` feeds both; the binding's ScopeTools is the per-verb tool allowlist the gateway enforces (roadmap risk 1: a write tool under read must be impossible).

#### Files to edit
- `cmd/main.go`.

#### Deep file dependency analysis
`buildRagForwardAuth` → `(*routes.ForwardAuthHandler, routes.TenantKeyMinter, error)` (nil,nil,nil unset; nil,nil,err on failure; handler,broker,nil configured). In `main()`: capture `ragBroker`; when non-nil, add to the mcpResolve caps map the `"rag"` binding with `Minter: ragBroker`, `RequiredScope: "rag:read"`, `ScopeTools` per D4.

#### TDD
- RED: `TestBuildRagForwardAuth_ExposesBroker` — configured → broker non-nil; unset → all nil; construct-failure → error (extend the existing M14 test).
- (binding correctness tested in T2.2.)

#### Concurrency tests
(none — single-threaded) — boot-time wiring; the broker's own concurrency is covered in theo-cloud M14 + the gateway cache test.

#### Acceptance criteria
- `buildRagForwardAuth` returns the broker; `main()` adds `MCPCapabilityBinding["rag"]` ONLY when the broker is configured; `go build ./...` + `go vet` clean.

#### DoD
`go test ./cmd/... -run BuildRagForwardAuth` green; `go build ./...` OK.

### T2.2 — rag MCP-resolve tests (translate + one-bucket)

#### Why this step
Prove the roadmap's two risk guards: (1) a `rag:read` key exposes NO write tool; (2) every rag tool is in exactly one bucket (tool-drift guard). Reasoning: these are the DoD's explicit Go tests and the security contract of the binding.

#### Files to edit
- `internal/routes/mcp_resolve_test.go`.

#### Deep file dependency analysis
`TestMCPResolve_Rag_TranslatesDataScopesToTools` (mirror `mcp_resolve_test.go:81`): a binding with the rag ScopeTools; resolve `[rag:read]` → granted tools == {ask,list_collections,retrieve}, NO write; resolve `[rag:read,rag:write]` → adds {create_collection,ingest_document}. `TestRagScopeTools_EveryToolInExactlyOneBucket`: over the rag ScopeTools map, assert the union of buckets == the 5 tool names, each appearing exactly once (no unmapped, no double-mapped).

#### TDD
- RED: both tests fail before the binding/map exists.
- GREEN: the T2.1 binding makes them pass.

#### Concurrency tests
(none — single-threaded) — pure map assertions, no shared state.

#### Acceptance criteria
- Both tests green; a deliberately mis-bucketed tool (write tool under read) makes `TranslatesDataScopesToTools` fail; an unmapped tool makes the one-bucket test fail.

#### DoD
`go test ./internal/routes/... -run 'MCPResolve_Rag|RagScopeTools'` green.

## Phase 3 — theo-rag: @usetheo/rag-mcp streamable-HTTP + dev-TLS listener

### T3.1 — HTTP/TLS transport + CLI (stdio stays default)

#### Why this step
The gateway proxies MCP over HTTP(S) to the upstream; theo-rag's MCP server is stdio-only today, so it needs a streamable-HTTP + dev-TLS listener. Reasoning: mirror theo-memory's shipped transport (D3, Rule 9); `createServer(client)` is transport-agnostic, so only the entrypoint gains an HTTP branch — stdio remains the default for backward-compat.

#### Files to edit
- `packages/mcp/src/transports/streamable-http.ts` (NEW); `packages/mcp/src/index.ts`.

#### Deep file dependency analysis
`streamable-http.ts`: `connectStreamableHttp(server, {port, host, tls?})` — `createHttpsServer({cert,key}, handler)` when TLS else `createHttpServer(handler)`; `new StreamableHTTPServerTransport({sessionIdGenerator: () => randomUUID()})`; `server.connect(transport)`. `index.ts`: parse `--transport stdio|streamable-http`, `--port` (default `DEV_RAG_MCP_PORT`/18093), `--host` (default 127.0.0.1), `--tls-cert`/`--tls-key` (both-or-neither); default transport stdio.

#### TDD
- RED: `streamable-http.test.ts` — boot the listener on an ephemeral port with a self-signed cert (generated in the test / fixture); an MCP `initialize` + `tools/list` over HTTPS returns the 5 tool names; the process serves and closes cleanly.
- RED: `index` arg-parsing test — `--transport streamable-http` selects the HTTP path; missing one of `--tls-cert/--tls-key` is a typed error (both-or-neither).
- GREEN: implement the transport + CLI.

#### Concurrency tests
(none — single-threaded) — the SDK owns MCP session concurrency inside the listener.

#### Failure-scenarios chaos pass
`--tls-cert` without `--tls-key` → typed error, non-zero exit (validate at the boundary). TLS cert unreadable → clear error to stderr. Reproduced in the arg-parsing test (xor case).

#### Acceptance criteria
- `pnpm --filter @usetheo/rag-mcp test` green (incl. the HTTPS boot test); stdio path unchanged (existing tests pass); `--transport streamable-http --tls-cert X --tls-key Y` boots an HTTPS MCP listener returning the 5 tools; `--tls-cert` xor `--tls-key` is rejected.

#### DoD
`pnpm --filter @usetheo/rag-mcp test` + `typecheck` green; the HTTPS boot test asserts the 5 tools.

## Phase 4 — theo-workspace: wiring (upstreams + TLS + rag-up.sh --mcp + drift-guard)

### T4.1 — THEO_MCP_UPSTREAMS += rag, TLS mount, rag-up.sh --mcp, drift-guard

#### Why this step
The gateway auto-registers any capability in `THEO_MCP_UPSTREAMS`, so adding `rag` wires the `/mcp/rag` upstream; `rag-up.sh --mcp` boots the rag-mcp HTTP/TLS listener (mirror `memory-up.sh`). Reasoning: config-only + a shell branch; the drift-guard is the static test.

#### Files to edit
- `compose.yaml`; `dev/rag-up.sh`; `dev/check-compose.sh`; (generate `dev/tls/rag-mcp.{crt,key}` like themory's).

#### Deep file dependency analysis
`compose.yaml`: `THEO_MCP_UPSTREAMS` gains `"rag":"https://host.docker.internal:${DEV_RAG_MCP_PORT:-18093}"`; mount the rag-mcp CA like themory (line ~146). `rag-up.sh`: a `--mcp` flag that starts `pnpm --filter @usetheo/rag-mcp start -- --transport streamable-http --host 0.0.0.0 --port 18093 --tls-cert dev/tls/rag-mcp.crt --tls-key dev/tls/rag-mcp.key` (mirror memory-up.sh:136-138). `check-compose.sh`: assert `THEO_MCP_UPSTREAMS` contains `rag` + `DEV_RAG_MCP_PORT`/18093.

#### TDD
The drift-guard is the test: `bash dev/check-compose.sh` asserts the rag MCP upstream; YAML validity; `bash -n dev/rag-up.sh`.

#### Concurrency tests
(none — single-threaded) — static config, no runtime concurrency.

#### Failure-scenarios chaos pass
Removing the rag upstream line → the drift-guard `bad`s (proven by running the guard after the edit).

#### Acceptance criteria
- `THEO_MCP_UPSTREAMS` carries `rag` (18093); `rag-up.sh --mcp` boots the HTTPS MCP listener; `bash dev/check-compose.sh` green; valid YAML; `bash -n` clean.

#### DoD
`bash dev/check-compose.sh` green; YAML valid; `bash -n dev/rag-up.sh` OK.

## Phase 5 — Integration Validation

### T5.1 — All gates green + documented live smoke (+ M18 caveat)

#### Why this step
Prove the full 4-repo change: both Go repos `go test`/`go vet` green, theo-rag vitest+typecheck green, the drift-guard green, YAML valid. Reasoning: the live per-tenant MCP proxy needs the multi-service stack (gateway+broker+rag-mcp+TLS) → documented; the automated hermetic isolation proof is M18.

#### Files to edit
- 4× `CHANGELOG.md` (theo-cloud, theo-traefik-mcp, theo-rag, theo-workspace).

#### Failure-scenarios chaos pass
(covered by the per-repo failure tests: capability fallback, TLS xor, broker-unreachable 503.)

#### Concurrency tests
`go test -race` on theo-traefik-mcp (the mint-cache capability isolation).

#### Acceptance criteria
- theo-traefik-mcp `go test ./... -race` + `go vet` green; theo-cloud `go test ./... ` + `go vet` green; theo-rag `pnpm --filter @usetheo/rag-mcp test` + `typecheck` green; `bash dev/check-compose.sh` green; 4 CHANGELOGs updated; live smoke documented (no-key→401 at `/mcp/rag`; consumer key→minted per-tenant rag key with rag tools; M18 is the automated proof); `/review` = READY_TO_MERGE.

#### DoD
All gates green; 4 CHANGELOGs have the M16 entry.

## Coverage Matrix

| DoD item (ROADMAP M16) | Task(s) |
|---|---|
| `MCPCapabilityBinding["rag"]` in cmd/main.go — ScopeTools read/write/delete | T2.1 |
| `@usetheo/rag-mcp` streamable-HTTP + dev-TLS listener; gateway upstream `/mcp/rag` per-tenant via broker | T3.1 (listener), T1.1 (gateway per-tenant capability), T4.1 (upstream) |
| Go test: rag:read exposes NO write tool; every tool in exactly one bucket | T2.2 |
| theo-cloud CHANGELOG + theo-rag CHANGELOG (HTTP transport); /review READY_TO_MERGE | T5.1 (also theo-traefik-mcp + theo-workspace CHANGELOGs) |

**Coverage: 4/4 DoD items mapped (100%).**

## Failure scenarios

- **Gateway broker unreachable / 5xx:** `BrokerResolver` → `ErrBackendUnavailable` → the gateway 503s (never 401 on a valid key during an outage). Unchanged by M16; the capability-via-context change preserves it. Test: stubbed 503 upstream.
- **Cross-capability cache reuse (security):** without the capability in the cache key, a memory-minted cred could serve a rag request. Mitigated by the composite key; `TestMintCache_IsolatesByCapability` reproduces the attack (same consumer key, two capabilities → two distinct minted creds).
- **rag-mcp TLS misconfig:** `--tls-cert` xor `--tls-key` → typed error, fail-fast at boot (validate at the boundary). Test: the arg-parsing xor case.
- **Empty capability in ctx:** fallback to the constructed default (no empty `X-Theo-Capability`). Test: the fallback case.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A write tool exposed under `rag:read` (confused-deputy) | HIGH | D4 buckets + `TestMCPResolve_Rag_TranslatesDataScopesToTools` (read exposes NO write) | paulohenriquevn |
| Cross-capability cred reuse (memory cred serves rag) | HIGH | D1 mint-cache key includes capability + `TestMintCache_IsolatesByCapability` | paulohenriquevn |
| Tool drift — a new rag tool unmapped | MEDIUM | `TestRagScopeTools_EveryToolInExactlyOneBucket` (union == all tools, each once) | paulohenriquevn |
| The interface-change temptation ripples to 4 resolvers | MEDIUM | D1 capability-via-context leaves static/JWT/reloadable untouched | paulohenriquevn |
| Live e2e not provable without the stack | LOW | Documented; M18 hermetic e2e is the automated proof (invariant #6) | paulohenriquevn |

## Unresolved Questions

(none — every decision is resolved at plan time: capability-via-context (D1), expose-broker (D2), mirror-memory-transport
(D3), rag ScopeTools buckets (D4) are locked by the blueprint. The live per-tenant proxy proof is M18, a named
downstream milestone, not an open question.)

## Global Definition of Done

Per `.claude/rules/architecture.md` (composition-root wiring, DIP), `.claude/rules/testing.md` (TDD RED→GREEN per
task, `go test -race` for the concurrent cache), and `.claude/rules/git-safety.md` (develop-only): all 4 Coverage-Matrix
items delivered; theo-traefik-mcp `go test -race`+`go vet` green (the **lint/quality gate**); theo-cloud `go test`+`go vet`
green; theo-rag `pnpm test`+`typecheck` green; `bash dev/check-compose.sh` green; 4 CHANGELOGs updated; live smoke
documented (+ M18 caveat); `/review` = READY_TO_MERGE. **File-size budget:** every touched/new file stays well under
the 500-LoC budget (`.claude/rules/architecture.md`) — the new `capability_ctx.go` (~15 LoC), `streamable-http.ts`
(~60 LoC mirror), and per-file edits are small; no split needed (KISS).

## Final Phase: Integration Validation

T5.1 is the integration gate — the milestone is NOT complete until both Go repos' `go test`/`go vet`, theo-rag's
vitest+typecheck, and the drift-guard are all green, across all 4 repos. A failing capability-isolation test or a
write-tool-under-read is a blocker, not a caveat.
