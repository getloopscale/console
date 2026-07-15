---
slug: workspace-bulk-operations
created_at: 2026-07-15
goal: Enable Workspace users to delete a whole folder and a multi-file selection in one action, measured by the new bulk-delete integration + vitest suites passing.
---

# Plan: Workspace bulk operations — multi-select + folder delete

> **Version 1.1** (2026-07-15 — absorbed 3 MUST-FIX from the edge-case review under `knowledge-base/reviews/`: idempotent not-found delete (D5/EC-1), trailing-slash-required prefixes (EC-2), hardened `safePrefix` (EC-3)). The TheoCloud dashboard Workspace (`/workspaces`) is a folder-browser over the flat M7 tenant blob store, but today a user can only delete ONE file at a time; a folder (which is just a key-prefix) cannot be deleted at all, and there is no multi-selection. This plan adds (1) a tenant-scoped, partial-failure-aware **bulk-delete** endpoint on the dashboard BFF that deletes an explicit list of files AND/OR whole folders (prefixes), and (2) a Workspace UI with row checkboxes, a selection action bar, a per-folder delete affordance, and a count+size ConfirmDialog. Because a folder can hold hundreds of objects (`skills/` = 548), deletion is a server-side prefix operation — never N client round-trips. Mass-delete is high blast radius, so it is tenant-scoped exactly like upload/download (EC-1) and reports partial failure honestly.

## Goal

> "Enable Workspace users to delete a whole folder or a multi-item selection in a single confirmed action so that the objects (and their freed quota) are removed server-side, measured by `TestStorageHandler_BulkDelete_*` (Go) + the workspace bulk-delete vitest suite passing GREEN."

## Context

Found during a real `theo storage sync` of a `.claude/` (2026-07-15): the Workspace UI has no folder-delete and no multi-select. The store is flat — folders are derived from `/` in object keys (`deriveEntries`, `workspace.tsx:68`); an empty folder carries a 1-byte `.keep` marker. Per-file delete exists (`deleteTarget: StorageFile` + `ConfirmDialog`, `workspace.tsx:127`/`:248`), but folder rows (`data-testid=folder-row`) only navigate. The dashboard BFF (`internal/routes/storage.go`, mounted via `StorageHandler.MountDashboardRoutes`) exposes only single-object `DELETE /v1/dashboard/storage/objects/{path...}`; there is no bulk/prefix delete anywhere. Deleting `skills/` today would mean 548 sequential UI clicks. This is a T2 change (new API contract + mass-delete blast radius) and goes through the full plan/TDD/review cycle.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `internal/storage/orchestrator.go` | 203 | `4a7c777` (2026-07-14) | The storage `Service` — `List`/`Delete`/`Upload`/… over `meta` + `store` | `Delete` stays single-object; `KeyForTenant` tenant-scoping (EC-1) unchanged; `List` keyset pagination (≤1000) unchanged |
| `internal/storage/orchestrator_test.go` | — | `4a7c777` (2026-07-14) | Unit tests for the `Service` (stubbed meta+store) | existing tests stay green |
| `internal/routes/storage.go` | 308 | `d1c26b2` (2026-07-15) | Dashboard + theo_live BFF handlers; `StorageService` interface (DIP); `MountDashboardRoutes` | error-mapping table (`statusForStorageErr`) reused; product-language messages (public-copy.md); `MountDashboardRoutes` stays testable |
| `internal/routes/storage_test.go` | 282 | `d1c26b2` (2026-07-15) | Handler tests via `stubStorageService` + `MountDashboardRoutes` | `stubStorageService` extended, not broken |
| `cmd/main.go` | 1413 | `d1c26b2` (2026-07-15) | Composition root; mounts `/v1/dashboard/storage` via `MountDashboardRoutes` | no new inline route — route added inside `MountDashboardRoutes` (SRP) |
| `internal/metrics/metrics.go` | — | (see git) | Prometheus counters (`theo_*`) | new counter registered once (no dup-registration panic) |
| `dashboard/src/pages/workspace.tsx` | 495 | `ec82238` (2026-07-15) | The folder-browser page (`deriveEntries`, preview Sheet, per-file delete) | `deriveEntries` pure + unit-tested; product language only (Rule 3); ≤ 500 LoC budget (split a `WorkspaceSelection` helper if exceeded) |
| `dashboard/src/pages/workspace.test.tsx` | 121 | `40aa8fd` (2026-07-15) | Vitest for the Workspace page | existing 9 tests stay green |
| `dashboard/src/lib/api.ts` | — | (see git) | `cloudFetch` (JSON) + `cloudFetchRaw` (bytes) — authenticated Bearer | reused as-is; bulk-delete uses `cloudFetch` (JSON body + JSON response) |

### Current callers / dependents

- **Symbol:** `StorageHandler.MountDashboardRoutes(r)` in `internal/routes/storage.go`
  - **Callers (production):** `cmd/main.go` (inside `r.Route("/v1/dashboard/storage", …)`)
  - **Callers (tests):** `internal/routes/storage_test.go` (`TestStorageHandler_DashboardMount_DownloadNestedObject`)
  - **External:** no — internal to theo-cloud.
- **Symbol:** `Service.Delete(ctx, tenantID, path)` in `internal/storage/orchestrator.go:124`
  - **Callers (production):** `internal/routes/storage.go` `StorageHandler.Delete`
  - **Callers (tests):** `internal/storage/orchestrator_test.go`, `internal/routes/storage_test.go` (`stubStorageService.Delete`)
  - **External:** no.
- **Symbol:** `StorageService` interface in `internal/routes/storage.go:24`
  - **Callers:** `*storage.Service` (prod), `stubStorageService` (test) — adding a method requires updating BOTH.
