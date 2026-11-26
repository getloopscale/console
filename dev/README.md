# loop-console dev stack — run the real apps locally

Spins up the **full real stack** for end-user validation: dashboard (real login),
gateway API, TheMemory (REST + MCP), Ory Kratos, Postgres + pgvector. One command.

```bash
make dev-up      # build + boot everything, start the dashboard (vite), print URLs
make dev-down    # stop everything (containers + the host vite server)
make dev-logs    # tail backend logs   (dashboard log: dev/.vite.log)
```

Requires `docker`, `docker compose`, `go`, `node`/`npm`. The sibling TheMemory
repo is expected at `../loopmem` (override `LOOPMEM_DIR`).
First run builds the TheMemory image + installs dashboard deps (slow; cached after).

## What you get

| Service | URL | Notes |
|---|---|---|
| **App (dashboard)** | http://localhost:5173 | open this; register on first run |
| Login | http://localhost:5173/login | real Ory Kratos (email + password) |
| Gateway API | http://localhost:13002 | `/health`, `/v1/*` |
| TheMemory REST | http://localhost:18081/v1/health | the memory backend |
| Kratos (direct) | http://localhost:14433 | identity service |
| **MCP (OpenMemory SSE)** | http://localhost:8765/{client}/sse/{user} | drop-in for OpenMemory clients |
| pg-cloud / pg-loopmem | :55433 / :15432 | Postgres (cloud schema) / pgvector |

## First-run login

The dashboard uses **real Kratos**. On first open, click **Create account** and
register (email + password, min 8 chars). Email verification is disabled in dev,
so you're logged in immediately. Example: `dev@loopscale.local` / `DevPassw0rd!2026`.

Then open **Memory** in the sidebar — the metrics load through the real path
(browser → gateway `/v1/dashboard/memory/*` → mints a server-side `theo_live_*`
key → TheMemory → pgvector).

### Seed some memories to see real data

Memories are written by agents (SDK / MCP), not the dashboard UI. To populate:

```bash
# get your Kratos subject id from the browser console:
#   await (await fetch('/sessions/whoami',{credentials:'include'})).json()  → identity.id
SUBJ=<your-identity-id>
curl -X POST http://localhost:18081/v1/remember \
  -H "Authorization: Bearer dev-master-key" -H "Content-Type: application/json" \
  -d "{\"text\":\"my favorite color is blue\",\"userId\":\"$SUBJ\"}"
```

Refresh the Memory tab → "Total memories" reflects the new rows.

## MCP (OpenMemory-compatible) client config

The MCP server exposes the OpenMemory tool surface (`add_memories` /
`search_memory` / `list_memories` / `delete_memories`) over SSE. Point any
OpenMemory-wired client at it. Example `.mcp.json` (Cursor / Claude Desktop):

```json
{
  "mcpServers": {
    "loopmem": {
      "url": "http://localhost:8765/cursor/sse/dev-user"
    }
  }
}
```

The path is `/{client}/sse/{user}` — `client` is your tool name, `user` is the
scope the memories are stored under.

## LLM backend (memory extraction / recall)

Defaults to a **hermetic deterministic mock** (no cost, no network). For real
semantic extraction/recall, export a valid key before `make dev-up`:

```bash
export OPENAI_API_KEY=sk-...                        # OpenAI
# or OpenRouter:
export OPENAI_API_KEY=sk-or-... OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

(The key in `loopmem/.env` returns 401 — expired — so it is NOT auto-loaded.)

## Known limitations (dev stack)

- **Engine features 502** — `/engine/*` (Projects, Domains, deploy) need the LoopScale
  engine, which is NOT in this stack. The dashboard shows those areas as errors;
  Memory / Billing / account work.
- **Dashboard runs via `vite dev`** (not the production bundle) — the prod build
  has a pre-existing `manualChunks` TDZ bug (`Cannot access 'X' before
  initialization`); dev mode avoids it. Tracked separately.
- **Memory → Webhooks / Exports tabs** still target the SDK `/v1/memory/*`
  surface (require a `theo_live_*` key), so they 401/403 from a browser session.
  The core Memory / Memories / Entities tabs use the BFF and work. Extending the
  BFF to webhooks/exports is a follow-up.
- **Hydra (OAuth2/social login) is not included** — "Continue with GitHub/Google"
  won't work; use email + password.
