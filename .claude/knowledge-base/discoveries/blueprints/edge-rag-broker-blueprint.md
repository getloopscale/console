# Blueprint: Model-B RAG broker + ForwardAuth wiring — M14 (edge-integration)

**Slug:** `edge-rag-broker` · **Owner:** paulohenriquevn · **Created:** 2026-07-02 · **Repo:** theo-cloud (Go, native)

## Context

M14 (deps M12 — theo-rag mint shipped in v0.0.0-rc.45) is the first theo-cloud-native edge-integration
milestone: the Model-B credential broker that mints per-tenant `rag_live_*` keys so Traefik ForwardAuth can
strip the customer key and inject a gateway-minted per-tenant key (CWE-441 edge half). theo-cloud already
has TWO working brokers — `internal/themory/*` (reference) + `internal/promptly/*` (2nd copy). M14 adds a
THIRD, `internal/rag/`, following the exact pattern. The generic handler
`routes.NewForwardAuthHandler(resolve, minter, authorize, requiredScope, logger)`
(`internal/routes/forward_auth.go:64`) is wired with a rag instance. The `broker.go` is response-shape
agnostic (it only uses the `minter` interface + `MintResult.Secret`), so it copies verbatim; the
`admin_client.go` is where theo-rag's NESTED `{key, raw_key}` response is parsed (the one real adaptation).

## Objective

Give M14's `/to-plan` a citation-backed Go design for `internal/rag/{admin_client,broker}.go`, the config,
the `cmd/main.go` wiring + forward-rag route, and the test matrix.

## Coverage Corner 1 — Integration Tests

theo-cloud co-locates Go tests beside sources (`internal/themory/{broker,admin_client}_test.go`). The M14
set (`.claude/rules/testing.md`, both lenses):

- **admin_client response parse (EC-1):** an `httptest` server returns theo-rag's EXACT shape
  `{"key":{"id":"akey_x","scopes":["rag:read"]},"raw_key":"rag_live_abc"}`; assert `MintKey` returns
  `MintResult{ID:"akey_x", Secret:"rag_live_abc", Scopes:["rag:read"]}` — NOT empty. Request assertions:
  `POST /v1/admin/keys`, body `{"name","scopes","workspace_id"}`, header `Authorization: Bearer <platformKey>`.
- **broker least-privilege intersect:** `KeyForTenantScoped(want=["rag:read"])` with `allowed=["rag:read","rag:write","rag:delete"]` → mints ONLY `["rag:read"]`; the stub minter records the scopes it was asked to mint.
- **broker singleflight:** N concurrent `KeyForTenantScoped` for a cold (tenant,scopes) → the stub minter is called EXACTLY once.
- **broker fail-closed (EC-2):** (a) mint error → `("", error)`, no cache write (a subsequent call re-mints); (b) empty `intersect(want, allowed)` → `("", error)`, minter NEVER called; (c) empty tenant id → error.
- **minted ≠ platform (EC-3):** the broker's returned secret (`rag_live_*`) is distinct from `RAG_PLATFORM_ADMIN_KEY`; the Broker has no field holding the platform key (structural — only the AdminClient does).
- **config validate + refuse-to-start (EC-4):** `RAG_BASE_URL` set + empty `RAG_PLATFORM_ADMIN_KEY` in prod → `Validate()` error; `cmd/main.go` refuses to start on `rag.NewBroker` error (boot-failure test / the main-wiring returns the error rather than nil-skipping).
- **TTL cache:** an injected clock proves a cached secret past `ttl` re-mints.

## Coverage Corner 2 — Dependencies

**Zero new runtime dependencies.** `golang.org/x/sync/singleflight` + `github.com/hashicorp/golang-lru/v2`
are already in `go.mod` (used by themory/promptly). The admin_client uses only stdlib (`net/http`,
`encoding/json`, `context`). `/deps-audit` seed: no NEW module.

## Coverage Corner 3 — Tools

**`go test ./...` + `go vet ./...`.** The forward-rag route mounts alongside the existing forward-auth
routes: `cmd/main.go:470-478` registers `routes.AuthzForwardPath` (themory) + `routes.AuthzForwardPromptlyPath`
(promptly) via `r.Get/r.Post`. M14 adds `routes.AuthzForwardRagPath = "/internal/authz/forward-rag"` (a new
const in `internal/routes/forward_auth.go` or the routes constants file) + `r.Get/r.Post(routes.AuthzForwardRagPath, ragForwardAuthHandler.ServeHTTP)` guarded by `if ragForwardAuthHandler != nil`. No new tooling.

