---
slug: themory-gateway-forget-cutover
created_at: 2026-06-21
goal: Cut the gateway Forget over to TheMemory's new scope-checked DELETE endpoint, dropping the O(scope) listAll() ownership pre-check.
---

# Plan: Gateway forget cutover → scope-checked DELETE

> **Version 1.0** — TheMemory v0.12.0 (theo-memory `develop`, plan `themory-scoped-forget-and-retrieval-counter`) ships `DELETE /v1/scopes/:type/:id/memories/:memId` (+`?hard`) that deletes a memory ONLY if it belongs to the subject scope (cross-scope/cross-workspace/missing → 404, no existence leak), plus a real `retrieval_api_usage` on `GET …/metrics`. This plan cuts the gateway's `themory.Client.Forget` over to that endpoint, removing its O(scope) `listAll()` IDOR pre-check (the provider now enforces ownership server-side), and corrects the now-stale "retrieval_api_usage is 0" comments (the metrics parse already reads the real value — no functional metrics change).

## Goal

> "Make the gateway delete a memory via one scope-checked provider call instead of paging the whole scope, measured by the contract test `Forget issues a single DELETE /v1/scopes/user/{id}/memories/{memId}` (validated against `openapi/themory.yaml`) + the existing `404 maps to ErrNotFound` staying green, with `listAll` removed and `go test ./... -race` green."

## Context