- **Symbol:** `deriveEntries(all, prefix)` in `dashboard/src/pages/workspace.tsx:68`
  - **Callers (production):** `WorkspacePage` render
  - **Callers (tests):** `workspace.test.tsx` (`deriveEntries` describe block)
  - **External:** no — exported for test only.

### Domain glossary

- **prefix / folder** — a folder is not a stored object; it is every key beginning with `folder/`. "Delete folder X" = delete every object under prefix `X/` plus the `X/.keep` marker.
- **`.keep` marker** — a 1-byte object that materializes an otherwise-empty folder so it appears in `deriveEntries`.
- **`KeyForTenant(tenantID, path)`** — server-side namespacing that prepends the tenant, guaranteeing an operation can never touch another tenant's keys (EC-1).
- **partial-failure** — a bulk op where some items succeed and some fail; the result reports both, and the list stays consistent on refresh (mirrors the sync engine's F-test-1 partial-apply).
- **BFF** — the `/v1/dashboard/storage/*` surface authenticated by the browser session (`requireJWT`), distinct from the theo_live_ key surface `/v1/storage/*`.

### Architecture boundaries affected

- `rules/architecture.md` — the handler (`internal/routes`) depends on the `StorageService` interface (DIP), not on `*storage.Service` directly; the new bulk-delete keeps that boundary. The store enumeration (List + Delete) lives in `internal/storage` (the Service), NOT in the handler — the handler only orchestrates the request/response shape.
- No new cross-package dependency direction is introduced; the mass-delete logic sits in the same layer as the existing `Delete`.

## Prior Art & Related Work

- **Internal — the sync engine's partial-apply (F-test-1):** `theo-cli` `SyncEngine.run` applies ops one-by-one, records per-op failures as `skipped` with a reason, and never aborts the whole batch (see `theo-cli/src/commands/storage-sync.ts` `run()`). The bulk-delete result shape (`deleted` + `failed[]`) mirrors this proven pattern.
- **Internal — EC-1 tenant isolation:** upload/download/delete all route through `KeyForTenant` so a client can never address another tenant's keys (`internal/storage/orchestrator.go`). Bulk-delete reuses it verbatim — the client sends relative paths/prefixes only.
- **Internal — 0-byte `.keep` marker fix (2026-07-15):** the folder-marker convention (`workspace.tsx onCreateFolder` writes a 1-byte `.keep`) is why folder-delete must also remove `{prefix}.keep`.
- **External — S3 `DeleteObjects` (batch delete) semantics:** AWS S3's batch delete returns per-key success/error, which is the same partial-failure contract adopted here (https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html). We do NOT call S3 batch directly — deletion goes through the existing `store.DeleteObject` per key so metadata + quota stay consistent.
- **Patterns skills:** (none identified — no `*-patterns` skill matches "workspace"/"storage"/"bulk-delete" in `.claude/skills/`).

## Objective

- [ ] Sub-goal 1 — `Service.DeletePrefix(ctx, tenant, prefix)` enumerates all objects under the prefix (paginated) and deletes each, returning counts + per-object failures, tenant-scoped.
- [ ] Sub-goal 2 — a `POST /v1/dashboard/storage/bulk-delete` handler accepts `{paths[], prefixes[]}`, orchestrates single + prefix deletes, and returns `{deleted, failed[], freed_bytes}`.
- [ ] Sub-goal 3 — a `theo_storage_objects_deleted_total` counter increments by the number actually deleted.
- [ ] Sub-goal 4 — the Workspace UI has row checkboxes + select-all (indeterminate state) + a selection action bar showing the count.
- [ ] Sub-goal 5 — folder rows get a Delete affordance; deleting a folder or a selection opens a ConfirmDialog showing item count + total size, then calls bulk-delete.
- [ ] Sub-goal 6 — partial failure is surfaced in product language; the list + usage bar refresh consistently after the op.

## ADRs

### D1 — Server-side prefix delete, not N client deletes
- **Decision:** folder/bulk delete is one `POST /v1/dashboard/storage/bulk-delete`; the server enumerates + deletes.
- **Rationale:** a folder can hold hundreds of objects (`skills/` = 548). N sequential authenticated HTTP deletes from the browser is unacceptable UX (the LIVE sync showed ~1.8 min for 640 sequential ops) and leaves the store half-deleted if the tab closes mid-loop.
- **Alternatives considered:** (a) client-side loop over `DELETE /objects/{path}` — rejected: latency + partial-state-on-close. (b) a true S3 `DeleteObjects` batch call — rejected: bypasses the metadata store + quota accounting, and the store abstraction (`ObjectStore.DeleteObject`) is per-key; batching S3 without batching metadata would desync `used_bytes`.
- **Consequences:** one request per bulk op; server owns the loop + partial-failure reporting; a new API contract to version.

### D2 — POST with an explicit `{paths, prefixes}` body, not `DELETE ?prefix=`
- **Decision:** the endpoint is `POST /v1/dashboard/storage/bulk-delete` carrying `{"paths": string[], "prefixes": string[]}`.
- **Rationale:** a multi-selection mixes individual files and whole folders; one call must express both. A `POST` body cleanly carries arrays; `DELETE` with a repeated query string is awkward and length-limited. `POST` for a non-idempotent mass mutation is acceptable (it is not a cacheable resource fetch).
- **Alternatives considered:** (a) `DELETE /objects?prefix=X` (folder-only) + client loop for multi-file — rejected: two mechanisms for one user action. (b) `DELETE` with a JSON body — rejected: semantically allowed but widely mishandled by proxies/clients.
- **Consequences:** a new route in `MountDashboardRoutes`; the theo_live_ surface (`/v1/storage`) does NOT get it in this slice (dashboard-only).

### D3 — Bounded enumeration (runaway-prefix guard)
- **Decision:** `DeletePrefix` paginates via the existing `List` (≤1000/page) up to a hard cap of `bulkDeleteMaxObjects = 10000`; beyond the cap it deletes what it can and returns `truncated: true` so the UI tells the user to narrow the selection.
- **Rationale:** an unbounded server loop over an enormous prefix is a self-inflicted DoS; a cap keeps the request bounded while still handling realistic folders (`skills/` = 548 ≪ 10000).
- **Alternatives considered:** (a) unbounded loop — rejected: request-time + memory blow-up on a pathological prefix. (b) async job + polling — rejected: over-engineered (YAGNI) for the current scale.
- **Consequences:** very large folders need repeated calls; the `truncated` flag must be surfaced honestly.

### D4 — Partial-failure is a success-shaped response, not an error
- **Decision:** bulk-delete returns HTTP 200 with `{deleted, failed[], freed_bytes, truncated}`; a per-object failure is a row in `failed[]`, not a 5xx.
- **Rationale:** mirrors the sync engine (F-test-1) and S3 `DeleteObjects` — the caller needs to know exactly which items remain. A single failing object must not abort the batch nor mask the successes.
- **Alternatives considered:** all-or-nothing transaction — rejected: the flat store has no cross-object transaction, and rolling back partial deletes is impossible; honesty about partial state is safer than a fake atomic guarantee.
- **Consequences:** the UI must render `failed[]` (which items remain) instead of a generic error toast.

### D5 — Bulk delete is idempotent: an already-absent object is SUCCESS, not a failure (EC-1)
- **Decision:** during bulk delete, a not-found result (`storage.ErrObjectNotFoundMeta` or the store's not-found) counts as deleted (a no-op), NOT a `failed[]` row.
- **Rationale:** a selection legitimately overlaps — a user selects folder `a/` AND file `a/b.txt`; the folder delete removes `a/b.txt`, then the path delete of `a/b.txt` finds it gone. Two tabs deleting the same prefix, or re-clicking after a `truncated` batch, hit the same race. Reporting these as failures is a false negative that erodes trust in the honest-partial-failure contract (D4). Delete is idempotent by nature — the desired end-state (object absent) is achieved.
- **Alternatives considered:** (a) dedupe `paths` covered by a selected `prefix` before the loop — kept as an optional optimization, but insufficient alone (does not cover cross-tab / re-click races). (b) surface not-found as failure — rejected: false negatives on the exact feature meant to be honest.
- **Consequences:** the loop must distinguish "not found" (→ deleted) from a real store error (→ `failed[]`); cross-tab concurrent deletes become safe without locking (KISS).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Mass-delete blast radius — a bug could wipe a tenant's storage | High | Tenant-scoped via `KeyForTenant` (EC-1); mandatory UI ConfirmDialog with count+size; server never accepts an absolute/`..` path (reuse `ValidatePath`); `/review` domain-security agent gates it | BE + security |
| A pathological prefix enumerates forever | Medium | `bulkDeleteMaxObjects = 10000` cap (D3) + `truncated` flag | BE |
| Partial delete leaves `used_bytes` briefly inconsistent | Low | `used_bytes` is derived from meta rows; each successful `Delete` removes its row, so usage converges; UI refreshes usage after the op | BE |
| `workspace.tsx` already 495 LoC — selection state may push past the 500 budget | Medium | Extract selection logic into a small `useWorkspaceSelection` hook / helper if the file exceeds 500 LoC (per `architecture.md`) | FE |
| Empty-folder `.keep` deleted but folder lingers in view until refresh | Low | After bulk-delete, re-fetch the object list so `deriveEntries` recomputes; a folder with zero remaining objects disappears | FE |

## Unresolved Questions

- Q1 — should the theo_live_ CLI surface (`/v1/storage`) also get bulk-delete, or is dashboard-only correct for this slice? (Leaning dashboard-only; the CLI already loops in `theo storage sync`.)
- Q2 — for `truncated` (folder > 10000 objects), does the UI auto-repeat the call until empty, or ask the user to click again? (Leaning: ask again, show remaining count — avoids a hidden long-running loop.)
- Q3 — does deleting a folder that is the *current* breadcrumb location navigate up to its parent, or stay and show empty? (Leaning: navigate to parent.)

## Dependency Graph

```
Phase 1 (backend: DeletePrefix + bulk-delete route + metric)
   │
   ▼
Phase 2 (frontend: selection + checkboxes + folder-delete + ConfirmDialog)
   │
   ▼
Phase 3 (Integration Validation)
```

Phase 2 depends on Phase 1's endpoint contract. Within Phase 1, T1.1 (Service) blocks T1.2 (handler) blocks T1.3 (route+metric).

---

## Phase 1: Backend — tenant-scoped bulk delete

**Objective:** add a partial-failure-aware `DeletePrefix` to the storage Service and a `POST /v1/dashboard/storage/bulk-delete` handler that deletes files and folders in one tenant-scoped call.

### T1.1 — `Service.DeletePrefix` (enumerate + delete, bounded, partial-failure)

#### Objective
Add `DeletePrefix(ctx, tenantID, prefix) (BulkDeleteResult, error)` that lists every object under `prefix` (paginated, capped) and deletes each via the existing per-key path, collecting per-object failures.

#### Why this step (action + reasoning)
1. **What this step does** — introduces one Service method that turns a prefix into a bounded sequence of `store.DeleteObject` + `meta.DeleteByName` calls, returning `{Deleted, Freed, Failed[], Truncated}`.
2. **Why it is necessary now** — the handler (T1.2) must not contain enumeration/deletion logic (architecture.md: deletion belongs in `internal/storage`, not `internal/routes`). Building it first, unit-tested against stubbed meta+store, lets T1.2 depend on a proven contract (D1, D3, D4).

#### Evidence
- `Service.List` already paginates by prefix: `internal/storage/orchestrator.go:116-120` (`meta.ListByPrefix`, limit ≤ 1000).
- `Service.Delete` already does store+meta delete tenant-scoped: `internal/storage/orchestrator.go:124-132`.
- `ObjectRecord.SizeBytes` is available per listed object (used for `Freed`): `List` returns `[]ObjectRecord`.

#### Files to edit
```
internal/storage/orchestrator.go — add DeletePrefix + BulkDeleteResult/FailedDelete types
internal/storage/orchestrator_test.go — RED tests first (TDD)
```

#### Deep file dependency analysis
- `orchestrator.go` today (Baseline row) holds `List` + `Delete`. `DeletePrefix` composes them: loop `List(tenant, prefix, 1000, cursor)` until no cursor OR `bulkDeleteMaxObjects` reached; for each record call the same store+meta delete as `Delete`; accumulate `Deleted`, `Freed += SizeBytes`, and on error append `FailedDelete{Path, Reason}`. No downstream caller changes (new method).
- Callers: none yet (new); T1.2 will be the first caller.

#### Deep Dives
- Types: `BulkDeleteResult{ Deleted int; Freed int64; Failed []FailedDelete; Truncated bool }`; `FailedDelete{ Path string; Reason string }`.
- Invariant (preserve): every delete goes through `KeyForTenant(tenantID, …)` — a listed record's `Name` is already tenant-relative, so reuse `Delete(ctx, tenantID, rec.Name)` to inherit EC-1. NEVER build a raw key.
- Edge cases: empty prefix result → `{Deleted:0}` (no error); the `{prefix}.keep` marker is a normal listed object → deleted like any other; a mid-loop delete error → recorded in `Failed`, loop continues (D4); enumeration reaches `bulkDeleteMaxObjects` → stop, set `Truncated=true` (D3).

#### Pseudo-code / Signatures
```pseudocode
const bulkDeleteMaxObjects = 10000
// safePrefix (EC-2 + EC-3): a folder prefix MUST be non-empty, end with "/", and
// contain no traversal — otherwise it could delete by substring (READ → README.md)
// or enumerate the whole tenant (/, .., .).
func safePrefix(p) bool:
  return p != "" && strings.HasSuffix(p, "/") && !strings.Contains(p, "..") &&
         p != "/" && p != "./" && !strings.HasPrefix(p, "/")

func (s *Service) DeletePrefix(ctx, tenant, prefix) (BulkDeleteResult, error):
  if !safePrefix(prefix): return {}, ErrInvalidPath   -- never substring-match nor delete the whole tenant
  res, cursor, seen := {}, "", 0
  loop:
    recs, next, err := s.List(ctx, tenant, prefix, 1000, cursor)
    if err: return res, err                      -- listing itself failed → surface
    for rec in recs:
      if seen >= bulkDeleteMaxObjects: res.Truncated = true; return res, nil
      seen++
      e := s.Delete(ctx, tenant, rec.Name)
      if e == nil || isNotFound(e):               -- D5: already-absent == deleted (idempotent)
        res.Deleted++; res.Freed += rec.SizeBytes
      else:
        res.Failed = append(res.Failed, {rec.Name, classify(e)})
    if next == "": break
    cursor = next
  return res, nil

# Example
input:  prefix="skills/", 3 objects (a.md 10B, b.md 20B, .keep 1B), b.md delete fails with 503
output: { Deleted:2, Freed:11, Failed:[{Path:"skills/b.md", Reason:"storage_unavailable"}], Truncated:false }
# Example (idempotent): prefix="skills/", b.md already gone (not-found) → counted as Deleted, not Failed
```

#### Tasks
1. Add `BulkDeleteResult` + `FailedDelete` types.
2. Add `safePrefix` guard: non-empty AND ends with `/` (EC-2, no substring match) AND no `..` AND not `/`/`./`/leading-`/` (EC-3, no whole-tenant wipe).
3. Implement `DeletePrefix` per pseudo-code, with `isNotFound(e)` → counted as deleted (D5/EC-1 idempotency).
4. Wire the cap constant `bulkDeleteMaxObjects`.

#### TDD
```
RED: TestService_DeletePrefix_DeletesAllUnderPrefix — 3 objects under "skills/" incl .keep → Deleted=3, Freed=sum
RED: TestService_DeletePrefix_PartialFailure — middle delete errors (real 503) → Deleted=2, Failed has the 1, loop not aborted
RED: TestService_DeletePrefix_IdempotentNotFound — a delete returns not-found → counted as Deleted, NOT Failed (D5/EC-1)
RED: TestService_DeletePrefix_RejectsUnsafePrefix — "", "/", "..", "skills" (no trailing slash) each → ErrInvalidPath, nothing deleted (EC-2, EC-3)
RED: TestService_DeletePrefix_Truncated — stub returns > cap → Truncated=true, Deleted==cap
GREEN: implement DeletePrefix + safePrefix + isNotFound
REFACTOR: extract the per-record delete into the shared path with Delete (DRY) if clean
VERIFY: cd theo-cloud && go test ./internal/storage/ -run TestService_DeletePrefix
```

#### Concurrency tests

(none — single-threaded)
The Service loop is sequential per request; the store/meta already serialize writes with `pg_advisory_xact_lock` (unchanged). No new shared mutable state is introduced.

#### Acceptance Criteria
- [ ] `DeletePrefix` deletes every object under the prefix incl. `.keep`, tenant-scoped
- [ ] partial failure recorded, loop not aborted (D4)
- [ ] empty prefix rejected (blast-radius guard)
- [ ] cap enforced with `Truncated` (D3)
- [ ] Pass: coverage — `go test ./internal/storage/ -cover` ≥ 90% on the new code (critical path 100%)
- [ ] Pass: lint — `golangci-lint run ./internal/storage/...` zero warnings
- [ ] Pass: size — `orchestrator.go` stays ≤ 500 lines

#### DoD
- [ ] All RED tests written first, then GREEN
- [ ] `go test ./internal/storage/...` green
- [ ] `go vet ./internal/storage/...` clean

---

### T1.2 — `bulk-delete` handler on the dashboard BFF

#### Objective
Add `StorageHandler.BulkDelete` serving `POST /v1/dashboard/storage/bulk-delete` with body `{paths[], prefixes[]}` → `{deleted, failed[], freed_bytes, truncated}`, tenant from `auth.GetUser`.

#### Why this step (action + reasoning)
1. **What this step does** — parses the request, calls `Service.Delete` for each `path` and `Service.DeletePrefix` for each `prefix`, aggregates, and writes a JSON 200 (D4).
2. **Why it is necessary now** — the frontend (Phase 2) needs a single endpoint for its "delete selection" action (D2); it depends on this exact response shape.

#### Evidence
- `StorageService` interface + `tenantOf(r)` helper: `internal/routes/storage.go:24`/`:44`.
- Existing single Delete handler pattern + error mapping: `internal/routes/storage.go:129` (`Delete`) + `statusForStorageErr`.
- `stubStorageService` for tests: `internal/routes/storage_test.go:25`.

#### Files to edit
```
internal/routes/storage.go — add BulkDelete handler + extend StorageService interface with DeletePrefix
internal/routes/storage_test.go — RED tests + extend stubStorageService with DeletePrefix
```

#### Deep file dependency analysis
- `StorageService` interface (storage.go:24) gains `DeletePrefix(ctx, tenantID, prefix) (storage.BulkDeleteResult, error)`. BOTH implementers update: `*storage.Service` (T1.1, already has it) and `stubStorageService` (test).
- `BulkDelete` handler reads `tenantOf(r)`, decodes JSON, loops paths→`svc.Delete`, prefixes→`svc.DeletePrefix`, aggregates into a response DTO. Product-language errors only (public-copy.md).

#### Deep Dives
- Request cap: reject a body with `len(paths)+len(prefixes) > bulkDeleteMaxItems` (e.g. 1000) with 400 — bounds the request itself.
- Invariant: the handler passes only client-relative paths/prefixes to the Service; the Service prepends the tenant (EC-1). The handler NEVER constructs a key.
- Edge case: empty body (`{}`) → 200 `{deleted:0}` (no-op, not an error); a `path` that 404s → recorded in `failed[]` (not a 5xx).

#### Pseudo-code / Signatures
```pseudocode
func (h *StorageHandler) BulkDelete(w, r):
  tenant := tenantOf(r)
  var req { Paths []string; Prefixes []string }
  decode(r.Body, &req)  -> on error 400 invalid_body
  if len(Paths)+len(Prefixes) > bulkDeleteMaxItems: 400 too_many_items
  for pre in Prefixes:
    if !strings.HasSuffix(pre, "/"): 400 invalid_folder   -- EC-2: a folder prefix must end with "/"
  agg := { Deleted:0, Freed:0, Failed:[], Truncated:false }
  for p in Paths:
    e := h.svc.Delete(ctx, tenant, p)
    if e == nil || isNotFound(e): agg.Deleted++            -- D5/EC-1 idempotent
    else: agg.Failed += {p, classify(e)}                   -- size unknown per single delete → Freed from prefixes only (see note)
  for pre in Prefixes:
    r, e := h.svc.DeletePrefix(ctx, tenant, pre)
    if e != nil: agg.Failed += {pre, classify(e)}; continue
    agg.Deleted += r.Deleted; agg.Freed += r.Freed; agg.Failed += r.Failed; agg.Truncated = agg.Truncated || r.Truncated
  writeJSONOK(w, {deleted, failed, freed_bytes, truncated})
```
> Note: for individual `paths`, `Freed` bytes are only known via a prior Stat; v1 reports `freed_bytes` from prefix deletes (where List gives sizes) and omits per-file byte accounting — the usage bar re-fetches `/usage` after the op regardless (authoritative). Documented as an Unresolved-Question-adjacent simplification.

#### Tasks
1. Extend `StorageService` interface with `DeletePrefix`.
2. Extend `stubStorageService` with a `DeletePrefix` returning a scripted result.
3. Implement `BulkDelete` handler.
4. Add `bulkDeleteMaxItems` request-size guard.

#### TDD
```
RED: TestStorageHandler_BulkDelete_FilesAndFolders — {paths:[a], prefixes:[skills/]} → deleted=1+N, tenant from ctx
RED: TestStorageHandler_BulkDelete_PartialFailure — one path errors (real 503) → 200 with failed[] containing it, not 5xx
RED: TestStorageHandler_BulkDelete_IdempotentOverlap — {paths:[a/b.txt], prefixes:[a/]} where a/ delete removes a/b.txt → the path's not-found is NOT a failure (D5/EC-1)
RED: TestStorageHandler_BulkDelete_RejectsPrefixWithoutSlash — prefixes:["skills"] (no trailing /) → 400 (EC-2)
RED: TestStorageHandler_BulkDelete_TooManyItems — >bulkDeleteMaxItems → 400
RED: TestStorageHandler_BulkDelete_EmptyBody — {} → 200 deleted:0
GREEN: implement handler + interface method
REFACTOR: share classify(e) with the single-delete error mapping (DRY)
VERIFY: cd theo-cloud && go test ./internal/routes/ -run TestStorageHandler_BulkDelete
```

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios (external I/O — object store)
| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| object store (`ObjectStore.DeleteObject`) | one key delete returns 503 mid-batch | `stubStorageService`/stub store errors on a scripted key | that key lands in `failed[]`; batch continues; HTTP 200 |
| object store (`List` during `DeletePrefix`) | list page errors | stub `List` returns error on 2nd page | `DeletePrefix` surfaces the error; handler records the prefix in `failed[]`; other prefixes/paths still processed |

#### Acceptance Criteria
- [ ] `POST /bulk-delete` deletes the given paths + prefixes, tenant-scoped
- [ ] partial failure → 200 with `failed[]` (D4), never a 5xx for a per-item failure
- [ ] over-size request → 400 in product language
- [ ] Pass: coverage ≥ 90% on the handler; lint clean; `storage.go` ≤ 500 lines (currently 308 + handler ≈ within budget; split if it exceeds)

#### DoD
- [ ] RED-first; `go test ./internal/routes/...` green; `go vet` clean

---

### T1.3 — Route + metric wiring

#### Objective
Register `POST /objects/bulk-delete` inside `MountDashboardRoutes` and increment `theo_storage_objects_deleted_total` by the number actually deleted.

#### Why this step (action + reasoning)
1. **What this step does** — one line in `MountDashboardRoutes` + a counter registration + increment in `BulkDelete`.
2. **Why it is necessary now** — without the route the handler is dead code (wiring triad, caller); without the metric ops cannot see mass-deletes in production (the wiring triad's runtime-metric pillar).

#### Evidence
- `MountDashboardRoutes` is the single place dashboard storage routes mount: `internal/routes/storage.go` (added `d1c26b2`); tested by `TestStorageHandler_DashboardMount_DownloadNestedObject`.
- Existing `theo_storage_*` counters live in `internal/metrics/metrics.go` (e.g. `theo_storage_bytes_written_total`).

#### Files to edit
```
internal/routes/storage.go — add r.Post("/bulk-delete", h.BulkDelete) in MountDashboardRoutes
internal/routes/storage_test.go — assert the mount exposes POST /bulk-delete (200 via stub)
internal/metrics/metrics.go — register theo_storage_objects_deleted_total
```

#### Deep file dependency analysis
- `MountDashboardRoutes` gains one line; the mount test proves the verb is reachable (mirrors the 405-regression test). The metric counter is registered once at init (guard against dup-registration panic).

#### Deep Dives
- Invariant: the counter increments by `agg.Deleted` (objects actually removed), not by request size — so it reflects real deletions.
- Edge case: a batch that deletes 0 (all failed) increments by 0.

#### Tasks
1. Add the route to `MountDashboardRoutes`.
2. Register + increment the counter.

#### TDD
```
RED: TestStorageHandler_DashboardMount_BulkDelete — POST /bulk-delete via the real mount → 200 (not 404/405)
RED: TestBulkDelete_MetricIncrements — after a delete of N, the counter delta == N (testutil.ToFloat64)
GREEN: add route + metric
REFACTOR: none expected
VERIFY: cd theo-cloud && go test ./internal/routes/ ./internal/metrics/
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `POST /v1/dashboard/storage/bulk-delete` reachable via the real mount (regression-guarded like the download route)
- [ ] `theo_storage_objects_deleted_total` increments by objects deleted, observed non-zero in the handler test
- [ ] lint clean; no duplicate metric registration panic

#### DoD
- [ ] RED-first; `go test ./internal/...` green; `go vet` clean

---

## Phase 2: Frontend — selection + folder delete

**Objective:** give the Workspace page row checkboxes, a select-all, a selection action bar, a per-folder delete affordance, and a count+size ConfirmDialog that calls `bulk-delete`.

### T2.1 — Selection state + row checkboxes + select-all

#### Objective
Add a `Set<string>` selection (files by path, folders by `prefix/`) with checkboxes on every file + folder row and a header select-all with indeterminate state.

#### Why this step (action + reasoning)
1. **What this step does** — introduces selection state + checkbox UI; no deletion yet.
2. **Why it is necessary now** — the action bar (T2.2) and bulk-delete (T2.3) operate on the selection; it must exist first. If `workspace.tsx` approaches 500 LoC, extract a `useWorkspaceSelection` hook (architecture.md size budget; Drawback row).

#### Evidence
- `deriveEntries(all, prefix)` returns `{folders: string[], files: StorageFile[]}`: `dashboard/src/pages/workspace.tsx:68`.
- Row rendering with `data-testid="folder-row"` + per-file Delete: `workspace.tsx` (folder rows ~:351, file rows with Share/Delete).
- `Checkbox` is available in `@usetheo/ui` (design system).

#### Files to edit
```
dashboard/src/pages/workspace.tsx — selection Set state, checkbox per row, select-all header
dashboard/src/pages/workspace.test.tsx — RED tests for selection + select-all
```

#### Deep file dependency analysis
- `WorkspacePage` gains `const [selected, setSelected] = useState<Set<string>>(new Set())`; a folder's selection key is its prefix `"<name>/"`, a file's key is its `path`. Toggling a checkbox mutates a cloned Set. Navigating into a folder OR refreshing clears selection. `deriveEntries` unchanged (pure).

#### Deep Dives
- Select-all: checked when all visible rows selected; indeterminate when some; unchecked when none.
- Edge cases: empty folder view → select-all disabled; navigating clears selection (stale keys from another prefix must not linger).

#### Tasks
1. Add selection state + toggle helper.
2. Render a `Checkbox` per file + folder row.
3. Render the header select-all with indeterminate.
4. Clear selection on navigate + on refresh.

#### TDD
```
RED: selects a file row via its checkbox → selection has that path
RED: select-all checks every visible row; indeterminate when a subset selected
RED: navigating into a folder clears the previous selection
GREEN: implement selection + checkboxes
REFACTOR: extract useWorkspaceSelection hook IF workspace.tsx > 500 LoC
VERIFY: cd dashboard && npm test -- workspace
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] every file + folder row has a working checkbox; select-all + indeterminate correct
- [ ] selection clears on navigate/refresh
- [ ] Pass: `npx tsc --noEmit` clean; `npx eslint` clean on the file; `workspace.tsx` ≤ 500 LoC (or hook extracted)

#### DoD
- [ ] RED-first; `npm test` green; tsc + eslint clean

---

### T2.2 — Selection action bar + folder-delete affordance

#### Objective
Show a bar when ≥1 item is selected ("N selected · Delete") and add a Delete button to each folder row (deletes that single folder).

#### Why this step (action + reasoning)
1. **What this step does** — surfaces the delete affordances (bulk from the bar, single-folder from the row); both funnel into the same ConfirmDialog (T2.3).
2. **Why it is necessary now** — this is the visible entry point users asked for ("como deleto uma pasta" + "selecionar arquivos"). It depends on T2.1's selection.

#### Evidence
- Existing per-file Delete button pattern (`workspace.tsx` file rows) — folder rows currently lack it.
- `Button` variants available: `@usetheo/ui` (`destructive`, `secondary`, `ghost`).

#### Files to edit
```
dashboard/src/pages/workspace.tsx — action bar + folder-row Delete button
dashboard/src/pages/workspace.test.tsx — RED tests for the bar + folder delete button
```

#### Deep file dependency analysis
- The bar renders conditionally on `selected.size > 0`. The folder-row Delete sets a pending "delete request" (a `{paths, prefixes}` shape) and opens the ConfirmDialog. Both the bar and the folder button produce the same request shape consumed by T2.3.

#### Deep Dives
- Edge case: a selection mixing files + folders → the request carries both `paths[]` and `prefixes[]`.
- Product language: labels say "Delete", "folder", "files" — never "objects"/"keys"/"S3" (Rule 3).

#### Tasks
1. Render the selection action bar with the count + Delete.
2. Add a Delete button to folder rows.
3. Build the `{paths, prefixes}` request from the selection OR the single folder.

#### TDD
```
RED: with 2 rows selected, the action bar shows "2 selected" + a Delete button
RED: a folder row has a Delete button that targets that folder's prefix
RED: uses product language only (no S3/bucket/objects)
GREEN: implement the bar + folder button
REFACTOR: none expected
VERIFY: cd dashboard && npm test -- workspace
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] action bar appears with correct count; folder rows have Delete
- [ ] request shape carries paths + prefixes correctly
- [ ] tsc + eslint clean; product language only

#### DoD
- [ ] RED-first; `npm test` green

---

### T2.3 — Count/size ConfirmDialog + bulk-delete call + partial-failure toast

#### Objective
On confirm, POST `bulk-delete`, then refresh the list + usage; show the count + total size in the ConfirmDialog and surface partial failure honestly.

#### Why this step (action + reasoning)
1. **What this step does** — wires the affordances to the backend endpoint (Phase 1) with a mandatory confirmation showing blast radius (count + size), then reconciles the view.
2. **Why it is necessary now** — this closes the loop (the wiring triad caller for the backend endpoint) and enforces the blast-radius mitigation (Drawback row: mandatory confirm).

#### Evidence
- Existing single-delete `ConfirmDialog` + `onConfirmDelete` refresh pattern: `workspace.tsx:248`.
- `cloudFetch(path, {method, body})` returns parsed JSON (authenticated Bearer): `dashboard/src/lib/api.ts`.
- Usage bar re-fetch on mutation: existing pattern after upload/delete.

#### Files to edit
```
dashboard/src/pages/workspace.tsx — ConfirmDialog with count+size, cloudFetch POST bulk-delete, refresh, partial-failure toast
dashboard/src/pages/workspace.test.tsx — RED tests (confirm shows count+size; POST body shape; refresh; partial failure)
```

#### Deep file dependency analysis
- The confirm computes the count (files selected + files under each selected folder — the folder's file count is known from the current listing when the folder is at the current level; for a nested folder use the count of matching-prefix objects in the loaded list) + total size (sum of matching `StorageFile.size`). On confirm → `cloudFetch('/v1/dashboard/storage/bulk-delete', {method:'POST', body: JSON.stringify({paths, prefixes})})` → on response re-fetch objects + usage; render `failed[]` count in a toast if non-zero.

#### Deep Dives
- Count/size: for folders, sum sizes of all loaded objects whose key starts with the prefix; if the count is only an estimate (folder deeper than the loaded page), label it "at least N".
- Edge cases: `truncated:true` → toast "Some files remain — delete again to continue"; `failed[]` non-empty → toast "N files could not be deleted"; deleting the current folder → navigate to parent (Q3); the folder disappears from `deriveEntries` once its objects are gone.

#### Pseudo-code / Signatures
```pseudocode
async function onConfirmBulkDelete(req: {paths, prefixes}):
  const res = await cloudFetch('/v1/dashboard/storage/bulk-delete', {method:'POST', body: JSON.stringify(req)})
  await refreshObjects(); await refreshUsage()
  if res.truncated: toast.info("Some files remain — delete again to finish")
  else if res.failed?.length: toast.warning(`${res.failed.length} files could not be deleted`)
  else: toast.success(`Deleted ${res.deleted} ${req.prefixes.length ? 'items' : 'files'}`)
  // EC-5: keep exactly the failed items selected so "Delete" retries only what remains
  setSelected(new Set(res.failed?.map(f => f.path) ?? []))
```

#### Tasks
1. Compute count + total size for the confirm.
2. Render the ConfirmDialog with count + size.
3. POST bulk-delete via `cloudFetch`; refresh list + usage.
4. Toast for success / partial-failure / truncated.
5. Navigate to parent if the current folder was deleted.

#### TDD
```
RED: ConfirmDialog shows the item count + total size before delete
RED: ConfirmDialog labels the count "at least N" when the object listing is paginated (EC-4 — count is a lower bound, never a misleading small N)
RED: confirming POSTs {paths, prefixes} to /v1/dashboard/storage/bulk-delete
RED: after a 200 with failed:[x,y], a partial-failure toast appears + list re-fetched + selection reduced to exactly {x,y} for retry (EC-5, not fully cleared)
RED: truncated:true shows the "delete again" message
GREEN: implement the confirm + call + refresh + toasts
REFACTOR: reuse the existing refresh helper (DRY)
VERIFY: cd dashboard && npm test -- workspace
```

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios (external I/O — BFF HTTP)
| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| bulk-delete BFF (HTTP) | 200 with `failed[]` non-empty | mock `cloudFetch` returns partial result | partial-failure toast; list re-fetched; remaining files still shown |
| bulk-delete BFF (HTTP) | network error / 5xx | mock `cloudFetch` rejects | error toast in product language; selection preserved so the user can retry |

#### Acceptance Criteria
- [ ] ConfirmDialog shows count + total size (blast-radius visible before commit)
- [ ] POST body is exactly `{paths, prefixes}`; list + usage refresh after
- [ ] partial-failure + truncated surfaced honestly, product language
- [ ] tsc + eslint clean; `workspace.tsx` ≤ 500 LoC (or selection hook extracted)

#### DoD
- [ ] RED-first; `npm test` green; tsc + eslint clean; CHANGELOG `[Unreleased]` updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Delete a whole folder (prefix), recursive incl `.keep` | T1.1, T2.2, T2.3 | `DeletePrefix` server-side + folder-row Delete |
| 2 | Multi-select files + folders | T2.1, T2.2 | checkboxes + select-all + action bar |
| 3 | Server-side bulk delete (not N client calls) | T1.1, T1.2, T1.3 | `POST /bulk-delete` endpoint |
| 4 | Tenant-scoped mass delete (EC-1) | T1.1, T1.2 | reuse `KeyForTenant` via `Service.Delete`/`DeletePrefix` |
| 5 | Partial-failure honest reporting | T1.1, T1.2, T2.3 | `{deleted, failed[]}` + partial-failure toast |
| 6 | Confirm shows blast radius (count + size) | T2.3 | ConfirmDialog with count/size |
| 7 | Runaway-prefix guard | T1.1 | `bulkDeleteMaxObjects` + `truncated` |
| 8 | Free quota + observability | T1.1, T1.3 | meta-row delete frees usage; `theo_storage_objects_deleted_total` |
| 9 | List/usage consistent after op | T2.3 | re-fetch objects + usage post-delete |
| 10 | Product language only (Rule 3) | T1.2, T2.2, T2.3 | reuse `statusForStorageErr` messages + UI copy audit |
| 11 | Idempotent bulk delete — overlap/re-click/cross-tab not-found is success (EC-1/D5) | T1.1, T1.2 | `isNotFound(e)` counts as deleted, not failed |
| 12 | No greedy substring delete — prefix must end with `/` (EC-2) | T1.1, T1.2 | `safePrefix` + handler rejects non-slash prefix (400) |
| 13 | No whole-tenant wipe — reject `""`, `/`, `.`, `..` (EC-3) | T1.1 | hardened `safePrefix` + unit tests per rejection |
| 14 | Confirm count is a lower bound under pagination (EC-4) | T2.3 | "at least N" label when listing paginated |
| 15 | Failed items stay selected for retry (EC-5) | T2.3 | selection reduced to `failed[]`, not cleared |

**Coverage: 15/15 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `cd theo-cloud && go test ./internal/...` + `cd dashboard && npm test` green
- [ ] Zero type errors — `cd dashboard && npx tsc --noEmit`
- [ ] Zero lint warnings — `golangci-lint run ./internal/...` + `cd dashboard && npx eslint src/pages/workspace.tsx`
- [ ] File-size budget respected (`workspace.tsx` ≤ 500 LoC — extract `useWorkspaceSelection` if needed; `storage.go` ≤ 500)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved — existing single-file delete + download routes untouched
- [ ] Mass-delete is tenant-scoped (EC-1) and confirmation-gated (blast-radius mitigation)
- [ ] Runtime-metric proof — `theo_storage_objects_deleted_total` observed non-zero in the handler integration test
- [ ] Plan archived to `knowledge-base/plans/completed/` after `/review` READY_TO_MERGE + PR merged

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| object store (`ObjectStore.DeleteObject`) | per-key 503 mid-batch | stub store errors on a scripted key | key → `failed[]`; batch continues; HTTP 200 (D4) |
| object store (`List` in `DeletePrefix`) | list page error | stub `List` errors on 2nd page | `DeletePrefix` returns the error; handler records the prefix in `failed[]` |
| bulk-delete BFF (HTTP, frontend) | 5xx / network error | mock `cloudFetch` rejects | product-language error toast; selection preserved for retry |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the bulk-delete works end-to-end — backend loop + tenant scoping + metric + frontend selection/confirm/refresh.

### Execution
```
cd theo-cloud && go test ./internal/storage/... ./internal/routes/... ./internal/metrics/...
cd theo-cloud && go vet ./internal/...
cd theo-cloud && golangci-lint run ./internal/...
cd theo-cloud/dashboard && npm test -- workspace
cd theo-cloud/dashboard && npx tsc --noEmit && npx eslint src/pages/workspace.tsx
```
LIVE (operator, after deploy to k3d theo-cloud): create a throwaway folder with N files via the Workspace UI, select it + a couple files, confirm delete, assert the folder + files disappear, the usage bar drops, and `theo_storage_objects_deleted_total` increased by N.

### Acceptance Criteria
- [ ] All Go + vitest suites green
- [ ] Coverage ≥ 90% on changed files (critical paths 100%)
- [ ] Zero type errors; zero lint warnings
- [ ] `theo_storage_objects_deleted_total` observed non-zero in the handler test
- [ ] Failure scenarios exercised (partial-failure batch → `failed[]`; frontend 5xx → error toast)
- [ ] LIVE: a folder + selection delete removes the objects, frees quota, and the folder collapses from the view

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures; re-run the chain.
3. Log pre-existing issues in the PR description; they do not block completion.
