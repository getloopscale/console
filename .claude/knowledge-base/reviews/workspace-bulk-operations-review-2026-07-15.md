# Review: workspace-bulk-operations

**Date:** 2026-07-15
**Reviewers (spawned agents):** 2 (security · architecture+tests)
**Scope:** commits `51a00e5..c225a08` against plan v1.1 + edge-case review

## Verdict progression

| Stage | Verdict |
|---|---|
| Initial review | **NEEDS_FIXES** (no BLOCKER; 2 HIGH test gaps + security hardening) |
| After remediation | **READY_TO_MERGE** |

## Findings + resolution

| # | Sev | Agent | Finding | Resolution |
|---|---|---|---|---|
| SEC MEDIUM-1 | MEDIUM | security | bulk-delete body not capped with `http.MaxBytesReader` (DoS) — inconsistent with every sibling handler | Added `r.Body = http.MaxBytesReader(w, r.Body, bulkDeleteMaxBodyBytes=1 MiB)` before decode (`storage.go`) |
| SEC LOW-1 | LOW | security | client `Paths[]` bypass `ValidatePath` in proxy mode (request-shaping surface, NOT isolation break) | Handler now `ValidatePath`s every path → `failed[]` on reject, both storage modes reject identically (`storage.go`) |
| ARCH HIGH-1 | HIGH | arch | multi-page `DeletePrefix` pagination untested (fake `ListByPrefix` ignored limit/cursor) | Made the fake keyset-paginate; added `TestDeletePrefixOver_Paginates` (cursor advance) + `TestService_DeletePrefix_MultiPage` (1500 objects across pages) |
| ARCH HIGH-2 | HIGH | arch | frontend `confirmBulk` mutation + pure helpers untested (partial-failure/truncated/error/units) | Added `use-workspace-selection.test.ts` (toBulkRequest + selectionStats units) + 3 WorkspacePage tests (partial-failure toast, truncated message, network-error toast) |
| ARCH MEDIUM-2 | MEDIUM | arch | 1000 prefixes × 10000 = 10M objects per request unbounded | Handler now caps TOTAL objects per request at `bulkDeleteMaxTotalObjects=10000` (`truncated` beyond) |
| SEC MEDIUM-1(freed) / ARCH MEDIUM-1 | LOW | both | `freed_bytes` omits per-file deletes (best-effort; usage-bar re-fetch authoritative) | Accepted per plan EC-6 (documented contract simplification); no change |

## Security verdict (LIVE-confirmed)

**SECURE.** Tenant isolation is airtight — the tenant is always JWT-derived (`tenantOf` → `auth.GetUser`), never from the request body; every delete routes through `KeyForTenant`; object names fed to delete come from the tenant's own metadata rows. `safePrefix` rejects `""`/`/`/`.`/`..`/traversal/non-trailing-slash; `ListByPrefix` LIKE-escapes. Confirmed LIVE on dev-public: folder delete (recursive), idempotency, EC-1 overlap, EC-2 guard all GREEN.

## What's done well (agent-noted)

- `DeletePrefixOver` DRY extraction is genuine shared knowledge, correct + tested in both in-process and thin-proxy modes.
- DIP boundary clean; handler stays thin (no enumeration logic in `routes`).
- Frontend SRP split (`use-workspace-selection` hook + `workspace-preview-sheet` + `new-folder-dialog`) is cohesive, not LoC-gaming; `workspace.tsx` = 499 LoC.
- Wiring triad complete: production callers, mount regression test, metric wired + delta-asserted.

## Quality gates

- Go: `storage` + `routes` + `storageproxy` + `metrics` green; `go vet` clean; binary builds.
- Dashboard: 22 vitest green (2 files); `tsc --noEmit` 0 errors; eslint clean; `workspace.tsx` ≤ 500 LoC.

## Handoff

**READY_TO_MERGE.** All HIGH findings remediated with tests; security hardening applied; LIVE-validated on dev-public (backend). Frontend UI not LIVE-deployed due to a pre-existing dashboard build-toolchain breakage (`@theokit/ui` missing on droplet + `index.css` rollup error locally) — unrelated to this change.