`themory-scoped-forget-and-retrieval-counter` (theo-memory) explicitly named the gateway cutover as its sequenced follow-up (out of that plan's scope). The gateway's `Forget` (`internal/themory/client.go:558`) today pages the entire user scope via `listAll()` to ownership-check the id before delegating to the workspace-only `POST /v1/forget` — O(scope) work + the only reason `listAll` exists. The provider now does the scope-checked delete in one call, so the gateway drops the pre-check and the dead `listAll`/`maxListPages`. The metrics side needs NO code change: `MetricsResult.RetrievalAPIUsage` already JSON-parses the field; only the "is 0 / no source" comments are stale.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists today | Invariants to preserve |
|---|---|---|---|
| `internal/themory/client.go` | 643 | TheMemory HTTP client. `Forget` (`:558`) does `listAll` pre-check + `POST /v1/forget`; `listAll` (`:302`) + `maxListPages` (`:247`) exist ONLY for that pre-check; `do()` (`:591`) already maps 404→ErrNotFound, 204→nil, ≥400→`*Error`; `ForgetSkill` (`:543`) is the DELETE template; `Metrics` (`:430`) + `MetricsResult` (`:116`) parse the 4-field shape | `do()` status mapping unchanged; `Metrics`/`List` behavior unchanged; 404-not-403 no-existence-leak discipline preserved (now provider-enforced) |
| `openapi/themory.yaml` | — | Vendored SUBSET of TheMemory's `/v1/openapi.json` the gateway calls; `contract_test.go::validateRequest` checks outgoing requests against it | additive: add the `DELETE /v1/scopes/{type}/{id}/memories/{memId}` path; existing paths unchanged |
| `internal/themory/contract_test.go` | 275+ | Contract tests: `Forget` "owned id" test (`:103`, currently expects GET listing + POST) + `404 maps to ErrNotFound` (`:277`) | rewrite the owned-id test to a single DELETE; 404 case unchanged; add a `?hard=true` query case |

### Current callers / dependents

- `themory.Client.Forget` is called by `internal/routes/memory.go:238` (`h.client.Forget(ctx, user.Subject, memoryID, hard)`), which `internal/routes/dashboard_memory.go:116` delegates to. The **signature is unchanged** (`Forget(ctx, userID, memoryID, hard)`), so no caller changes.
- `listAll` is called ONLY by `Forget` (`client.go:564`); `maxListPages` is used ONLY by `listAll` (`:305`,`:316`). Both become dead on cutover → removed.

## ADRs

- **D1 — reuse `do()` mapping, mirror `ForgetSkill`.** The new `Forget` is `c.do(ctx, http.MethodDelete, "/v1/scopes/user/{id}/memories/{memId}", query, nil, nil)`. `do()` already turns the provider's 204→nil, 404→ErrNotFound (cross-scope/missing — same no-leak response the gateway used to synthesize), ≥400→`*Error` (e.g. 422 bad UUID). Rejected alternative: keep a thin gateway-side validation — unnecessary, the provider is authoritative and the IDOR is closed server-side.
- **D2 — scope is always `user`.** The gateway's shared-key model maps each customer to one `user` subject (same rule as `Entities`/`Graph`/`Metrics`), so the path tier is hardcoded `user`, matching `Metrics` (`client.go:432`). Rejected: parameterize the tier — YAGNI, no caller passes another tier.
- **D3 — delete dead code now.** Remove `listAll` + `maxListPages` in the same commit (Inquebrável: no dead code). Rejected: leave `listAll` "in case" — it has zero other callers; `go vet`/dead-code would flag it.

## Phase 1 — forget cutover

### T1.1 — Forget → scope-checked DELETE + remove dead listAll/maxListPages + openapi path

#### Files to edit
```
internal/themory/contract_test.go — RED: rewrite "owned id" test → single DELETE; add ?hard=true case; keep 404→ErrNotFound
openapi/themory.yaml — add DELETE /v1/scopes/{type}/{id}/memories/{memId} (204/404/422 + path/query params)
internal/themory/client.go — Forget body = single do(DELETE, .../memories/{memId}, ?hard); remove listAll + maxListPages; update package-doc invariant #3
```

#### TDD
```
RED: Forget_issues_single_DELETE — stub captures one DELETE /v1/scopes/user/user-1/memories/mem-123 (204) → validateRequest(router, got) passes against themory.yaml; assert NO GET listing fired.
RED: Forget_hard_sets_query — Forget(..., hard=true) → captured req has ?hard=true.
RED (unchanged, must stay green): 404 maps to ErrNotFound — provider 404 → IsNotFound(err).
GREEN: rewrite Forget; add openapi path; remove listAll/maxListPages.
REFACTOR: none expected.
VERIFY: go test ./internal/themory/... -race
```

#### Concurrency tests
```
(none — single HTTP call; no shared mutable state introduced).
```

#### Acceptance Criteria
- [ ] `Forget` issues exactly ONE `DELETE /v1/scopes/user/{id}/memories/{memId}` (no GET listing); `?hard=true` propagated.
- [ ] Provider 404 → `ErrNotFound`; provider 422 → `*Error` (not a panic).
- [ ] `listAll` + `maxListPages` removed; `go vet ./...` clean (no unused).
- [ ] `openapi/themory.yaml` has the DELETE path; `validateRequest` passes.

#### DoD
- [ ] `go test ./... -race` green; `go vet ./...` clean; signature `Forget(ctx, userID, memoryID, hard)` unchanged (no caller edits).

### T1.2 — metrics honesty comment (retrieval_api_usage now real)

#### Files to edit
```
internal/themory/client.go — update MetricsResult doc (:112-116) + Metrics doc (:428) + package doc: retrieval_api_usage is now REAL (provider persists a per-scope recall counter as of v0.12.0); no functional change.
```

#### Why this step
Inquebrável Rule 3 honesty: the comments currently assert "0 — the provider has no persisted recall counter", which is false as of theo-memory v0.12.0. The parse code is already correct; only the prose lies.

#### TDD
```
(comment-only; no behavior change — covered by the existing Metrics contract test staying green).
VERIFY: go test ./internal/themory/... -race
```

#### Acceptance Criteria
- [ ] No comment in `client.go` claims `retrieval_api_usage` is always 0 / unsourced.

#### DoD
- [ ] `go test ./... -race` green.

## Coverage Matrix

| Goal element | Task |
|---|---|
| Single DELETE replaces listAll+POST | T1.1 |
| ?hard propagation | T1.1 |
| 404→ErrNotFound preserved | T1.1 |
| listAll/maxListPages removed | T1.1 |
| openapi/themory.yaml DELETE path | T1.1 |
| retrieval_api_usage comment honesty | T1.2 |

## Failure scenarios (external theo-data I/O)

- **Provider 404 (cross-scope / missing):** `do()` → `ErrNotFound` → handler 404. Tested.
- **Provider 422 (bad UUID):** `do()` → `*Error` (status 422); handler surfaces non-404 error. Asserted via the existing `503 maps to *Error` pattern (same `do()` branch); add a 422 assertion.
- **Provider 5xx / connection reset:** `do()` → `*Error`; no panic (existing 503 test covers the branch).

## Drawbacks & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Deploy dependency + 404-collapse hazard:** the cutover only works against a theo-memory that HAS the DELETE endpoint (v0.12.0). If the gateway deploys before v0.12.0 is live, the absent route returns 404 → `do()` maps to `ErrNotFound` → forget returns HTTP 404 "not found" while the memory is **NOT actually deleted** (silent data-not-deleted; GDPR dimension on `?hard=true`). The pre-cutover code did not have this mode (it paged a route present in all versions). | HIGH | (1) DEPLOY-GATE (merge-to-`develop` mitigation, in force): do NOT release/deploy this gateway until theo-memory v0.12.0 (PR #58) is merged AND the deployed provider image includes it. Code + stub-provider tests land on `develop` now. (2) PRODUCTION-DEPLOY GUARD (REQUIRED before prod, tracked as followup F1): add EITHER a gateway readiness probe asserting the provider advertises the DELETE route (via `/v1/openapi.json`/version header, fail readiness if absent) OR a deploy-pipeline smoke check (forget a seeded memory → assert 204, not 404). Without it, a deploy-ordering mistake is undetectable at runtime. Surfaced by `/review` security agent (MAJOR). |
| Vendored `openapi/themory.yaml` drifts from the provider's real spec | LOW | Add the DELETE path matching theo-memory's `openapi-registration.ts` shape (204/404/422); it is a curated subset by design. |

## Unresolved Questions

- **Q1 (deploy sequencing):** this gateway code MUST NOT deploy to prod before theo-memory v0.12.0 is live. Resolved as a release-gate (not a code blocker): land on `develop`, hold the gateway release until the provider ships. The project owner controls both releases.

## Prior Art & Related Work

- In-repo precedent: `ForgetSkill` (`client.go:543`) already issues a scope-checked `DELETE` via `do()` — the exact template. The `themory-graph-gateway-dashboard` plan is the sibling cross-repo integration pattern.
- Provider side: theo-memory plan `themory-scoped-forget-and-retrieval-counter` (T1.1/T1.2 DELETE endpoint, T2.x counter).

## Global Definition of Done

- [ ] `go test ./... -race` green; `go vet ./...` clean.
- [ ] `Forget` is one DELETE; `listAll`/`maxListPages` gone; openapi path added; metrics comments honest.
- [ ] No caller signature change.
- [ ] CHANGELOG updated; deploy-gate (Q1) recorded in the release notes.
- [ ] Plan archived after `/review` READY_TO_MERGE + merge.
