---
slug: gateway-graphexpand-recall-ui
milestone_id: GatewayGraphExpandRecallUi
created_at: 2026-06-23
goal: Expose TheMemory's recall graphExpand option through the theo-cloud gateway (SDK + BFF recall) and a dashboard Playground toggle, so an end user can run graph-aware recall, measured by a gateway contract test where a recall with graphExpand forwards { graphExpand } in the outbound POST /v1/recall body + a dashboard test asserting the toggle sends it.
---

# Plan: Gateway graphExpand recall + dashboard toggle

> **Version 1.1** — EG-1 of the entity-graph-dogfood-remediation-roadmap (theo-memory). v1.1 absorbs the `/edge-case-plan` MUST FIX EC-1 (boundary validation mirrors TheMemory's OPTIONAL `hops` zod — `graphExpand:{}` is honored as enable-with-defaults, NOT 400'd) + SHOULD-TEST EC-2/EC-3. See `.claude/knowledge-base/reviews/gateway-graphexpand-recall-ui-edge-cases-2026-06-23.md`. TheMemory shipped `RecallOptions.graphExpand` over `POST /v1/recall` (v0.20.0, `{ hops?: 1|2; limit?: number }`) — graph-aware recall that surfaces memories CONNECTED by a shared entity to the semantic hits. But the theo-cloud gateway recall path (`/v1/memory/recall` SDK + `/v1/dashboard/memory/recall` BFF) does NOT forward `graphExpand`, and the dashboard Playground recall has no control for it — so end users cannot use the feature. This plan threads `graphExpand` through the gateway client + handler (mirroring the existing `asOf`/`topK` passthrough) and adds a Playground toggle. NO graph DB, NO new dependency. Distinct from the shipped `themory-graph-gateway-dashboard` plan (that exposed the `/graph` VIEW tab; this exposes the `graphExpand` RECALL option).

## Goal

> "Expose TheMemory's `graphExpand` recall option end-to-end through the theo-cloud gateway (client `RecallOptions.GraphExpand` → outbound `POST /v1/recall` body + `recallRequest` boundary-validated handler) and a dashboard Playground toggle, measured by `internal/themory/contract_test.go` where a `Recall` with `GraphExpand` produces a captured outbound `/v1/recall` body containing `graphExpand` + `dashboard/src/pages/memory/playground.test.tsx` asserting the recall POST body carries `graphExpand` when the toggle is on and omits it when off."

## Context

EG-1 of the theo-memory entity-graph-dogfood-remediation roadmap (sibling repo). The 2026-06-23 Chrome-MCP dogfood + my honest correction established that `graphExpand` (shipped at the REST/SDK layer in theo-memory v0.20.0) had NO consumer UI. The gateway recall chain is: dashboard → `POST /v1/dashboard/memory/recall` (BFF, `dashboard_memory.go:181` delegates to the SDK handler) → `MemoryHandler.Recall` (`memory.go:605`) → `themory.Client.Recall` (`client.go:390`) → `POST /v1/recall`. Today `graphExpand` is dropped at every hop. This plan forwards it, mirroring the `asOf` passthrough precedent (added for v1.1 bi-temporal). The gateway treats `graphExpand` as a bounded forward field — validated at the boundary (clear 400, ADR D2 `asOf` precedent) and passed to TheMemory which owns the graph traversal.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `internal/themory/client.go` | ~430 | — | TheMemory HTTP client; `RecallOptions` + `recallRequest` body + `Recall` (`:390`) | the existing TopK/Threshold/AsOf forwarding unchanged; `graphExpand` omitted from the body when unset (omitempty); response parsing unchanged |
| `internal/routes/memory.go` | ~660 | — | SDK recall handler; inbound `recallRequest` (`:597`) + boundary validation + `client.Recall` (`:640`) | the existing query/topK/threshold/asOf validation unchanged; new graphExpand validation is additive; 400-at-boundary discipline (ADR D2) |
| `internal/themory/contract_test.go` | ~220 | — | client contract tests via `captureServer` (`:15`) | existing Recall contract tests stay green |
| `internal/routes/memory_test.go` (NEW) | 0 | — | (file to be created) — handler validation + passthrough test (httptest) | — |
| `dashboard/src/pages/memory/playground.tsx` | 293 | — | the live remember/recall/reflect surface; recall mutation POSTs `/v1/dashboard/memory/recall` (`:89-97`) | the existing recall body (query/topK/threshold/asOf) unchanged; graphExpand added only when the toggle is on |
| `dashboard/src/pages/memory/playground.test.tsx` | ~110 | — | Playground page tests (recall POST body assertions) | existing recall test stays green |

