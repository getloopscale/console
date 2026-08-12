---
slug: docs-claims-guard
items: B-158, B-159, B-199, B-200, B-201, B-202, B-204, B-205, B-207, B-208, B-209, B-210, B-211, B-212
date: 2026-08-11
source_opportunity: .claude/knowledge-base/discoveries/opportunities/dashboard-code-review-sweep-opportunity.md
---

# Plan — the docs stop asserting numbers nobody re-measures, and a guard fails when they drift

## Goal

Fourteen items say the same thing in fourteen places: a document states a measured fact
(a count, a size cap, a file path, a file:line pointer) and the code moved. Fixing the fourteen
numbers by hand restarts the same clock.

**This is not speculation — it was observed during this cycle.** The measurement pass recorded
`app.tsx` at 226 lines and `434` `.tsx` files on 2026-08-11; four hours later, after two unrelated
slices, the same commands return **231** and **437**. Two of the numbers this plan was written to
correct drifted *while the plan was being written*.

So the deliverable is not fourteen edits. It is: correct the fourteen, and add a guard that
re-measures every remaining numeric and path claim so the fifteenth cannot land silently.

## Baseline Context

| File | Role | Claims it makes |
|---|---|---|
| `dashboard/DESIGN.md` | 838 lines, the UI contract | dependency reach, motion tokens, component inventory, onboarding routes, instrumentation |
| `dashboard/DOGFOOD.md` | acceptance criteria | bundle cap, audit-template path |
| `dashboard/docs/architecture.md` | measured architecture record | subfolder count, ADR status counts, provenance path |
| `dashboard/docs/adr/README.md` | ADR index | the ADR id range, the nomenclature-gate path |
| `dashboard/docs/adr/0002-…md` | LoC budget ADR | allowlist size |
| `dashboard/docs/padronizacao-ui-2026-08-09.md` | a dated migration plan | P1/P2 status, file counts |
| `dashboard/eslint.config.js` | the enforcement | allowlist size (in prose) |

**Existing precedent for guarding a doc-adjacent fact:** `src/lib/adr-nomenclature.test.ts`,
`src/lib/loc-budget-ratchet.test.ts`, `src/lib/absence-assertion-ratchet.test.ts`. All three are
tests that re-measure disk and fail on drift. This slice adds the same instrument for prose.

**Measured today (2026-08-11, by the author of this plan, not copied):**

| Claim | Doc says | Disk says |
|---|---|---|
| subfolders under `src/components/` | 28 | **9** |
| files importing `@usetheo/ui` | 183 | **198** |
| files importing `@theokit/ui` | 3 files / 4 symbols | **7 files** |
| ADRs awaiting acceptance | 8 | **6 proposed, 8 accepted, 14 total** |
| `max-lines` allowlist entries | 32 (ADR) / 18 (architecture.md) / 18 (eslint prose) | **15** |
| bundle cap (DOGFOOD acceptance line) | 180 KB | **320 kB** enforced |
| `BuildStepList`, `CanaryProgress` | prescribed | **0 files each** |
| `system-design-output/final_report.md` | cited as provenance | **does not exist anywhere in the umbrella** |

**Git sha:** `91c1c798`. **Baseline:** 356 files / 2989 tests green; typecheck + lint clean.

## ADRs

### ADR-1 — a declarative claim table, re-measured on every run

**Decision.** One new test module holding a **table** of claims. Each row: the document, a regex
capturing the asserted number, and a `measure()` closure that computes the truth from disk. One
test iterates the table; a mismatch names the document, the claim, the stated value and the
measured one.

**Rationale.** Fourteen hand edits produce fourteen numbers that are correct for one afternoon.
The repo already knows this pattern works — three ratchets do exactly this for code facts. A table
makes adding the fifteenth claim a one-row change (OCP) rather than a new test.

**Alternatives considered.**
1. *Just fix the fourteen numbers* — the DoD on most of these items is "a test covers the
   corrected behaviour and fails if it regresses", and a hand-edited number has no such test.
   Rejected, and the drift observed mid-plan is the evidence.
2. *Delete the numbers from the docs entirely* — honest, and it loses the information. A count of
   198 importers is the argument for a boundary; removing it removes the argument. Rejected, but
   applied selectively: where a number restates something a config file owns (the bundle cap),
   the doc cites the config instead of copying it.
3. *Generate the docs from measurement* — the correct end state for a metrics table and far more
   machinery than fourteen claims justify (YAGNI). Rejected; the guard gets the same protection
   for a fraction of the cost.

### ADR-2 — a path cited in a governed doc must resolve

**Decision.** A second test asserts that every repo-relative path cited in the governed docs
exists on disk.

**Rationale.** Four items (B-201, B-207, B-209, B-210) are the same defect in path form: a
document points at `system-design-output/final_report.md`, at a deleted audit, at
`src/pages/settings.tsx`, at `docs/adr/adr-nomenclature.test.ts` — none of which exist. A reader
who follows one concludes the record is unverifiable, which is worse than the doc not citing
anything.

**Honest limit, stated rather than discovered later.** The extractor is a regex over prose. It
will not catch every path, and it must not fail on a path that is deliberately illustrative
(`path/to/file.ext`) or on one describing a file that was *correctly* deleted in a historical
note. Both get an explicit opt-out marker, and the guard reports how many paths it checked so a
silent zero cannot pass as coverage.

## Coverage Matrix

