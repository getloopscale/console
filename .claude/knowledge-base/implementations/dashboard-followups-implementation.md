# Implementation — dashboard-followups (B-242, B-277, B-278, B-279, B-280)

**Plan:** `.claude/knowledge-base/plans/dashboard-followups-plan.md` (`SHIPPABLE`, 91.6)
**Baseline sha:** `4a63fd9e`
**Branch:** `workspace`
**Date:** 2026-08-13

## What shipped, and what did not

| Item | Before | After | Status |
|---|---|---|---|
| B-277 — the label rule in three places | 3 copies | 1 owner | **shipped** |
| B-278 — two vulnerabilities | 1 MODERATE shipped, 1 HIGH not shipped | MODERATE gone, HIGH allowlisted + ADR | **shipped** |
| B-279 — the detector's tail | 16 words invisible, 43 declarations | 0 | **shipped** |
| B-242 — absence assertions that cannot fail | 91 | **84** | open, attributed |
| B-280 — shuffle fails | environment 690s, shuffle red | environment **415s**, shuffle **still red** | **open** |

Final state: `tsc --noEmit` clean, `npm run lint` clean (knip 30/30), fixed-order suite
**381 files / 3377 tests** green, `npm run build` green.

## B-277 — one owner, proved by mutation

The item registered two sites; measuring found **three** — `billing.tsx:193`, `billing.tsx:314` and
`rag/connectors.tsx:61`, the last differing by one separator. Three call sites of one rule is the
Rule-of-3 threshold, so the extraction is justified rather than speculative.

`humanizeKey` went into `lib/formatting/format.ts`, the module every consumer already imports for
this class of function (rung 4 — not a new module).

**The proof the item asked for:** one mutation of the owner (forced to a constant) reddens
`billing.test.tsx` (3 cases), `format.test.ts` (4) and `connectors.test.tsx` (3). Before the
extraction, the same class of mutation on one of the two billing copies reddened nothing.

## B-279 — the tail, and why the sizing in the item was noise

The block estimated `inteiro` 84 and `mostrar` 37. That came from `grep -rlw`, which counts FILES
MENTIONING a word — including the Portuguese prose the convention permits. As declarations they are
**1 and 1**. Sixteen words, 46 occurrences by the harness's scanner, **43** by the ratchet's; the
difference is `BindingElement`, a kind the harness renames and the ratchet does not count.

Words went into `SUPLEMENTO_IDENTIFICADORES` and **not** `MARCADOR` — verified, because
`varrerInterface` reads the latter and is an ACTIVE guard over on-screen text.

**RED first, and visibly:** adding the words took the guard to 43 before a single rename. A
widening that does not raise the number has not widened anything, and that is the tell separating
this from B-238, where a ceiling fell because a detector was narrowed.

**The purity check caught itself being vacuous.** The first version compared quoted runs with grep
and reported 12 literal deltas; opening them showed object-literal KEYS and template
interpolations, neither of which is a literal change. Rewritten to parse both trees and compare
multisets — and its first run reported `30 files listed, 0 actually compared` while printing a
green zero, because it was run from the wrong directory. It now refuses to report on zero files.

```
30 files compared
comments changed: 1   — src/test/i18n-guard.ts, the hand-written docblock
literals changed: 1   — the same file, the sixteen word strings
the other 29 (169 harness edits): 0 and 0
```

## B-278 — two problems, opposite actions

| | severity | ships? | action |
|---|---|---|---|
| `prismjs` GHSA-x7hr-w5r2-h6wg | MODERATE | **yes** — `react-syntax-highlighter` is a prod dep used by two RAG screens | bumped to 16.1.1 → prismjs 1.30.0, `refractor` dropped |
| `nanoid` GHSA-2v37-7h3g-55p8 | HIGH | **no** — `@theokit/ui` declares `vite` as a runtime dep | allowlist + ADR, sunset 2026-11-11 |

The bump is semver-major, so it was an attempt with a gate: `tsc` clean, 20 RAG test files / 101
tests green, `npm run build` green.

**Why the HIGH was not simply pinned.** An `overrides` entry exists, works, and would turn the
audit green **without changing a byte of what ships**. A report that improves while reality does
not is the failure this repository keeps registering under other names. The correct fix is in
`@theokit/ui`'s packaging, which has no checkout in this umbrella.

## B-280 — half closed, and the other half changed shape

**Closed half — starvation.** 131 of 379 test files built a jsdom they never used.

```
before   transform 26.51s  setup 133.55s  import 562.67s  tests 487.42s  environment 690.34s
after    transform 24.85s  setup 125.03s  import 471.52s  tests 434.66s  environment 415.11s
```

Environment was the largest of the four lines and is now the smallest — **−40%**.

111 moved; **22 moved back**, and those 22 are the finding: they read no DOM themselves but a
module they import touches a browser global at import time. `lib/http/config.ts` is the clearest
(`export const API_URL = getConfig().API_URL` runs on import and reads `window.__THEO_CONFIG__`,
and `api.ts` — 151 importers — imports it). A one-line defensive read was **tried and reverted**:
it did not unlock them, because `document` is read eagerly elsewhere too. Registered as **B-282**.

The invariant is the point: `environment-fit.test.ts` fails when a DOM-free file lacks the pragma,
asserts the 22 exceptions exactly (a new one cannot join silently, a fixed one cannot be forgotten
in it), and carries six cases proving the classifier discriminates — including that
`config.location` is not the global and that the word in a comment is not a reference.

**Open half — and the failure changed character.** Before: `Test timed out in 20000ms` on a varying
file. After: one file, one assertion.

```
settled-tree shuffle, 3 runs:   FAIL / pass / FAIL
   FAIL src/pages/lens/overview.test.tsx > M60 …
   TestingLibraryElementError: Unable to find an element with the text: Throughput (traces)

the same file ALONE, 4 runs with --sequence.shuffle:   3 pass / 1 FAIL
```

Isolated + shuffled + an assertion failure is order dependence **inside the file**, not contention.
Registered as **B-283**, with the two hypotheses stated as hypotheses (the `QueryClient` was checked
and ruled out — `src/test/render.tsx:37` builds one per render).

So B-280 stays open. The cost is down 40% and the DoD line is not met.

## B-242 — seven anchored, and the rest attributed

Each of the seven proved by mutation, with the absence assertion staying green — which is the
finding, not a footnote.

**One of my own mutations was invalid and nearly passed as proof.** Replacing the first occurrence
of "URL pending" in `live-url-hero.tsx` hit a COMMENT on line 14, not the Badge on line 109. The
test stayed green and for a moment that read as "the anchor does not discriminate". Mutating the
right line killed it.

The 84 that remain are attributed: ~8 anchorable, 25 fixture-introduced (B-276), ~50 with the text
nowhere. The classifier that produced the split errs both ways and the docblock says so.

## A measurement-hygiene lesson

Two of three earlier shuffle runs also failed on the B-242 ratchet — because I was editing the
assertions **while the suite ran**. Measuring a suite during its own edit produces a red that is
not the suite's, and it cost one full round of investigation before I noticed the pattern.

## Items registered on the way

- **B-281** — the next tail of the identifier detector, measured the same way.
- **B-282** — modules reading browser globals at import time; the cause of the 22.
- **B-283** — the `lens/overview` intra-file order dependency.