### Current callers / dependents

- **Symbol:** `themory.RecallOptions` (`client.go:140`) — `{ TopK, Threshold, AsOf }`. Set by `memory.go:640` (`MemoryHandler.Recall`). Add `GraphExpand`.
- **Symbol:** `themory.Client.Recall` (`client.go:390`) — marshals `recallRequest{UserID,Query,TopK,Threshold,AsOf}` → `POST /v1/recall`. Add `graphExpand` to the body struct + set it from opts.
- **Symbol:** `recallRequest` (handler inbound, `memory.go:597`) — `{ Query, TopK, Threshold, AsOf }`. Add `GraphExpand`.
- **Dashboard:** `playground.tsx` recall mutation (`:87-99`) builds `{ query, topK, threshold, asOf? }`. Add `graphExpand?`.
- **External (provider):** TheMemory `POST /v1/recall` accepts `graphExpand: { hops?: 1|2; limit?: number(1..100) }` (v0.20.0, strict zod; invalid → 422). The gateway validates at its own boundary to return a clear 400 instead of laundering the 422 → 502.

### Domain glossary

- **graphExpand** — the recall option that makes TheMemory pool-expand results with memories connected by a shared entity (1 hop) or relation edge (2nd hop). Shape `{ hops?: 1|2; limit?: number }`.
- **BFF recall** — `/v1/dashboard/memory/recall` (JWT, dashboard) which delegates to the SDK recall handler (one handler, two route surfaces).
- **boundary validation** — the gateway validates request fields (ADR D2 precedent: `asOf` is RFC3339-checked at the gateway so a bad value is a clear 400, not a 502 from the provider's 422).

### Architecture boundaries affected

- **Gateway (Go, `internal/`)** — additive field on the recall request/options/body; one new validation block; no new route, no new dependency. Mirrors the `asOf` passthrough.
- **Dashboard (React/Vite)** — one toggle + an additive body field on the existing recall mutation; no new dependency.
- **Cross-repo:** TheMemory side is DONE (v0.20.0). This plan is the theo-cloud consumer exposure only.

## Prior Art & Related Work

- **Internal precedent (gateway):** the `asOf` passthrough (v1.1 bi-temporal) — `RecallOptions.AsOf` + `recallRequest.AsOf` + boundary validation (`memory.go` RFC3339 check) + body forwarding (`client.go`). EG-1 mirrors this exact shape for `graphExpand`.
- **Internal precedent (dashboard):** the `asOf` control in `playground.tsx` (`recallAsOf` state → conditional body field). EG-1 mirrors it for the graphExpand toggle.
- **Sibling shipped plan:** `.claude/knowledge-base/plans/themory-graph-gateway-dashboard-plan.md` (the `/graph` VIEW tab) — different surface; confirms the gateway+dashboard integration pattern.
- **Cross-repo source:** theo-memory v0.20.0 `rest-graph-aware-recall` (the `graphExpand` REST field this consumes).

## Objective

- [ ] `themory.Client.Recall` forwards `graphExpand` in the outbound `/v1/recall` body when set; omits it when unset.
- [ ] `MemoryHandler.Recall` parses `graphExpand` from the inbound request, validates it at the boundary (hops ∈ {1,2}, limit 1..100), and passes it through.
- [ ] The dashboard Playground has a graphExpand toggle that adds `graphExpand` to the recall POST body when on.
- [ ] Existing recall behavior (no graphExpand) is byte-unchanged.

## Dependencies

### Existing — use as-is
- Go stdlib `encoding/json`, `net/http/httptest` (gateway + tests).
- React + `@tanstack/react-query` `useMutation` + `cloudFetch` (dashboard) — already in use by the recall mutation.

### New — to be introduced
- (none — ZERO new dependency.)

### Removed
- (none.)

## ADRs

### D1 — Forward `graphExpand` as a bounded passthrough (gateway does NOT do graph traversal)
- **Decision:** the gateway adds `GraphExpand { Hops int; Limit int }` to `RecallOptions` + the outbound body, forwarding it to TheMemory which owns the traversal. The gateway only validates + forwards.
- **Rationale:** mirrors the `asOf`/`topK` passthrough; the graph logic lives in TheMemory (v0.20.0). Keeps the gateway a thin proxy (its role). Zero new dependency.
- **Alternatives considered:** (a) gateway computes graph expansion itself — REJECTED: duplicates TheMemory's pgvector JOIN logic in Go, violates the single-source-of-truth + the gateway's proxy role. (b) pass graphExpand opaquely without validation — REJECTED: a bad value would 422 at the provider → laundered to 502; boundary validation (D2) gives a clear 400.
- **Consequences:** the gateway must keep its `graphExpand` validation in sync with TheMemory's zod bounds (hops 1|2, limit ≤ 100). Documented; low drift risk (the bounds are stable).

### D2 — Validate `graphExpand` at the gateway boundary (clear 400, mirrors `asOf`)
- **Decision:** `MemoryHandler.Recall` rejects `graphExpand.hops ∉ {1,2}` or `graphExpand.limit ∉ [1,100]` with a 400 INVALID_BODY, before calling the provider.
- **Rationale:** the `asOf` precedent (ADR D2 of the v1.1 work) validates at the boundary so a bad value is a clear 400, not a 502 laundered from the provider's 422. Better DX + honest error attribution.
- **Alternatives considered:** forward unvalidated — REJECTED (502 laundering). 
- **Consequences:** the gateway duplicates the bound check; acceptable (small, mirrors TheMemory's strict zod; both are the same numbers).

### D3 — Dashboard toggle is opt-in (default OFF; byte-unchanged recall when off)
- **Decision:** the Playground adds a "Graph expand" toggle (default off) + an optional hops select (1|2, default 1); `graphExpand` is added to the recall body ONLY when the toggle is on.
- **Rationale:** preserves the existing recall behavior exactly when off (no regression); opt-in matches TheMemory's default-OFF semantics.
- **Alternatives considered:** always-on graphExpand — REJECTED (changes default recall behavior + cost).
- **Consequences:** users must opt in; acceptable (it is an advanced retrieval mode).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Gateway graphExpand bounds drift from TheMemory's zod | Low | both pin hops 1|2 + limit ≤ 100 (stable); a drift would surface as a provider 422 in the e2e | gateway |
| The graphExpand toggle confuses users (advanced feature) | Low | default OFF + a short helper label; advanced-mode framing | dashboard |
| Extra recall latency when graphExpand on (graph JOIN in TheMemory) | Low | opt-in only; the cost is TheMemory's (already benchmarked v0.19.0); gateway adds none | gateway |

## Unresolved Questions

- Q1 — Should `graphExpand` also be exposed on the other recall surfaces (MCP)? Out of scope — this plan is the dashboard/gateway recall path; MCP recall exposure is a separate followup.
- Q2 — Should graph-sourced hits be visually marked in the results list? Nice-to-have, out of scope (KISS) — they already appear scored; a visual badge is a follow-up.

## Dependency Graph

```
Phase 1 (gateway client + handler) ──▶ Phase 2 (dashboard toggle) ──▶ Phase 3 (GOAL contract passthrough + full gate)
```

---

## Phase 1: Gateway passthrough

### T1.1 — Client forwards `graphExpand` in the `/v1/recall` body

#### Objective
`themory.Client.Recall` includes `graphExpand` in the outbound body when set; omits it when unset.

#### Why this step
1. **What this step does** — adds `GraphExpand` to `RecallOptions` + a `graphExpand` field (omitempty) to the client's `recallRequest` body struct; `Recall` sets it from opts; a contract test (`captureServer`) asserts the captured outbound `/v1/recall` body carries `graphExpand`.
2. **Why now** — per D1 the client is the hop that talks to `/v1/recall`; mirroring the `asOf` field is the minimal forward. Cite `client.go:390` (Recall) + the `asOf` precedent.

#### Evidence
- `client.go:341-347` — `recallRequest` body has UserID/Query/TopK/Threshold/AsOf; no graphExpand.
- `client.go:403` — `c.do(... "/v1/recall" ...)`.

#### Files to edit
```
internal/themory/client.go — RecallOptions.GraphExpand + recallRequest.GraphExpand (json:"graphExpand,omitempty") + Recall sets it
internal/themory/contract_test.go — RED: a Recall with GraphExpand → captured /v1/recall body contains "graphExpand" with hops
```

#### Deep Dives
- **Type:** `type GraphExpand struct { Hops int \`json:"hops,omitempty"\`; Limit int \`json:"limit,omitempty"\` }`. `RecallOptions.GraphExpand *GraphExpand` (pointer → omitted when nil). The body struct gets `GraphExpand *GraphExpand \`json:"graphExpand,omitempty"\``.
- **Invariant:** when `opts.GraphExpand == nil`, the body has no `graphExpand` key (byte-unchanged recall). Existing fields unchanged.

#### TDD
```
RED:  t.Run("Recall forwards graphExpand in the body") — c.Recall(ctx, "u", "q", RecallOptions{GraphExpand: &GraphExpand{Hops:1}}) → captured request body JSON contains "graphExpand":{"hops":1}
RED:  t.Run("Recall omits graphExpand when unset") — captured body has NO "graphExpand" key
GREEN: add the field + marshal
REFACTOR: None expected
VERIFY: go test ./internal/themory/...
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — request marshaling; the httptest server is per-test.

#### Acceptance Criteria
- [ ] Captured `/v1/recall` body `contains` `graphExpand` with `hops` when set — `go test ./internal/themory/...` `exit code 0`.
- [ ] Body OMITS `graphExpand` when unset (omitempty) — same test.
- [ ] Existing Recall contract tests stay `green` — `go test ./internal/themory/...` `exit code 0`.
- [ ] Pass: `go vet ./internal/themory/...` clean; size `<= 500` per file.

#### DoD
- [ ] `go test ./internal/themory/...` green
- [ ] `go build ./...` clean

### T1.2 — Handler parses + boundary-validates `graphExpand`

#### Objective
`MemoryHandler.Recall` reads `graphExpand` from the inbound request, validates hops ∈ {1,2} + limit ∈ [1,100] (400 on violation), and passes it into `RecallOptions`.

#### Why this step
1. **What this step does** — adds `GraphExpand` to the handler's inbound `recallRequest`; validates it (mirroring the `asOf` boundary check); passes `themory.RecallOptions{..., GraphExpand: ...}`; a handler test (new `memory_test.go`, httptest) asserts 400 on bad hops + passthrough on good.
2. **Why now** — per D2 the boundary is where a clear 400 must be produced; `memory.go:605` is the handler. Cite `memory.go:621-640` (existing validation + RecallOptions build).

#### Evidence
- `memory.go:597-601` — inbound `recallRequest` (Query/TopK/Threshold/AsOf).
- `memory.go:625-639` — boundary validation (topK 0..200, threshold 0..1, asOf RFC3339).
- `memory.go:640` — `themory.RecallOptions{TopK, Threshold, AsOf}`.

#### Files to edit
```
internal/routes/memory.go — recallRequest.GraphExpand + validation (hops ∈ {1,2}, limit 1..100) + pass into RecallOptions
internal/routes/memory_test.go — NEW: httptest handler tests (bad hops → 400; good graphExpand → passthrough to a stub client)
```

#### Deep Dives
- **Inbound shape:** `GraphExpand *struct{ Hops int \`json:"hops"\`; Limit int \`json:"limit"\` } \`json:"graphExpand,omitempty"\``.
- **Validation (EC-1 — mirror TheMemory's OPTIONAL hops):** if `req.GraphExpand != nil`: `Hops` must be in `{0,1,2}` (0 = OMITTED → forwarded via omitempty so TheMemory applies its default hops; TheMemory's zod is `z.union([1,2]).optional()`, so `graphExpand:{}` is valid "enable with defaults"); `Limit` must be in `[0,100]` (0 = omitted). 400 INVALID_BODY only for `Hops ∉ {0,1,2}` or `Limit < 0 || Limit > 100`. A non-nil `graphExpand` with both 0 forwards as `graphExpand:{}` (enable, default hops).
- **Passthrough:** map to `&themory.GraphExpand{Hops: req.GraphExpand.Hops, Limit: req.GraphExpand.Limit}`.
- **Invariant:** no graphExpand → RecallOptions.GraphExpand nil → byte-unchanged.

#### TDD
```
RED:  TestRecall_GraphExpandBadHops_400 — POST body {query, graphExpand:{hops:3}} → 400 INVALID_BODY
RED:  TestRecall_GraphExpandBadLimit_400 — graphExpand:{hops:1,limit:9999} → 400
RED:  TestRecall_GraphExpandPassthrough — graphExpand:{hops:2} → stub client receives RecallOptions.GraphExpand{Hops:2}; 200
RED:  TestRecall_GraphExpandEmpty_EnablesDefault — graphExpand:{} (EC-1) → 200; stub receives a non-nil GraphExpand (Hops 0 = provider default), NOT a 400
RED:  TestRecall_NoGraphExpand_Unchanged — no graphExpand → stub receives nil GraphExpand; 200
GREEN: add field + validation + passthrough
REFACTOR: None expected
VERIFY: go test ./internal/routes/...
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — per-request handler; the stub client is per-test.

#### Acceptance Criteria
- [ ] Bad hops/limit → `400` INVALID_BODY — `go test ./internal/routes/...` `exit code 0`.
- [ ] Good graphExpand → stub client `receives` `RecallOptions.GraphExpand` — same test.
- [ ] No graphExpand → nil passthrough (byte-unchanged) — `go test ./internal/routes/...` asserts the stub `received` a nil `GraphExpand`.
- [ ] Pass: `go vet ./internal/routes/...` clean.

#### DoD
- [ ] `go test ./internal/routes/...` green
- [ ] `go build ./...` clean

---

## Phase 2: Dashboard toggle

### T2.1 — Playground graphExpand toggle

#### Objective
The Playground recall panel has a "Graph expand" toggle (+ hops 1|2); when on, `graphExpand` is added to the recall POST body.

#### Why this step
1. **What this step does** — adds `graphExpandOn` + `graphExpandHops` state to `playground.tsx`; a toggle + hops select in the recall panel; conditionally spreads `graphExpand: { hops }` into the recall mutation body; `playground.test.tsx` asserts the body carries graphExpand when on and omits when off.
2. **Why now** — per D3 the user-facing control is the deliverable's point; mirrors the `recallAsOf` conditional-body precedent. Cite `playground.tsx:89-97`.

#### Evidence
- `playground.tsx:87-99` — recall mutation builds `{ query, topK:10, threshold, ...(asOf) }`.
- `playground.tsx:186-228` — the recall panel JSX (query + asOf inputs + button).

#### Files to edit
```
dashboard/src/pages/memory/playground.tsx — graphExpand toggle + hops select + conditional body field
dashboard/src/pages/memory/playground.test.tsx — RED: toggle on → body has graphExpand:{hops}; default off → no graphExpand
```

#### Deep Dives
- **State:** `const [graphExpandOn, setGraphExpandOn] = useState(false); const [graphExpandHops, setGraphExpandHops] = useState(1);`
- **Body:** `...(graphExpandOn ? { graphExpand: { hops: graphExpandHops } } : {})`.
- **UI:** a checkbox/Switch "Graph expand (surface connected memories)" + a hops select (1 | 2) shown when on. Use existing UI primitives already imported in the file.
- **Invariant:** default off → body identical to today.

#### TDD
```
RED:  it("recall sends graphExpand when the toggle is on") — toggle on, hops 2, recall → mockCloudFetch called with body containing graphExpand:{hops:2}
RED:  it("recall omits graphExpand by default (toggle off)") — existing recall test body has NO graphExpand
GREEN: add the toggle + conditional body
REFACTOR: None expected
VERIFY: (cd dashboard && npx vitest run src/pages/memory/playground.test.tsx)
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — React state + a mutation; no shared concurrency.

#### Acceptance Criteria
- [ ] Toggle on → recall body `contains` `graphExpand` with `hops` — `(cd dashboard && npx vitest run src/pages/memory/playground.test.tsx)` `exit code 0`.
- [ ] Default off → body OMITS graphExpand — `(cd dashboard && npx vitest run src/pages/memory/playground.test.tsx)` `exit code 0` (existing recall test asserts no `graphExpand` key).
- [ ] Pass: `(cd dashboard && npm run lint)` `exit code 0` on the file; `npx tsc -b` clean.

#### DoD
- [ ] Dashboard tests green — `(cd dashboard && npx vitest run src/pages/memory/playground.test.tsx)`
- [ ] Dashboard typecheck + lint clean

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Gateway client drops graphExpand | T1.1 | client forwards it in the /v1/recall body |
| 2 | Gateway handler drops + doesn't validate graphExpand | T1.2 | handler parses + boundary-validates + passes through |
| 3 | Dashboard has no graphExpand control | T2.1 | Playground toggle adds it to the recall body |
| 4 | No regression to existing recall (no graphExpand) | T1.1, T1.2, T2.1 | omitempty / nil / default-off → byte-unchanged |
| 5 | End-to-end passthrough proof | T3.1 | contract GOAL: captured /v1/recall body carries graphExpand |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `go test ./...` green; `go build ./...` clean; `go vet ./...` clean
- [ ] Dashboard `npx vitest run` green; `npx tsc -b` clean; `npm run lint` clean
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved (no graphExpand → byte-unchanged recall; no new dependency)
- [ ] Plan-specific: contract GOAL green (captured /v1/recall body carries graphExpand) + dashboard toggle test green
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| TheMemory `POST /v1/recall` (HTTP) | provider rejects graphExpand (422) | the gateway boundary-validates FIRST (D2) so a bad value never reaches the provider → clear 400; a provider 422 on a valid value would launder to 502 (existing recall error path) | clear 400 at the boundary for bad input; 502 only for genuine provider failure |
| TheMemory unavailable during recall | connection refused | existing recall error path (`memory.go:642` → 502 MEMORY_UPSTREAM_UNAVAILABLE) | unchanged 502 path; graphExpand adds no new failure mode |

## Final Phase: Integration Validation (MANDATORY)

### T3.1 — GOAL: gateway forwards graphExpand end-to-end (contract capture)

#### Objective
A `Recall` with `graphExpand` (the dashboard-shaped body → gateway → outbound) produces a captured `/v1/recall` request whose body contains `graphExpand`.

#### Files to edit
```
internal/themory/contract_test.go — GOAL: captureServer records the /v1/recall body; assert it contains graphExpand:{hops} when set (proves the full gateway passthrough)
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — sequential capture assertion.

#### TDD
```
RED:  t.Run("GOAL: graphExpand reaches the provider /v1/recall body") — c.Recall(ctx,"u","q",RecallOptions{GraphExpand:&GraphExpand{Hops:2,Limit:10}}) → captured body JSON contains "graphExpand":{"hops":2,"limit":10}
GREEN: passes once T1.1 wires the client
REFACTOR: None expected
VERIFY: go test ./internal/themory/...
```

Note: the TRUE end-to-end (a graph-connected memory actually surfaces) is already proven by theo-memory v0.20.0's `rest-graph-aware-recall` GOAL against real pgvector; this plan's GOAL proves the theo-cloud GATEWAY forwards the field (the new code here). An optional manual `make e2e` run (real stack) is the cross-repo belt-and-suspenders.

### Execution
```
go build ./... && go vet ./... && go test ./...
(cd dashboard && npx tsc -b && npm run lint && npx vitest run src/pages/memory/playground.test.tsx)
```

### Acceptance Criteria
- [ ] `go test ./...` green (incl. the contract GOAL + handler tests)
- [ ] Dashboard tests green (toggle on/off body assertions)
- [ ] Zero go vet / tsc / lint issues on changed files
- [ ] The captured `/v1/recall` body provably carries graphExpand (GOAL non-vacuous)

### If Validation Fails
1. Separate plan-caused from pre-existing.
2. Fix plan-caused; re-run.
3. Log pre-existing in the PR description.
