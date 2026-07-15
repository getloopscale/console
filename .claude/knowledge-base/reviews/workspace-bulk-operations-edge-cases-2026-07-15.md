# Edge Case Review — workspace-bulk-operations

Date: 2026-07-15
Plan analyzed: `.claude/knowledge-base/plans/workspace-bulk-operations-plan.md`
Tasks analyzed: 6 (T1.1, T1.2, T1.3, T2.1, T2.2, T2.3)
Cases found: 7 (EDGE: 4, NEGATIVE: 3 | MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

Already covered by the plan (not re-flagged): partial-failure per object (D4), `truncated` cap (D3), empty-prefix rejection, `.keep` marker deletion, tenant scoping via `KeyForTenant` (EC-1), list/usage re-fetch after op, network-error toast.

## MUST FIX

### EC-1: Bulk delete is not idempotent — overlapping selection or already-deleted object produces a FALSE failure
- **Affected task:** T1.2 (handler), T1.1 (`DeletePrefix`)
- **Kind:** NEGATIVE (unexpected-but-normal: 404 during a mass op)
- **Family:** State
- **Scenario:** A user selects a folder `a/` AND a file `a/b.txt` inside it. The handler deletes prefix `a/` first (removing `a/b.txt`), then deletes path `a/b.txt` → the object is already gone → the store returns not-found → it lands in `failed[]`. The UI reports "1 file could not be deleted" even though everything the user wanted deleted IS gone. Same happens across two tabs deleting the same prefix, or re-clicking delete after a `truncated` batch.
- **Impact:** False-negative failure reporting; users think data survived when it did not; erodes trust in the exact feature whose whole point is honest partial-failure.
- **Suggested fix:** In the bulk path (both `DeletePrefix` and the handler's per-path loop), treat "object not found" as SUCCESS (idempotent delete — deleting an absent object is a no-op, not a failure). Map `storage.ErrObjectNotFoundMeta` (and the store's not-found) to "already deleted", not to `failed[]`. Optionally dedupe `paths` already covered by a selected `prefix` before the loop.

### EC-2: A prefix without a trailing `/` deletes greedily by substring
- **Affected task:** T1.1 (`DeletePrefix`), T1.2 (handler)
- **Kind:** EDGE (boundary of a "valid" prefix) shading into NEGATIVE
- **Family:** Input / Format
- **Scenario:** `DeletePrefix(tenant, "READ")` calls `List(prefix="READ")` which matches `README.md`, `READY.txt`, `README.md.bak` — every object whose KEY STARTS WITH "READ", not just a folder. The UI sends `"<name>/"`, but the endpoint is a public contract (D2) and a buggy/hand-crafted caller can send a bare prefix and nuke unrelated files that merely share a name stem.
- **Impact:** Mass-deletion of unintended objects that share a name prefix — a silent data-loss footgun on a high-blast-radius endpoint.
- **Suggested fix:** The handler MUST require every `prefixes[]` entry to end with `/` (reject 400 otherwise); a "folder" is by definition `name/`. This guarantees `List` matches only true folder members, never a substring sibling.

### EC-3: `safePrefix` must reject the whole-tenant prefixes `""`, `/`, `.`, `..`, and any traversal — not just `""`
- **Affected task:** T1.1 (`DeletePrefix`)
- **Kind:** NEGATIVE (invalid input on a catastrophic operation)
- **Family:** Permission / Boundary
- **Scenario:** The plan's pseudo-code rejects `prefix == ""`, but a prefix of `/`, `.`, or `../` (or, with EC-2, any short stem) could enumerate + delete the tenant's ENTIRE storage. `ValidatePath` is written for object paths; it is not obviously correct for prefixes.
- **Impact:** A single crafted request wipes a tenant's whole Workspace. This is the worst-case blast radius the plan's own Drawbacks row calls out.
- **Suggested fix:** Add an explicit `safePrefix(p)` that rejects empty, `"/"`, `"."`, `".."`, anything containing `..`, and (per EC-2) anything not ending in `/`; unit-test each rejection. This is the guard that makes the endpoint safe to expose.

## SHOULD TEST

### EC-4: The ConfirmDialog count/size is a LOWER BOUND when the object listing is paginated
- **Affected task:** T2.3
- **Kind:** EDGE (large-but-valid folder)
- **Suggested test:** `confirm_dialog_shows_lower_bound_when_listing_paginated` — with a folder whose objects exceed the loaded page, assert the confirm shows "at least N" (or the UI loads all pages before counting), NOT a wrong small N.
  - The Workspace `list` follows `next_cursor`; if the page shows only what is loaded, a 548-file `skills/` could display "12 files" and mislead the user about the blast radius. Either load all pages for the count OR label it "at least N". Assert the correct label/behavior at the boundary.

### EC-5: Partial failure clears the selection, so the user loses the failed items to retry
- **Affected task:** T2.3
- **Kind:** NEGATIVE (recovery after a partial failure)
- **Suggested test:** `partial_failure_keeps_failed_items_selected` — after a 200 with `failed:[x,y]`, assert the selection is reduced to exactly the failed items (not fully cleared), so "Delete" retries only what remains.
  - Assert the specific post-state (selection == failed set), not just "a toast appeared". Clearing everything (plan's `setSelected(new Set())`) forces the user to re-find + re-select the failures.

## DOCUMENT

### EC-6: Individual-path `freed_bytes` is omitted; the usage bar re-fetch is authoritative
- **Kind:** EDGE
- **Accepted risk:** Per the plan's T1.2 note, `freed_bytes` is summed only from prefix deletes (where `List` gives sizes); single-file deletes do not Stat-for-size. The usage bar re-fetches `/usage` after every op, so the displayed quota is always authoritative — `freed_bytes` is a best-effort hint, not the source of truth. OK to ship.

### EC-7: Cross-tab concurrent delete of the same prefix
- **Kind:** NEGATIVE
- **Accepted risk:** Two tabs deleting the same folder both enumerate and delete; the loser sees not-found on already-deleted objects. Fully absorbed by EC-1's idempotent-not-found fix — no separate locking needed (KISS). Document that the idempotency fix is what makes concurrent deletes safe.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 (EC-2) | 2 (EC-2, EC-3) | 3 (EC-1, EC-2, EC-3) | 0 | 0 |
| T1.2 | 0 | 1 (EC-1) | shares EC-1/EC-2 | 0 | 0 |
| T1.3 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T2.3 | 2 (EC-4) | 1 (EC-5) | 0 | 2 (EC-4, EC-5) | 1 (EC-6) |

**Coverage check:** the backend mass-delete tasks (T1.1/T1.2) now have EDGE + NEGATIVE on every input boundary (prefix shape, prefix validity, overlap/idempotency). T1.3 (metric wiring) and the pure-UI selection tasks (T2.1/T2.2) have no external input boundary that a new lens uncovers.

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX (all on the mass-delete blast radius: idempotency, greedy-prefix, safePrefix). Absorb into plan v1.1 before `/plan-confidence`.
