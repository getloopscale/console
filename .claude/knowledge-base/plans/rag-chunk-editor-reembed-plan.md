# Plan: RAG Chunk Viewer + Editor with Re-embedding

> **Version 1.0** — Add a chunk-level viewer and editor to the TheoCloud RAG dashboard: open a document, list its chunks (text + index + retrieval metadata), edit a chunk's text inline, and on save regenerate that chunk's embedding so retrieval reflects the edit. Spans three layers/two repos — a new `PATCH /v1/chunks/{id}` mutation endpoint in **theo-rag** (data-plane) that reverses the read-only ADR D1, three per-tenant proxy routes in the **theo-cloud BFF**, and a chunk panel in the **dashboard**. Outcome: a user can correct a bad chunk (OCR error, wrong split) without re-ingesting the whole document, and the corrected text is immediately searchable.

## Goal

> "Enable RAG dashboard users to edit a document's chunk text and regenerate its embedding so that the corrected chunk is retrievable, measured by the LIVE integration test `chunk-edit-reembed` asserting the chunk's pgvector embedding differs pre- vs post-edit AND the new text is returned by `/answers`."

## Context

RAG answer quality is bottlenecked by chunk quality: a single mis-split, OCR-garbled, or boilerplate-polluted chunk poisons retrieval for every question that hits it. Today the only remedy is to delete the document and re-ingest — expensive (re-chunks + re-embeds everything) and lossy (loses the document's other good chunks' identity). Users have asked for a way to **see** what got chunked and **fix** an individual chunk.

The data-plane already stores everything needed: the `chunks` table holds each chunk's `text` and its `embedding vector(1536)`, and theo-rag already exposes **read-only** chunk endpoints (`GET /v1/documents/{doc_id}/chunks`, `GET /v1/chunks/{id}`). What is missing is (a) a mutation path that updates a chunk's text and re-embeds it, (b) the BFF proxy that surfaces chunk read + edit per-tenant, and (c) the dashboard UI. The mutation reverses an explicit prior decision (ADR D1 in `chunks.ts`: "no mutation endpoints"), so this plan carries a new ADR that supersedes it with a bounded, single-chunk, re-embed-on-write contract.

This plan follows the exact cross-repo deploy path proven in this session (dashboard build → Caddy `dist`; BFF `docker build` → `k3d image import` → rollout; theo-rag host process restart) and validates LIVE on `app-dev.usetheo.dev` via the real browser.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `theo-rag: packages/api/src/server/handlers/chunks.ts` (cross-repo, droplet `/home/paulo/theo-data-plane/theo-rag`) | 130 | (data-plane repo) | Read-only chunk handlers `GET /v1/documents/{doc_id}/chunks` + `GET /v1/chunks/{id}`; registers OpenAPI routes; ownership check via `documentsRepo.get(ws, docId)` → 404 cross-workspace | The two GET routes + their ownership check MUST keep working unchanged; workspace isolation (404 on cross-workspace) is non-negotiable |
| `theo-rag: packages/api/src/server/app.ts` (cross-repo) | ~500 | (data-plane repo) | Wires `registerChunksRoutes(app, chunksRepo, documentsRepo)` at line 495 | Existing route registration order preserved; the reranker/embedder singletons already constructed here are reused, not duplicated |
| `theo-rag: packages/core/src/infrastructure/db/schema.ts` (cross-repo) | 807 | (data-plane repo) | Drizzle schema; `chunks` table (`id, document_id, workspace_id, collection_id, text, embedding vector(1536)`, SHA256 content-hash), `vector` custom type at ~line 28 | `vector(1536)` dimension fixed (matches `text-embedding-3-small`); the content-hash column semantics for dedupe must stay consistent |
| `theo-rag: packages/core/src/domain/graph-store/community-store.ts` sibling — chunk repository (cross-repo) | n/a | (data-plane repo) | `chunksRepo` implements chunk reads used by `registerChunksRoutes` | Add `updateText` without breaking existing read methods (`get`, `listByDocument`) |
| `theo-rag: packages/core/src/domain/pipeline/stages/chunk-stage.ts` (cross-repo) | n/a | (data-plane repo) | Ingest pipeline stage that embeds chunks via `text-embedding-3-small` | The embed function reused for re-embed MUST produce a byte-comparable 1536-dim vector via the same model/config as ingest |
| `internal/routes/rag_dashboard.go` | 446 | `51dd0b6` (2026-07-16) | BFF per-tenant RAG dashboard handlers (M11 `UploadDocumentFile`, M13 `CommunityReport`) + `RagDataClient` interface | Existing handlers + interface methods unchanged; new methods appended; typed errors + Rule 3 (no internal terms in messages) |
| `internal/rag/data_client.go` | 528 | `51dd0b6` (2026-07-16) | HTTP client to theo-rag with per-tenant key resolver; opaque credential forward | `WithKeyResolver` chain + opaque forward unchanged; new methods reuse the same request builder |
| `cmd/main.go` | 1454 | `51dd0b6` (2026-07-16) | Composition root; registers dashboard RAG routes at lines 161–174 under `/v1/dashboard/rag` | Route registration block ordering; auth middleware (`rag:read`/`rag:write` scope) applied consistently |
| `dashboard/src/pages/rag/documents.tsx` | 316 | `2553310` (2026-07-16) | Documents page: collection picker, M11 file dropzone, doc list table with status | The upload + doc-list behavior unchanged; the chunk panel is additive (open-on-row) |
| `dashboard/src/pages/rag/chunks-panel.tsx` (NEW) | 0 | — | (file to be created) — the chunk viewer/editor Sheet | — |
| `internal/routes/rag_dashboard_test.go` | (exists) | `51dd0b6` (2026-07-16) | Go component tests for BFF RAG handlers | Add cases; keep existing green |
| `dashboard/src/pages/rag/chunks-panel.test.tsx` (NEW) | 0 | — | (file to be created) | — |

