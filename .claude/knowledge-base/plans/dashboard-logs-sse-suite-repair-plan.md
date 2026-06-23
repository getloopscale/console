---
slug: dashboard-logs-sse-suite-repair
milestone_id: DashboardLogsSseSuiteRepair
created_at: 2026-06-23
goal: Make the theo-cloud dashboard test suite globally green (cd dashboard && npm run test exits 0) by root-causing and fixing all 16 failing tests across 6 logs/SSE files — restoring the regressed J-19 runtime-logs feature code (useLogStream named-event + theo-api mapping; runtime-logs env/since stream path + TimeRangePicker mount; log-viewer ANSI render + 3s empty-state + permalink) and correcting the genuinely-stale tests (Radix-Select portal interaction; +1 SSE-stream count; SBOM API-contract shape) — with zero new @skip and each failure traced to a documented root cause.
---

# Plan: dashboard-logs-sse-suite-repair (M1 of skills-dashboard-followups-roadmap)

> The `dashboard/` test suite is red: **16 failures across 6 files** in the logs/SSE area. A 4-agent triage (2026-06-23) found this is NOT all stale tests — **10 are real REGRESSIONS** where J-19 runtime-logs feature code was lost (a `develop` merge `149655d` reverted the runtime-logs feature; a scaffold `686760c` only implemented R3 of the log-viewer/hook). 5 are genuinely STALE tests (a UI-primitive drift to Radix Select + a `+1` SSE-stream count + an SBOM API-contract change). 1 (`pages.smoke`) is a parallelism flake (passes in isolation). This plan fixes CODE for the regressions and TESTS for the stale ones — no `@skip` (Inquebrável Rule 7).

## Goal

> "Make `cd dashboard && npm run test` exit 0 (every suite green) on `develop` by fixing all 16 logs/SSE failures — restoring regressed J-19 code (useLogStream/runtime-logs/log-viewer) and correcting the 5 stale tests (Radix Select portal, SSE count 3→4, SBOM shape) — with zero new `@skip` and each failure root-caused in this plan."

## Context

Surfaced honestly (Inquebrável Rule 3) during the skills-cross-repo `/review` as out-of-scope pre-existing debt. A red `npm run test` erodes the signal of every future PR (new breakage indistinguishable from old). Root-cause triage attached below.

## Baseline Context (root-cause triage — 2026-06-23, 4 Explore agents)

### REGRESSION group — fix the CODE

| File | Failures | Root cause | Fix |
|---|---|---|---|
| `dashboard/src/hooks/use-log-stream.ts` | 3 | The J-17 refactor to `useSSEStream` dropped (a) `eventTypes: ['log']` — so named `event: log` SSE frames are never bound (`addEventListener('log')`), and (b) the theo-api field mapping `{timestamp,line,step} → {ts,msg,source}`. `useSSEStream` supports `eventTypes` (`use-sse-stream.ts:41,172`); the hook just doesn't pass it. | Pass `eventTypes: ['log']`; in the `useMemo`, map theo-api shape → LogLine (`ts←ts??timestamp`, `msg←msg??line`, `source←source??step`, `level←level??'info'`). |
| `dashboard/src/pages/runtime-logs.tsx` | 3 | Merge `149655d` reverted the J-19 feature (`a9480ff`): lost the `selectedRange` state, the `?env=production&since=<range>` stream-path query (env before since), AND the `<TimeRangePicker>` mount (role=combobox). | Restore `selectedRange` state (default `5m`), build `streamPath` with `?env=production&since=${selectedRange}` (env first), render `<TimeRangePicker value onChange>`. |
| `dashboard/src/components/logs/log-viewer.tsx` | 4 | Scaffold `686760c` implemented only R3; missing R2 (ANSI render — `parseAnsi` from `src/lib/ansi.tsx` exists but is not used), R4 (empty-state 3s delay + cancel on disconnect), R5 (permalink: `data-line-index` + click→`location.hash='#L<i>'`). | Wrap `line.msg` in `parseAnsi(...)`; add `showEmptyState` 3s `setTimeout` gated on `connected` (cleanup cancels on disconnect/lines-arrive); add `data-line-index={i}` + `onClick` setting `window.location.hash`. |

### STALE-TEST group — fix the TEST (component/contract are correct)

