# Blueprint: Hermetic ForwardAuth e2e — M18 (edge-integration) [KEYSTONE]

**Slug:** `edge-rag-hermetic-e2e` · **Owner:** paulohenriquevn · **Created:** 2026-07-02 · **Repo:** theo-cloud (native; builds theo-rag from the sibling checkout)

## Context

M18 (deps M11,M12,M13,M14,M15 — all released) is the **non-negotiable proof of invariant #6**: cross-tenant
isolation + the per-verb wall + fail-closed hold END-TO-END through the REAL Traefik edge + REAL ForwardAuth +
a REAL theo-rag container. It mirrors the shipped MEMORY edge e2e (`tests/e2e/edge_forward_auth_e2e_test.go`,
the #113 pattern) exactly. The stack is HERMETIC: container upstreams (`http://rag:8080`, not
`host.docker.internal`), a mock-openai (no real key/network), consumer keys seeded in the CLOUD DB, per-tenant
keys minted by the broker at request time.

## Objective

Give M18's `/to-plan` a citation-backed design for: (a) a `rag` + `pg-rag` + `rag-migrate` service in the e2e
compose (theo-rag built from the sibling checkout, pinned to M11/M12/M13); (b) `rag-edge` + `forward-auth-rag`
+ `rag-rewrite` → `http://rag:8080` in `dynamic.e2e.yml`; (c) `RAG_BASE_URL`+`RAG_PLATFORM_ADMIN_KEY` on the
e2e theo-cloud + the run.sh rag-admin mint; (d) `edge_rag_forward_auth_e2e_test.go` with the 7 assertions;
(e) `make e2e-edge` green (hermetic).

## Coverage Corner 1 — Integration Tests

`tests/e2e/edge_rag_forward_auth_e2e_test.go` (`//go:build e2e`), mirroring `edge_forward_auth_e2e_test.go`
but collections-based (no OpenAI needed — create/list a collection never embeds). Reuses the shared harness
(`requireE2EEdge`, `env`, `mustDo`, `seedUser`, `seedTenant`, `ensureTenantAccount`). Adds `seedRagAPIKey`
(rag-scoped variant of `seedAPIKey` — the CLOUD `theo_api_keys` row with `["rag:read","rag:write"]` or
`["rag:read"]`). The 7 DoD assertions:

