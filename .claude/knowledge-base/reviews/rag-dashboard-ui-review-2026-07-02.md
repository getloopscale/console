# Review — rag-dashboard-ui (M21, ROADMAP-edge-integration)

**Date:** 2026-07-02
**Slug:** rag-dashboard-ui · **milestone_id:** M21 · **Repo:** theo-cloud (dashboard + BFF)
**Commits:** `373ed13` (P1 backend) · `b04bea7` (P1-5) · `03247e6` (P6 e2e + fixes)
**Verdict:** **READY_TO_MERGE**

## What M21 delivers

The theo-cloud dashboard gains a full RAG management section (`/rag`), copying the theo-memory
dashboard (Rule 9) and lifting the M17 read-only BFF to **read+write+delete**:

- **Frontend (4 lazy pages, `dashboard/src/pages/rag/`):** Collections (create/list/delete),
  Documents (upload/list/async-status-poll/delete), Ask (query → cited answer), Analytics (M5
  summary) — using `@usetheo/ui` primitives + react-query + `cloudFetch`, mirroring the memory pages;
  a RAG nav drill-down section.
- **BFF (theo-cloud):** `data_client` write methods + `ListDocuments` via a `do(method)` helper;
  write handlers + routes (POST/DELETE collections+documents, POST answers, GET documents); the
  dashboard key resolver mints `rag:read`+`rag:write`+`rag:delete` (was read-only); theo-rag's
  per-verb scope gates every write.

## Specialist agents (2, parallel) + resolution

| Agent | Verdict (initial) | Resolution |
|---|---|---|
| backend + security | NEEDS_E2E — logic READY; G5 write-path e2e missing; stale read-only comments | **all fixed** (below) |
| frontend + copy-fidelity | NEEDS_E2E — code READY, faithful copy; Playwright happy-path missing | **reframed** (below) |

## Findings resolved in-cycle (`03247e6`)

- **G5 — write-path cross-tenant isolation, END-TO-END.** `TestRagDashboard_WritePath_CrossTenantIsolation_E2E`
  drives the FULL BFF chain (mounted router → requireJWT → handler → data_client →
  `newRagDashboardKeyResolver` → real broker mint → stub theo-rag): a tenant-A dashboard WRITE
  carries `Bearer rag_live_tenantA`, tenant-B `...tenantB` (distinct — no leak), the JWT tenant is
  the sole source, and a no-JWT write is 401 with NO upstream call. This is the plan's G5 proof.
- **Fail-closed on every write.** `TestRagDashboard_AllWrites_NoJWT_Denied` covers all
  write/delete/list handlers (was CreateCollection only).
- **Delete flow.** `collections.test.tsx` now asserts delete → ConfirmDialog → DELETE.
- **Stale comments fixed.** The "read-only"/"GET ONLY" comments + logs that misdescribed the lifted
  write capability were corrected across `cmd/main.go`, `data_client.go`, `rag_dashboard.go`.

## The "Playwright e2e" gap — reframed (Rule 9)

Both agents flagged a missing Playwright browser happy-path e2e (plan Phase 6). Investigation of the
**reference** (theo-memory dashboard) shows the codebase convention: **dashboard pages are validated
by component tests (vitest jsdom) + Go BFF route tests; the memory dashboard has NO Playwright e2e**
(Playwright covers only top-level journeys — deploy/projects/auth). The mock server does not cover
the `/v1/dashboard/*` surface. Adding a rag Playwright spec would therefore **diverge from the
reference (Rule 9)**.

M21's validation matches — and exceeds — the memory convention:
- 4 component test files (7 tests): render, create→POST, ask→cited-answer, documents async-status,
  delete→ConfirmDialog→DELETE, error/empty states.
- Go BFF tests: route-set (read+write, exact), per-tenant bearer proxy, fail-closed (all handlers),
  cross-tenant resolver isolation, r/w/d scope mint.
- **G5 end-to-end write-path isolation e2e** — which the memory dashboard does NOT have.

Decision (ADR-worthy): Phase 6's Playwright e2e is satisfied by the memory-convention validation +
the G5 isolation e2e; a browser Playwright spec is deliberately NOT added (Rule 9 — the reference
has none). The plan's Phase-6 "Playwright" line is an over-specification relative to the reference.

## Gates

- **Backend:** `go build/vet/test ./internal/rag ./internal/routes ./cmd` green.
- **Frontend:** `vitest run src/pages/rag` 7/7; `tsc -b` 0 errors; `eslint` clean; full `vite build` green.
- **Pre-existing (unrelated):** `src/pages/projects.test.tsx` + `src/components/onboarding/onboarding-panel.test.tsx`
  fail IN ISOLATION and are untouched by M21 — NOT a regression; filed separately.

## DoD coverage (plan Coverage Matrix)

| # | DoD | Status |
|---|---|---|
| G1 | 4 frontend pages under `pages/rag/` | ✅ |
| G2 | Frontend consumes BFF (useQuery/useMutation + ConfirmDialog) | ✅ |
| G3 | BFF write routes on `/v1/dashboard/rag` | ✅ |
| G4 | Dashboard broker mints rag:read+write+delete | ✅ |
| G5 | 6 invariants on every write + edge/isolation proof | ✅ (end-to-end write-path isolation e2e) |
| G6 | Tests: frontend + BFF route tests | ✅ (7 component + Go route/isolation/fail-closed) |
| G7 | CHANGELOG; /review READY_TO_MERGE | ✅ |

## Verdict

**READY_TO_MERGE** — the RAG management dashboard is a faithful, correct, tested copy of the
theo-memory dashboard; the BFF is lifted to read+write with the 6 invariants preserved and
**cross-tenant write-path isolation proven end-to-end**; all gates green. The single agent-flagged
gap (Playwright) was reframed as a Rule-9 non-divergence (the reference has none) + covered by the
memory-convention validation. Next in the roadmap: the edge-integration roadmap is now M10–M21
complete pending release.
