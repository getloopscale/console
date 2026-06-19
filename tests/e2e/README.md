# theo-cloud ↔ TheMemory — end-to-end harness

Boots the **full real path** a customer traverses and exercises the gateway's
`/v1/memory/*` endpoints against the **real** TheMemory server — no external
network, no API keys, no cost.

```
go test (customer)  --theo_live_* bearer-->  theo-cloud (gateway)
     --master bearer + subject-in-path-->    themory (TheMemory REST) --> pgvector
themory --OPENAI_BASE_URL--> mock-openai (hermetic LLM + embeddings)
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
expected at `../../theo-data/theo-memory` (override with `THEMORY_DIR=/path`).
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
| `docker-compose.e2e.yaml` | 5 services: `pg-themory` (pgvector), `pg-cloud` (postgres), `mock-openai`, `themory`, `theo-cloud` |
| `mock-openai/` | hermetic OpenAI-compatible server (`/v1/chat/completions` extraction + `/v1/embeddings`, honors `encoding_format=base64`) |
| `sql/01-cloud-schema.sql` | minimal `theo_api_keys` table (theo-cloud ships no migrations of its own — the prod schema lives in the engine) |
| `runtime.Dockerfile` | wraps the host-built static Go binaries (theo-cloud, mock-openai) |
| `run.sh` | the orchestrator `make e2e` calls |
| `memory_e2e_test.go` | the Go test (build tag `e2e`) |

## Notes

- `mock-openai` honors `encoding_format=base64` — the official OpenAI SDK
  requests base64 by default; a mock that returns a raw float array makes the
  SDK mis-decode the bytes (the 1536→384 dimension bug).
- The TheMemory image runs with `THEOMEM_EMBEDDER=openai` pointed at the mock
  (1536-dim) so no model download is needed at runtime.