| File | Failures | Root cause | Fix |
|---|---|---|---|
| `dashboard/src/components/logs/time-range-picker.test.tsx` | 3 | The component is a working `@usetheo/ui` `Select` (Radix): trigger `role="combobox"`, options mount in a PORTAL only after open. The tests query `findAllByRole('option')` racing the async portal. | Open the select (click the combobox), then `await screen.findAllByRole('option')` / `findByRole('option', {name})` with the portal mounted; assert onChange after selecting. Keep one `getByRole('combobox', {name:/time range/i})` presence assert. |
| `dashboard/src/lib/mocks/handlers.test.ts` | 2 | (a) A 4th SSE stream handler (`/deploys/{id}/timeline`, added `416f6fd`) makes the expected count 3 stale → 4. (b) The SBOM API contract changed to `{build_id, apps: AppSBOMSummary[]}` (handler already returns the new shape); the test still asserts the old CycloneDX inline shape. | (a) Bump expected SSE count 3→4 + comment. (b) Assert the new SBOM shape (`build_id`, `apps[]`, `apps[0].sbom_format`); drop `bomFormat`/`components`. |

### Flake — verify only

| File | Note |
|---|---|
| `dashboard/src/pages/pages.smoke.test.ts` | Passes in isolation (26/26); failed once under full-suite parallelism. Re-confirm green in the full run; if it flakes again, root-cause the specific page (separate from this plan's 15). |

### Architecture boundaries

Pure `dashboard/` (React + vitest). No Go, no theo-memory, no API contract change (the SBOM/SSE are mock-handler + test alignment). `parseAnsi` + `useSSEStream` are existing primitives reused.

## Prior Art & Related Work

- J-19 runtime-logs blueprint (R1-R5 referenced in the test describes); the lost commits `a9480ff` (runtime-logs + TimeRangePicker), `1e17c7e` (useLogStream named-event + mapping) are the faithful-restore source. `src/lib/ansi.tsx` (`parseAnsi`) + `src/hooks/use-sse-stream.ts` (`eventTypes`) are the existing primitives. The dashboard `memories.tsx`/`skills.tsx` Radix-Select interaction is the test-pattern precedent for opening a Select before querying options.

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | Restoring regressed code re-introduces whatever caused the original revert (`149655d`). | Medium | The revert was a `develop` merge accident, not a deliberate removal (the tests for the feature stayed). Restore the minimal feature logic the tests pin; full suite + lint gate guards against breakage. | impl |
| 2 | Radix portal interaction is jsdom-flaky (the original failure mode). | Medium | Use `userEvent` to open + `findAllByRole` (async, awaits portal) — the canonical RTL+Radix pattern already used by sibling Select tests; avoid fixed timeouts. | impl |
| 3 | A "stale test" is actually a contract regression (e.g. SBOM). | Low | The triage confirmed the handler returns the NEW shape (matches `types.ts` `BuildSBOM`); the test asserts the OLD shape → the test is stale. Verified against `src/lib/api/types.ts`. | impl |

## Unresolved Questions

(none — every failure is root-caused with a confirmed fix direction; the regression sources exist in git history for faithful restoration.)

## Failure scenarios

No external I/O changed (mock-only). The SSE consumption is tested via the existing mock EventSource. No chaos pass needed.

## ADRs

### D1 — Fix code for regressions, tests for genuine drift (no @skip)

For the 10 regressions, restore the lost feature code (the tests are the correct contract). For the 5 stale tests, update the test to the current correct primitive/contract. NEVER `@skip` to reach green (Inquebrável Rule 7 — a skipped test is invisible debt).

- **Why:** the tests encode the J-19 R1-R5 requirements + the current API contract; making them pass by restoring code (regressions) or aligning assertions (drift) is the honest fix. Cites Rule 7 (no disabled tests) + Rule 3 (honest over green-by-hiding).
- **Rejected alternative:** `@skip`/delete the failing tests to green the suite. Rejected: hides real product regressions (ANSI render, permalink, env/since path are genuinely broken on develop) — a workaround, explicitly forbidden by the goal.

### D2 — Restore from git history, not re-invent

The regressed logic existed in `a9480ff` / `1e17c7e`; restore it faithfully (read the old versions) rather than re-deriving from the test, so behavior matches the original J-19 intent (not just the test's minimum).

- **Why:** avoids subtly-different re-implementations (no-rework discipline); the old code is the authoritative behavior. Cites the no-rework directive.
- **Rejected alternative:** infer the implementation purely from the test assertions. Rejected: risks an under-implementation that passes the test but misses J-19 nuance.

## Dependency Graph

```
Phase 1 (regressions, independent): T1.1 useLogStream · T1.2 runtime-logs · T1.3 log-viewer  (parallel)
Phase 2 (stale tests, independent): T2.1 time-range-picker test · T2.2 handlers test          (parallel)
Phase 3 (validation): T3.1 full dashboard suite green + lint + flake re-confirm
```

## Phases

### Phase 1 — Restore regressed J-19 code

#### T1.1 — useLogStream: bind named `log` events + map theo-api shape
- **Files:** `dashboard/src/hooks/use-log-stream.ts`.
- **TDD:** the 3 tests in `use-log-stream.test.tsx` are RED. Fix: `eventTypes: ['log']` + field-map in `useMemo`. GREEN.
- **Acceptance:** `vitest run use-log-stream.test.tsx` GREEN; non-JSON string fallback preserved; droppedCount unchanged.

#### T1.2 — runtime-logs: restore env/since stream path + TimeRangePicker
- **Files:** `dashboard/src/pages/runtime-logs.tsx`.
- **TDD:** the 3 `runtime-logs.test.tsx` tests are RED. Restore `selectedRange` + `?env=production&since=${selectedRange}` (env first) + `<TimeRangePicker>`. GREEN.
- **Acceptance:** `vitest run runtime-logs.test.tsx` GREEN; stream path matches `/[?&]env=production(&|$)/` with env before since; combobox present.

#### T1.3 — log-viewer: ANSI render + 3s empty-state + permalink
- **Files:** `dashboard/src/components/logs/log-viewer.tsx`.
- **TDD:** the 4 `log-viewer.test.tsx` tests are RED. Add `parseAnsi(line.msg)`, `showEmptyState` 3s timer gated on `connected` (cleanup cancels), `data-line-index={i}` + click→`location.hash='#L<i>'`. GREEN.
- **Acceptance:** `vitest run log-viewer.test.tsx` GREEN (ANSI spans found; empty-state hidden <3s + cancelled on disconnect; click sets `#L1`).

### Phase 2 — Correct genuinely-stale tests

#### T2.1 — time-range-picker: open the Radix Select before querying options
- **Files:** `dashboard/src/components/logs/time-range-picker.test.tsx` (test only).
- **TDD:** open the combobox via `userEvent.click`, then `await screen.findAllByRole('option')`; assert 6 options + uniqueness + onChange. GREEN.
- **Acceptance:** `vitest run time-range-picker.test.tsx` GREEN; component file UNCHANGED (it works).

#### T2.2 — handlers: SSE count 3→4 + SBOM new shape
- **Files:** `dashboard/src/lib/mocks/handlers.test.ts` (test only).
- **TDD:** bump SSE count to 4 (+ comment naming the deploy-timeline stream); replace SBOM assertions with `{build_id, apps[], apps[0].sbom_format}`. GREEN.
- **Acceptance:** `vitest run handlers.test.ts` GREEN; `handlers.ts` UNCHANGED (it's correct).

### Phase 3 — Integration validation

#### T3.1 — full suite green + lint + flake re-confirm
- **TDD:** `cd dashboard && npm run test` exits 0 (all files green, including `pages.smoke` in the full parallel run); `npm run lint` clean for touched files.
- **Acceptance:** `npm run test` exit 0; 0 new `@skip`; `git diff` shows test-only changes for the stale group + code changes for the regression group; CHANGELOG updated.

## Coverage Matrix

| # | Requirement / failure | Detail | Task |
|---|---|---|---|
| 1 | useLogStream named-event (3 tests) | `eventTypes:['log']` + theo-api mapping | T1.1 |
| 2 | runtime-logs env/since path + picker (3) | restore `selectedRange` + query + TimeRangePicker | T1.2 |
| 3 | log-viewer ANSI render (1) | `parseAnsi` | T1.3 |
| 4 | log-viewer empty-state 3s + disconnect (2) | timer gated on `connected` | T1.3 |
| 5 | log-viewer permalink (1) | `data-line-index` + click→hash | T1.3 |
| 6 | time-range-picker portal (3) | open-then-query (test) | T2.1 |
| 7 | handlers SSE count (1) | 3→4 (test) | T2.2 |
| 8 | handlers SBOM shape (1) | new contract (test) | T2.2 |
| 9 | pages.smoke flake (1) | re-confirm green in full run | T3.1 |
| 10 | no @skip; root-caused | Rule 7 + this plan's triage | T3.1 |
| 11 | suite globally green | `npm run test` exit 0 | T3.1 |

## Global Definition of Done

- [ ] All 16 failures fixed: regressions via code, stale via test; `pages.smoke` green in full run.
- [ ] `cd dashboard && npm run test` exits 0 (0 failed).
- [ ] `npm run lint` clean for every touched file.
- [ ] ZERO new `@skip`/`.skip`/`it.skip`; no test deleted to reach green.
- [ ] Regression fixes restore J-19 behavior faithfully (from `a9480ff`/`1e17c7e`); stale-test files change tests only (component/handler unchanged).
- [ ] Each failure root-caused in this plan (done in Baseline Context).
- [ ] `CHANGELOG.md [Unreleased]` updated (Fixed: dashboard logs/SSE suite + restored J-19 runtime-logs regressions).
- [ ] `/review`-equivalent: 0 BLOCKER / 0 HIGH.
- [ ] Plan archived after PR merge.
