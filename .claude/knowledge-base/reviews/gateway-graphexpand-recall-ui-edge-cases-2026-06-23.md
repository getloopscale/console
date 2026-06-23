# Edge Case Review — gateway-graphexpand-recall-ui (EG-1)

Date: 2026-06-23
Tasks analyzed: 4 (T1.1, T1.2, T2.1, T3.1)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

A thin passthrough + a UI toggle, mirroring the shipped `asOf` precedent. Low blast radius. One MUST FIX: the boundary validation must match TheMemory's OPTIONAL `hops` (z.union([1,2]).optional()) — rejecting `hops=0` would 400 a valid "enable-with-defaults" request.

## MUST FIX

### EC-1: `hops` is OPTIONAL in TheMemory's zod — the gateway must NOT reject `hops=0` (omitted)
- **Affected task:** T1.2 (boundary validation)
- **Family:** Format / Boundary
- **Scenario:** TheMemory's `graphExpand.hops` is `z.union([z.literal(1), z.literal(2)]).optional()` — a request with `graphExpand: {}` (or `{limit:10}`) is VALID (enables graph expansion with the core default hops). In Go, an absent `hops` decodes to `0`. The plan's draft validation ("hops must be 1 or 2 when graphExpand present") would 400 a legitimate `{graphExpand:{}}` request.
- **Impact:** a valid enable-with-defaults recall (e.g. a future SDK client, or a dashboard variant that omits hops) gets a wrong 400.
- **Suggested fix:** validate `hops ∈ {0,1,2}` (0 = omitted → forwarded via `omitempty` so TheMemory applies its default) and `limit ∈ [0,100]` (0 = omitted). Only reject hops ∉ {0,1,2} or limit < 0 / > 100. Add a test for `graphExpand:{}` → 200 + forwarded as `graphExpand:{}`.

## SHOULD TEST

### EC-2: empty `graphExpand: {}` (toggle on, default hops) forwards + enables
- **Affected task:** T1.1, T1.2
- **Suggested test:** `Recall` with `RecallOptions{GraphExpand:&GraphExpand{}}` → captured body contains `"graphExpand":{}` (not omitted — the pointer is non-nil), proving "enable with provider defaults" works distinctly from "graphExpand absent".

### EC-3: the BFF route (`/v1/dashboard/memory/recall`) inherits graphExpand for free
- **Affected task:** T1.2
- **Suggested test:** the handler test exercises `MemoryHandler.Recall` directly — which IS the function `dashboard_memory.go:185` delegates to. A one-line assertion/comment that the BFF path shares the handler (no separate wiring) prevents a future reviewer thinking the BFF was missed. (No separate code; the delegation is pre-existing.)

## DOCUMENT

### EC-4: gateway validation bounds must mirror TheMemory's zod (drift)
- **Accepted risk:** already ADR D1/D2. The gateway hard-codes hops ∈ {1,2} + limit ≤ 100, mirroring TheMemory's strict zod. If TheMemory ever widens the bounds, the gateway would 400 a value the provider would accept. Low risk (the bounds are stable, locked by TheMemory's `rest-graph-aware-recall` ADR D1). The real e2e (`make e2e`) would catch a genuine drift. Documented.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 3 | 1 | 1 | 1 |
| T2.1 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — align hops/limit validation with TheMemory's OPTIONAL zod so `graphExpand:{}` is honored, not 400'd). The fix is a ≤3-line validation change + a test; no new module.
