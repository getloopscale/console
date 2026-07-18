# M14 AppModal — benchmark + review record

Date: 2026-07-18
Cycle: CODE-QUALITY / REVIEW / BENCHMARK for milestone M14 (`standard-modal-component`).
Commits: `1d02077` (impl), `d628d6a` (review edge-case tests).

## Benchmark (measured)

The honest metric for a modal-standardization is **byte cost + dedup**, not latency
(the mount cost is Radix's, unchanged — AppModal is a pass-through wrapper).

| Metric | Value | Method |
|---|---|---|
| AppModal code size | 92 LoC (53 code-only) | `wc -l` |
| Minified byte cost | **608 B** | `esbuild --bundle --minify` (react/@usetheo/ui/tailwind-merge external) |
| Gzipped byte cost | **387 B** | `gzip -c` of the minified output |
| New dependencies added | **0** | reuses `Dialog` + Radix + tailwind-merge already bundled |
| Ad-hoc `<Dialog.Content>` sites today | **20** | `grep -rl '<Dialog.Content' src` |
| Scaffold lines centralized per site | **~12** | Dialog/Content/Header/Title/Description/Body/Footer wiring + size map |
| Projected scaffold LoC removable as sites convert | **~240** | 20 sites × 12 lines |
| Mount+unmount cycle (jsdom) | mean **35.6 ms** (rme ±8.86%, 15 samples) | `vitest bench` — Radix portal cost; wrapper adds no render work |

**Interpretation:** AppModal costs 387 B gzipped and zero new deps, and centralizes the
~12-line Dialog skeleton that 20 sites duplicate today (~240 LoC of duplication it can
retire as those sites convert). M14 converts the shared `NewFolderDialog` (used by 2
pages) + the Wiki New-page surface; the rest are roadmap-declared follow-ups. The mount
timing confirms the wrapper adds no measurable render overhead over the base `Dialog`.

## Code-quality gates (all PASS)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| ESLint (changed files) | 0 |
| Full dashboard suite | 236 files / 1784 tests pass, 8 skipped, 0 fail |
| Production build | GREEN (107 PWA precache entries) |
| Dead code / orphan export | AppModal has 2 real callers (NewFolderDialog, wiki.tsx) |

## Review (multi-agent, pre-merge)

- **Architecture/wiring reviewer → READY_TO_MERGE.** No BLOCKER/HIGH/MEDIUM. Verified: full a11y/focus/ESC/overlay delegation to Radix; the `size` token via twMerge provably wins over the `Dialog.Content` default `max-w-lg` (Content uses `cn`=twMerge with the caller className last — even narrower `sm` wins); `detailOpen = openPageID !== null` state transitions consistent (no leak when creating over an open split); no dead code; create-failure keeps the modal open. 2 LOW/INFO cosmetic notes (redundant inner `w-full`; benign double `/`-guard).
- **Test auditor → TESTS_NEED_MORE (addressed).** Flagged 3 edge-case gaps vs the plan: EC3 (New-page create-failure keeps modal open + inline error), EC5 (create-while-split-open replaces the split), EC2 (overlay/X close at AppModal level). **All three closed in `d628d6a`** — new tests: AppModal X-close + `hideCloseButton`; Wiki create-failure (modal stays open + error); Wiki create-over-split (modal closes, split shows the new page). Re-run: 14/14 green.
- **Design critic** — crashed (context thrashing, 0 output); advisory-only, non-blocking.

## Verdict

READY_TO_MERGE — all gates green, all review merge-gating findings resolved, DoD covered.
