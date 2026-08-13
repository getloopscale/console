---
slug: dashboard-followups
date: 2026-08-13
verdict: READY_TO_MERGE_WITH_FOLLOWUPS
baseline: 4a63fd9e
head_reviewed: 67b3bf76
head_after_fixes: 47990e99
reviewers: 2
---

# REVIEW — `dashboard-followups` (B-242, B-277, B-278, B-279, B-280)

## Verdict

**`READY_TO_MERGE_WITH_FOLLOWUPS`** — 0 BLOCKER. 3 HIGH and 9 MEDIUM found, **all closed in this
cycle**. The residual debt is 5 registered followups, named below.

Per `cycle-review § Verdicts`, `READY_TO_MERGE` allows at most 2 HIGH with documented mitigation.
This slice had 3, and although every one is now closed, the honest token for a review that surfaced
more than the cap and carries named followups is the `WITH_FOLLOWUPS` band. The blocking work is
closed and provable; the debt is real and owned.

## Pre-conditions

| Gate | State |
|---|---|
| `/implement` emitted `IMPLEMENTATION_COMPLETE` | yes — `67b3bf76` |
| `/code-quality` verdict | `FAIL_SOFT` (21 Go soft caps, all pre-existing, all allowlisted) |
| ADR dismissing each soft cap | **`ADR-0011`** — written during this review, which found it missing |
| Working branch | `workspace` |
| Tree clean at review start | **no** — see § Caveats |

## Method

Two independent reviewers over `4a63fd9e..67b3bf76` (8 commits), running concurrently:

- **Adversarial** — mutation-tested every claim: broke production strings to prove each B-242 anchor
  reddens, deleted DOM globals to see whether the classifier guard is vacuous, stripped pragmas from
  11 files whose transitive graph branches on `typeof window`, re-derived the B-279 purity audit
  with two independent tokenizers, rebuilt `dist/` to check what actually ships.
- **Cross-validation** — re-derived every numeric claim in the record from `git archive` copies of
  both trees, never reading the number it was checking. Verified each plan task against its own
  acceptance criteria and DoD.

Neither reviewer modified the repository; all destructive verification ran in scratchpad copies or
was restored from backups.

## Findings

### HIGH

