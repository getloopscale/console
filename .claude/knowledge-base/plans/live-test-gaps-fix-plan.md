---
slug: live-test-gaps-fix
created_at: 2026-06-24
repo: theo-cloud
goal: Close the 3 actionable theo-cloud gaps from the 2026-06-24 complete live test — F-1 (gateway laundering themory upstream 4xx into a misleading 502), F-4 (dashboard Memory sub-nav not re-rendering because navigate() is wrapped in a raw startViewTransition instead of react-router v7's native viewTransition), and LT-1 (concurrent migrate-on-boot race between themory + themory-mcp on one DB) — measured by Go handler tests asserting upstream 4xx passes through (not 502), a dashboard test asserting sub-nav navigation uses RR-native viewTransition, and a dev-compose dedicated migrate init container that serializes migrations; with no regression to the existing 502-on-network-error path, the existing memory surfaces, or the e2e compose.
---

# Plan: live-test-gaps-fix (theo-cloud)

> Closes the 3 actionable gaps surfaced by the COMPLETE live test (`live-test-complete-2026-06-24.md`). F-2 (skill codeLanguage ts/js enum) is **working-as-designed** per project-owner decision 2026-06-24 (it is a LOCKED blueprint decision; F-1 makes the rejection an honest 422) — NO change. F-3 (PaaS engine 502) is out-of-scope (engine not in the memory dev-stack). theo-cloud has no cycle skills; this plan drives the cycle discipline manually (plan + TDD + manual /review).

## Goal

> "Close F-1 + F-4 + LT-1: (F-1) a shared `writeUpstreamError` gateway helper that propagates a themory upstream 4xx as the SAME status (not 502), keeping 5xx/network → 502, applied to all 13 memory handlers; (F-4) the dashboard sidebar navigates via react-router v7 `navigate(path, { viewTransition: true })` so the Memory sub-nav panel re-renders on click; (LT-1) a dedicated `themory-migrate` one-shot init container in `docker-compose.dev.yaml` (mirroring `cloud-migrate`) so migrations run once before themory + themory-mcp start — measured by Go handler tests (422 upstream → 422 client, network error → 502), a dashboard sidebar test (navigate called with `{ viewTransition: true }`), and `docker compose config` validity; with the existing network-error 502 tests, memory surfaces, and e2e compose unchanged."

## Context

The complete live test (real OpenAI, all surfaces) passed but surfaced 4 findings. Per the report + the owner F-2 decision, 3 are actionable bugs in theo-cloud:
- **F-1 (MEDIUM):** `internal/themory/client.go:811` already returns a typed `*themory.Error{StatusCode, Body}`; but all 13 handlers in `internal/routes/memory.go` blanket-`writeError(502, MEMORY_UPSTREAM_UNAVAILABLE)` on any non-sentinel error — laundering a themory 422 into a misleading 502 ("try again" — but retry can't fix an invalid body). Discovered via skill add `codeLanguage:"python"`.
- **F-4 (LOW, real bug):** `dashboard/src/components/layout/app-sidebar.tsx:349,354` wrap `navigate()` in a RAW `document.startViewTransition` (`lib/view-transitions.ts`). React's route update doesn't flush inside that callback → the URL changes but the Memory panel lags until reload. react-router v7 ships the correct integration (`navigate(path, { viewTransition: true })`). jsdom has no `startViewTransition` so tests took the sync fallback → the bug is invisible to the suite, live in Chrome.
- **LT-1 (MEDIUM):** `docker-compose.dev.yaml` — `themory` (REST) + `themory-mcp` both `depends_on: pg-themory healthy` and BOTH run `runMigrations()` on boot against the same DB. On a new migration both apply concurrently → `CREATE INDEX IF NOT EXISTS` not atomic under concurrent DDL → one crashes. The repo already uses the one-shot-init pattern (`cloud-migrate`, `kratos-migrate`).

## Baseline Context (current state)

### Files that will be touched

| File | Why it exists | Change | Invariant |
|---|---|---|---|
| `internal/routes/memory.go` | 13 memory handlers; each blanket-502s upstream errors (`:174,201,265,293,328,387,432,475,534,573,626,716,754`) | ADD one `writeUpstreamError` helper (near `namespaceRepo` `:129`); swap the 13 blanket-502 `writeError(...502, MEMORY_UPSTREAM_UNAVAILABLE...)` calls to it | per-handler 404 (`ErrNotFound`) + 409 (`ErrSkillConflict`) pre-checks UNCHANGED (run before the helper); the helper only decides upstream-4xx-passthrough vs 502 |
| `internal/themory/client.go` | `*themory.Error{StatusCode, Body}` (`:811`) | UNCHANGED (already carries status); the helper consumes it via `errors.As` | — |
| `tests/unit/memory_handlers_test.go` | handler tests; existing `*_UpstreamErrorReturns502` inject generic `errors.New` | existing 502 tests UNCHANGED (network error → 502 still correct); ADD 4xx-passthrough tests injecting `&themory.Error{StatusCode:422}` | fake's per-method err fields already exist |
| `dashboard/src/components/layout/app-sidebar.tsx` | sidebar nav; `handleItemClick`/`handleBack` wrap `navigate` in `withViewTransition` (`:347-364`) | replace `withViewTransition(() => navigate(p))` with `navigate(p, { viewTransition: true })` (RR v7 native); drop the `withViewTransition` import | crossfade preserved via RR-native; nav behavior fixed |
| `dashboard/src/lib/view-transitions.ts` + `.test.ts` | the raw-startViewTransition helper (now the bug source) | REMOVE (dead after the 2 call sites migrate; grep confirms no other consumer) | — |
| `dashboard/src/components/layout/app-sidebar.test.tsx` | sidebar tests | ADD a test asserting sub-nav `navigate` is called with `{ viewTransition: true }` | existing 5 tests UNCHANGED |
| `docker-compose.dev.yaml` | dev stack | ADD `themory-migrate` one-shot init (mirror `cloud-migrate` `:43`); `themory` + `themory-mcp` `depends_on: themory-migrate: service_completed_successfully`; set `THEMEMORY_SKIP_MIGRATIONS: "true"` on `themory` REST | `pg-themory`/`mock-openai`/gateway/dashboard services UNCHANGED; e2e compose (`tests/e2e/docker-compose.e2e.yaml`) UNCHANGED (single themory, no race) |
| `CHANGELOG.md` | Rule 6 | `Fixed` entries for F-1 + F-4 + LT-1 | — |

### Architecture boundaries affected
- F-1: gateway routing layer only (`internal/routes`); the themory client contract is already correct (carries status). No themory change.
- F-4: dashboard presentation only; RR v7 native API (no new dep — `react-router-dom@^7` already supports `viewTransition`).
- LT-1: dev-compose only (confirmed: e2e compose has a single themory, no race; no k8s/prod manifests in repo). No themory image change (the `themory migrate` subcommand already exists).

## Prior Art & Related Work
- F-1: the client already models `*themory.Error` + sentinel `ErrNotFound`/`ErrSkillConflict` — the fix completes the pattern (4xx passthrough) the client layer already enables.
- LT-1: `cloud-migrate` (`docker-compose.dev.yaml:43`) + `kratos-migrate` (`:126`) are the established one-shot-init precedent; `themory migrate` CLI subcommand (theo-memory `cli.ts:223`) is the init body.
- F-4: react-router v7 `viewTransition` option is the documented replacement for hand-rolled `startViewTransition` wrapping.

## Dependencies
(none — no new runtime/dev deps. `react-router-dom@^7` already in dashboard; `themory migrate` already in the themory image.)

## ADRs

### D1 — F-1: a shared `writeUpstreamError` helper, FAIL-CLOSED consumer-fault allowlist
- **Decision:** one helper maps `*themory.Error` whose `StatusCode` is in the **consumer-fault allowlist `{400, 413, 422}`** → the SAME status to the SDK consumer (echo the upstream `{code,message}` when the body is JSON, else a generic `MEMORY_REQUEST_REJECTED`); **everything else** (5xx, network, unwrapped, AND any other 4xx incl. gateway-master-key `401/403/429` + unexpected/future 4xx) → `502 MEMORY_UPSTREAM_UNAVAILABLE`. Applied to all 13 handlers, AFTER their existing 404/409 sentinel pre-checks. The logged upstream body is CR/LF-sanitized (`sanitizeForLog`).
- **Rationale:** a consumer-fault 4xx (bad body/params) masked as 502 "try again" is misleading + un-actionable (DX bug). FAIL-CLOSED allowlist (security review SEC-STATUS-2): only the documented consumer-fault codes pass through; provider drift / a gateway-side 401/403/429 / an unexpected 4xx fails closed (laundered to 502) rather than mis-attributing an infra/gateway condition to the consumer. DRY: one helper vs 13 ad-hoc branches. SRP: handlers keep domain pre-checks; the generic decision lives once.
- **Alternatives rejected:** (a) per-handler inline 4xx checks — 13× duplication; (b) propagate ALL upstream statuses verbatim incl 5xx — wrong, a themory 500/timeout SHOULD be a gateway 502; (c) **allow-by-default deny-list (pass through all 4xx except `{401,403,429}`)** — REJECTED post-review (SEC-STATUS-2): fail-open on provider drift; an unexpected/future 4xx (or a gateway-construction 405/415) would mis-surface as the consumer's fault. The fail-closed allowlist is the security-correct posture.

> **Amendment 2026-06-24 (post-`/review`):** D1 originally specified "propagate 4xx as the SAME status" (deny-list). The 3-agent `/review` surfaced SEC-STATUS-2 (allow-by-default is fail-open for a security-load-bearing decision) — D1 above is the as-built FAIL-CLOSED allowlist `{400,413,422}`. Tests: `TestMemory*_Upstream{400,413,422}PassesThrough` + `TestMemory*_Upstream{401|UnexpectedUpstream4xx}Becomes502`. Also absorbed SEC-LOGINJ-1 (CR/LF log sanitization).

### D2 — F-4: react-router v7 native `viewTransition`, remove the raw helper
- **Decision:** `navigate(path, { viewTransition: true })`; delete `lib/view-transitions.ts` (+ test).
- **Rationale:** RR v7 sequences the View Transition snapshot AROUND its own route commit (the raw `startViewTransition(cb)` snapshots before React commits → stale panel). Native = correct + less code. No new dep.
- **Alternatives rejected:** (a) `flushSync` inside the raw callback — fights the framework; (b) drop transitions entirely — loses the crossfade for no reason (native gives it for free).

### D3 — LT-1: dedicated one-shot `themory-migrate` init container (Option b)
- **Decision:** add `themory-migrate` (runs `node cli.js migrate`, `THEOMEM_EMBEDDER=openai` to match runtime dim) depending on `pg-themory healthy`; `themory` + `themory-mcp` depend on it `service_completed_successfully`; `themory` REST gets `THEMEMORY_SKIP_MIGRATIONS=true`.
- **Rationale:** matches the in-file `cloud-migrate`/`kratos-migrate` precedent + ADR D8 (migrate-as-separate-concern); removes ALL boot-migration concurrency (init runs once, before either long-running container). themory-mcp has no skip flag so its own `runMigrations` runs as a post-init journal no-op (idempotent, serial — not a workaround, it's defense-in-depth; the race is gone because it's no longer concurrent).
- **Alternatives rejected:** (a) themory-mcp `depends_on themory healthy` — smaller but couples MCP to REST health + both still call migrate; (b) add a THEMEMORY_SKIP_MIGRATIONS flag to themory-mcp in theo-memory — cross-repo coupling + a themory release for a dev-compose fix (YAGNI now; the init container already closes the race). Recorded as an optional themory symmetry follow-up.

## Dependency Graph
```
T1 (F-1 gateway: RED tests → helper → swap 13 → GREEN)        ─┐
T2 (F-4 dashboard: RED test → RR-native navigate → GREEN)     ─┼─ independent; any order
T3 (LT-1 compose: init container + depends_on + skip flag)    ─┘
   ↓ all precede
T4 (Integration validation: go build/vet/test + dashboard test + compose config + CHANGELOG)
```

## Phase 1 — F-1: gateway upstream-4xx passthrough

### T1.1 — RED + GREEN: writeUpstreamError helper + 13 swaps
**Action:** add RED tests in `tests/unit/memory_handlers_test.go` injecting `&themory.Error{StatusCode:422, Body:'{"code":"INVALID_BODY","message":"..."}'}` into `fake.addSkillErr` (+ a verb e.g. `recallErr`) and asserting the handler returns **422** with the upstream code/message (not 502). Then add the `writeUpstreamError(w, err, logMsg, fields...)` helper + swap the 13 blanket-502 sites. Keep the existing generic-error → 502 tests green.
**Reasoning:** TDD; the 422-passthrough is the deliverable; the 502-on-network tests prove no regression.
#### TDD
- `TestMemoryAddSkill_Upstream422PassesThrough` — `&themory.Error{422}` → 422, body carries upstream code/message, NOT 502.
- `TestMemoryRecall_Upstream422PassesThrough` — representative verb.
- existing `*_UpstreamErrorReturns502` (generic `errors.New`) — STILL 502 (no regression).
#### Concurrency tests
(none — single-threaded request handlers.)
#### Acceptance criteria
- `go test ./tests/unit/ -run 'Upstream'` green: 422 cases pass-through, network cases still 502.
#### DoD
- `go build ./... && go vet ./... && go test ./tests/unit/...` green.

## Phase 2 — F-4: dashboard sub-nav viewTransition

### T2.1 — RED + GREEN: RR-native navigate
**Action:** add a sidebar test that clicks a sub-nav item and asserts `navigate` called with `(path, { viewTransition: true })` (mock `useNavigate`); then change `handleItemClick` + `handleBack` to `navigate(path, { viewTransition: true })`; remove the `withViewTransition` import + delete `lib/view-transitions.ts` + its test.
**Reasoning:** asserts the RR-native call (the real fix); jsdom can't exercise the actual transition, so asserting the call shape is the deterministic proof.
#### TDD
- `app-sidebar.test.tsx`: clicking a menu item → `navigate` called with `{ viewTransition: true }`.
#### Concurrency tests
(none.)
#### Acceptance criteria
- `cd dashboard && npx vitest run src/components/layout/app-sidebar.test.tsx` green; `view-transitions.test.ts` removed; no dangling import.
#### DoD
- `cd dashboard && npm run test` green; `tsc --noEmit` clean; `eslint` clean on touched files.

## Phase 3 — LT-1: dev-compose migrate init container

### T3.1 — Add themory-migrate one-shot + serialize
**Action:** add the `themory-migrate` service; add `depends_on: themory-migrate: service_completed_successfully` to `themory` + `themory-mcp`; set `THEMEMORY_SKIP_MIGRATIONS: "true"` on `themory` REST. Verify `docker compose -f docker-compose.dev.yaml config` parses.
**Reasoning:** serializes migration to one one-shot run before either long-running container; idiomatic (matches cloud-migrate).
#### TDD
- N/A (compose infra). Validation = `docker compose config` valid + a stack bring-up where themory-mcp no longer crashes on a fresh-migration boot (manual, in T4).
#### Concurrency tests
(the WHOLE POINT — eliminates the migration concurrency; no race-test code, the topology change is the fix.)
#### Acceptance criteria
- `docker compose -p theo-cloud-dev -f docker-compose.dev.yaml config -q` exits 0; the `themory-migrate` service present; `themory` + `themory-mcp` depend on its `service_completed_successfully`.
#### DoD
- compose config valid; documented in CHANGELOG.

## Phase 4 — Integration validation
- `go build ./... && go vet ./... && go test ./tests/unit/... ./internal/...`
- `cd dashboard && npm run test` (+ `tsc --noEmit` + eslint touched)
- `docker compose -f docker-compose.dev.yaml config -q`
- CHANGELOG `Fixed` × 3.
- Manual `/review` (architecture + tests + cross-validation + domain) → READY_TO_MERGE.

## Coverage Matrix
| Goal claim | Task |
|---|---|
| F-1 writeUpstreamError helper + 13 swaps; 4xx passthrough, 5xx/network → 502 | T1.1 |
| F-1 Go tests: 422 pass-through + network still 502 | T1.1 |
| F-4 RR-native navigate viewTransition; panel re-renders | T2.1 |
| F-4 dashboard test + dead helper removed | T2.1 |
| LT-1 themory-migrate init + serialized depends_on + skip flag | T3.1 |
| LT-1 compose config valid | T3.1 |
| No regression (network 502 / memory surfaces / e2e compose) | T1.1 + T4 |
| F-2 NO change (owner decision; F-1 makes it honest 422) | (n/a) |
| CHANGELOG Fixed × 3 | T4 |

## Drawbacks & Risks
| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | F-1 is an observable contract change (consumers catching 502 on what was a client error now get 4xx) | LOW | it's the CORRECT behavior; pre-release; documented in CHANGELOG |
| 2 | F-1 echoing the upstream body could leak internal detail | LOW | echo only the parsed `{code,message}` (already consumer-facing in themory's REST contract); raw body only logged, not returned |
| 3 | LT-1 themory-mcp still calls runMigrations (no skip flag) | LOW | post-init journal no-op (idempotent, serial); the race is gone; MCP-skip-flag parity recorded as optional themory follow-up |
| 4 | F-4 removing view-transitions.ts could break another importer | LOW | grep confirms only app-sidebar imports it; the test removal is paired |

## Unresolved Questions
(none — all 4 gaps were scoped by discovery to file:line; F-2 resolved by owner decision; the fixes use existing patterns/APIs with no new deps.)

## Failure scenarios
| Dependency | Failure | Reproduced? | Expected |
|---|---|---|---|
| themory upstream | 422 client error | yes (T1.1 inject `*themory.Error{422}`) | gateway returns 422 (not 502) |
| themory upstream | 500/timeout/network | yes (existing generic-error tests) | gateway returns 502 MEMORY_UPSTREAM_UNAVAILABLE |
| dev stack | fresh-migration concurrent boot | manual (T4 bring-up) | init container migrates once; no themory-mcp crash |

## Global Definition of Done
- [ ] `go build ./... && go vet ./... && go test ./tests/unit/... ./internal/...` green.
- [ ] `cd dashboard && npm run test` green; `tsc --noEmit` + eslint clean on touched files.
- [ ] `docker compose -f docker-compose.dev.yaml config -q` exits 0.
- [ ] F-1: 422 upstream → 422 client (tested); network → 502 (tested, unchanged).
- [ ] F-4: sidebar navigates with RR-native viewTransition (tested); `view-transitions.ts` removed.
- [ ] LT-1: `themory-migrate` init + serialized depends_on + REST skip flag.
- [ ] CHANGELOG `Fixed` × 3.
- [ ] Manual `/review` READY_TO_MERGE.

## Final Phase: Integration Validation
Run Phase 4; bring the stack up fresh once to confirm themory-mcp no longer crashes on a new-migration boot (LT-1 empirical proof); then manual `/review`.
