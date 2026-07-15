# Review: rag-connectors-dashboard (theo-cloud #191)

**Date:** 2026-07-12
**Cycle:** cycle-review
**Reviewers (spawned agents):** 2 fresh-eyes (BFF/tenancy + frontend/cross-validation)
**Diff under review:** commit 28f4bc2 (impl) + 09b5330 (review fixes) on `develop`
**Plan:** `.claude/knowledge-base/plans/rag-connectors-dashboard-plan.md` (SHIPPABLE_WITH_CAVEATS 89.0)
**Code-quality:** PASS (`.claude/knowledge-base/audits/rag-connectors-dashboard-code-quality-2026-07-12.md`)

## Verdict: READY_TO_MERGE

No BLOCKER, no HIGH. One MEDIUM raised and **fixed** in 09b5330; two LOW (one fixed, one accepted for v1).

## Scope

Adds a RAG **Connectors** management surface to the dashboard (v1 = list + sync + delete),
proxied through the Model-B dashboard BFF. Connecting a NEW source (per-provider OAuth),
document-level enrichment, and webhooks are DISCLOSED out-of-scope follow-ups (plan D2/D3 +
CHANGELOG + the page's empty-state note). Closes the #191 headline ("no Connectors page; BFF
doesn't proxy").

## Findings

| # | Severity | Area | Status |
|---|---|---|---|
| F1 | MEDIUM | Delete 409 (sync-in-progress) silently swallowed — `remove` mutation had no error UI, ConfirmDialog hung with no feedback, contradicting the plan's own documented mitigation | **FIXED** 09b5330 — added `remove.isError` Alert + regression test |
| F2 | LOW | No test for the delete-error path | **FIXED** 09b5330 — "surfaces an error … 409 while syncing" test added |
| F3 | LOW | Sync success gives no positive toast (only a status flip on refetch) | ACCEPTED for v1 (additive later) |
| F4 | LOW | `rag_dashboard_test.go` new struct fields misaligned vs gofmt | **FIXED** 09b5330 — `gofmt -w` |

### BFF / tenancy reviewer — all PASS (READY_TO_MERGE)

- **Model-B tenancy:** all 3 handlers (`ListConnectors`/`SyncConnector`/`DeleteConnector`) gate on `authTenant` as the first statement, before any upstream call; fail-closed 401 `AUTH_REQUIRED` when no tenant. `TestRagDashboard_AllWrites_NoJWT_Denied` covers all 3 and asserts the stub was NOT called. Per-tenant key resolved through the same `getJSON`/`do` as collections — no master fallback.
- **Route invariant:** `cmd/main_test.go` `want` gained the 3 routes; `cmd/main.go` mounts them under `requireJWT` in the `/v1/dashboard/rag` block. Paths correct.
- **Proxy correctness:** `url.PathEscape` on the id in both mutating methods (injection-safe); sync passes through the 202 upstream body; upstream error → 502 (no leak/200), covered by `TestRagDashboard_Connectors_HappyPath`.
- **Interface completeness:** `RagDataClient` +3 methods, satisfied by both the real `*rag.DataClient` and the test stub (compiles).

### Frontend / cross-validation reviewer — MEDIUM fixed → READY_TO_MERGE

- Page mirrors the collections template: `useQuery(['cloud','/v1/dashboard/rag/connectors'])` + `cloudFetch` (BFF-only, never theo-rag directly) + `DataTable` + `ConfirmDialog`; sync POSTs `/…/{id}/sync`, delete DELETEs `/…/{id}`, both invalidate on success.
- Cross-validated the BFF proxy against the live theo-rag upstream: route paths, verbs, scopes (`rag:read/write/delete`), the `{items:[presentConnection]}` list shape, the `202 {status:'enqueued',connection_id}` sync body, the `204`/`409-while-syncing` delete — **all match**, including every Go struct JSON tag.
- Scope honest and consistent across plan ADRs, CHANGELOG, and the empty-state note (no overclaim of "connect").

## Quality gates

- `dashboard` vitest (connectors): **4/4 pass** (list+sync, empty-state, delete-confirm, delete-409-error).
- Full dashboard vitest: **1742 pass / 8 skipped**, no regressions.
- `tsc -b`: **exit 0**.
- `go test ./internal/routes -run RagDashboard`: **ok**; `go vet ./internal/routes`: clean.
- code-quality: **PASS**.

## Known out-of-diff issue (filed separately, NOT a #191 regression)

`cmd/main_test.go` `TestLensDashboard_ReadWriteRouteSet` FAILS on clean `develop` (a LENS
ADR-3 violation: mutating POST on read-only surface
`/v1/dashboard/lens/traces/{traceID}/enqueue-for-labeling`). Commit 28f4bc2 touches zero Lens
files — confirmed pre-existing via `git stash`. To be filed as a theo-cloud issue.

## Handoff

READY_TO_MERGE. This is a cross-repo change (theo-cloud), queued behind the theo-rag release
train; open the theo-cloud develop→main release PR per that repo's cadence.
