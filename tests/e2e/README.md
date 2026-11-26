# loop-console ↔ TheMemory — end-to-end harness

Boots the **full real path** a customer traverses and exercises the gateway's
`/v1/memory/*` endpoints against the **real** TheMemory server — no external
network, no API keys, no cost.

```
go test (customer)  --theo_live_* bearer-->  loop-console (gateway)
     --master bearer + subject-in-path-->    loopmem (TheMemory REST) --> pgvector
loopmem --OPENAI_BASE_URL--> mock-openai (hermetic LLM + embeddings)
```

## Run it

From the repo root:

```bash
make e2e          # build + boot + test + teardown (one command)
make e2e-up       # boot and LEAVE running (KEEP_UP=1) for debugging
make e2e-down     # tear a left-up stack down
make e2e-logs     # tail the stack logs
```

Requires `docker`, `docker compose`, and `go`. The sibling TheMemory repo is
expected at `../loopmem` (override with `LOOPMEM_DIR=/path`).
First run builds the TheMemory image (slow; cached afterwards).

## What it proves

`memory_e2e_test.go` (`-tags e2e`) seeds a `theo_live_*` key exactly the way the
gateway's BFF vault does, seeds a memory via the real `POST /v1/remember`, then
asserts through the gateway:

- list returns the customer's own memories (subject-in-path scoping);
- list is scope-isolated (no cross-tenant bleed);
- cross-tenant `forget` is denied — 404, victim's memory survives (IDOR closed);
- owner `forget` removes the memory.

## Pieces

| File | Role |
|---|---|
| `docker-compose.e2e.yaml` | `pg-loopmem` (pgvector), `pg-cloud` (postgres) + `cloud-migrate` (engine REAL migrations → full account-tenancy schema), `mock-openai`, `loopmem`, `kratos` (+ `kratos-migrate`), `loop-console` |
| `mock-openai/` | hermetic OpenAI-compatible server (`/v1/chat/completions` extraction + `/v1/embeddings`, honors `encoding_format=base64`) |
| `sql/` | initdb (superuser): extensions the migrations assume + the `kratos` database. The cloud schema itself comes from `cloud-migrate` (the engine's golang-migrate migrations — drift-free, M6) |
| `runtime.Dockerfile` | wraps the host-built static Go binaries (loop-console, mock-openai) |
| `run.sh` | the orchestrator `make e2e` calls |
| `memory_e2e_test.go` | the Go test (build tag `e2e`) |

## Notes

- `mock-openai` honors `encoding_format=base64` — the official OpenAI SDK
  requests base64 by default; a mock that returns a raw float array makes the
  SDK mis-decode the bytes (the 1536→384 dimension bug).
- The TheMemory image runs with `LOOPSCALEMEM_EMBEDDER=openai` pointed at the mock
  (1536-dim) so no model download is needed at runtime.
- A host port already taken (e.g. another stack on `55432`) is resolved by
  exporting the matching `E2E_*_PORT` (e.g. `E2E_PG_CLOUD_PORT=55442`).

## M6 — the full-chain test + the coverage seam

`fullchain_e2e_test.go` is the FIRST automated test of the **real user journey**,
with ZERO mocks and ZERO synthetic seeds:

```
real Kratos login (pre-verified identity, headless API flow)
  → POST /v1/auth/session/token   (Kratos cookie → loopscale_session_* JWT)
    → POST /v1/dashboard/memory/{remember,recall}   (session-JWT chain)
      → the REAL Model-B broker mints a per-tenant key → REAL loopmem
```

- `TestFullChainE2E_RealLoginToMemory` — the chain returns the written content.
- `TestFullChainE2E_CrossTenantIsolationRealChain` — tenant-A's real session
  cannot read tenant-B's memory; each reads its own. This replaces the
  `captureMinter` STUB the M1/M3 isolation e2e used — isolation is now proven on
  the fully-real broker → loopmem path.

**What this does NOT cover (don't over-read the green):**

- **The engine project-cap (M4/M5).** The `loopscale` engine is not in this stack (nor
  in the dev compose); the BFF's `/engine/*` proxy has no upstream here. The
  per-Account project cap is proven at the **engine layer** (M5 integration, 7
  `-race` scenarios), not through this chain. (ADR-M6-3.)
- **The browser/UI.** The dashboard Playwright suite (`dashboard/e2e`) runs with
  `VITE_USE_MOCKS=true` by design; it exercises the UI against mocked responses,
  not this stack. The full-chain test covers the API journey headlessly.

Off-stack, `go test -tags e2e ./tests/e2e/...` SKIPs cleanly (tests guard on
`E2E_CLOUD_URL`/`E2E_PG_CLOUD_DSN`). CI runs the whole harness via
`.github/workflows/test-e2e.yml` (its first real run happens on push — Actions
can't be executed from a dev box; `make e2e` green locally is the proxy oracle).

## The edge ForwardAuth job (#113 — `make e2e-edge`)

The default `make e2e` stack runs **no Traefik**, so the edge ForwardAuth tests
(`edge_forward_auth_e2e_test.go`) are SKIP-guarded by `requireE2EEdge` (they need
`E2E_EDGE_URL`). `make e2e-edge` closes that coverage gap:

```bash
make e2e-edge      # EDGE=1 tests/e2e/run.sh
```

It layers `docker-compose.edge.e2e.yaml` (the **Traefik single edge** on `:8090`)
onto the SAME hermetic stack via a trimmed `traefik/dynamic.e2e.yml` — only the
`/v1/memory` ForwardAuth router (a faithful subset of `dev/traefik/dynamic.yml`,
reusing the dev static config verbatim). `run.sh` waits until the edge
fail-closed-denies an unauthenticated `/v1/memory`, then runs **only**
`go test -run TestEdgeForwardAuth` through the edge:

```
go test (customer) --theo_live_* bearer--> Traefik :8090 /v1/memory/*
   --ForwardAuth--> loop-console /internal/authz/forward (mints per-tenant key,
                    Del-then-set Authorization strips the client key, D3)
   --memory-rewrite--> loopmem:8080 DIRECT (ADR D7) --> pgvector
```

This proves cross-tenant isolation END-TO-END through the real edge mint +
rewrite + direct-to-loopmem path (CWE-441 closure). A second `e2e-edge` job in
`.github/workflows/test-e2e.yml` runs it in CI.

**Out of scope:** the unified SPA/Kratos/BFF edge tests (`edge_unify_e2e_test.go`,
`TestEdge_*`, M8 slice-3a) — they need the dashboard SPA image; the trimmed edge
overlay intentionally omits the dashboard/kratos routers. Tracked separately.
