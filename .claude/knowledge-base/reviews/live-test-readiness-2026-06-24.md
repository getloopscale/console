# Live-test readiness — full stack (UX + REST + MCP + SDK) — 2026-06-24

**Goal:** close the gaps so a COMPLETE live test (UX, APIs, MCP, SDK) can run against the LATEST merged code.

## What was done

Rebuilt the dev stack from latest source (`bash dev/run.sh`, full themory image rebuild — NO `THEMORY_SKIP_BUILD`): themory image now **v0.22.0** (episodes MCP tool + cross-repo skills), gateway binary **v0.9.0** (SDK `/v1/memory/skills/all`). All 7 containers up.

## Surface readiness (verified live against latest code)

| Surface | Endpoint | Result |
|---|---|---|
| **UX dashboard** | http://localhost:5173/ | 200 ✓ (Vite; skills tab cross-repo flat list + details dialog, memories, logs/SSE) |
| **REST API (themory)** | :18081 `/v1/health`, `/v1/openapi.json` | 200 ✓ |
| REST cross-repo skills (v0.21.0) | :18081 `/v1/scopes/skill/:subject/all` | mounted (401 no-auth) ✓ |
| **Gateway SDK** | :13002 `/v1/memory/remember` + `/recall` | **201 / 200**, write→read round-trip, recall score **0.783** ✓ |
| Gateway SDK skills/all (v0.9.0) | :13002 `/v1/memory/skills/all` | 200, shape `{skills,total,truncated}` ✓ |
| Gateway dashboard BFF | :13002 `/v1/dashboard/memory/*` | mounted (401 no-auth) ✓ |
| **MCP (OpenMemory compat)** | :8765 `/{client}/sse/{user}` | container up + SSE serving ✓ |

## Gaps CLOSED this session

1. **Stale stack** (themory 14h / gateway 11h, pre-v0.22.0/v0.9.0) → rebuilt to latest. All new routes now live.
2. **`themory-mcp` container crash-loop** → see root cause below; closed by restart (now a no-op).

## Root cause of the MCP crash (real finding, Rule 3)

`themory-mcp` Exited(1) on the rebuild with:
`Failed query: CREATE INDEX IF NOT EXISTS "idx_memories_skill_subject_prefix" ... text_pattern_ops ...` (migration 0021, the M2 index).

**It is NOT a bug in migration 0021** — the index is correct + idempotent (manual `CREATE INDEX IF NOT EXISTS` → `NOTICE: already exists, skipping`; journal records 0021).

**It is a concurrent-migrate race in the dev-stack topology:** both `themory` (REST) and `themory-mcp` `depends_on: pg-themory healthy` and BOTH run `runMigrations()` on boot against the SAME database, near-simultaneously. With the 21h-old pg-themory at journal=0020, BOTH saw 0021 pending and tried to apply it concurrently. `CREATE INDEX IF NOT EXISTS` is NOT atomic under concurrent DDL (the IF-NOT-EXISTS check uses each txn's pre-commit snapshot), so one container won (REST) and the other crashed. This race is PRE-EXISTING (affects any first-new-migration after a DB was last fresh); 0021 merely was the first new migration to expose it. Restart is a no-op because 0021 is now journaled.

## Residual gaps / decisions for the COMPLETE live test

| # | Gap | Type | Recommendation |
|---|---|---|---|
| LT-1 | **Concurrent-migrate race** — two themory containers migrate-on-boot on one DB; will re-bite on the NEXT new migration | theo-cloud dev-topology follow-up | Only ONE container should run migrations (dedicated `themory migrate` init container OR `themory-mcp` skips migrate / `depends_on: themory healthy`). Connects to M4 migration discipline. NOT blocking now. |
| LT-2 | **Native MCP `episodes` tool not exposed by the dev stack** — the MCP container runs `mcp --compat openmemory` (4 OpenMemory tools); `episodes` is native-only (8-tool native surface) | config / test-setup | To live-test the native episodes tool, run a native `themory mcp` (no `--compat`) entry — either a second MCP container or `docker exec ... themory mcp`. |
| LT-3 | **mock-openai backend** — embeds/LLM use the real code path but a MOCK backend (`OPENAI_BASE_URL`→mock-openai). Per the standing "NUNCA USE MOCK USE LLM REAL" directive, a real-semantics live test needs the real OpenAI key swapped in | decision | Swap `OPENAI_BASE_URL`/`OPENAI_API_KEY` to real OpenAI for the semantic-quality portion of the live test (recall scores, extraction quality). The wiring is proven (score 0.78 on mock); real-LLM is for quality fidelity. |
| LT-4 | **UX browser test needs the user's Chrome** | manual | Drive the dashboard (skills/memories/logs tabs) via chrome-devtools MCP against http://localhost:5173 (Paulo granted autonomous Chrome launch). |

## Verdict

**Stack is READY for the complete live test.** Every surface boots + the programmatic chain (SDK→gateway→themory) round-trips end-to-end against the latest code (remember 201 / recall 200 score 0.78 / skills-all v0.9.0 shape). The 4 residual items are decisions/follow-ups (real-LLM swap, native-MCP-episodes entry, the migrate-race follow-up, browser UX) — none blocks starting the test.
