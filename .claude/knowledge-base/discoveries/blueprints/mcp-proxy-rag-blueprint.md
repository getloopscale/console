# Blueprint: MCP proxy end-to-end via the MCP gateway — M16 (edge-integration)

**Slug:** `mcp-proxy-rag` · **Owner:** paulohenriquevn · **Created:** 2026-07-02 · **Repos:** theo-cloud (native) + theo-traefik-mcp + theo-rag + theo-workspace

## Context

M16 (deps M14 — the theo-cloud rag broker; M11 — theo-rag per-verb scope) exposes theo-rag's MCP tools
per-tenant through the **Theo MCP Gateway** (`theo-traefik-mcp`, `/mcp/*` → theo-cloud
`/internal/authz/mcp-resolve`), NOT the REST forward-auth edge. DISCOVER surfaced a scope-defining fact:
the gateway is a **walking skeleton hardcoded to `brokerCapability = "memory"`**
(`theo-traefik-mcp/cmd/theo-mcp-gateway/main.go:65,673`) — its own comment says *"multi-capability
(capability-via-context) is a follow-up"* (`main.go:668-670`). So `/mcp/rag` today would resolve against
the **memory** binding (wrong key + wrong tools — a cross-capability defect). M16 is that follow-up and
spans 4 repos.

## Objective

Give M16's `/to-plan` a citation-backed design for: (a) theo-traefik-mcp **capability-via-context** so the
broker resolver sends the per-request `X-Theo-Capability` (+ cache key includes capability); (b) theo-cloud
`MCPCapabilityBinding["rag"]` with the `ragBroker` as Minter and the read/write/delete `ScopeTools` map + the
one-bucket/allowlist Go test; (c) a theo-rag `@usetheo/rag-mcp` streamable-HTTP + dev-TLS listener (today
stdio); (d) theo-workspace `THEO_MCP_UPSTREAMS += rag` + TLS mount + `rag-up.sh --mcp`.

## Coverage Corner 1 — Integration Tests

The M16 test set (per repo):

- **theo-cloud (Go, unit — 100% offline):**
  - `TestMCPResolve_Rag_TranslatesDataScopesToTools` — a `rag:read` key exposes ONLY `{ask,list_collections,retrieve}`; a `rag:read+rag:write` key adds `{create_collection,ingest_document}`; NO write tool ever appears under read-only. Mirrors `mcp_resolve_test.go:81 TestMCPResolve_Allow_TranslatesDataScopesToTools` (memory).
  - `TestRagScopeTools_EveryToolInExactlyOneBucket` — static assertion over the rag `ScopeTools` map: every `@usetheo/rag-mcp` tool name appears in exactly one scope bucket; no tool unmapped; no tool double-mapped (the "tool drift" guard, roadmap risk 2).
  - `TestBuildRagForwardAuth_ExposesBroker` — the refactor returns the broker so both ForwardAuth (M14) and the MCP binding share ONE broker; nil-when-unset preserved.
- **theo-traefik-mcp (Go, unit — 100% offline):**
  - `TestBrokerResolver_UsesCapabilityFromContext` — `resolveRemote` sends `X-Theo-Capability: <ctx capability>` (rag), not the constructed default; a `httptest.Server` asserts the header per capability.
  - `TestMintCache_IsolatesByCapability` — a memory-minted cred is NEVER served for a rag request with the same consumer key (cache key = `capability\x00apiKey`). Cross-capability cache-collision guard (security).
  - `TestGateway_RoutesCapabilityToResolver` — `/mcp/rag/...` puts `rag` in the context the resolver reads.
- **theo-rag (TS/vitest — offline + a real HTTP+TLS boot):**
  - `streamable-http` transport test: the listener boots on an ephemeral port with a self-signed cert, an MCP `initialize` handshake over HTTPS returns the 5 tools; stdio path unchanged.
  - `--transport streamable-http` CLI parsing test (flag → transport selection, mirrors themory).
- **theo-workspace (drift-guard):** `check-compose.sh` asserts `THEO_MCP_UPSTREAMS` carries `"rag"` + the rag-mcp TLS cert is mounted.
- **Live e2e (deferred to M18):** the real per-tenant MCP proxy (gateway + broker + rag-mcp + TLS) through `make e2e-edge`. M16 ships the unit/integration proofs + static config; the hermetic isolation proof is M18 (invariant #6), as with M15.

## Coverage Corner 2 — Dependencies

**Zero new Go modules.** theo-cloud reuses the existing `rag.NewBroker` (M14) + `routes.MCPCapabilityBinding`
(shipped for memory). theo-traefik-mcp reuses its own `BrokerResolver`/`mintCache` (only adds a context key +
cache-key composition — stdlib `context`). **Zero new npm runtime deps** in theo-rag: the streamable-HTTP
transport is `@modelcontextprotocol/sdk/server/streamableHttp.js` (the SDK, `^1.29.0`, already a dep) + Node
built-ins `node:http`/`node:https`/`node:crypto`. `/deps-audit` seed: no NEW dep in any repo.

## Coverage Corner 3 — Tools

**Dev-TLS + drift-guard.** theo-rag's MCP HTTP listener needs a self-signed dev cert (mirror theo-memory's
`dev/tls/themory-mcp.{crt,key}` referenced by `memory-up.sh:136-138`). theo-workspace generates/mounts a
`rag-mcp.{crt,key}` and adds a `--mcp` mode to `rag-up.sh` (mirror `memory-up.sh`). The gateway file-provider
+ compose recreate caveat is unchanged (inode). `bash dev/check-compose.sh` is the static drift-guard runner.
No new tooling.