Every file listed in any `#### Files to edit` block below appears in this table.

### Current callers / dependents

- **Symbol:** `registerChunksRoutes(app, chunksRepo, documentsRepo)` in theo-rag `handlers/chunks.ts:80`
  - **Callers (production):** theo-rag `packages/api/src/server/app.ts:495`
  - **Callers (tests):** theo-rag `handlers/chunks.test.ts` (if present; the mutation adds a new test file `chunks.mutation.test.ts`)
  - **External (public API consumed by other repos):** yes — the theo-cloud BFF is the consumer of `/v1/documents/{id}/chunks` + `/v1/chunks/{id}` + the new `PATCH /v1/chunks/{id}`. This is the cross-repo contract.
- **Symbol:** `RagDataClient` interface in `internal/routes/rag_dashboard.go:29`
  - **Callers (production):** `cmd/main.go:462` (`routes.NewRagDashboardHandler(ragDataClient, logger)`)
  - **Callers (tests):** `internal/routes/rag_dashboard_test.go` (fake client)
  - **External:** no — internal to theo-cloud.
- **Symbol:** `RagDashboardPage`/documents page component in `dashboard/src/pages/rag/documents.tsx`
  - **Callers (production):** the dashboard router (RAG route group)
  - **Callers (tests):** `dashboard/src/pages/rag/documents.test.tsx` (if present)
  - **External:** no.

### Domain glossary

- **chunk** — a contiguous slice of a document's text produced by the ingest pipeline's chunk-stage; the atomic unit of retrieval, stored with its own `embedding vector(1536)`.
- **re-embed** — recompute a chunk's embedding vector from its (edited) text using the same model (`text-embedding-3-small`) the ingest pipeline used, so retrieval reflects the new text.
- **content-hash** — SHA256 of a chunk's text used by ingest for idempotent dedupe; must be recomputed when text changes so a later re-ingest does not resurrect the stale text.
- **workspace_id / tenant** — the isolation key; every chunk read/write is scoped to the caller's workspace (theo-rag `workspace_id`, minted per-tenant by the BFF broker).
- **per-tenant key resolver** — the BFF mints a scoped data-plane key per tenant (`WithKeyResolver`), forwarding it opaquely; the browser never sees it.

### Architecture boundaries affected

- **theo-rag data-plane ↔ BFF (HTTP/OpenAPI contract):** this plan ADDS one endpoint to the data-plane's public HTTP surface (`PATCH /v1/chunks/{id}`) and consumes it from the BFF. Direction: BFF (higher) → theo-rag (lower), acyclic — consistent with `rules/architecture.md § 1` (interface→…→infrastructure inward) applied cross-repo.
- **BFF interface (DIP):** `RagDataClient` (the domain port the dashboard handler depends on) gains three methods; the concrete `data_client.go` implements them (`rules/architecture.md § 2` DIP — the handler depends on the interface, not the HTTP client).
- **Read-only → read-write boundary (theo-rag):** the chunk surface changes from read-only (ADR D1) to bounded read-write. Recorded as ADR D1-supersede below.

## Prior Art & Related Work

