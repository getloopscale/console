---
slug: rag-scope-graduation
issue: 168
created_at: 2026-07-05
goal: Graduate rag:read/write/delete to customer-issuable scopes so a customer can create a theo_live_* key with rag scopes in the dashboard, proven by a new Go handler test and an extended dashboard vitest, all green.
---

# Plan: theo-cloud #168 — Graduate `rag:*` to customer-issuable scopes

## Goal

Move `rag:read` / `rag:write` / `rag:delete` from reserved to **customer-issuable ACTIVE scopes** (backend `validScopes` + dashboard `ACTIVE_SCOPES`) so that a customer can self-serve a `theo_live_*` key with rag scopes, proven by a NEW hermetic `api_keys_test.go` (scope validation: rag accepted, reserved rejected 503, unknown rejected 400) and an extended `api-keys.test.tsx`, with `go test ./internal/routes ./cmd` + dashboard `vitest`/`tsc` all green.

## Context

Grounded in the DISCOVER blueprint `.claude/knowledge-base/discoveries/blueprints/rag-scope-graduation-blueprint.md`. Faithful parallel to the `observability:*` graduation (M37-M46, theo-cloud CHANGELOG). The RAG edge broker (`forward-auth-rag`) is already GA and intersects consumer scopes least-privilege; only the customer-issuance gate (`validScopes`) + the dashboard UI need to graduate `rag:*`. No broker/edge change.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | Role today | #168 change |
|---|---|---|
| `internal/routes/api_keys.go` | `validScopes` (memory+observability) + `reservedScopes` (rag:read/write, agents, deploys); `CreateKey` validation loop | move rag:read/write to validScopes, ADD rag:delete to validScopes, remove rag:read/write from reservedScopes |
| `internal/routes/api_keys_test.go` (NEW) | — (no test today) | NEW hermetic `CreateKey` scope-validation test (closes a coverage gap) |
| `dashboard/src/pages/api-keys.tsx` | `ACTIVE_SCOPES` (memory+observability) + `RESERVED_SCOPES` (rag:read/write) | add rag:read/write/delete to ACTIVE_SCOPES (id+label+description); remove rag:read/write from RESERVED_SCOPES |
| `dashboard/src/pages/api-keys.test.tsx` | vitest (memory scopes) | add assertion that rag scopes render as selectable active scopes |
| `CHANGELOG.md` | `[Unreleased]` | `### Added` entry (#168) |

### Current callers / dependents

- `validScopes` / `reservedScopes` — `internal/routes/api_keys.go:90-112`; consumed by `CreateKey` (`:334-345`): `reservedScopes[s]` → 503 `scope_not_yet_active`; `!validScopes[s]` → 400 `UNKNOWN_SCOPE`.
- rag broker supported set — `cmd/main.go:66-67` `[]string{"rag:read","rag:write","rag:delete"}`; forward-auth required scope `rag:read` (`cmd/main.go:71`); BFF minter `cmd/main.go:146`.
- `forward_auth.go:116-118` — broker intersects consumer scopes (least privilege) → no broker change needed.
- `ACTIVE_SCOPES` / `RESERVED_SCOPES` — `dashboard/src/pages/api-keys.tsx:65-79`.

### Domain glossary

- **validScopes** — the ACTIVE customer-issuable scope enum; a `CreateKey` request scope must be in it (else 400/503).
- **reservedScopes** — scopes recognized but not yet active → 503 `scope_not_yet_active` (honest "not implemented yet").
- **forward-auth-rag** — the edge broker that validates a `theo_live_*`, checks required scope `rag:read`, and mints a per-tenant `rag_live_*` intersected with the consumer's scopes.
- **rag:admin** — theo-rag key-lifecycle scope, broker-held, NEVER customer-issuable (excluded from this graduation, ADR-1).

### Architecture boundaries affected

None crossed (per `rules/architecture.md` — no new package boundary, no dependency-direction change). The change is confined to the customer-issuance gate (`validScopes`) + the dashboard scope list; the edge broker least-privilege intersection (`forward_auth.go`) is unchanged. Tests follow `rules/testing.md` (TDD RED-first, hermetic unit tests, negative cases assert the specific typed error code). Git discipline per `rules/git-safety.md` (work on `develop`).

## Prior Art & Related Work

- **Blueprint (this cycle):** `.claude/knowledge-base/discoveries/blueprints/rag-scope-graduation-blueprint.md`.
- **The precedent:** the `observability:*` graduation (theo-cloud CHANGELOG "Activate the observability:* customer key scope") — identical two-site shape (validScopes + api-keys.tsx). `rag:*` mirrors it.

## Objective

`rag:read`/`rag:write`/`rag:delete` become ACTIVE customer-issuable scopes end-to-end (backend gate + dashboard UI), with the previously-absent scope-validation test added.

## ADRs

### ADR-1 — Activate rag:read + rag:write + rag:delete (NOT rag:admin)
**Decision:** graduate the three data scopes the broker + BFF + theo-rag support.
**Rationale:** the broker's supported set is `[rag:read, rag:write, rag:delete]` (`cmd/main.go:66-67`); `rag:admin` is a broker-held key-lifecycle scope never minted to a consumer (least privilege — anti-escalation, CWE-441). The current `reservedScopes` omission of `rag:delete` is a pre-existing incompleteness corrected here.
**Rejected — also activate rag:admin:** scope-creep; a consumer `rag:admin` key is not in the broker intersect set → dead scope. **Rejected — activate only read+write (issue's literal wording):** leaves `rag:delete` unusable despite broker support — incomplete surface.

### ADR-2 — Two-site edit + close the test gap; no broker/edge change
**Decision:** edit the Go scope maps + the dashboard scope arrays; add hermetic `api_keys_test.go` + extend `api-keys.test.tsx`.
**Rationale:** `forward-auth-rag` already intersects consumer scopes — no broker change (KISS; the observability precedent did the same). The missing `CreateKey` scope-validation test is a real gap; TDD closes it and proves the graduation.
**Rejected — extract a `validateScopes` helper:** unnecessary refactor; the handler test reaches the branches via sqlmock (YAGNI).

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | Activating a data scope a customer can't actually use through the edge (dead scope) | MEDIUM | ADR-1: activate exactly the broker's supported set `[read,write,delete]`; the live E2E (issue evidence) already proved a rag-scoped key drives /v1/rag/* + /mcp/rag | impl |
| R2 | Over-granting (rag:admin escalation) | HIGH | ADR-1: rag:admin explicitly EXCLUDED; not in validScopes, not in the broker intersect set | impl |
| R3 | Dashboard/back-end scope-list drift (UI offers a scope the gate rejects, or vice-versa) | MEDIUM | The Go test asserts rag:* ∈ validScopes; the vitest asserts the UI offers rag:*; both reference the same three ids | impl |

## Unresolved Questions

- Should `rag:admin` ever be customer-issuable (a future RAG settings/webhooks surface)? Deferred — out of scope for #168; add only if a customer-facing rag admin surface + broker support lands (mirrors observability:admin's later arrival). No other open questions.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why (Rule 9) |
|---|---|---|---|
| `github.com/DATA-DOG/go-sqlmock` | v1.5.2 | go | mock `*sql.DB` in the new handler test — already a dep |
| Go stdlib `net/http/httptest` | go 1.x | — | hermetic handler test |
| `vitest` + `@testing-library/react` | installed | npm | dashboard scope-list test |

### New — to be introduced

(none — pure parity change; no new runtime or dev deps.)

### Removed

(none)

## Dependency Graph

```
Phase 1 (backend: validScopes/reservedScopes + hermetic test) ── independent
Phase 2 (dashboard: ACTIVE_SCOPES/RESERVED_SCOPES + vitest)    ── independent
   ↓ (both) 
Phase 3 (integration validation: go test + vitest + tsc + CHANGELOG)
```

## Phase 1: Backend — graduate the scope gate

### T1.1 — Move rag:* to validScopes + hermetic CreateKey scope test
#### Objective
Activate `rag:read`/`rag:write`/`rag:delete` in `validScopes`, remove rag:read/write from `reservedScopes`, and add the previously-absent scope-validation test.
#### Why this step
The customer-issuance gate (`validScopes`) is the single backend site that decides whether a `CreateKey` scope is accepted; graduating rag here (mirroring observability, ADR-2) is what makes a rag key issuable. Reasoning: the broker already supports these three scopes (`cmd/main.go:66-67`), so the gate is the only blocker; the new test closes a real coverage gap and proves the branches.
#### Files to edit
- `internal/routes/api_keys.go` (validScopes + reservedScopes)
- `internal/routes/api_keys_test.go` (NEW)
- `CHANGELOG.md`
#### Deep file dependency analysis
`validScopes:90-99`, `reservedScopes:105-112`, validation loop `:334-345`. Test uses `auth.WithUser` (`me_test.go:30` pattern) + `sqlmock` (go.mod) + `httptest`. Negative cases return before the INSERT (no DB op); the positive case expects the INSERT.
#### TDD
RED (`api_keys_test.go`): `TestCreateKey_ScopeValidation` table-driven —
- `rag:read` / `rag:write` / `rag:delete` (with a mocked INSERT) → **201** (accepted, key created).
- `agents:read` (still reserved) → **503** `scope_not_yet_active`.
- `deploys:write` (still reserved) → **503**.
- `foo:bar` (unknown) → **400** `UNKNOWN_SCOPE`.
- empty scopes `[]` → **400** `EMPTY_SCOPES`.
- unauthenticated (no user in ctx) → **401**.
#### Concurrency tests
(none — single-threaded)
#### Acceptance Criteria
- `TestCreateKey_ScopeValidation` asserts a `rag:read`/`rag:write`/`rag:delete` request returns `201` and `agents:read`/`deploys:write` return `503`, `foo:bar` returns `400 UNKNOWN_SCOPE`, `[]` returns `400 EMPTY_SCOPES` — the test passes.
- `go test ./internal/routes` passes; `rag:read`/`rag:write`/`rag:delete` are in `validScopes` and NOT in `reservedScopes`; `rag:admin` is in NEITHER.
#### DoD
- `go test ./internal/routes ./cmd` green; `go vet ./internal/routes` clean.

## Phase 2: Dashboard — offer rag scopes as active

### T2.1 — Move rag:* to ACTIVE_SCOPES + vitest
#### Objective
Add `rag:read`/`rag:write`/`rag:delete` to `ACTIVE_SCOPES` (id+label+description); remove rag:read/write from `RESERVED_SCOPES`.
#### Why this step
The Create API Key dialog renders `ACTIVE_SCOPES` as selectable checkboxes and `RESERVED_SCOPES` as greyed static labels; moving rag to ACTIVE is what lets a customer tick rag scopes. Reasoning: mirrors the observability rows already in `ACTIVE_SCOPES` (`api-keys.tsx:70-73`); the backend gate (T1.1) now accepts them.
#### Files to edit
- `dashboard/src/pages/api-keys.tsx` (ACTIVE_SCOPES + RESERVED_SCOPES)
- `dashboard/src/pages/api-keys.test.tsx`
#### Deep file dependency analysis
`ACTIVE_SCOPES:65-74`, `RESERVED_SCOPES:76-79`. Descriptions mirror theo-rag's per-verb semantics (read = retrieve/answer; write = create collections + ingest; delete = remove documents/collections).
#### TDD
RED (`api-keys.test.tsx`): open the Create dialog → assert `rag:read`, `rag:write`, `rag:delete` render as selectable scope checkboxes (active), and are NOT under "Reserved for future surfaces".
#### Concurrency tests
(none — single-threaded)
#### Acceptance Criteria
- `api-keys.test.tsx` asserts the dialog exposes `rag:read`/`rag:write`/`rag:delete` as selectable active-scope checkboxes and they are absent from the reserved section — the test passes.
- `ACTIVE_SCOPES` contains the three rag ids; `RESERVED_SCOPES` contains none of them.
#### DoD
- dashboard `vitest run` green for `api-keys.test.tsx`; `tsc` clean.

## Coverage Matrix

| Issue requirement | Task |
|---|---|
| Customer can create a theo_live_* key with rag scopes in the dashboard | T2.1 (UI) + T1.1 (gate accepts) |
| Backend gate accepts rag:read/write/delete | T1.1, ADR-1 |
| rag:admin NOT customer-issuable (anti-escalation) | T1.1, ADR-1, R2 |
| Reserved agents/deploys still rejected; unknown rejected | T1.1 TDD |
| Close the missing scope-validation test gap | T1.1 (NEW api_keys_test.go) |
| Dashboard offers rag scopes as active, not reserved | T2.1 |
| No broker/edge change (least-privilege intersect unchanged) | ADR-2, Baseline |
| CHANGELOG updated | T1.1 |
| go test + vitest + tsc green | Final Phase |

## Global Definition of Done

- `go test ./internal/routes ./cmd` green; `go vet` clean.
- dashboard `vitest run` green; `tsc --noEmit` clean.
- `rag:read`/`rag:write`/`rag:delete` ∈ validScopes + ACTIVE_SCOPES; ∉ reservedScopes + RESERVED_SCOPES; `rag:admin` ∈ neither.
- CHANGELOG `[Unreleased] § Added` entry referencing #168.
- No broker/edge/main.go change (parity only).

## Failure scenarios (external I/O)

(none — no external I/O touched. The `CreateKey` DB INSERT is exercised via sqlmock in the positive test; scope validation precedes it and needs no I/O.)

## Final Phase: Integration Validation (MANDATORY)

### Execution
1. `go test ./internal/routes ./cmd` — green.
2. `go vet ./internal/routes` — clean.
3. `cd dashboard && npx vitest run src/pages/api-keys.test.tsx` — green.
4. `cd dashboard && npx tsc --noEmit` — clean.
5. Manual/live re-verify (issue evidence already proved the edge path): a `theo_live_*` with rag scopes drives `/v1/rag/*` + `/mcp/rag` — now issuable from the dashboard.

### Acceptance Criteria
- The full chain (go test + vet + vitest + tsc) passes; rag scopes are selectable in the dashboard and accepted by the backend gate; rag:admin remains non-issuable.

### If Validation Fails
- Loop back to the failing task's phase; never weaken a test or widen the scope set beyond the broker's supported `[read,write,delete]`.