## Coverage Corner 4 — Techniques

**(a) theo-traefik-mcp — capability-via-context (ADR D1).** The Gateway's `ServeHTTP` already parses the
capability from the path (`proxy.go:189 parsePath`). Put it in the request context; `BrokerResolver.resolveRemote`
reads it for the `X-Theo-Capability` header AND the mint-cache key, falling back to the constructed `r.capability`
(backward-compat, single-cap boot). Interface `CredentialResolver.Resolve(ctx,key)` UNCHANGED — static/JWT/reloadable
resolvers ignore the context value.
```go
// internal/auth/capability_ctx.go (NEW)
type capKey struct{}
func WithCapability(ctx context.Context, cap string) context.Context { return context.WithValue(ctx, capKey{}, cap) }
func capabilityFromContext(ctx context.Context, fallback string) string {
    if v, ok := ctx.Value(capKey{}).(string); ok && v != "" { return v }
    return fallback
}
// resolveRemote: cap := capabilityFromContext(ctx, r.capability); req.Header.Set("X-Theo-Capability", cap)
// mintCache.getOrResolve key: cap + "\x00" + apiKey   (cross-capability isolation)
// proxy.go ServeHTTP: ctx := auth.WithCapability(r.Context(), capability); cred, err := g.resolver.Resolve(ctx, key)
```

**(b) theo-cloud — expose ragBroker + MCPCapabilityBinding["rag"] (ADR D2, D4).** Refactor
`buildRagForwardAuth` to return the broker so ONE broker serves both ForwardAuth (M14) and the MCP binding:
```go
// cmd/main.go — buildRagForwardAuth now returns (*ForwardAuthHandler, TenantKeyMinter, error)
//   nil,nil,nil when RAG_BASE_URL unset; nil,nil,err on broker-construct failure; handler,broker,nil configured.
// In main(), when ragBroker != nil, add to the mcpResolve caps map:
"rag": {Minter: ragBroker, RequiredScope: "rag:read", ScopeTools: map[string][]string{
    "rag:read":   {"ask", "list_collections", "retrieve"},
    "rag:write":  {"create_collection", "ingest_document"},
    "rag:delete": {},   // no delete tool in @usetheo/rag-mcp today (D4)
}},
```

**(c) theo-rag — @usetheo/rag-mcp streamable-HTTP + dev-TLS listener (ADR D3).** Mirror theo-memory's
`packages/mcp/src/transports/streamable-http.ts` (`StreamableHTTPServerTransport` +
`createHttpsServer({cert,key})` when TLS, else `createHttpServer`; `sessionIdGenerator: randomUUID`). Add a
`--transport streamable-http --host --port --tls-cert --tls-key` CLI (theo-rag's `src/index.ts` today
hardcodes `StdioServerTransport`). The `createServer(client)` factory (`packages/mcp/src/server.ts`) is
transport-agnostic (DIP) — only the entrypoint changes. Port default `18082`'s MCP sibling → `DEV_RAG_MCP_PORT` (18093).

**(d) theo-workspace — THEO_MCP_UPSTREAMS += rag.** The gateway auto-registers any capability in the env map
(`parseUpstreams`, `main.go:533`); NO gateway rebuild for the upstream itself (only the resolver code change in (a)):
```yaml
THEO_MCP_UPSTREAMS: '{"memory":"https://host.docker.internal:${DEV_THEMORY_MCP_PORT:-18091}","rag":"https://host.docker.internal:${DEV_RAG_MCP_PORT:-18093}"}'
```

## Cross-cutting Comparison