- **Internal — M11/M13 BFF proxy pattern:** `cmd/main.go:174` (`r.Post("/documents/file", h.UploadDocumentFile)`) and `cmd/main.go:168` (`CommunityReport`) are the exact template for adding a per-tenant RAG dashboard route + `RagDataClient` method + `data_client.go` HTTP call. This plan mirrors them.
- **Internal — M13 GraphRAG Sheet UI:** `dashboard/src/pages/rag/graphrag.tsx` uses a `@usetheo/ui` `Sheet` for the community-report drill-down; the chunk panel reuses that pattern (Sheet + query + inline content).
- **Internal — theo-rag read-only chunk handlers:** theo-rag `handlers/chunks.ts` (the existing GET endpoints + ownership check) is the direct base the mutation extends.
- **External — pgvector update semantics:** updating a `vector(1536)` column in place is a normal `UPDATE` (pgvector stores the vector as a row value); no index rebuild is required for IVFFlat/HNSW on single-row update (the index updates on write). Relevance: confirms re-embed = `UPDATE chunks SET text=$1, embedding=$2, content_hash=$3 WHERE id=$4 AND workspace_id=$5` is sufficient. (https://github.com/pgvector/pgvector#storing)
- **External — OpenAI embeddings determinism:** `text-embedding-3-small` is deterministic per input+model; the LIVE test asserts pre/post vectors differ *because the text differs*, not because of nondeterminism. (https://platform.openai.com/docs/guides/embeddings)

## Objective

- [ ] Sub-goal 1 — theo-rag exposes `PATCH /v1/chunks/{id}` (scope `rag:write`) that updates `text`, re-embeds, writes the new `vector` + recomputed content-hash, workspace-scoped, transactional.
- [ ] Sub-goal 2 — BFF exposes `GET /v1/dashboard/rag/documents/{id}/chunks`, `GET /v1/dashboard/rag/chunks/{id}`, `PATCH /v1/dashboard/rag/chunks/{id}` per-tenant, opaque-forwarded, typed errors, Rule 3.
- [ ] Sub-goal 3 — dashboard: opening a document lists its chunks; editing a chunk's text + Save triggers PATCH + shows re-embedding→ready status.
- [ ] Sub-goal 4 — LIVE on dev-public: edit a chunk, prove via pgvector that the embedding changed and the new text is retrievable by `/answers`.

## ADRs

### D1-supersede — Allow bounded single-chunk mutation with mandatory re-embed (supersedes theo-rag chunks read-only ADR D1)

- **Decision:** Add exactly one chunk mutation endpoint, `PATCH /v1/chunks/{id}`, that changes only a chunk's `text` and, atomically in the same request, recomputes its embedding and content-hash. No chunk create, no chunk delete, no re-chunking (boundaries immutable), no bulk mutation.
- **Rationale:** The read-only ADR D1 existed because chunks were considered a pure derivative of ingest. The product need (fix a bad chunk without re-ingesting) requires targeted mutation. Constraining the mutation to *text + mandatory re-embed of a single chunk* keeps the derivative invariant intact (embedding always matches text) while unlocking the use case. Per `rules/architecture.md § 2`, the mutation stays behind the data-plane's own repository + ownership check, so the isolation boundary is unchanged.
- **Alternatives considered:**
  - *Delete + re-ingest the document* — rejected: loses the other chunks' identity/history, re-pays full embedding cost, and is not "edit a chunk".
  - *Client-side edit stored only in the BFF* — rejected: retrieval happens in theo-rag against its own `chunks` table; an edit not persisted + re-embedded there is invisible to `/answers` (the whole point).
  - *Allow arbitrary chunk CRUD (create/delete/re-split)* — rejected (YAGNI + risk): re-chunking breaks index/offset invariants and dedupe; out of scope.
- **Consequences:** Enables the feature. Constrains: text is the only mutable field; embedding is never client-supplied (always server-recomputed → no "poisoned vector" vector-injection risk); content-hash recomputed so a future re-ingest dedupes against the edited text.

### D2 — Re-embed synchronously within the PATCH request (not via the ingest job queue)

- **Decision:** The re-embed runs inline in the PATCH handler (one embedding call for one chunk) and the response returns only after the new vector is persisted.
- **Rationale:** A single chunk is one cheap embedding call (sub-second); synchronous keeps the contract simple (no job status polling for one chunk) and the LIVE assertion deterministic (embedding is present when 200 returns). Reuses the ingest embedder (`chunk-stage`) — `rules/parsimony-ladder.md` rung 4 (reuse installed capability).
- **Alternatives considered:** *Enqueue a re-embed job on pg-boss* — rejected: adds status-polling UX + worker dependency (and the worker had cross-version instability this session) for a one-chunk operation; the async path is only justified for bulk (explicitly out of scope).
- **Consequences:** PATCH latency includes one embedding round-trip (external I/O → see Failure scenarios). If the embedding call fails, the whole PATCH fails atomically (no partial write).

### D3 — BFF surfaces chunk routes under the existing `/v1/dashboard/rag` per-tenant group

- **Decision:** The three new routes mount under the existing `/v1/dashboard/rag` group in `cmd/main.go` alongside M11/M13 routes, reusing the per-tenant key resolver + auth scopes (`rag:read` for the two GETs, `rag:write` for PATCH).
- **Rationale:** DIP + DRY — the dashboard handler already depends on `RagDataClient`; adding methods there keeps one seam. Mirrors M11 `UploadDocumentFile` exactly (`cmd/main.go:174`).
- **Alternatives considered:** *A separate chunks handler struct* — rejected: unnecessary second seam for three thin proxies; violates KISS.
- **Consequences:** `RagDataClient` interface grows by three methods; every fake in tests must implement them.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Reversing read-only ADR D1 opens a write path to the corpus that did not exist; a bug could corrupt chunk text/embedding | Medium | Bounded contract (text-only + server-side re-embed), workspace-scoped ownership check reused from GET, transactional write, TDD incl. cross-workspace 403/404 test | data-plane |
| Edit + re-embed changes retrieval results silently for anyone querying that collection (no audit/history in scope) | Medium | Out-of-scope history noted in Unresolved Questions; log an audit line (who/when/chunk) in theo-rag on mutation; content-hash recompute keeps re-ingest consistent | data-plane |
| Embedding-provider call inside the request adds latency + a new failure mode to a previously read-only surface | Low | Synchronous single call, typed error on failure with atomic rollback (Failure scenarios §); timeout bounded | data-plane |
| Concurrent edits to the same chunk could lose an update (last-writer-wins) | Low | `UPDATE ... WHERE id=$ AND workspace_id=$` is atomic; add optimistic guard on content-hash (reject if the chunk's current hash != the hash the client last saw) — see Concurrency tests | data-plane |
| Cross-repo deploy (theo-rag + BFF + dashboard) is 3 artifacts; a partial deploy shows UI without backend (the 405 we hit this session) | Medium | Deploy order enforced in Final Phase: theo-rag → BFF → dashboard; each validated before the next | eng-lead |

## Unresolved Questions

- Q1 — Should an edited chunk keep a version history / be revertible? (This plan does NOT implement history — edit is destructive-with-audit-log. Confirm that's acceptable for v1.)
- Q2 — When a chunk's text is edited, should the parent document's `content_hash`/`chunk_count` or `updated_at` be touched so the doc list reflects "modified"? (Plan touches only the chunk row + logs; doc-level staleness signal is deferred.)
- Q3 — Optimistic-concurrency: reject on stale content-hash (return 409) vs last-writer-wins? (Plan implements the 409 guard; confirm the UX — dashboard shows "chunk changed, reload".)
- Q4 — Retrieval cache: does theo-rag cache embeddings/answers such that a re-embed needs an explicit invalidation beyond the DB write? (Baseline shows retrieval reads the `chunks` table directly; assumed no separate cache. `/edge-case-plan` to confirm against theo-rag's retrieval path.)

## Dependency Graph

```
Phase 1 (theo-rag PATCH + re-embed) ──▶ Phase 2 (BFF proxies) ──▶ Phase 3 (dashboard UI)
        │                                                                    │
        └──────────────────────────────────────────────────────────────────▼
                                                        Final Phase: Integration Validation (LIVE)
```

Sequential: Phase 2 depends on Phase 1's endpoint contract; Phase 3 depends on Phase 2's BFF routes. The three read-path pieces (list/get) within each phase can be built alongside the write path but tests are per-task. Final Phase runs only after all three deploy.

---

## Phase 1: theo-rag — chunk mutation endpoint with mandatory re-embed

**Objective:** Add `PATCH /v1/chunks/{id}` to theo-rag that updates a chunk's text, re-embeds it, and persists the new vector + content-hash, workspace-scoped and transactional.

### T1.1 — `chunksRepo.updateText` (repository: update text + embedding + content-hash in one transaction)

#### Objective
Add a repository method that, given `(workspace_id, chunk_id, newText, newEmbedding, newHash, expectedHash?)`, updates the row atomically and returns the updated chunk (or a typed conflict/not-found).

#### Why this step (action + reasoning)
1. **What this step does** — introduces `updateText` on the chunk repository that issues `UPDATE chunks SET text, embedding, content_hash WHERE id AND workspace_id [AND content_hash = expected]` in a transaction.
2. **Why it is necessary now** — the handler (T1.2) must not embed SQL; per `rules/architecture.md § 2` the persistence detail lives in the repository. The optional `expectedHash` guard is what makes concurrent edits safe (D1-supersede Consequences + Drawback row 4). Doing it first gives T1.2 a clean seam to call.

#### Evidence
theo-rag `handlers/chunks.ts:80` already receives `chunksRepo` (read methods `get`, `listByDocument`); the `chunks` table + `vector(1536)` type are in `schema.ts` (~line 28 for `vector`, chunks table ~line 302). Re-embed reuses the embedder wired for ingest (`chunk-stage.ts`).

#### Files to edit
```
theo-rag: packages/core/src/domain/graph-store/chunk-store (chunk repository) — add updateText(scope, id, text, embedding, hash, expectedHash?)
theo-rag: packages/core/src/.../chunk-store.mutation.test.ts (NEW) — RED tests first
```

#### Deep file dependency analysis
- The chunk repository today implements reads used by `registerChunksRoutes` (Baseline row). Adding `updateText` is additive; existing `get`/`listByDocument` signatures unchanged (invariant).
- Downstream: only T1.2 (the handler) will call `updateText`. No other caller (grep before merge).

#### Deep Dives
- **Data structures:** `updateText(scope: {workspaceId}, id: string, text: string, embedding: number[]/*1536*/, contentHash: string, expectedHash?: string): Promise<Chunk | {conflict:true} | null>`.
- **Algorithm:** single `UPDATE ... RETURNING *`; when `expectedHash` provided, add `AND content_hash = expectedHash`; 0 rows affected + row exists → conflict (409); row absent/cross-workspace → null (404).
- **Invariants:** embedding length MUST be 1536 (assert before write); `workspace_id` predicate always present (isolation); text non-empty.
- **Edge cases:** identical text (hash unchanged) — still allowed (re-embed is a no-op vector but the call succeeds); empty text rejected upstream (T1.2 validation).

#### Tasks
1. Add `updateText` to the chunk repository interface + Drizzle implementation.
2. Guard embedding dimension (1536) and non-empty text at the repo boundary (defense in depth).
3. Return typed outcomes (updated / conflict / not-found).

#### TDD
```
RED:  updates_text_embedding_and_hash_in_one_row() — after updateText, SELECT shows new text + new embedding + new hash
RED:  rejects_cross_workspace_chunk() — updateText with wrong workspace_id → null (no row touched)
RED:  conflict_when_expected_hash_stale() — expectedHash != current → {conflict:true}, row unchanged
RED:  rejects_wrong_embedding_dimension() — embedding length != 1536 → throws typed error, no write
GREEN: implement updateText
REFACTOR: extract the 1536 constant to the shared vector type module (DRY)
VERIFY: pnpm --filter @usetheo/rag-core test
```

#### Concurrency tests

This task is concurrency sensitive: the DB transaction is mutated by concurrent writers. The test below is a race detector style check running concurrent parallel transactions with an atomic single-winner invariant (no lost update):

```
RACE: two_concurrent_updateText_same_chunk_last_writer_wins_or_conflict() — spawn 2 updateText with the SAME expectedHash; assert exactly ONE succeeds and the other returns {conflict:true} (no Lost Update). Uses Promise.all over two transactions against a real Postgres (testcontainer/pg).
```

#### Acceptance Criteria
- [ ] `updateText` writes text+embedding+hash atomically, workspace-scoped.
- [ ] Stale-hash concurrent edit returns conflict (no lost update).
- [ ] Pass: coverage ≥ 90% on the repository file; critical path (the UPDATE) 100%.
- [ ] Pass: lint zero warnings; file ≤ 500 lines.

#### DoD
- [ ] All T1.1 tests green — `pnpm --filter @usetheo/rag-core test`
- [ ] Zero type errors — `pnpm --filter @usetheo/rag-core typecheck`
- [ ] Zero lint warnings

### T1.2 — `PATCH /v1/chunks/{id}` handler (validate → ownership → re-embed → updateText)

#### Objective
Add the mutation route that validates the body, checks document ownership (reusing the GET path's check), re-embeds the new text via the ingest embedder, and calls `updateText`.

#### Why this step (action + reasoning)
1. **What this step does** — registers `PATCH /v1/chunks/:id` in `chunks.ts` (scope `rag:write`), wires it in `app.ts`.
2. **Why it is necessary now** — this is the endpoint the BFF (Phase 2) consumes; it must exist + be contract-stable before the BFF can proxy it (Dependency Graph). Re-embed-in-handler realizes ADR D2.

#### Evidence
`chunks.ts` already has the ownership check (`documentsRepo.get(ws, chunk.document_id)` at ~line 124 for the GET-one path) — reuse it. `registerChunksRoutes` wired at `app.ts:495` receives the repos + (to add) the embedder.

#### Files to edit
```
theo-rag: packages/api/src/server/handlers/chunks.ts — add PATCH route + createRoute OpenAPI def; inject embedder
theo-rag: packages/api/src/server/app.ts — pass the ingest embedder into registerChunksRoutes(app, chunksRepo, documentsRepo, embedder)
theo-rag: packages/api/src/server/handlers/chunks.mutation.test.ts (NEW) — RED tests first
```

#### Deep file dependency analysis
- `chunks.ts` today registers two GET routes (Baseline row); adding a PATCH is additive, GET routes unchanged (invariant).
- `app.ts:495` call signature grows by one arg (embedder) — the embedder singleton already constructed in `app.ts` for ingest is reused (grep for its construction; do not create a second).
- Downstream: BFF `data_client.go` (Phase 2) is the consumer.

#### Deep Dives
- **Signature:** `PATCH /v1/chunks/{id}` body `{ text: string, expected_content_hash?: string }` → 200 `{ id, text, index, content_hash, reembedded: true }` / 400 (empty text) / 404 (unknown or cross-workspace) / 409 (stale hash) / 502 (embed provider failure).
- **Algorithm:** load chunk (workspace-scoped) → 404 if none → ownership check on parent doc → validate text non-empty → `embed(text)` → compute `sha256(text)` → `updateText(scope, id, text, vector, hash, expected?)` → map conflict→409.
- **Invariants:** the response is returned only after the vector is persisted (D2); embedding never taken from the client.

#### Pseudo-code / Signatures
```pseudocode
patchChunk(ctx, id, body):
  chunk = chunksRepo.get(ws(ctx), id)
  if !chunk: return 404
  if !documentsRepo.get(ws(ctx), chunk.document_id): return 404   # ownership, mirrors GET
  if isEmpty(body.text): return 400 typed("EMPTY_CHUNK_TEXT")
  vector = await embedder.embed(body.text)        # reuse ingest embedder (D2)
  hash   = sha256(body.text)
  res = await chunksRepo.updateText(ws(ctx), id, body.text, vector, hash, body.expected_content_hash)
  if res == conflict: return 409 typed("CHUNK_CONTENT_STALE")
  if res == null:     return 404
  return 200 { id, text: res.text, index: res.index, content_hash: hash, reembedded: true }

# Example
input:  PATCH /v1/chunks/ch_9 {text: "Corrected sentence."}
output: 200 {id:"ch_9", text:"Corrected sentence.", index:3, content_hash:"a1b2…", reembedded:true}
```

#### Tasks
1. Add `patchChunkRoute` (createRoute) + `app.patch('/v1/chunks/:id', requireScopeOnPrincipal('rag:write'), handler)`.
2. Inject the ingest embedder into `registerChunksRoutes`; wire in `app.ts`.
3. Emit an audit log line (`chunk.edited`, workspace, chunk id, actor) on success (Drawback row 2 mitigation).

#### TDD
```
RED:  patch_updates_text_and_reembeds() — 200; SELECT shows new text; embedding differs from pre-edit
RED:  patch_rejects_empty_text() — 400 EMPTY_CHUNK_TEXT
RED:  patch_404_on_cross_workspace() — chunk of another workspace → 404
RED:  patch_409_on_stale_expected_hash() — expected_content_hash mismatch → 409 CHUNK_CONTENT_STALE
RED:  patch_requires_rag_write_scope() — token with only rag:read → 403
GREEN: implement handler + wiring
REFACTOR: share the ownership-check helper with the GET-one handler (DRY)
VERIFY: pnpm --filter @usetheo/rag-api test
```

#### Concurrency tests

The handler holds no shared mutable state — it is single-threaded per request; the concurrent-edit race is owned + proven at the repository layer (T1.1), and this handler only maps the resulting conflict to a deterministic 409.

(none — single-threaded)

#### Failure scenarios (external I/O) — see plan-level § Failure scenarios (embedding provider).

#### Acceptance Criteria
- [ ] PATCH returns 200 only after the vector is persisted; embedding changed.
- [ ] 400/403/404/409 typed errors as specified; no internal terms leak.
- [ ] Pass: coverage ≥ 90% on `chunks.ts`; the PATCH path 100%.
- [ ] Pass: lint zero warnings; file ≤ 500 lines (split if `chunks.ts` exceeds).

#### DoD
- [ ] T1.2 tests green — `pnpm --filter @usetheo/rag-api test`
- [ ] Zero type errors; zero lint warnings
- [ ] `/v1/openapi.json` includes the PATCH route (registry registration)

---

## Phase 2: theo-cloud BFF — per-tenant chunk proxies

**Objective:** Expose `GET /v1/dashboard/rag/documents/{id}/chunks`, `GET /v1/dashboard/rag/chunks/{id}`, `PATCH /v1/dashboard/rag/chunks/{id}` proxying theo-rag with the per-tenant key + typed errors.

### T2.1 — `RagDataClient` methods + `data_client.go` HTTP calls (ListChunks, GetChunk, UpdateChunk)

#### Objective
Add three methods to the `RagDataClient` interface + concrete HTTP implementations forwarding to theo-rag with the resolved per-tenant key.

#### Why this step (action + reasoning)
1. **What this step does** — extends the DIP port + adapter that the dashboard handler depends on.
2. **Why it is necessary now** — the handler (T2.2) depends on the interface, not the HTTP client (`rules/architecture.md § 2`); the port must gain the methods first. Mirrors M11 `UploadDocumentFile` (`data_client.go`).

#### Evidence
`rag_dashboard.go:29` declares `RagDataClient` (incl. `UploadDocumentFile`, `CommunityReport`); `data_client.go` implements them with `WithKeyResolver` (line 461 in main wiring). Re-use the same request builder.

#### Files to edit
```
internal/routes/rag_dashboard.go — add ListChunks/GetChunk/UpdateChunk to RagDataClient interface
internal/rag/data_client.go — implement the three HTTP calls (GET/GET/PATCH) forwarding opaque credential
internal/rag/data_client_test.go (or existing) — RED tests against an httptest theo-rag stub
```

#### Deep file dependency analysis
- `RagDataClient` interface (Baseline row) — additive; every fake in `rag_dashboard_test.go` must implement the new methods (compile-time forcing function → update fakes in T2.2).
- `data_client.go` — new methods reuse the per-tenant key path (invariant: opaque forward, never log the key — Rule 3 + security).

#### Deep Dives
- **Signatures (Go):** `ListChunks(ctx, docID string, cursor string) (json.RawMessage, error)`, `GetChunk(ctx, id string) (json.RawMessage, error)`, `UpdateChunk(ctx, id string, body json.RawMessage) (json.RawMessage, error)`.
- **Invariants:** map theo-rag 404→typed `CHUNK_NOT_FOUND`, 409→`CHUNK_CONTENT_STALE`, 400→`INVALID_REQUEST`; forward `rag:read`/`rag:write` via the resolver; never surface internal URLs/terms (Rule 3).

#### TDD
```
RED:  list_chunks_forwards_cursor_and_returns_body()
RED:  get_chunk_maps_404_to_typed_error()
RED:  update_chunk_maps_409_to_content_stale()
RED:  update_chunk_forwards_per_tenant_key_not_logged()
GREEN: implement the three methods
REFACTOR: extract a shared doRaw(method, path, body) helper if the three duplicate (DRY)
VERIFY: cd theo-cloud && go test ./internal/rag/...
```

#### Concurrency tests

The BFF is a stateless proxy — each request is handled independently with no shared mutable state added by this task.

(none — single-threaded)

#### Acceptance Criteria
- [ ] Three `RagDataClient` methods are implemented and the interface compiles across all fakes — verified by `go build ./...` returning exit 0.
- [ ] Error mapping typed; key never logged.
- [ ] Pass: `go vet` clean; coverage ≥ 90% on `data_client.go` new methods.

#### DoD
- [ ] `go test ./internal/rag/...` green; zero vet/lint.

### T2.2 — Dashboard handlers + route registration (`rag_dashboard.go` + `cmd/main.go`)

#### Objective
Add handler methods `ListDocumentChunks`, `GetChunk`, `UpdateChunk` on `RagDashboardHandler` and register the three routes under `/v1/dashboard/rag`.

#### Why this step (action + reasoning)
1. **What this step does** — thin handlers that call the T2.1 client methods + register routes at `cmd/main.go` alongside M11/M13.
2. **Why it is necessary now** — completes the BFF surface the dashboard consumes; realizes ADR D3.

#### Evidence
Route block `cmd/main.go:161–174` (existing `r.Get("/documents", …)`, `r.Post("/documents/file", …)`) is the exact insertion point + scope pattern.

#### Files to edit
```
internal/routes/rag_dashboard.go — add the 3 handler methods (rag:read x2, rag:write x1)
cmd/main.go — register: r.Get("/documents/{id}/chunks", ...), r.Get("/chunks/{id}", ...), r.Patch("/chunks/{id}", ...)
internal/routes/rag_dashboard_test.go — RED component tests (200 + 404 + 409 + scope)
```

#### Deep file dependency analysis
- `rag_dashboard.go` handlers mirror `CommunityReport`/`UploadDocumentFile` (Baseline). `cmd/main.go` route block (Baseline row) — additive, ordering preserved.
- Downstream: the dashboard (Phase 3) consumes these paths.

#### TDD
```
RED:  GET_documents_id_chunks_returns_list()
RED:  PATCH_chunks_id_updates_and_returns_reembedded_true()
RED:  PATCH_chunks_id_maps_409_content_stale()
RED:  chunk_routes_reject_missing_scope() — rag:read token on PATCH → 403
GREEN: implement handlers + register routes
REFACTOR: none expected
VERIFY: cd theo-cloud && go test ./internal/routes/...
```

#### Concurrency tests

The handlers are stateless request-scoped proxies onto `RagDataClient`; they add no shared mutable state.

(none — single-threaded)

#### Acceptance Criteria
- [ ] Three routes are registered under `/v1/dashboard/rag` with the correct scopes — verified by a route-table assertion test returning the expected `rag:read`/`rag:write` per path.
- [ ] Typed errors + Rule 3 (no `theo-rag`/internal terms in messages).
- [ ] Pass: coverage ≥ 90% on new handlers; files ≤ 500 lines (split `rag_dashboard.go` if it exceeds).

#### DoD
- [ ] `go test ./internal/...` green; zero lint; CHANGELOG `[Unreleased]` updated.

---

## Phase 3: dashboard — chunk viewer + editor

**Objective:** From the Documents page, open a document to view its chunks, edit a chunk's text, and Save → PATCH → re-embed with status feedback.

### T3.1 — `chunks-panel.tsx` (Sheet: list chunks, inline edit, save → PATCH)

#### Objective
Create a chunk panel (Sheet) opened from a document row that lists chunks (text + index) and lets the user edit one chunk's text and save.

#### Why this step (action + reasoning)
1. **What this step does** — new component using `@usetheo/ui` `Sheet` (the M13 GraphRAG pattern) + `cloudFetch` to the BFF chunk routes.
2. **Why it is necessary now** — this is the user-facing capability (Goal); it depends on Phase 2 routes existing.

#### Evidence
`dashboard/src/pages/rag/graphrag.tsx` uses `Sheet` for the community-report drill-down (Prior Art); `documents.tsx:316` is the host page (doc list table) — add an "open chunks" affordance per row.

#### Files to edit
```
dashboard/src/pages/rag/chunks-panel.tsx (NEW) — the Sheet component (list + inline editor + save)
dashboard/src/pages/rag/documents.tsx — add per-row "View chunks" action that opens the panel
dashboard/src/pages/rag/chunks-panel.test.tsx (NEW) — RED vitest first
```

#### Deep file dependency analysis
- `documents.tsx` (Baseline) — additive: a new column/action button + panel state; upload + doc-list behavior unchanged (invariant).
- New `chunks-panel.tsx` depends on `@/lib/api` `cloudFetch` (existing) and `@usetheo/ui` `Sheet`, `Textarea`, `Button`, `Badge` (existing design system).

#### Deep Dives
- **State:** `openDocId`, `chunks` (query `GET /v1/dashboard/rag/documents/{id}/chunks`), per-chunk `editingText`, `saving`, `status` (idle/reembedding/ready/error).
- **Save flow:** on Save → `PATCH /v1/dashboard/rag/chunks/{id}` `{text, expected_content_hash}` → on 200 update the row + show "re-embedded"; on 409 show "chunk changed — reload"; on 4xx/5xx typed error toast.
- **Edge cases:** empty text → Save disabled; unchanged text → Save disabled; long chunk → scroll.

#### TDD
```
RED:  renders_chunk_list_on_open() — mock GET returns 2 chunks → both rendered with index+text
RED:  save_disabled_when_text_unchanged_or_empty()
RED:  save_calls_patch_with_expected_hash_and_shows_reembedded()
RED:  conflict_409_shows_reload_hint()
GREEN: implement chunks-panel + wire the documents.tsx action
REFACTOR: none expected
VERIFY: cd theo-cloud/dashboard && npx vitest run src/pages/rag/chunks-panel.test.tsx
```

#### Concurrency tests

The component is a single-threaded UI; the concurrent-edit invariant is enforced server-side via the 409 path (asserted in T1.1), and the UI only renders the reload hint.

(none — single-threaded)

#### Acceptance Criteria
- [ ] Opening a document renders its chunk list and editing + Save issues exactly one `PATCH` — verified by `save_calls_patch_with_expected_hash_and_shows_reembedded` asserting the fetch mock was called once with the chunk id and the panel shows "re-embedded".
- [ ] 409 renders a reload hint (no silent overwrite).
- [ ] Pass: coverage ≥ 90% on `chunks-panel.tsx`; a11y (labeled controls); files ≤ 500 lines.

#### DoD
- [ ] vitest green; `npx tsc -b --noEmit` zero errors; eslint zero warnings.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Edit a chunk's text (mutation didn't exist — ADR D1 read-only) | T1.1, T1.2 | New `updateText` repo + `PATCH /v1/chunks/{id}` handler; ADR D1-supersede |
| 2 | Regenerate embedding on edit | T1.2 (D2) | Synchronous re-embed via ingest embedder inside PATCH; vector persisted before 200 |
| 3 | View a document's chunks in the dashboard | T2.1, T2.2, T3.1 | BFF read proxies + Sheet listing |
| 4 | Edit + save chunk from the dashboard | T2.1, T2.2, T3.1 | BFF PATCH proxy + inline editor |
| 5 | Workspace isolation on read+write | T1.1, T1.2, T2.2 | `workspace_id` predicate + ownership check reused from GET; cross-workspace tests |
| 6 | Concurrent edit safety | T1.1, T1.2 | Optimistic content-hash guard → 409; race test |
| 7 | Typed errors + Rule 3 (no internal terms) | T1.2, T2.1, T2.2 | Typed 400/403/404/409/502; BFF message scrub |
| 8 | LIVE proof embedding changed + retrievable | T1.2 (re-embed) + Final Phase | pgvector pre/post diff + `/answers` returns new text |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @usetheo/rag-core test` + `pnpm --filter @usetheo/rag-api test` (theo-rag), `go test ./internal/...` (BFF), `npx vitest run` (dashboard)
- [ ] Zero type errors — `pnpm ... typecheck` + `go build ./...` + `npx tsc -b --noEmit`
- [ ] Zero lint warnings — theo-rag eslint + `golangci-lint run` + dashboard eslint
- [ ] File-size budget respected (≤ 500 lines/file per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — the two existing GET chunk routes + `RagDataClient` existing methods unchanged
- [ ] Plan-specific: ADR D1-supersede recorded; audit log line on chunk edit; re-embed proven to change the pgvector value
- [ ] **Runtime-metric proof** — the LIVE `chunk-edit-reembed` check observes the embedding delta (not just compiles)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Embedding provider `text-embedding-3-small` (HTTP, OpenAI) | 5xx / timeout during re-embed inside PATCH | Stub embedder throws / returns 503 in T1.2 test | PATCH returns 502 typed `REEMBED_FAILED`; **no partial write** (text NOT updated without a matching vector — atomic) |
| Postgres `chunks` (DB, transaction) | connection drop mid-UPDATE | testcontainer pg + terminate backend in T1.1 test | transaction rolls back; chunk row unchanged; caller sees typed error; retry-safe |
| theo-rag (HTTP, from BFF) | 409 content-stale / 404 | httptest stub returns 409/404 in T2.1 test | BFF maps to typed `CHUNK_CONTENT_STALE` / `CHUNK_NOT_FOUND`; dashboard shows reload hint / not-found (no internal terms) |

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1–3 deploy, in strict order (theo-rag → BFF → dashboard) to avoid the split-deploy 405 seen this session.

### Execution

```
# theo-rag (data-plane, droplet host process)
pnpm --filter @usetheo/rag-core test && pnpm --filter @usetheo/rag-api test
# deploy: restart the rag-api + worker host processes on the droplet

# BFF (theo-cloud)
cd theo-cloud && go test ./... && golangci-lint run
# deploy: docker build -f theo-cloud/Dockerfile.local -t theo-cloud:local <workspace-root>
#         k3d image import theo-cloud:local -c theo-mgmt
#         kubectl -n theo-system rollout restart deploy/theo-cloud

# dashboard
cd theo-cloud/dashboard && npx vitest run && npx tsc -b --noEmit && npx eslint .
# deploy: npm run build  (Caddy serves dashboard/dist)
```

LIVE (dev-public, real browser via chrome-devtools MCP against app-dev.usetheo.dev), non-destructive:

```
1. RAG → Documents → open a document with ≥1 chunk → chunk list renders (view proof)
2. Capture the target chunk's embedding pre-edit:
   psql therag: SELECT substring(embedding::text,1,40) FROM chunks WHERE id='<chunk>'
3. Edit the chunk text → Save → panel shows re-embedded/ready
4. Capture embedding post-edit → assert it DIFFERS from step 2 (re-embed proof)
5. POST /answers with a question that should hit the edited text → assert the new text is retrieved
```

### Acceptance Criteria

- [ ] All suites green (theo-rag core+api, BFF Go, dashboard vitest)
- [ ] Coverage ≥ 90% on changed files; PATCH + updateText critical paths 100%
- [ ] Zero type errors; zero lint warnings
- [ ] Runtime proof — pgvector embedding value DIFFERS pre/post edit (LIVE)
- [ ] Failure scenarios green — embed-5xx → 502 no partial write; DB drop → rollback; theo-rag 409 → typed reload hint
- [ ] `/answers` returns the edited chunk's new text LIVE

### If Validation Fails

1. Separate plan-caused failures from pre-existing (data-plane worker version chaos noted this session is pre-existing infra, not this plan).
2. Fix plan-caused failures; re-run the chain.
3. Log pre-existing issues in the PR; they do not block.