**H1 — the `nanoid` ADR's rationale was false in both premises, and the fix it called impossible
took one command.** The ADR deferred a HIGH via allowlist on the grounds that `@theokit/ui` declares
`vite` as a runtime dependency (making it a third party's packaging defect, unfixable here) and that
any local bump would only green the report. Measured: `vite` is a **`peerOptional`**, which is the
correct declaration for a design system shipping a Vite plugin; and `npm explain nanoid` shows the
physical install is required by `postcss`, a **direct devDependency of this dashboard**. `npm audit`
named the remedy in its own output.

→ **Closed** by taking the patch (`npm update nanoid`, 3 lockfile lines, `package.json` untouched).
`npm audit --omit=dev` went from 1 high to **0**. Allowlist entry deleted; ADR rewritten to record
the corrected mechanism and what the first draft got wrong. `f80d050f`.

**H2 — the registry contradicted itself on two closed items.** B-278 and B-279 read `[x]` in a
commit literally titled `close B-277/B-278/B-279` while their `status:` field still said `raw`.
`cycle-maintenance § Chain` SELECTs on `status`, so the macro loop would have re-picked both closed
items as unmeasured hypotheses and routed them back to `/discover`. B-280 was also `raw` despite
being the most heavily measured item in the slice.

→ **Closed**: B-278/B-279 → `shipped`, B-280 → `triaged`. `f80d050f`.

**H3 — "111 moved" and "131 now run in Node" are both wrong, and the second reached the CHANGELOG.**
The true accounting is `misfits(baseline)=131`, `misfits(HEAD)=22`, resolved `=109`. The published
111 contradicted itself in its own sentence (111 + 22 = 133 ≠ 131). And 22 of the 131 still build a
jsdom — they are listed by name in the guard — so "they now run in a plain Node environment" was
false in the user-visible document.

→ **Closed**: corrected in `BACKLOG.md`, in both `environment-fit` docblocks, and in the CHANGELOG,
which now also states the residual (22 exceptions) and that the shuffle failure is reduced rather
than closed. `f80d050f`, `47990e99`.

### MEDIUM

**M1 — the `.tsx ⇒ needs a DOM` axiom put 213 of 379 files outside the invariant.** Refuted by a
file already in the tree: `add-webhook-dialog.test.tsx` carries the node pragma and renders nothing.
The axiom was not substituting for a check — it was **hiding** one: all 43 JSX-bearing `.test.tsx`
that the widened classifier first called DOM-free import `@/test/render`, this repo's own re-export
of @testing-library, which `DOM_MODULES` did not know. Dropping the short-circuit without teaching
it that name would have moved 43 rendering suites to `node` and broken all of them.

→ **Closed**: classifier widened to all 379 files, `@/test/render` added to `DOM_MODULES`, 3 real
misfits found — 2 moved, 1 (`pages/trust/violations-date.test.tsx`) failed under `node` with
`ReferenceError: window is not defined` and was returned to the exception list with the others.
`47990e99`.

**M2 — 15 of the classifier's 24 DOM globals could be deleted with the guard fully green.** Only
`document` and `location` were load-bearing against the corpus as it happens to be written today.

→ **Closed**: a table-driven case now exercises every entry. A vocabulary is validated by the input
it must classify, not by which words today's files happen to use.

**M3 — `globalThis.document` was invisible.** The same `isPropertyAccessExpression` rule that
correctly rejects `config.location` rejected every qualified read — the idiom people reach for
*precisely when* they are being careful about environments.

→ **Closed**: qualified reads through `globalThis`/`window`/`self`/`top`/`parent` now count, and the
`config.location` discrimination is pinned by its own case. The `HTMLxElement`/`SVGxElement`
families are matched by shape, and the remaining limits (alias indirection, the conservative
`Blob`/`Event` entries) are declared in the docblock rather than left to be discovered.

**M4 — the B-280 timings do not reproduce and one directional claim is wrong.** Three independent
full runs measured `environment` at **479.93s / 497.98s / 427.70s** against a published 415.11s.
From 690.34s that is a real drop of 28–38%, not the stated 40%, and the spread between runs is wider
than the single figure implied. `environment` is now third of five, not "the smallest" — `import`
and `tests` are both larger, which is what the opportunity actually predicted.

→ **Closed**: all three runs recorded with their provenance, the direction kept, the precision
withdrawn. The slice's own measurement-hygiene lesson applies to the numbers above it.

**M5 — the B-242 composition does not add up.** `8 + 25 + 50 = 83`, presented as the composition of
84, and the 8 included the 7 already anchored — which by construction are no longer among the 84.
The classification was of the **91** before the slice: 16 anchorable, 25 fixture, ~50 no-text.

→ **Closed**: corrected in both the registry and the ratchet docblock. Nine anchorable remain and
**only one has a recorded reason**; the other eight (`recovery:331,536`, `environments:232,233`,
`alerts:558`, `catalogo:484`, `api-keys:253`) have neither an anchor nor an explanation, which is
now stated as the reason B-242 stays open.

**M6 — the identifier guard reports zero over seven node kinds and never looked at the eighth.**
`varrerIdentificadores` does not inspect `BindingElement`, so every name introduced by destructuring
was outside the zero. Measured with the repo's own detector: **40 declarations over 33 names**,
nearly all `const [erro, setErro] = useState()`. The guard was reporting a true zero and an untrue
impression at the same time.

→ **Closed**: `varrerBindingElementsPT` added, `BINDING_ELEMENT_CEILING = 40` pinned with `toBe`
(mutation-proved: bumping to 41 reddens). Migration registered as **B-285**.

**M7 — the ratchet's primary docblock asserted the opposite of the tree.** It still said the B-279
tail words "are still in the tree and are simply not in it" after all sixteen had been learned and
their 43 declarations migrated, and still said "276 names" after the map reached 301.

→ **Closed**: rewritten to state both axes of the zero's narrowness, with the follow-on items named.

**M8 — `/review`'s own pre-condition was unsatisfied.** `FAIL_SOFT` may proceed only with an ADR
dismissing each soft cap, and none existed.

→ **Closed**: `ADR-0011`. The 21 are all `dead_code_unallowlisted_go`, all pre-existing, all already
allowlisted, and the slice contains **zero `.go` files** (`git diff --name-only | grep -c '\.go$'`
→ 0). Dismissed for this slice only; the debt belongs to the `control-plane` domain.

**M9 — R7 ("one commit per item") violated three ways, and a 102-line orphan shipped across four
commits.** `a64c8fe2` (B-279) added `dashboard/scripts/environment-fit.mjs` — B-280 code; `3fc0b277`
(B-242) added a node pragma — B-280 work; `b8168674`, a `docs(...)` commit, deleted the `.mjs`. That
module had **zero importers in every commit it existed in** and was a near-verbatim duplicate of
`src/test/environment-fit.ts`, created two commits later.

→ **Not fixable in place.** The history is on `workspace` and rewriting it is forbidden
(`git-safety.md § 2`). Recorded here and in the implementation record. This is the third consecutive
slice where bundling was both predicted by the plan's own risk register (`likelihood: certain if
unmanaged`) and then done anyway; the correction belongs in how commits are cut, not in this diff.
It is also the direct cause of one earlier false claim — "0 comments / 0 literals changed" was true
of the compiler and false of the commit that carried it.

### LOW (all closed)

| # | Finding | Closure |
|---|---|---|
| L1 | `humanizeKey`'s "no behaviour change" DoD is false — each old site accepted one separator and passed the other through | Widening pinned by a case; docblock and CHANGELOG say so. No shipped key mixes them, so nothing on screen moved |
| L2 | `i18n-guard.ts` shipped "46 occurrences" six lines from a detector that reports 43 | Both numbers stated with their instrument: 46 is the harness's scanner (counts `BindingElement`), 43 is the ratchet's |
| L3 | `consumo.ts` carried an orphan duplicate docblock, and two unrelated `label` fields | Duplicate removed. The `label` pair is **not** a collision: `Target.label` is the SDK's own parameter name, which the snippet literally emits (`getPrompt(name, { label })`, `?label=`, `"label":`). Renaming it would decouple the field from its own output; documented instead |
| L4 | `CHANGELOG [Unreleased]` had 16 `###` sections for 3 categories | Normalised to Unbreakable Rule 6's fixed order; all 175 bullets preserved verbatim |
| L5 | Denominator drift: one file said "130 of 379", its sibling "131 of 379" | Both corrected; 131 is the measured figure |
| L6 | T4.1's DoD ("the reason written beside each file") was met by one collective docblock | Kept collective — 22 files share one cause — and the 23rd now carries its own measured `ReferenceError` |

## Claims that survived every attempt to break them

Stated because the previous slice's review found the opposite, and because a review that only lists
defects is not a measurement.

- **B-277's owner is load-bearing from all three consumers.** Mutating `humanizeKey` to a constant
  reddens `billing.test.tsx` 3, `connectors.test.tsx` 3, `format.test.ts` 4 — matching the recorded
  figure exactly.
- **B-279 did not touch `MARCADOR`.** Byte-identical across the slice: 1203 bytes,
  `sha256=791752d6…`, and `git diff --numstat` on the file is `15 0` — fifteen lines added, zero
  removed, all inside `SUPLEMENTO_IDENTIFICADORES`. The active screen-text guard was never widened.
- **B-279's rename touched no comment and no string literal in any of the 29 production files.**
  Re-derived by two independent tokenizers — a character state machine and the real TypeScript
  parser — which agreed.
- **B-278's shipped vulnerability is genuinely gone.** `prismjs` 1.27.0 → 1.30.0, absent from
  `npm audit --omit=dev`, all ten deep imports still resolve, highlighter still in `dist/`.
- **B-280 stopped nothing from testing.** Test-count accounting closes exactly; zero silent-skip
  shapes in the moved files; and the decisive check — 11 files whose transitive graph branches on
  `typeof window` were run BOTH ways and gave identical results (114 tests, both environments).
- **All seven B-242 anchors redden, none is a tautology.** Seven production mutations, seven runs:
  in every case exactly one case fails and the paired absence assertion stays green — which is
  precisely the discrimination the pair exists to provide.
- **The 91 → 84 drop is caused solely by those seven.** Proved by reverting the seven test files and
  re-running: `expected 91 to be 84`. Nothing else in the slice moved the number.
- **The guards cannot be gutted.** `domFitness → always true`, `→ always false`, `DOM_GLOBALS → 2
  entries`, `CEILING_UNANCHORED + 1`, `BINDING_ELEMENT_CEILING + 1`, pragma deleted, pragma added to
  an exception — every mutation reddens.

## State after fixes

```
suite            381 files / 3385 tests passed, exit 0
                 (+8 vs the reviewed HEAD = exactly the cases added by this review)
tsc --noEmit     clean
eslint           clean
knip ratchet     30/30, other classes at zero
npm audit        --omit=dev: 0 vulnerabilities   (was: 1 high)
npm run build    exit 0
```

## Followups registered

| Item | What |
|---|---|
| **B-281** | The next vocabulary tail of the identifier guard, measured while closing the last one |
| **B-282** | The 22 (now 23) files that cannot leave jsdom — a module they import reads a browser global at import time |
| **B-283** | The intra-file order dependency in `lens/overview.test.tsx` — the second, unrelated half of the shuffle failure |
| **B-284** | 16 findings in the dev dependency tree that no item covers (production surface is clean) |
| **B-285** | The 40 Portuguese `BindingElement` declarations, now measured and frozen |

Open items carried forward: **B-242** (9 anchorable remain, 8 unexplained) and **B-280** (shuffle
reduced, not closed). Both correctly `triaged`, neither claimed as shipped.

## Caveats about the review itself

- **The tree was not clean when the reviewers started.** A staged audit file was present and a
  concurrent session committed twice mid-run; both reviewers observed uncommitted edits appear and
  disappear. One reviewer's first measurement showed 6 spurious failures and was correctly
  attributed to the tree moving underneath it, then re-derived from `git archive` copies. This is
  the same measurement-hygiene failure the slice already records against itself, and it says the
  lesson has not yet been converted into a habit.
- **The published timings were taken on a shared machine**, which is why three runs disagree by
  ~70s. Any future performance claim in this repository needs a variance band or it is an
  observation, not a measurement.
- **One reviewer's first mutation attempt was invalid** and briefly read as a failed anchor:
  appending to `URL pending` left the substring intact, so `getByText(/URL pending/i)` still
  matched. A substring-preserving mutation is not a mutation — mutate to a disjoint string at the
  rendered site.

## Cross-references

- `.claude/rules/cycle-review.md`
- `.claude/knowledge-base/plans/dashboard-followups-plan.md`
- `.claude/knowledge-base/implementations/dashboard-followups-implementation.md`
- `.claude/knowledge-base/audits/dashboard-followups-code-quality-2026-08-13.md`
- `.claude/knowledge-base/adrs/ADR-0011-dismiss-go-soft-caps-for-a-dashboard-only-slice.md`
- `.claude/knowledge-base/adrs/ADR-b278-nanoid-patched-in-lockfile.md`
