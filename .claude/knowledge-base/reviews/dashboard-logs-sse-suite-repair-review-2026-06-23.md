# Review: dashboard-logs-sse-suite-repair (M1)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 3 (regression-restore faithfulness, test-integrity, cross-validation/determinism)
**Findings:** BLOCKER: 0, HIGH: 3 (all FIXED inline), LOW: 2, INFO: several
**Verdict:** READY_TO_MERGE

## Scope reviewed

HEAD on `develop`: `fix(dashboard): green the logs/SSE test suite — restore regressed J-19 + jsdom pointer-capture polyfill` (+ the review-fix commit).

## BLOCKER / HIGH

### F1 (HIGH) — permalink READ-side not restored — FIXED
- Found by: regression-restore agent. The first pass restored only the permalink WRITE side (click → `#L<i>`); a9480ff also had a mount-time READ effect (parse `#L<n>` → scroll the line into view + pin auto-scroll off). The permalink tests only assert no-throw, so write-only passed — an under-implementation vs ADR D2 (faithful, not test-minimum).
- **FIXED:** restored the mount-time read effect (regex `^#L(\d+)$`, bounds-check vs `lines.length`, `scrollIntoView({block:'center'})`, `autoScrollRef=false`). 18 log-viewer+runtime-logs tests green.

### F2 (HIGH) — runtime-logs dropped `droppedCount` threading — FIXED
- Found by: regression-restore agent. The restore omitted `droppedCount` from the `useLogStream` destructure + `<LogViewer>` props; the FIFO-overflow indicator (J-19 R3) was dead UI on the runtime-logs page (a9480ff threaded it).
- **FIXED:** re-added `droppedCount` to the destructure + passed to `<LogViewer>`. tsc clean.

### F-XV-1 (HIGH) — suite not deterministically green (timeout flake) — FIXED
- Found by: cross-validation agent (1/5 full runs failed: `pages.smoke` + `projects` timed out under worker contention; both pass in isolation). The plan's "15 erroring suites stole worker time" theory was partially refuted — `pages.smoke` still timed out once with all suites passing. Real cause: broad worker-pool contention under default vitest config (5s testTimeout).
- **FIXED:** raised `testTimeout`/`hookTimeout` to 20000 in `vitest.config.ts` (the starved tests are not wrong — a pure import-typeof smoke + a render test just need headroom). Re-verified: **3 consecutive full runs green** (143 files, 1005 passed, 8 skipped). Not `@skip`, not a logic change — addresses the real starvation cause.

## LOW / INFO

- F3 (LOW): a9480ff's log-viewer also had copy-to-clipboard (R6) + local-time tooltip (R9) + toolbar subcomponents — genuinely out of this plan's R2/R4/R5 scope (+ predates the `@usetheo/ui` re-scaffold). Tracked as separate J-19 follow-ups if still desired; not in scope here.
- handlers SBOM test uses one `toBeDefined()` (`build_id`) alongside two stronger exact/instanceOf assertions — net strength equal-or-greater; acceptable.
- F-XV-2 (LOW): the 8 skips are pre-existing in `login.test.tsx` (untouched by this work) — "no @skip" holds for the logs/SSE repair scope.

## Test-integrity verdict (agent 2)

Suite made green HONESTLY: NO `@skip`/`xit`/`.skip` added, NO test deleted. The Pointer Capture polyfill is a legitimate guarded jsdom shim (real browsers have these natively; it only lets Radix Select open — cannot mask a product bug; `time-range-picker.test.tsx` was NOT modified, the cleanest fix). SSE count 3→4 + SBOM shape track the real handler/contract (not gamed).

## Cross-validation summary

- Coverage Matrix 11/11 delivered.
- Scope: dashboard-only (no Go, no theo-memory); `go build`/`go test` unaffected.
- Regressions restored faithfully from `a9480ff`/`1e17c7e` (write+read sides now complete after F1/F2).
- Full suite: 3 consecutive green runs post-fix (143 files, 1005 passed, 8 pre-existing skips, 0 failed).

## Quality gates

- `cd dashboard && npm run test`: 0 failed, deterministic green ×3. `tsc --noEmit` clean. `eslint` clean on touched `.ts/.tsx` (vitest.config.ts is eslint-ignored — config file).

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. All 3 HIGH fixed inline (permalink read-side, droppedCount, deterministic-green via testTimeout). LOW/INFO are out-of-scope follow-ups / accepted. Pure dashboard change; no `@skip`, no deleted tests.