| Dimension | memory (reference) | rag (M16) |
|---|---|---|
| MCP binding | `MCPCapabilityBinding["memory"]`, `themoryBroker` | `["rag"]`, `ragBroker` (exposed from buildRagForwardAuth) |
| RequiredScope | `memory:read` | `rag:read` |
| ScopeTools read | recall/episodes/search_memory/list_memories | ask/list_collections/retrieve |
| ScopeTools write | remember/reflect/add_skill/… | create_collection/ingest_document |
| ScopeTools delete | forget/forget_skill/delete_memories | (none — no rag delete tool yet) |
| gateway capability | hardcoded `brokerCapability="memory"` | **capability-via-context** (both, D1) |
| MCP transport | streamable-http + dev-TLS (shipped) | NEW streamable-http + dev-TLS listener (D3) |
| upstream | THEO_MCP_UPSTREAMS memory:18091 | += rag:18093 |
| new deps | — | none |

## ADRs

### D1 — theo-traefik-mcp multi-capability via context (not an interface change)
**Decision:** carry the parsed capability in the request context; `BrokerResolver` reads it for the
`X-Theo-Capability` header + the mint-cache key (`capability\x00apiKey`); fallback to the constructed default.
**Rationale:** the interface `CredentialResolver.Resolve(ctx,key)` is shared by static/JWT/reloadable resolvers
that are capability-agnostic; a context value leaves them untouched and matches the author's own note
("capability-via-context is a follow-up", `main.go:668-670`). The cache-key composition is a SECURITY
requirement — without it a memory-minted cred could be served for a rag request (cross-capability collision).
**Alternatives:** interface change `Resolve(ctx,key,cap)` (rejected — ripples to StaticResolver/JWTResolver/Reloadable/mocks for a value 3 of 4 ignore); a per-capability resolver map in the Gateway (rejected — duplicates the JWT-chain wrapping + reloadable snapshot per capability).

### D2 — expose ragBroker from buildRagForwardAuth (one broker, two consumers)
**Decision:** `buildRagForwardAuth` returns `(*ForwardAuthHandler, TenantKeyMinter, error)`; main() feeds the
same broker to the ForwardAuth handler AND the MCP binding.
**Rationale:** mirrors memory (`themoryBroker` at main scope feeds both `NewForwardAuthHandler` and the MCP
binding). ONE broker = ONE mint cache = consistent per-tenant keys across REST + MCP. Preserves M14's
nil-when-unset / refuse-to-start branches (still unit-tested).
**Alternatives:** build a second rag broker at main scope for MCP (rejected — two caches, duplicated nil/refuse logic, drift risk).

### D3 — rag-mcp HTTP/TLS listener mirrors theo-memory's transport (Rule 9)
**Decision:** copy theo-memory's `streamable-http.ts` transport shape + the `--transport/--port/--host/--tls-cert/--tls-key`
CLI; keep stdio as the default (backward-compat).
**Rationale:** theo-memory's streamable-HTTP+TLS MCP listener is production-shipped; re-deriving invites drift
(Rule 9). `createServer(client)` is already transport-agnostic (DIP) — only the entrypoint gains an HTTP branch.
**Alternatives:** hand-roll an HTTP transport (rejected — Rule 9; the SDK ships `StreamableHTTPServerTransport`).

### D4 — rag ScopeTools buckets (read/write/delete), delete empty today
**Decision:** `rag:read`→{ask,list_collections,retrieve}; `rag:write`→{create_collection,ingest_document};
`rag:delete`→{} (empty — `@usetheo/rag-mcp` has no delete tool yet).
**Rationale:** the 5 tools' verbs are unambiguous (ask/retrieve/list = read; create/ingest = write). An empty
delete bucket is honest (no tool) and keeps the map ready when a delete tool lands. The one-bucket test asserts
every tool is mapped exactly once.
**Alternatives:** omit the delete key (rejected — the test + future-proofing want all three data scopes present).

## Recommendations

1. **theo-traefik-mcp** — add `capability_ctx.go` + read it in `BrokerResolver` (header + cache key); Gateway puts capability in ctx. (Corner 4a, D1)
2. **theo-cloud** — refactor `buildRagForwardAuth` to expose the broker; add `MCPCapabilityBinding["rag"]`; add the two Go tests. (Corner 4b, D2, D4)
3. **theo-rag** — add the streamable-HTTP + dev-TLS listener + CLI; keep stdio default; vitest boot test. (Corner 4c, D3)
4. **theo-workspace** — `THEO_MCP_UPSTREAMS += rag`, mount rag-mcp TLS, `rag-up.sh --mcp`, drift-guard. (Corner 4d)
5. **Live smoke** — document + attempt via the stack; note M18 hermetic e2e is the automated proof. (Corner 1)

### Blocked questions

None — every surface is grounded in file:line evidence (theo-cloud mcp_resolve.go + main.go; theo-traefik-mcp
proxy.go + broker_resolver.go + main.go; theo-rag packages/mcp; theo-memory streamable-http.ts + run-mcp-server.ts;
theo-workspace compose.yaml). Honest caveat: the live per-tenant MCP proxy needs the multi-service stack — M16
ships the unit/integration proofs + static config; the automated isolation proof is M18.