## Coverage Corner 4 — Techniques

**(a) `internal/rag/admin_client.go` — copy themory + ADAPT the response parse (EC-1, ADR D2).**
Copy `internal/themory/admin_client.go` (`AdminClient{baseURL, platformKey, httpClient}`, `NewAdminClient`,
`do()` with `Authorization: Bearer <platformKey>`, `Error`/`ErrNotFound`). Change:
- `MintKey(ctx, workspaceID, name string, scopes []string)` sends `map[string]any{"name":name,"scopes":scopes,"workspace_id":workspaceID}` to `POST /v1/admin/keys` (unchanged).
- **MintResult + parse (the adaptation):**
```go
type MintResult struct { ID string; Secret string; Scopes []string }
type mintResponse struct {
    Key    struct { ID string `json:"id"`; Scopes []string `json:"scopes"` } `json:"key"`
    RawKey string `json:"raw_key"`
}
func (a *AdminClient) MintKey(ctx context.Context, workspaceID, name string, scopes []string) (*MintResult, error) {
    var resp mintResponse
    if err := a.do(ctx, http.MethodPost, "/v1/admin/keys", map[string]any{"name": name, "scopes": scopes, "workspace_id": workspaceID}, &resp); err != nil {
        return nil, err
    }
    return &MintResult{ID: resp.Key.ID, Secret: resp.RawKey, Scopes: resp.Key.Scopes}, nil
}
```
The platform key lives ONLY here (control plane); no data-plane client references it (NIST AC-5/6).

**(b) `internal/rag/broker.go` — verbatim copy (memory:→rag:, ADR D2).**
Copy `internal/themory/broker.go` byte-for-byte, changing only the package name (`rag`) + the error-message
prefix (`themory broker:` → `rag broker:`). Keep `minter` interface, `cachedSecret`, `Broker`, `NewBroker(admin, size, ttl, scopes)`,
`KeyForTenant`, `KeyForTenantScoped(want)` (with `intersectScopes(want, b.scopes)`, empty-scope + empty-tenant
fail-closed, singleflight, cache key `account\x00tenant\x00scopes`), `intersectScopes`, `Evict`. It reads
`r.Secret` from `MintResult` — which the adapted admin_client fills from `raw_key`. No logic change.

**(c) `internal/config/config.go` — `RagBaseURL` + `RagPlatformAdminKey` (ADR D3).**
Add fields mirroring `PromptlyBaseURL`/`PromptlyPlatformAdminKey` (`config.go:118-128`):
```go
RagBaseURL          string  // env RAG_BASE_URL (default "")
RagPlatformAdminKey Secret  // env RAG_PLATFORM_ADMIN_KEY
```
Load: `cfg.RagBaseURL = envOr("RAG_BASE_URL", "")`; `cfg.RagPlatformAdminKey = Secret(envOr("RAG_PLATFORM_ADMIN_KEY", ""))`.
Validate (mirror `config.go:231`): in prod, `RagBaseURL != "" && RagPlatformAdminKey == "" → error` (base-url set ⇒ admin-key required).

