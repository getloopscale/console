---
slug: edge-rag-hermetic-e2e
milestone_id: M18
roadmap: ../../../theo-data/theo-rag/ROADMAP-edge-integration.md
created_at: 2026-07-02
goal: Prove rag ForwardAuth isolation END-TO-END through the real Traefik edge with a hermetic stack (rag+pg-rag+rag-migrate containers, theo-rag built from the sibling checkout) — add rag-edge to dynamic.e2e.yml, the rag services + RAG_* env to the edge overlay, the rag admin mint to run.sh, and edge_rag_forward_auth_e2e_test.go with 7 assertions — verified by make e2e-edge green.
---

# Plan: Hermetic ForwardAuth e2e — M18 (edge-integration, theo-cloud) [KEYSTONE]

> **v1.0** (2026-07-02) — from blueprint `.claude/knowledge-base/discoveries/blueprints/edge-rag-hermetic-e2e-blueprint.md` (SHIPPABLE 99.2). Native theo-cloud; builds theo-rag from the sibling checkout.

## Goal

Prove — with a hermetic automated e2e (`make e2e-edge` green) — that rag cross-tenant isolation + the per-verb
scope wall + fail-closed hold END-TO-END through the REAL Traefik edge + REAL ForwardAuth + a REAL theo-rag
container. Deliver: (1) `rag`+`pg-rag`+`rag-migrate` services in the e2e edge overlay (theo-rag built from the
sibling checkout, pinned M11/M12/M13); (2) `rag-edge`+`forward-auth-rag`+`rag-rewrite` → `http://rag:8080` in
`dynamic.e2e.yml`; (3) `RAG_BASE_URL`+`RAG_PLATFORM_ADMIN_KEY` on the e2e theo-cloud + the run.sh rag-admin mint;
(4) `edge_rag_forward_auth_e2e_test.go` with the 7 DoD assertions — all green under `make e2e-edge`.

## Context