| Goal claim | Item(s) | Task |
|---|---|---|
| every stated count matches disk | B-159, B-200, B-208, B-212 | T1, T2 |
| a size cap cites the config that enforces it | B-158 | T2 |
| a cited path resolves | B-201, B-207, B-209, B-210 | T3, T4 |
| a doc stops prescribing what was never built | B-204, B-205 | T5 |
| a stale in-code comment stops describing a removed feature | B-199, B-202 | T6 |
| a dated migration doc states that it is done | B-211 | T5 |
| the guard fails when the next claim drifts | all | T1, T3 |

## Dependencies

No new dependency. `node:fs`, `node:path` and the existing vitest runner — the same instruments
the three existing ratchets use. Parsimony ladder: **rung 2**.

## Tasks

### T1 — the numeric-claim guard (new instrument)

**Why this step.** It must exist before the numbers are corrected, or the corrections have no
test — which is the state the items are complaining about.

**TDD.**
```
test_a_claim_matching_disk_passes
test_a_claim_that_drifted_FAILS_and_names_both_numbers
  RED-proof: seed the table with a deliberately wrong expectation and assert the failure message
test_the_guard_reports_how_many_claims_it_checked
  (a table that silently matched zero rows would pass while proving nothing — the same inert
   shape B-152/B-189 are about, one level up)
```

### T2 — correct every numeric claim (B-158, B-159, B-200, B-208, B-212)

Each corrected value comes from the table in Baseline Context, re-measured by this plan's author.
For B-158 the fix is **not** a new number: DOGFOOD's acceptance line cites
`package.json#size-limit` rather than copying a cap that the config already owns and enforces.

### T3 — the path-claim guard (new instrument)

Reports the number of paths checked; supports an explicit opt-out for illustrative paths and for
historical notes about deleted files.

### T4 — correct every dead path (B-201, B-207, B-209, B-210)

`system-design-output/final_report.md` does not exist: the claim it backs is removed rather than
re-pointed, because there is no artifact to re-point at. `docs/adr/README.md` gets its id range
corrected (`0001`..`0014`) and its nomenclature-gate pointer fixed to `src/lib/`.

### T5 — the docs stop prescribing what was never built (B-204, B-205, B-211)

`BuildStepList` and `CanaryProgress` (0 files each) and the four onboarding routes are marked as
**not built** with their backlog ids, not silently deleted — a prescription that was dropped is
information. `padronizacao-ui-2026-08-09.md` gets a status header saying its P2 is done.

### T6 — stale in-code comments (B-199, B-202)

`app-sidebar.tsx:42-43` describes a hard-coded plan tier the file no longer renders.
`memory/exports.tsx:217` and `memory/playground.tsx:283` end with an orphaned comment describing
an alias export that was deleted.

## Wiring triad

| Pillar | How |
|---|---|
| Caller | Both guards are vitest tests — the suite is their caller, and `npm test` runs them on every commit. |
| Integration test | The guards read real files from disk, not fixtures. |
| Runtime metric | **N/A by construction** — these are build-time gates with no production code path. Recorded so the absence is a decision. |

## Failure scenarios / Concurrency tests

**(none — no external I/O, single-threaded.)** Both guards read the filesystem synchronously in a
test process. The failure mode that matters is a guard that cannot fail, and T1/T3 each carry a
self-test for exactly that.

## Drawbacks & Risks

1. **A guard that is too strict becomes noise.** Every legitimate refactor that moves a count will
   now go red. That is the intent, but it is a cost: the fix must be to update the doc, and the
   failure message must make that obvious. Mitigated by naming both numbers in the message.
2. **The path regex will miss paths and may catch non-paths.** Stated in ADR-2 with an opt-out and
   a reported coverage count rather than left to be discovered.
3. **Fourteen items close on one instrument.** If the instrument is wrong, fourteen items are
   wrongly closed. Mitigated by the self-tests in T1/T3, which are the only reason to trust it.
4. **B-203 is NOT in this slice.** Its headline number could not be reproduced (27 of 72, not 84),
   and the knip ratchet already governs that population. It stays `triaged` with narrowed scope.
5. **B-206 is NOT in this slice.** It is a routing change, not a documentation one, and belongs
   with the product-honesty slice.

## Unresolved Questions

1. **Should the guards cover the umbrella docs too, not just `dashboard/`?** Out of scope — this
   cycle's items are all `frontend-dashboard`. Widening is a separate item.

## Prior Art

- **In-repo:** `loc-budget-ratchet.test.ts`, `absence-assertion-ratchet.test.ts`,
  `adr-nomenclature.test.ts` — three tests that re-measure disk and fail on drift. This slice
  applies the identical instrument to prose, which is the only part of the repo without one.
- **In-repo:** `check-knip-ratchet.mjs`, whose failure message instructs lowering the ceiling when
  a count descends. The numeric guard copies that message discipline: name both numbers, say which
  direction is progress.

## Definition of done (all must hold)

- [ ] A numeric-claim guard exists, is proven able to fail, and reports its coverage
- [ ] A path-claim guard exists, is proven able to fail, and reports its coverage
- [ ] Every claim in the Baseline Context table matches disk
- [ ] `DOGFOOD.md` cites `package.json#size-limit` instead of restating a cap
- [ ] No governed doc cites a path that does not resolve
- [ ] Unbuilt prescriptions are marked as unbuilt with their backlog ids
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green
- [ ] `CHANGELOG.md` `[Unreleased]` updated
