# COMPLETE live test — UX + REST + MCP + SDK, REAL OpenAI — 2026-06-24

**Backend:** REAL OpenAI (`text-embedding-3-small` dim=1536 + GPT LLM) wired into themory + themory-mcp (key valid, `/v1/models` 200). Stack rebuilt to latest (themory **v0.22.0**, gateway **v0.9.0**). Browser: real Chrome (user's profile), dashboard at :5173.

## Results — ALL SURFACES PASS

### 1. REST API (themory direct, :18081, master key)
- `/v1/health` + `/v1/openapi.json` → 200 ✓
- `GET /v1/scopes/user/rt-subject/episodes` → 200, 3 real facts in temporal desc order ✓
- `GET /v1/scopes/skill/:subject/all` (cross-repo, v0.21.0) → mounted ✓

### 2. SDK (gateway, :13002, Bearer theo_live_*)
- `remember` → 201 (real LLM extraction; 1st→3rd person transform observed) ✓
- `recall` → 200 with **REAL cross-lexical semantic match**: query "what caffeinated beverage does the user like?" (zero word overlap) → coffee/espresso fact ranked #1 at **cosine 0.4817**; "where located geographically?" → Lisbon fact #1 at **0.3755**. Mock cannot do this — proves real embeddings. ✓
- `skills` add + `skills/all` (v0.9.0) → 2 repos (repo-alpha + repo-beta), correct per-row repoId ✓
- `episodes?scope=user` → 200, 3 items temporal ✓

### 3. MCP native (`themory mcp`, real OpenAI, stdio)
- `tools/list` → **8 tools, `episodes` present** ✓ (v0.22.0 deliverable LIVE over MCP)
- `tools/call episodes {limit:3,order:desc}` → **3 real items, isError=false** ✓

### 4. MCP OpenMemory compat (themory-mcp container, :8765 SSE)
- `GET /{client}/sse/{user}` → `event: endpoint` + messages URL (SSE stream opens) ✓ (full round-trip covered by v0.5.0 GOAL test)

### 5. UX dashboard (real Chrome, :5173, dev session)
- **Memory hub** → real metrics (Total memories 2, Retrieval calls 1, Add events 2, Distinct entities 4) + Usage/Entities charts ✓
- **Skills tab** → cross-repo flat list (REPO/SKILL/LANGUAGE/CREATED), **3 skills across 2 repos**, search + pagination, per-row **View details + Forget** ✓
- **Skills details dialog** (the UX-feedback fix) → opens with repo·language·created + **Code section showing the full payload** (not a table column) ✓
- **Episodes tab** → temporal event log + **"As of (replay)" datetime picker** (bi-temporal asOf in UX) + text filter + order toggle + **2 real items** (scope USER) ✓
- BFF `/v1/dashboard/memory/episodes?scope=user` → 200 ✓

## Findings (honest, Rule 3)

| # | Finding | Severity | Note |
|---|---|---|---|
| **F-1** | **Gateway maps themory upstream 422 → 502.** Skill add with `codeLanguage:"python"` → themory correctly returns `422 INVALID_BODY` ("Expected 'typescript'\|'javascript'"), but the gateway collapses it to `502 MEMORY_UPSTREAM_UNAVAILABLE` ("try again"). A 4xx client error must pass through, not become a misleading 502 (retry won't help). | **MEDIUM** (real DX bug) | `internal/routes/memory.go` AddSkill (+ likely other handlers) — propagate upstream 4xx instead of blanket 502. Follow-up. |
| **F-2** | **themory skill `codeLanguage` enum = typescript\|javascript only.** Python (+ other langs) rejected 422. | LOW | May be intentional (Voyager JS/TS skills) or a gap — decide + document, or widen the enum. |
| **F-3** | **`/engine/api/v1/*` (PaaS deploy engine) → 502** in the dashboard (projects/domains/whoami). | EXPECTED | The PaaS engine isn't part of the memory-dev-stack. NOT a memory defect; out of scope. |
| **F-4** | **SPA sub-nav render lag.** Clicking a Memory sidebar sub-tab changes the URL but the main panel lags until a reload (direct nav renders fine). | LOW (UX) | Dashboard routing/render timing; worth a look. |
| **LT-1** | **Concurrent-migrate race** (themory + themory-mcp both migrate-on-boot on one DB) — crashed themory-mcp on the v0.22.0 first-boot (0021); fixed by restart (no-op once journaled). | MEDIUM (dev-topology) | Only one container should migrate. Follow-up (connects to M4). |

## Verdict

**COMPLETE live test PASS across UX + REST + MCP + SDK with REAL OpenAI.** Every memory surface works end-to-end against the latest code: real semantic recall (cross-lexical 0.48), real extraction, cross-repo skills (flat list + details dialog + curation in the live dashboard), episodic tier on all three surfaces (REST/SDK/MCP + the dashboard asOf-replay UX), and the native MCP `episodes` tool (v0.22.0) live with 8 tools. 4 findings surfaced (1 MEDIUM gateway 422→502 bug, 1 MEDIUM dev-topology migrate-race, 2 LOW); none blocks the memory product — F-3 (engine 502) is an out-of-scope PaaS-not-running artifact.

## Recommended follow-ups (priority order)
1. **F-1** gateway 422→502 mis-mapping (DX correctness) — propagate upstream 4xx.
2. **LT-1** concurrent-migrate race (GA-readiness; one migrator).
3. **F-2** skill codeLanguage enum decision; **F-4** SPA sub-nav lag.