ROADMAP-edge-integration.md § M18 (deps M11–M15, all released). This is the KEYSTONE — the non-negotiable
proof of invariant #6 that M15/M16/M17 deferred. Mirrors the shipped memory edge e2e
(`tests/e2e/edge_forward_auth_e2e_test.go`, #113). Hermetic: container upstreams (`http://rag:8080`),
mock-openai (no real key/network), consumer keys in the CLOUD DB, per-tenant keys minted by the broker.
ADRs D1 (build from sibling), D2 (rag-migrate psql), D3 (direct-with-consumer-key→401 proves minted≠customer),
D4 (THEORAG_REQUIRE_CREDENTIAL=true) locked by the blueprint.

## Baseline Context

### Files that will be touched

| File | Role |
|---|---|
| `tests/e2e/docker-compose.edge.e2e.yaml` | Add `pg-rag` + `rag-migrate` + `rag` services + RAG_* env on theo-cloud |
| `tests/e2e/traefik/dynamic.e2e.yml` | Add `rag-edge` + `forward-auth-rag` + `rag-rewrite` + `rag` service |
| `tests/e2e/sql/rag/00-extensions.sql` (NEW) | `CREATE EXTENSION vector` before theo-rag's migrations |
| `tests/e2e/run.sh` | Build `theo-rag-e2e` from the sibling + mint the rag platform-admin (EDGE-gated) |
| `tests/e2e/edge_rag_forward_auth_e2e_test.go` (NEW) | The 7 rag assertions + `seedRagAPIKey` + collections helpers |
| `CHANGELOG.md` | M18 entry |

### Reference (read-only) — verified

| Reference | path | Proves |
|---|---|---|
| memory edge e2e test | `tests/e2e/edge_forward_auth_e2e_test.go` (full) | the 7-assertion structure + the harness reuse |
| seedAPIKey | `tests/e2e/memory_e2e_test.go:82-112` | the CLOUD `theo_api_keys` seed (scopes JSON — rag variant) |
| memory compose | `tests/e2e/docker-compose.e2e.yaml:132-203` | themory service + theo-cloud env shape |
| edge overlay | `tests/e2e/docker-compose.edge.e2e.yaml` | where to add rag services + theo-cloud override |
| dynamic.e2e | `tests/e2e/traefik/dynamic.e2e.yml:18-54` | memory-edge → rag-edge template |
| run.sh | `tests/e2e/run.sh` (build themory + mint platform-admin + EDGE gate) | the build + mint + recreate flow |
| theo-rag Dockerfile | theo-rag `packages/api/Dockerfile` | the build (PORT 8080-overridable, CMD start) |
| theo-rag migrations | theo-rag `packages/core/src/infrastructure/db/migrations/*.sql` | plain SQL, idempotent, `vector` type in 0000, admin_bootstrap in 0011 |
| theo-rag collections | theo-rag `packages/api/src/server/handlers/collections.ts:154-206` | POST(rag:write)/GET(rag:read) |
| theo-rag M12 mint | theo-rag `packages/api/src/server/handlers/admin-keys.ts` | `raw_key` nested response + workspace_id |
| theo-rag M13 | theo-rag `packages/api/src/server/middleware/auth.ts:124` | `THEORAG_REQUIRE_CREDENTIAL` |

### Current callers / dependents

- **`make e2e-edge`** → `EDGE=1 bash tests/e2e/run.sh` (Makefile:33); the rag additions are EDGE-gated so the base memory e2e (`make e2e`) is untouched.
- **theo-cloud e2e service** — the edge overlay adds RAG_* env; theo-cloud's `buildRagForwardAuth` (M14) wires `/internal/authz/forward-rag` when RAG_BASE_URL is set.
- **The shared e2e harness** (`requireE2EEdge`, `env`, `mustDo`, `seedUser`, `seedTenant`, `ensureTenantAccount`) — reused by the new rag test; only `seedRagAPIKey` + collections helpers are added.

### Domain glossary

- **hermetic e2e** — no secrets, no real network, container upstreams; a mock-openai replaces the real LLM.
- **rag-migrate** — a one-shot psql service applying `CREATE EXTENSION vector` + theo-rag's drizzle SQLs before `rag` boots.
- **per-verb wall** — a minted `rag:read`-only key gets 403 on a write (theo-rag's M11 `requireScopeOnPrincipal('rag:write')`).
- **minted ≠ customer** — the raw consumer key 401s direct-to-theo-rag; only the edge-minted key resolves (proves the Del-then-set).

### Architecture boundaries affected

- Per `.claude/rules/architecture.md`: the e2e is a test harness (no production code change). The rag build is pinned to the sibling checkout (D1); the schema is applied by an isolated migrate step (D2). Per **DRY** the rag services/traefik/test copy the memory shapes; per **KISS** the rag additions are EDGE-gated (base e2e untouched), zero new deps. **Security-first**: `THEORAG_REQUIRE_CREDENTIAL=true` (M13) makes theo-rag fail-closed so the direct-401 proof holds; the mint uses `raw_key` (M12).

## Prior Art & Related Work

- Internal blueprint `.claude/knowledge-base/discoveries/blueprints/edge-rag-hermetic-e2e-blueprint.md` (design source; 4 corners + D1–D4).
- Reference: the shipped memory edge ForwardAuth e2e (#113) — mirrored exactly (Rule 9). theo-rag's own e2e-container patterns (Dockerfile, migrations) reused.

## ADRs

### D1 — build theo-rag from the sibling checkout, pinned (not GHCR :develop)
**Decision:** `docker build -t theo-rag-e2e:latest -f $THEORAG_DIR/packages/api/Dockerfile $THEORAG_DIR`.
**Rationale:** the DoD forbids a floating `:develop`; the local sibling checkout (M11/M12/M13 at rc.47) is the pinned ref. Mirrors run.sh's themory build.
**Alternatives:** pull GHCR `:develop` (rejected — floating, non-hermetic).

### D2 — apply theo-rag's schema via a `rag-migrate` one-shot (psql)
**Decision:** a `postgres:alpine` one-shot applies `00-extensions.sql` + theo-rag's drizzle SQLs (sorted) then exits; `rag` depends on it completing.
**Rationale:** theo-rag has no boot migrator; the SQLs are plain + idempotent. `vector` must precede 0000. Mirrors theo-cloud's cloud-migrate.
**Alternatives:** drizzle-kit push in a node container (rejected — heavier); pg initdb mount (rejected — fragile file+dir mount).

### D3 — direct-with-consumer-key → 401 proves minted ≠ customer
**Decision:** assertion 7 sends the raw consumer key directly to `rag:8080` → 401; the same key through the edge → 201.
**Rationale:** theo-rag doesn't know the customer key (it's in the CLOUD DB); only the edge-minted key resolves. The 401-direct + 201-edge contrast is the honest Del-then-set proof.
**Alternatives:** a theo-rag echo backdoor (rejected — test-only backdoor).

### D4 — THEORAG_REQUIRE_CREDENTIAL=true in the e2e
**Decision:** the `rag` service sets it.
**Rationale:** the direct no-key → 401 proof needs M13 fail-closed; without it a no-key direct request resolves a dev-mode default Principal. M13 is a declared dependency.
**Alternatives:** leave unset (rejected — the direct-401 proof fails).

## Dependencies

### New — to be introduced
| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | Reuse pgx (e2e), postgres:alpine, mock-openai, Traefik, theo-rag's own Dockerfile. | Zero new dependency. |

### Existing — use as-is
| Package | Version | Ecosystem | Why |
|---|---|---|---|
| pgx/v5 | (existing) | go | the e2e cloud-DB seed |
| docker compose | (existing) | infra | the hermetic stack |

## Dependency Graph

```
Phase 1 (compose: pg-rag + rag-migrate + rag + theo-cloud RAG_* env) ──┐ (infra)
Phase 2 (traefik dynamic.e2e: rag-edge + middlewares + service) ───────┤ (config; parallel with P1)
Phase 3 (run.sh: build rag image + mint rag platform-admin) ───────────┤ (needs P1)
        ↓                                                               │
Phase 4 (edge_rag_forward_auth_e2e_test.go: 7 assertions + helpers) ────┤ (needs P1-P3 to run)
        ↓                                                               │
Phase 5 (Integration Validation: make e2e-edge green) ─────────────────┘ (needs all)
```

## Phase 1 — e2e compose: rag stack

### T1.1 — Add pg-rag + rag-migrate + rag services + theo-cloud RAG_* env

#### Why this step
The hermetic proof needs a REAL theo-rag container + its DB + schema, plus theo-cloud wired to the rag broker. Reasoning: mirror the themory service block (D1); the rag-migrate one-shot applies the schema (D2, theo-rag has no boot migrator); `THEORAG_REQUIRE_CREDENTIAL=true` (D4) enables the direct-401 proof.

#### Files to edit
- `tests/e2e/docker-compose.edge.e2e.yaml`; `tests/e2e/sql/rag/00-extensions.sql` (NEW).

#### Deep file dependency analysis
`pg-rag` (postgres:17-alpine, therag/therag/therag, healthcheck pg_isready); `rag-migrate` (postgres:17-alpine, mounts `00-extensions.sql` + the sibling migrations dir, `psql -v ON_ERROR_STOP=1 -f` each sorted file, exits); `rag` (`theo-rag-e2e:latest`, PORT 8080, THEORAG_PG_URI, THEORAG_ADMIN_BOOTSTRAP_TOKEN, THEORAG_REQUIRE_CREDENTIAL=true, OPENAI_BASE_URL→mock-openai, depends_on rag-migrate completed + mock-openai healthy, healthz healthcheck, port E2E_RAG_PORT:18082→8080); theo-cloud override adds RAG_BASE_URL=http://rag:8080 + RAG_PLATFORM_ADMIN_KEY env.

#### TDD
`docker compose -p theo-cloud-memory-e2e -f docker-compose.e2e.yaml -f docker-compose.edge.e2e.yaml config -q` parses; the services resolve. (The behavioral test is Phase 5's `make e2e-edge`.)

#### Concurrency tests
(none — single-threaded) — declarative compose.

#### Failure-scenarios chaos pass
`rag-migrate` uses `ON_ERROR_STOP=1` → a bad migration aborts the stack (fail-fast, not a silently half-migrated DB). `rag` depends on `rag-migrate: service_completed_successfully` → boots only after the schema exists.

#### Acceptance criteria
- `docker compose ... config -q` OK; pg-rag/rag-migrate/rag present with the exact env; theo-cloud carries RAG_BASE_URL + RAG_PLATFORM_ADMIN_KEY.

#### DoD
`docker compose ... config -q` exit 0.

## Phase 2 — traefik dynamic.e2e: rag-edge

### T2.1 — Add rag-edge + forward-auth-rag + rag-rewrite + rag service

#### Why this step
Traefik must route `/v1/rag/*` through forward-auth-rag (mint per-tenant) + rag-rewrite (`/v1`-preserving) to the rag container. Reasoning: mirror memory-edge; the forward-auth-rag address is theo-cloud's M14 `/internal/authz/forward-rag`.

#### Files to edit
- `tests/e2e/traefik/dynamic.e2e.yml`.

#### Deep file dependency analysis
`rag-edge` (priority 92, `PathPrefix('/v1/rag')`, service `rag`, middlewares `[forward-auth-rag, rag-rewrite]`); `forward-auth-rag` (`http://theo-cloud:13002/internal/authz/forward-rag`, authResponseHeaders Authorization, trustForwardHeader false); `rag-rewrite` (`^/v1/rag/(.*) → /v1/$1`); `rag` service (`http://rag:8080`).

#### TDD
YAML validity + the drift is caught by the e2e (Phase 5) — a wrong address → the write assertion fails.

#### Concurrency tests
(none — single-threaded) — static config.

#### Acceptance criteria
- `dynamic.e2e.yml` valid YAML with rag-edge(92) + forward-auth-rag(forward-rag address) + rag-rewrite + rag service.

#### DoD
`python3 -c "import yaml; yaml.safe_load(...)"` OK; used by Phase 5.

## Phase 3 — run.sh: build rag + mint rag platform-admin

### T3.1 — Build theo-rag-e2e from the sibling + mint the rag admin (EDGE-gated)

#### Why this step
The stack needs the theo-rag image built from pinned source + theo-cloud wired with the minted rag platform-admin. Reasoning: mirror run.sh's themory build + platform-admin mint (D1); the rag mint returns `raw_key` (M12), not `secret`.

#### Files to edit
- `tests/e2e/run.sh`.

#### Deep file dependency analysis
EDGE-gated: `docker build -t theo-rag-e2e:latest -f $THEORAG_DIR/packages/api/Dockerfile $THEORAG_DIR`; after `compose up --wait`, if `RAG_PLATFORM_ADMIN_KEY` empty → `curl POST localhost:$E2E_RAG_PORT/v1/admin/keys` (bootstrap token, body `{name, workspace_id:"default", scopes:[rag:platform-admin,...]}`) → extract `.raw_key` → `[ -n ]` fail-fast → export + `compose up -d --no-deps --force-recreate theo-cloud`. `THEORAG_DIR` default `$ROOT/../../theo-data/theo-rag`.

#### TDD
`bash -n tests/e2e/run.sh`; the behavioral proof is Phase 5.

#### Concurrency tests
(none — single-threaded) — a sequential harness.

#### Failure-scenarios chaos pass
Empty `raw_key` → `die` (fail-fast, EC-1) BEFORE wiring an empty key; theo-rag not healthy → compose `--wait` fails.

#### Acceptance criteria
- run.sh (EDGE=1) builds theo-rag-e2e + mints the rag platform-admin via `raw_key` + recreates theo-cloud; `bash -n` clean; the base (EDGE=0) path unchanged.

#### DoD
`bash -n tests/e2e/run.sh` OK; Phase 5 uses it.

## Phase 4 — edge_rag_forward_auth_e2e_test.go

### T4.1 — The 7 rag assertions + seedRagAPIKey + collections helpers

#### Why this step
The Go test is the actual proof of invariant #6 for rag. Reasoning: mirror `edge_forward_auth_e2e_test.go`; collections CRUD needs no embedding (pure isolation); the direct-with-consumer-key 401 proves minted≠customer (D3).

#### Files to edit
- `tests/e2e/edge_rag_forward_auth_e2e_test.go` (NEW).

#### Deep file dependency analysis
`//go:build e2e`. Helpers: `seedRagAPIKey(t, db, subject, tenant, scopesJSON)` (mirror seedAPIKey with rag scopes); `createCollection(t, base, bearer, name) (status, id)` (POST `/v1/rag/collections` via edge OR `/v1/collections` direct); `listCollections(t, base, bearer) []name` (GET). The test: seed users/tenants/keys (A rw, B rw, C read-only); (1) B create via edge → 201; (2) A list via edge → name absent; (3) B list via edge → name present; (4) C create via edge → 403; (5) no-key create via edge → 401/403 + no Authorization on deny; (6) no-key direct → 401; (7) consumer-key-B direct → 401. Direct base = `http://localhost:$E2E_RAG_PORT`.

#### TDD
The test IS the RED→GREEN: it fails (compile/skip) until the stack + wiring exist, then passes under `make e2e-edge`.

#### Concurrency tests
(none — single-threaded) — sequential e2e assertions.

#### Failure-scenarios chaos pass
Assertions 5/6/7 ARE the failure-mode proofs (no-key edge, no-key direct, consumer-key direct — all fail-closed). Assertion 2 is the cross-tenant-leak guard.

#### Acceptance criteria
- The test compiles under `-tags=e2e`; all 7 assertions pass under `make e2e-edge`; a cross-tenant leak (assertion 2) or a missing 403/401 fails the test.

#### DoD
`go vet -tags=e2e ./tests/e2e/` clean; the test runs green in Phase 5.

## Phase 5 — Integration Validation

### T5.1 — make e2e-edge green (the keystone proof)

#### Why this step
The KEYSTONE requires the FULL hermetic stack green — real Traefik + real ForwardAuth + real theo-rag. Reasoning: `make e2e-edge` builds + brings up + runs + tears down; a green run is the invariant-#6 proof.

#### Files to edit
- `CHANGELOG.md`; (validation runs `make e2e-edge`).

#### Failure-scenarios chaos pass
(covered by the 7 assertions — the e2e itself is the failure-mode proof.)

#### Concurrency tests
(none — single-threaded).

#### Acceptance criteria
- `make e2e-edge` exits 0 with the rag test PASS (all 7 assertions) AND the existing memory test still PASS (no regression); the stack is hermetic (no secrets, no real network — mock-openai); CHANGELOG updated; `/review` = READY_TO_MERGE.

#### DoD
`make e2e-edge` green (rag + memory); CHANGELOG `[Unreleased]` has the M18 entry.

## Coverage Matrix

| DoD item (ROADMAP M18) | Task(s) |
|---|---|
| `docker-compose.e2e.yaml`: rag container + pg + seed; edge overlay depends_on rag | T1.1 |
| theo-rag built from a pinned source ref (M11/M12/M13), not GHCR :develop | T3.1 (D1) |
| `dynamic.e2e.yml`: rag-edge + forward-auth-rag + rag-rewrite → http://rag:8080 | T2.1 |
| e2e rag case: 2 tenants; write B; A read→not found; B read→found; minted rag:read→403 write; no-key→401 edge; direct no-key→401; minted≠customer | T4.1 |
| `make e2e-edge` green in CI (hermetic; no secrets/real-network/host process) | T5.1 |
| theo-cloud CHANGELOG; /review READY_TO_MERGE | T5.1 |

**Coverage: 6/6 DoD items mapped (100%).**

## Failure scenarios

- **theo-rag not fail-closed (direct no-key not 401):** without `THEORAG_REQUIRE_CREDENTIAL=true` a no-key direct request resolves a dev-mode owner → assertion 6 fails. Mitigated by D4 (the env is set); the test IS the reproduction.
- **A "passing" e2e not actually through ForwardAuth (roadmap risk 1):** mitigated by assertions 5 (no-key→401 at edge), 6 (direct no-key→401), 7 (consumer-key direct→401) — only real ForwardAuth + real M13 produce all three; a mock/bypass cannot.
- **rag-migrate half-applies the schema:** `ON_ERROR_STOP=1` aborts on the first error; `rag` depends on `service_completed_successfully` so it never boots against a partial schema.
- **Empty rag platform-admin mint (raw_key vs secret trap):** run.sh extracts `.raw_key` (M12) + fail-fasts on empty before wiring theo-cloud.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A "passing" e2e not routing through ForwardAuth (roadmap risk 1) | HIGH | assertions 5+6+7 (no-key-edge + direct-no-key + consumer-key-direct) — only real ForwardAuth+M13 pass all | paulohenriquevn |
| Cross-tenant leak through the edge | HIGH | assertion 2 (A cannot see B's collection) — the headline invariant-#6 proof | paulohenriquevn |
| theo-rag image build slow/heavy in CI | MEDIUM | build once, cached layers; EDGE-gated so base e2e unaffected; mirrors the themory build already in CI | paulohenriquevn |
| Migration drift (theo-rag schema changes) | MEDIUM | rag-migrate applies the ACTUAL sibling migrations (not a snapshot) — always current; ON_ERROR_STOP fails loud | paulohenriquevn |

## Unresolved Questions

(none — every decision is resolved at plan time: build-from-sibling (D1), rag-migrate psql (D2),
direct-with-consumer-key→401 (D3), THEORAG_REQUIRE_CREDENTIAL=true (D4) are locked by the blueprint. M18 IS the
automated proof — there is no live-stack caveat to defer.)

## Failure scenarios

(see § Failure scenarios above — the 7 assertions ARE the external-I/O + fail-closed proofs for the edge, the
direct service, and the migrate step.)

## Global Definition of Done

Per `.claude/rules/architecture.md` (test harness, no prod change; pinned build), `.claude/rules/testing.md`
(the e2e is the E2E lane of the pyramid — the invariant-#6 proof), and `.claude/rules/git-safety.md`
(develop-only): all 6 Coverage-Matrix items delivered; `docker compose ... config -q` OK; `dynamic.e2e.yml`
valid YAML; `bash -n run.sh` clean; `go vet -tags=e2e ./tests/e2e/` clean; **`make e2e-edge` green (rag test
all 7 assertions + memory test — no regression)**; CHANGELOG updated; `/review` = READY_TO_MERGE. **File-size
budget:** the new test + compose/traefik/sql additions stay well under the 500-LoC budget (KISS).

## Final Phase: Integration Validation

T5.1 is the integration gate — the KEYSTONE is NOT complete until `make e2e-edge` is green with all 7 rag
assertions AND no memory regression. A cross-tenant leak, a missing 403/401, or a red e2e is a blocker, not a
caveat. This is the "eat your own cooking" proof of invariant #6.