**(d) `cmd/main.go` — construct broker + register forward-rag (mirror themory `:244-284`, ADR D3).**
```go
var ragForwardAuthHandler *routes.ForwardAuthHandler
if cfg.RagBaseURL != "" {
    ragHTTP := &http.Client{ Timeout: 10 * time.Second /* + transport limits like themory */ }
    ragAdmin := rag.NewAdminClient(cfg.RagBaseURL, cfg.RagPlatformAdminKey.Value(), ragHTTP)
    ragBroker, brErr := rag.NewBroker(ragAdmin, 1024, time.Hour, []string{"rag:read","rag:write","rag:delete"})
    if brErr != nil {
        return fmt.Errorf("rag broker: %w", brErr) // REFUSE TO START (never nil-skip)
    }
    ragForwardAuthHandler = routes.NewForwardAuthHandler(resolve, ragBroker, auth.AccountOwnsTenant, "rag:read", logger)
}
// ... route mount:
if ragForwardAuthHandler != nil {
    r.Get(routes.AuthzForwardRagPath, ragForwardAuthHandler.ServeHTTP)
    r.Post(routes.AuthzForwardRagPath, ragForwardAuthHandler.ServeHTTP)
}
```
`resolve` + `auth.AccountOwnsTenant` are the SAME collaborators the themory handler uses (`main.go:284`). The
required scope is `"rag:read"` (the edge gate; the broker mints the consumer's OWN scopes least-privilege).

## Cross-cutting Comparison

| Dimension | themory (reference) | rag (M14) |
|---|---|---|
| AdminClient | holds platform key, MintKey→POST `/v1/admin/keys` | identical request; **response parse differs** |
| MintResult | flat `{id, secret}` | **nested `{key:{id,scopes}, raw_key}` → mapped to `{ID, Secret, Scopes}`** |
| Broker | LRU+singleflight+fail-closed+intersect | verbatim copy |
| config | `THEMORY_BASE_URL`+`THEMORY_PLATFORM_ADMIN_KEY` | `RAG_BASE_URL`+`RAG_PLATFORM_ADMIN_KEY` |
| forward-auth | `NewForwardAuthHandler(resolve, broker, auth, "memory:read", log)` | `(resolve, ragBroker, auth, "rag:read", log)` |
| data-plane client.go | present (proxies memory data) | **out of scope** (edge/Traefik proxies) |
| new deps | none | none |

## ADRs

### D1 — Copy the broker verbatim; `client.go` out of scope
**Decision:** `broker.go` is a byte-for-byte copy (package + error-prefix only); `internal/rag/client.go` is NOT created.
**Rationale:** the broker's least-privilege/singleflight/fail-closed is production-validated across themory+promptly; re-deriving invites drift (Rule 9). Model B: the edge forwards with the injected key — no Go data-plane client is needed (YAGNI).
**Alternatives considered:** create a rag data-plane client mirroring themory's (rejected — YAGNI, the edge proxies).

### D2 — Adapt ONLY the admin_client's response parse to theo-rag's `{key, raw_key}`
**Decision:** `MintResult` is `{ID, Secret, Scopes}`; `MintKey` unmarshals theo-rag's nested `{key:{id,scopes}, raw_key}` and maps `raw_key→Secret`, `key.id→ID`, `key.scopes→Scopes`.
**Rationale:** theo-rag M12 returns `CreateApiKeyResult{key, raw_key}` (verified `admin-keys.ts:130`) — a verbatim flat-`{id,secret}` copy would cache an EMPTY secret and 401 the whole edge (EC-1). Isolating the delta in the admin_client keeps the broker a pure copy.
**Alternatives considered:** change the broker to read a nested field (rejected — couples the broker to the shape); change theo-rag M12 to a flat response (rejected — shipped/released contract, breaking + wrong repo).

### D3 — Config gated + refuse-to-start; least-privilege mint of the consumer's own scopes
**Decision:** `RagBaseURL` unset → the rag forward-auth is not wired (no-op); set → `RagPlatformAdminKey` required in prod; a broker construction error REFUSES to start (never nil-skips). The handler passes `"rag:read"` as the edge gate; the broker mints `intersect(consumer scopes, {read,write,delete})`.
**Rationale:** mirrors themory/promptly exactly; refuse-to-start prevents a silent unauthenticated edge (fail-closed at boot). Least-privilege mint closes intra-tenant scope escalation.
**Alternatives considered:** default-on rag wiring (rejected — an operator without theo-rag deployed would fail); mint full scopes always (rejected — least-privilege breach).

## Recommendations

1. **`internal/rag/admin_client.go`** — copy themory + the adapted `MintResult`/`mintResponse` parse (EC-1). (Corner 4a, D2)
2. **`internal/rag/broker.go`** — verbatim copy (package + error-prefix), preserving empty-scope/empty-tenant fail-closed (EC-2). (Corner 4b, D1)
3. **`internal/config/config.go`** — `RagBaseURL`+`RagPlatformAdminKey` + prod validate (base-url ⇒ admin-key). (Corner 4c, D3)
4. **`internal/routes/` const** — `AuthzForwardRagPath = "/internal/authz/forward-rag"`. (Corner 3)
5. **`cmd/main.go`** — construct rag broker (refuse-to-start) + `NewForwardAuthHandler(resolve, ragBroker, auth.AccountOwnsTenant, "rag:read", logger)` + route mount. (Corner 4d, D3)
6. **Tests** (Corner 1): admin_client parses theo-rag `{key,raw_key}`; broker least-privilege/singleflight/fail-closed/TTL; minted≠platform; config validate + refuse-to-start.

### Blocked questions

None — all 6 research questions answered with resolving citations (theo-cloud themory/promptly + theo-rag
M12 `admin-keys.ts`/`api-keys-store.ts`, all verified). Honest caveat: reference is sibling-repo + in-repo
(not a `references/` clone), so citation-density reads low — expected for a "copy the sibling broker" milestone.