1. **Write as B (edge):** `POST {edge}/v1/rag/collections` with bearerB → 201; capture the collection name.
2. **A read → not found (isolation):** `GET {edge}/v1/rag/collections` with bearerA → B's collection ABSENT.
3. **B read → found:** `GET {edge}/v1/rag/collections` with bearerB → B's collection PRESENT (isolation is not a false negative).
4. **Minted rag:read → 403 on write through Traefik (per-verb wall):** a 3rd consumer key with ONLY `["rag:read"]` → `POST {edge}/v1/rag/collections` → 403 (theo-rag's M11 `requireScopeOnPrincipal('rag:write')` denies the minted read-only key).
5. **No-key → 401 at edge:** `POST {edge}/v1/rag/collections` with no Authorization → 401/403 at ForwardAuth (theo-rag never called; no Authorization on the deny).
6. **Direct-to-service no-key → 401:** `POST http://localhost:{E2E_RAG_PORT}/v1/collections` no auth → 401 (theo-rag's M13 `THEORAG_REQUIRE_CREDENTIAL=true` fail-closed).
7. **Minted ≠ customer key:** `POST http://localhost:{E2E_RAG_PORT}/v1/collections` with bearerB (the RAW consumer key) → 401 — theo-rag does NOT recognize the customer key; only the edge-MINTED key works. Combined with assertion 1 (the same write SUCCEEDS through the edge), this proves the edge minted a DIFFERENT valid key (D3 Del-then-set).

## Coverage Corner 2 — Dependencies

**Zero new Go modules; zero new npm deps.** The Go test uses the existing e2e harness + `pgx` (already a dep).
The compose reuses `postgres:*-alpine`, the existing `mock-openai`, Traefik. theo-rag builds from its own
`packages/api/Dockerfile` (existing). `/deps-audit` seed: no NEW dep.

## Coverage Corner 3 — Tools

**Docker Compose + Traefik + psql migrate — all already in the e2e harness.** The one new tool wiring: a
`rag-migrate` one-shot service (a `postgres:*-alpine` running `psql` to apply `00-extensions.sql` + theo-rag's
drizzle migration `.sql` files, mounted from the sibling `packages/core/src/infrastructure/db/migrations/`) —
mirrors theo-cloud's `cloud-migrate` (theo-rag has NO boot-time migrator; its migrations are plain SQL with
`--> statement-breakpoint` comments + idempotent `ON CONFLICT` inserts, psql-safe). `make e2e-edge` (EDGE=1
run.sh) is extended to build the rag image + mint the rag platform-admin.

## Coverage Corner 4 — Techniques

**(a) e2e compose — rag + pg-rag + rag-migrate (mirror themory, ADR D1/D2).**
```yaml
  pg-rag:
    image: postgres:17-alpine
    environment: { POSTGRES_USER: therag, POSTGRES_PASSWORD: therag, POSTGRES_DB: therag }
    healthcheck: { test: ["CMD-SHELL","pg_isready -U therag -d therag"], interval: 2s, retries: 30 }
  rag-migrate:                       # one-shot: apply extensions + theo-rag drizzle SQLs, then exit
    image: postgres:17-alpine
    depends_on: { pg-rag: { condition: service_healthy } }
    volumes:
      - ./sql/rag/00-extensions.sql:/mig/00-extensions.sql:ro
      - ../../../../theo-data/theo-rag/packages/core/src/infrastructure/db/migrations:/mig/drizzle:ro
    entrypoint: ["sh","-c","for f in /mig/00-extensions.sql $(ls /mig/drizzle/*.sql | sort); do psql \"$$THEORAG_PG_URI\" -v ON_ERROR_STOP=1 -f \"$$f\"; done"]
    environment: { THEORAG_PG_URI: postgres://therag:therag@pg-rag:5432/therag }
  rag:
    image: theo-rag-e2e:latest       # built from the sibling checkout (pinned M11/M12/M13) — D1
    depends_on: { rag-migrate: { condition: service_completed_successfully }, mock-openai: { condition: service_healthy } }
    environment:
      PORT: "8080"
      THEORAG_PG_URI: postgres://therag:therag@pg-rag:5432/therag
      THEORAG_ADMIN_BOOTSTRAP_TOKEN: ${THEORAG_ADMIN_BOOTSTRAP_TOKEN:?defina com >= 32 chars — sem default}
      THEORAG_REQUIRE_CREDENTIAL: "true"     # M13 fail-closed — the direct-to-service 401 proof (D4)
      OPENAI_API_KEY: dummy-key-for-mock
      OPENAI_BASE_URL: http://mock-openai:11434/v1
    ports: [ "${E2E_RAG_PORT:-18082}:8080" ]
    healthcheck: { test: ["CMD","node","-e","fetch('http://127.0.0.1:8080/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: 2s, retries: 30 }
```
`00-extensions.sql`: `CREATE EXTENSION IF NOT EXISTS vector;` (theo-rag's 0000 migration uses the `vector`
type + an HNSW index — the extension MUST precede).

**(b) theo-cloud e2e env — the rag broker (mirror THEMORY_*).**
```yaml
  theo-cloud:
    environment:
      RAG_BASE_URL: http://rag:8080
      RAG_PLATFORM_ADMIN_KEY: ${RAG_PLATFORM_ADMIN_KEY:-}   # minted at setup via the rag bootstrap token
```

**(c) dynamic.e2e.yml — rag-edge (mirror memory-edge, /v1-preserving rewrite).**
```yaml
  routers:
    rag-edge:
      priority: 92                    # non-colliding with memory-edge(100)
      rule: "PathPrefix(`/v1/rag`)"
      entryPoints: [web]
      service: rag
      middlewares: [forward-auth-rag, rag-rewrite]
  middlewares:
    forward-auth-rag:
      forwardAuth:
        address: "http://theo-cloud:13002/internal/authz/forward-rag"
        authResponseHeaders: ["Authorization"]
        trustForwardHeader: false
    rag-rewrite:
      replacePathRegex: { regex: "^/v1/rag/(.*)", replacement: "/v1/$1" }
  services:
    rag:
      loadBalancer: { servers: [ { url: "http://rag:8080" } ] }
```

**(d) run.sh — build rag image + mint the rag platform-admin (mirror themory, ADR D1).**
```bash
# build the rag image from the sibling checkout (pinned local source; M11/M12/M13 present).
THEORAG_DIR="${THEORAG_DIR:-$ROOT/../../theo-data/theo-rag}"
docker build -t theo-rag-e2e:latest -f "$THEORAG_DIR/packages/api/Dockerfile" "$THEORAG_DIR"
# after the stack is up, mint the rag platform-admin from the bootstrap token (one-shot; consume-first).
if [ -z "${RAG_PLATFORM_ADMIN_KEY:-}" ]; then
  RAG_PLATFORM_ADMIN_KEY="$(curl -s -X POST "http://localhost:${E2E_RAG_PORT}/v1/admin/keys" \
    -H "Authorization: Bearer ${THEORAG_ADMIN_BOOTSTRAP_TOKEN}" -H 'Content-Type: application/json' \
    -d '{"name":"theo-cloud-rag-admin","workspace_id":"default","scopes":["rag:platform-admin","rag:admin","rag:read","rag:write","rag:delete"]}' \
    | sed -n 's/.*"raw_key":"\([^"]*\)".*/\1/p')"
  [ -n "$RAG_PLATFORM_ADMIN_KEY" ] || { echo "could not mint rag platform-admin"; exit 1; }
  export RAG_PLATFORM_ADMIN_KEY
  docker compose ... up -d --no-deps --force-recreate theo-cloud   # inject the minted key
fi
```
Note the theo-rag mint returns `raw_key` (nested, M12) — NOT themory's flat `secret` (the M14/M15 trap).

## Cross-cutting Comparison

| Dimension | memory edge e2e (reference) | rag edge e2e (M18) |
|---|---|---|
| upstream | `themory` container `:8080` | `rag` container `:8080` |
| build source | `THEMORY_DIR` sibling | `THEORAG_DIR` sibling (pinned M11-M13) |
| migrations | themory container self-migrates | `rag-migrate` one-shot (psql applies drizzle SQLs) |
| edge path | `/v1/memory/*` → `/v1/*` (memory-rewrite) | `/v1/rag/*` → `/v1/*` (rag-rewrite) |
| forward-auth | `/internal/authz/forward` | `/internal/authz/forward-rag` |
| broker env | `THEMORY_BASE_URL`+`THEMORY_PLATFORM_ADMIN_KEY` | `RAG_BASE_URL`+`RAG_PLATFORM_ADMIN_KEY` |
| mint response | flat `{secret}` | nested `{key, raw_key}` (M12) |
| data op tested | remember/recall (needs embed → mock-openai) | collections CRUD (NO embed — pure isolation) |
| fail-closed direct | themory | theo-rag `THEORAG_REQUIRE_CREDENTIAL=true` (M13) |
| consumer key scopes | `memory:read/write/delete` | `rag:read/write` (+ a `rag:read`-only key for the per-verb 403) |

## ADRs

### D1 — build theo-rag from the sibling checkout, pinned (NOT GHCR :develop)
**Decision:** `docker build -t theo-rag-e2e:latest -f $THEORAG_DIR/packages/api/Dockerfile $THEORAG_DIR` from the local sibling checkout (currently M11/M12/M13 released at rc.47).
**Rationale:** the DoD forbids a floating GHCR `:develop` (a hermetic proof must pin the source under test). Mirrors run.sh's themory build from `THEMORY_DIR`. The local checkout IS the pinned ref.
**Alternatives:** pull GHCR `:develop` (rejected — floating, non-hermetic, may lag the source).

### D2 — apply theo-rag's schema via a `rag-migrate` one-shot (psql), not a boot migrator
**Decision:** a `postgres:alpine` one-shot applies `00-extensions.sql` + theo-rag's drizzle migration `.sql`
files (mounted from the sibling) in sorted order; `rag` `depends_on: rag-migrate: service_completed_successfully`.
**Rationale:** theo-rag has NO boot-time migration runner (drizzle emits SQL; CONTRIBUTING notes manual apply).
The SQLs are plain + idempotent (`ON CONFLICT`, `--> statement-breakpoint` comments psql ignores). Mirrors
theo-cloud's `cloud-migrate`. The `vector` extension must precede 0000 (which uses the vector type + HNSW index).
**Alternatives:** run `drizzle-kit push` in a node container (rejected — heavier, needs the toolchain in the e2e); mount migrations into pg initdb (rejected — mounting a file + a dir into the same initdb dir is fragile).

### D3 — hermetic mint proof: direct-with-consumer-key → 401 proves minted ≠ customer
**Decision:** assertion 7 sends the RAW consumer key directly to `rag:8080/v1/collections` → 401; the same key through the edge → 201 (assertion 1).
**Rationale:** theo-rag does not know the customer's `theo_live_*_e2e` key (it lives in the CLOUD DB); only the edge-minted per-tenant key resolves in theo-rag. A direct-with-consumer-key 401 + an edge-write 201 together prove the edge Del-then-set a DIFFERENT valid key (the #113 minted≠customer proof adapted to rag).
**Alternatives:** echo the upstream Authorization from theo-rag (rejected — a test-only backdoor; the 401/201 contrast is the honest proof).

### D4 — theo-rag runs with THEORAG_REQUIRE_CREDENTIAL=true (M13) in the e2e
**Decision:** the `rag` service sets `THEORAG_REQUIRE_CREDENTIAL=true`.
**Rationale:** the direct-to-service no-key → 401 proof (assertion 6) requires theo-rag's M13 fail-closed mode; without it a no-key direct request would resolve a default owner Principal (dev mode) → not a 401. This is the whole point of M13 being a dependency.
**Alternatives:** leave it unset (rejected — the direct-401 proof would fail; M13 is a declared dependency).

## Recommendations

1. **compose** — add `pg-rag` + `rag-migrate` + `rag` (+ theo-cloud RAG_* env) to the e2e edge stack. (Corner 4a/4b, D1/D2/D4)
2. **traefik** — add `rag-edge` + `forward-auth-rag` + `rag-rewrite` → `http://rag:8080`. (Corner 4c)
3. **run.sh** — build `theo-rag-e2e` from the sibling + mint the rag platform-admin (raw_key) + recreate theo-cloud. (Corner 4d, D1)
4. **test** — `edge_rag_forward_auth_e2e_test.go` with the 7 assertions + `seedRagAPIKey`. (Corner 1)
5. **CHANGELOG** — theo-cloud entry; `make e2e-edge` green.

### Blocked questions

None — every surface is grounded in file:line (theo-cloud e2e harness + compose + dynamic + run.sh; theo-rag
Dockerfile + migrations + collections routes + M12 mint + M13 require-credential + scope-hierarchy). Honest
caveat: none — M18 IS the hermetic automated proof (no live-stack caveat; that was M15/M16/M17's deferral,
which M18 closes).
