# Plan: close the five followups the ratchet-burndown slice left open

**Items:** B-242, B-277, B-278, B-279, B-280
**Slug:** `dashboard-followups`
**Date:** 2026-08-13
**Baseline sha:** `58d2f011`
**Upstream opportunity:** `.claude/knowledge-base/discoveries/opportunities/dashboard-followups-opportunity.md`

## Goal

Close the four items the previous slice's adversarial review registered, plus the next batch of the
one it left open:

- **B-277** — give the machine-key-to-label rule ONE owner, called from all three sites, and prove
  the owner is load-bearing by mutation.
- **B-279** — teach the identifier detector the 16 words of its measured tail, migrate the 46
  declarations they reveal, and keep the guard at zero without touching `MARCADOR`.
- **B-278** — remove the vulnerability that actually ships (`prismjs`, MODERATE, DOM Clobbering) or
  allowlist it with a sunset and a measured reason; address the `nanoid` HIGH where it is caused,
  which is not here.
- **B-280** — cut the cost that starves the workers instead of raising the timeout again: move the
  130 test files that never touch the DOM off jsdom, and install an invariant that keeps them off.
- **B-242** — anchor the 16 assertions the classifier says a positive case can exist for, lower the
  ceiling, and leave the other 75 correctly attributed.

## Context

Four of these were filed by the review that tore apart the previous slice, and one of the four was
filed **wrong by me** — B-278 named the wrong package as HIGH and said the harmless one ships. The
correction is already in the registry and in the opportunity; this plan works from the corrected
measurement.

The common shape across the five is the one this repository keeps paying for: **a number that
measures a spelling instead of a defect.** B-279's tail was sized with a grep that counted prose.
B-280's failure looks like a flaky test and is a resource budget. B-277's duplication is invisible
to a mutation that only touches one copy. Every task below therefore ends in a check that fails
when the thing it describes stops being true.

## Baseline Context (deep review of current state)

Measured 2026-08-13 at `58d2f011`, tree clean, on `workspace`. Fixed-order suite: 380 files / 3361
tests green. `tsc --noEmit` clean. `npm run lint` clean (knip ratchet 30/30).

### Files that will be touched

| File | LoC | Role today | Change |
|---|---|---|---|
| `dashboard/src/lib/formatting/format.ts` | 316 | `formatDate`, `formatNumber`, `humanizeAuthor`, 8 more | NEW `humanizeKey` — the single owner (B-277) |
| `dashboard/src/lib/formatting/format.test.ts` | — | its tests | cases for `humanizeKey` |
| `dashboard/src/pages/settings/billing.tsx` | 520 | derives the label twice (`:193`, `:314`) | both call the owner |
| `dashboard/src/pages/rag/connectors.tsx` | — | derives it a third time (`:61`) | calls the owner |
| `dashboard/src/test/i18n-guard.ts` | 291 | `MARCADOR` + `SUPLEMENTO_IDENTIFICADORES` | 16 words into the SUPPLEMENT only (B-279) |
| ~30 production `.ts`/`.tsx` | varies | hold the 46 tail declarations | renamed by the existing harness |
| `dashboard/scripts/identifier-map.json` | 276 entries | the migration record | + the tail's names |
| `dashboard/vitest.config.ts` | 45 | one jsdom environment for everything | unchanged default; see D4 |
| ~130 `*.test.ts(x)` | varies | pay for a jsdom they never use | `@vitest-environment node` pragma (B-280) |
| `dashboard/src/lib/environment-fit.test.ts` | 0 (new) | — | NEW — the invariant that keeps them off jsdom |
| ~10 `*.test.tsx` | varies | hold anchorable absence assertions | one anchored case each (B-242) |
| `dashboard/src/lib/absence-assertion-ratchet.test.ts` | 434 | ceiling 91 | lowered |
| `dashboard/package.json` | — | `react-syntax-highlighter@^15.6.6` | bumped, or allowlisted (B-278) |
| `.claude/rules/deps-audit-allowlist.txt` | — | exemptions | an entry if the bump does not land |
| `CHANGELOG.md`, `BACKLOG.md` | — | the contract and the registry | entries and status |

### Current callers / dependents

| Symbol | Declared in | Consumed by |
|---|---|---|
| the key→label expression | inline ×3 | `billing.tsx` (UsageMeter + the Includes list), `connectors.tsx` (OAuth provider label) |
| `SUPLEMENTO_IDENTIFICADORES` | `src/test/i18n-guard.ts` (module-private) | `ehIdentificadorPT` only |
| `MARCADOR` | same file (module-private) | `ehIdentificadorPT` **and** `varrerInterface` — the shared half, deliberately untouched |
| `varrerIdentificadores` | same file | `identifier-language-ratchet.test.ts`, `scripts/identifier-map.test.mjs` |
| `RenameHarness` | `scripts/rename-identifiers.mjs` | its own tests, and the CLI used for the migration |
| `environment: 'jsdom'` | `vitest.config.ts:14` | every test file without a pragma — 357 of 379 |

### Domain glossary

| Term | Meaning here |
|---|---|
| **the tail** | the 16 Portuguese words the detector's lists do not contain, and the 46 declarations they reveal |
| **the supplement** | `SUPLEMENTO_IDENTIFICADORES` — read only by the identifier guard, never by the interface-text guard |
| **anchorable** | an absence assertion whose queried text exists in the screen the test owns, so a positive case can exist |
| **starvation** | a test failing on a 20 s timeout because workers are contending, not because the code is wrong |
| **ships / does not ship** | whether Rollup puts the package in the bundle. Decides which of B-278's two advisories is a product risk |

### Architecture boundaries affected

None crossed. `humanizeKey` joins an existing formatting module that pages already import; the
identifier work is test-support plus renames; the environment work is test configuration. The only
change with a public surface is the `react-syntax-highlighter` major, and only if it lands.

## Prior Art & Related Work

- **The previous slice** (`.claude/knowledge-base/plans/dashboard-ratchet-burndown-plan.md`) — its D2 (do not touch the detector
  to move a number) and D4 (do not loosen `MARCADOR`) carry over verbatim and constrain B-279.
- **B-238 / B-243** — two ceilings that fell because a guard's vocabulary was widened, not because
  code improved. B-279 widens a vocabulary ON PURPOSE, which is the opposite direction, and D2
  below states how the two are told apart.
- **The reverted sweep** (B-241 § `tentativa_1`) — why B-279's migration goes through the harness.
- **`vitest.config.ts:22-31`** — the repo already diagnosed worker starvation once and answered by
  raising the timeouts to 20 s. B-280 is the same diagnosis with the other answer.
- **`i18n-guard.test.ts`** — the ACTIVE interface guard whose green must survive B-279.

## Dependencies

| Dependency | Version | Installed? | Rule 9 note |
|---|---|---|---|
| `typescript` | 5.x | yes | the rename harness, already built and hardened |
| `vitest` | 4.1.2 | yes | `environmentMatchGlobs` was REMOVED in v4, so the per-file pragma is the mechanism the installed version offers |
| `react-syntax-highlighter` | `^15.6.6` → possibly `16.1.1` | yes (bump) | the ONLY dependency change this plan may make, and only if the two screens survive it |

No new dependency is introduced.

## Objective

1. One owner for the key→label rule, proved by mutation from all three consumers.
2. Identifier population back to 0 with the detector 16 words wider, and `i18n-guard.test.ts` green.
3. The shipped vulnerability gone or allowlisted with sunset + reason; the non-shipped HIGH
   addressed where it is caused.
4. Shuffle green N consecutive times, with the environment cost measurably lower.
5. `unanchoredIn` below 91 with the ceiling matching disk.

## ADRs

### D1 — `humanizeKey` goes in `lib/formatting/format.ts`, and takes both separators

**Decision.** One exported function, `humanizeKey(key: string): string`, splitting on `_` and `-`
and title-casing. All three sites call it.

**Rationale and alternatives.**
- *Leave the duplication and only test it better* — rejected: the mutation survives precisely
  because there are two copies, so no test on one copy can be load-bearing.
- *A private helper inside `billing.tsx`* — rejected: it would leave `connectors.tsx` out, which is
  the third occurrence of the same knowledge and therefore the one that makes this a Rule-of-3
  extraction rather than a speculative one.
- *A new `lib/formatting/keys.ts` module* — rejected on parsimony rung 4: `format.ts` is the module
  every consumer already imports for exactly this class of function.
- *Accept `-` and `_` in one function vs two functions* — one. The two sites differ by a separator
  and nothing else; two functions would be the duplication wearing a nicer hat.

**Consequences.** `format.ts` grows one small function with tests. `connectors.tsx` keeps its
explicit `OAUTH_PROVIDER_LABELS` lookup in front — the helper is the fallback, not a replacement
for a curated label.

### D2 — B-279 widens the SUPPLEMENT, never `MARCADOR`, and migrates in the same slice

**Decision.** The 16 words go into `SUPLEMENTO_IDENTIFICADORES`. `MARCADOR` is not touched. The 46
declarations are migrated in the same slice so the guard is back at zero when the slice ends.

**Rationale.** `MARCADOR` is read by `varrerInterface`, the ACTIVE guard over on-screen text.
Widening it would tighten what may appear on screen as a side effect of an identifier decision —
two consumers moved by one edit. The supplement is read only by `ehIdentificadorPT`. Measured, not
assumed (opportunity § B-279).

**Why this is not B-238's defect in reverse.** B-238 recorded a ceiling FALLING because a detector
was narrowed. Here the detector is WIDENED and the number goes UP before it goes back to zero
through migration. The direction is the tell: narrowing lowers a number without work; widening
raises it and then demands the work. The plan's Verification requires seeing 46 before seeing 0.

**Alternatives.** *Add the words and allowlist the 46* — rejected: an allowlist of 46 is the
population wearing a different name. *Add the words in a later slice* — rejected: a guard that
knows a word while 46 declarations violate it is a red suite, so the two are one unit of work.

### D3 — B-278 splits into two decisions, because it is two problems

**Decision.**
1. **`prismjs` (MODERATE, SHIPPED):** attempt `react-syntax-highlighter@16.1.1`. If the two RAG
   screens survive with their tests green, take it. If not, allowlist with a ≤90-day sunset and the
   measured reason.
2. **`nanoid` (HIGH, NOT SHIPPED):** do not "fix" it here. It exists because `@theokit/ui` declares
   `vite` as a runtime dependency. Record an allowlist entry naming that cause, and register the
   upstream defect as its own item.

**Rationale.** Treating them as one number is what produced the wrong block in the first place. A
HIGH in build tooling and a MODERATE in shipped rendering code demand different actions, and the
allowlist mechanism exists so a pre-existing finding does not force a bad fix
(`code-quality-golden-rule.md § 4`, `deps-audit-golden-rule.md § 4`).

**Alternatives.** *`npm audit fix --force`* — rejected: it applies a semver-major to a rendering
dependency with no test of the result. *Drop `react-syntax-highlighter`* — rejected as
disproportionate; two screens use it and no measurement says the highlighting is unwanted.
*Ignore the nanoid HIGH because it does not ship* — rejected: unrecorded is not the same as
addressed, and the packaging defect is real.

### D4 — B-280 moves files off jsdom, and installs the invariant

**Decision.** Every test file that touches no DOM API declares `@vitest-environment node`. A new
guard, `environment-fit.test.ts`, fails when a file could be `node` and is not.

**Rationale.** Environment construction is 690–732 s per full run, larger than the tests themselves
(461–487 s), and 130 of 379 files pay it for nothing. That is the measured cause of starvation, and
cutting it is the only answer that does not weaken a signal — raising the timeout again (the
previous answer) makes a genuinely hung test take longer to report.

**Alternatives.**
- *Raise the timeout* — rejected by the item, and it trades a false red for a slower true red.
- *Cap `maxThreads`* — rejected as the primary fix: it lowers contention by lowering throughput,
  leaving the waste in place. Kept as a fallback if the pragma pass does not close it.
- *`environmentMatchGlobs`* — unavailable: removed in vitest 4 (installed: 4.1.2).
- *Two vitest projects* — rejected: the split is semantic (does this file touch the DOM), not
  path-based, so a project glob cannot express it.
- *Move files and leave it at that* — rejected: without the invariant the 130 becomes 120 next
  quarter, which is precisely the ratchet-less cleanup `commit 05132088` already taught this repo.

**Consequences.** Up to 130 files gain one comment line. Some will fail because a transitive import
touches `window` at module scope: each of those is a finding to record, not a reason to revert the
pass.

### D5 — B-242 anchors only what the classifier says is anchorable, and re-attributes the rest

**Decision.** Work the 16 ANCHORABLE assertions. Do not touch the 25 fixture-class (B-276) or the
50 absent-everywhere; record their composition in the ratchet's docblock.

**Rationale.** The previous slice anchored 11 and learned that the "honest class" is three shapes,
only one of which is fixable. The classifier now names them, so the remaining number stops being an
undifferentiated backlog.

**Alternatives.** *Anchor everything* — impossible for the 50 by construction. *Change the anchor
rule to absorb the fixture class* — that is B-276, and it was measured and rejected once for moving
50 at once.

## Drawbacks & Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | The 16 tail words reveal declarations whose rename collides, like the last migration | medium | the harness's collision-override file exists and is tested; `tsc` per batch |
| R2 | `react-syntax-highlighter@16.1.1` breaks the two RAG screens | medium-high (semver major) | their tests are the gate; if red, allowlist instead of forcing |
| R3 | Moving a file to `node` breaks it because a transitive import touches `window` | high across 130 files | the suite is the detector; each failure is recorded and that file stays jsdom |
| R4 | `environment-fit.test.ts` is too strict and blocks a legitimately jsdom file | medium | the invariant is "declares node OR references a DOM API"; a file that needs jsdom simply uses one |
| R5 | Widening the supplement makes `i18n-guard.test.ts` (interface text) red | **measured as impossible** — different list — but asserted anyway | a case pinning that `varrerInterface` is unaffected |
| R6 | The B-242 classifier is wrong for some of the 16 | medium | each is read; a wrong classification is recorded, not forced |
| R7 | Bundling again, the defect the last review named | certain if unmanaged | one commit per item, and the rename commit carries nothing else |
| R8 | Shuffle stays red for a reason unrelated to environment cost | medium | the DoD records N runs and the measured environment line, so a partial improvement is visible as partial |

## Unresolved Questions

- Q1 — **will `react-syntax-highlighter@16.1.1` land?** Unknown until attempted. D3 makes both
  outcomes acceptable and distinguishable.
- Q2 — **how many of the 130 files actually survive `node`?** Unknown. R3 says the suite decides.
- Q3 — **does removing 130 jsdom constructions make shuffle green?** Unknown. It removes the
  largest measured cost; whether that is sufficient is what the DoD's N runs answer.
- Q4 — **where does the `nanoid` upstream item live?** `@theokit/ui` has no checkout in this
  umbrella (`cycle-backlog § Repos an inventory names but disk does not`), so it may be registrable
  only as a note. Resolved in T3.2 by looking, not now.

## Failure scenarios

| Scenario | Expected behaviour |
|---|---|
| `npm audit` cannot reach the registry | the audit step reports UNAVAILABLE and the slice does not claim a clean bill; never a silent pass |
| the rename harness reports `skipped` for a tail name | recorded per name; that declaration is migrated by hand or left with its reason |
| a `node`-pragma file fails on a missing global | that file keeps jsdom and the reason is written next to it |
| the bump breaks a RAG screen | revert the bump, allowlist with sunset, record the failure mode |
| shuffle still fails after the pass | B-280 stays open with the new measurement; the DoD is not declared met |

## Concurrency tests

(none — single-threaded). Nothing here introduces concurrency. B-280 CHANGES the concurrency
profile of the test runner, which is a resource decision and not a race; its evidence is timing and
repetition, not a race-aware assertion.

## Dependency Graph

```
T1.1 humanizeKey + tests ──> T1.2 the three call sites ──> T1.3 mutation proof
T2.1 the 16 words ──> T2.2 migrate the 46 ──> T2.3 guard back at zero + interface guard green
T3.1 attempt the bump ──> T3.2 land it OR allowlist + upstream note
T4.1 classify + move the non-DOM files ──> T4.2 environment-fit guard ──> T4.3 shuffle N times
T5.1 anchor the 16 ──> T5.2 lower the ceiling + record the composition
all ──> T6.1 CHANGELOG + BACKLOG
```

T1–T5 are independent of each other and are committed separately (R7).

## Phase 1: B-277 — one owner for the label rule

### T1.1 — `humanizeKey` in `lib/formatting/format.ts`

#### Objective

One exported function turning a machine key into a display label, with tests.

#### Why this step (action + reasoning — ReAct discipline)

Three call sites hold the same expression, and the duplication is not cosmetic: it is why a
mutation of one site survived a 20-case suite. The rule has to have one home before any test on it
can be load-bearing.

#### Evidence

`billing.tsx:193`, `billing.tsx:314`, `rag/connectors.tsx:61` — measured in the opportunity.
`lib/formatting/format.ts` exports eleven formatters and none of them do this.

#### Files to edit

`dashboard/src/lib/formatting/format.ts`, `dashboard/src/lib/formatting/format.test.ts`.

#### TDD

- `test_humanize_key_replaces_underscores_and_title_cases` — `fast_data_transfer` `returns`
  `Fast Data Transfer`.
- `test_humanize_key_replaces_hyphens_too` — `google-drive` `returns` `Google Drive`, the
  `connectors.tsx` shape.
- `test_humanize_key_leaves_an_already_humane_label_alone` — `Seats` `returns` `Seats`.
- `test_humanize_key_handles_an_empty_key` — `''` `returns` `''`, no throw.

#### Acceptance Criteria

- `npx vitest run src/lib/formatting/format.test.ts` exits 0 with the four cases passing.
- `humanizeKey('fast_data_transfer')` `equals` `'Fast Data Transfer'`.

#### DoD

- The function is exported from `format.ts` and has no other copy: `git grep -n "replace(/\\\\b\\\\w/g"`
  `returns` only `format.ts`.

### T1.2 — the three call sites use it

#### Objective

`billing.tsx:193`, `billing.tsx:314` and `connectors.tsx:61` call `humanizeKey`.

#### Why this step (action + reasoning)

An owner nobody calls is a fourth copy. This is the step that makes the mutation in T1.3 possible.

#### Files to edit

`dashboard/src/pages/settings/billing.tsx`, `dashboard/src/pages/rag/connectors.tsx`.

#### Acceptance Criteria

- `npx vitest run src/pages/settings/billing.test.tsx src/pages/rag/connectors.test.tsx` exits 0.
- `git grep -c "toUpperCase())" src/pages` `returns` no hit on the key→label shape.

#### DoD

- No behaviour change: the billing anchor still asserts exactly 2 occurrences per label.

### T1.3 — prove the owner is load-bearing

#### Objective

A single mutation of `humanizeKey` reddens at least one case in each of the three consumers.

#### Why this step (action + reasoning)

This is the whole point of B-277. Before the extraction, mutating one of the two billing sites left
all 20 cases green — the finding that produced the item. After it, one mutation must reach every
consumer, and that is what proves the duplication is gone rather than merely moved.

#### TDD

Mutate `humanizeKey` to `() => 'Usage'`, run the three test files, record which cases redden,
restore. The transcript goes in the commit.

#### Acceptance Criteria

- The mutation reddens `billing.test.tsx` AND `connectors.test.tsx`. If a consumer stays green it
  has no test of its label, and that gap is filed rather than ignored.

#### DoD

- `npx vitest run src/pages/settings src/pages/rag src/lib/formatting` exits 0 after restoring.

## Phase 2: B-279 — the detector's tail

### T2.1 — the 16 words enter the supplement

#### Objective

`rotulo`, `rotulos`, `linguagem`, `variavel`, `variaveis`, `ultima`, `ultimo`, `resolucao`,
`intencao`, `normalizar`, `bruto`, `bruta`, `vistas`, `endereco`, `mostrar`, `inteiro` added to
`SUPLEMENTO_IDENTIFICADORES`.

#### Why this step (action + reasoning)

The zero the guard reports today is a zero by a detector with a known blind spot, and the item
exists so that blind spot shrinks by decision rather than by accident. Each word was checked
against the same admission test the supplement's docblock states: not an English word, and not a
one-accent cognate.

#### Evidence

Opportunity § B-279: 46 occurrences over these 16, measured by walking the same declaration kinds
`varrerIdentificadores` counts. `inteiro` is 1 declaration, not the 84 files the item's own grep
suggested.

#### Files to edit

`dashboard/src/test/i18n-guard.ts` (the supplement only), `dashboard/src/lib/identifier-language-ratchet.test.ts`
(the KNOWN TAIL case shrinks by the words that leave it).

#### TDD

- The guard goes RED, reporting 46. That is the RED step and it is the proof the words do something.
- `test_interface_guard_is_unaffected_by_the_supplement` — `npx vitest run src/lib/i18n-guard.test.ts`
  stays green, because `varrerInterface` reads `MARCADOR` and not the supplement.

#### Acceptance Criteria

- `varrerIdentificadores(SRC).length` `equals` 46 immediately after this task, before T2.2.
- `npx vitest run src/lib/i18n-guard.test.ts` exits 0 unchanged.

#### DoD

- `MARCADOR` is byte-identical: `git diff` shows no change to that constant.

### T2.2 — migrate the 46

#### Objective

The 46 declarations renamed through `scripts/rename-identifiers.mjs`, with map entries added.

#### Why this step (action + reasoning)

The harness exists, is tested at 21 cases, and had its two BLOCKERs closed last slice. Using it is
rung 4; hand-editing 46 declarations across ~30 files is how the reverted sweep started.

#### Files to edit

`dashboard/scripts/identifier-map.json`, ~30 production files (mechanically).

#### TDD

The gates are the tests, per batch: `tsc --noEmit` clean, suite green, population strictly lower.

#### Acceptance Criteria

- `git diff -U0` shows no changed line inside a comment or a string literal **for the harness's
  commit** — stated with the scope the last slice learned to state it with.
- `varrerIdentificadores(SRC).length` `equals 0`.

#### DoD

- `npm run typecheck` clean, `npm run lint` clean, suite green.

### T2.3 — the guard is back at zero, honestly

#### Objective

The guard green at zero with 16 more words known, and the KNOWN TAIL case reduced to whatever tail
remains.

#### Acceptance Criteria

- `npx vitest run src/lib/identifier-language-ratchet.test.ts` exits 0.
- The docblock of `src/lib/identifier-language-ratchet.test.ts` `contains` the 16 words the detector
  now knows and states that the zero is still a zero BY THIS DETECTOR.

#### DoD

- `git grep -n "CORPUS_FLOOR"` still `returns` the floor, unchanged in spirit.

## Phase 3: B-278 — the two vulnerabilities

### T3.1 — attempt the bump that fixes the shipped one

#### Objective

`react-syntax-highlighter@16.1.1` installed and the two RAG screens green, or the attempt recorded
as failed.

#### Why this step (action + reasoning)

`prismjs@1.27.0` is the copy that ships, through `refractor@3.6.0`, and the DOM-Clobbering advisory
is against a package that renders markdown. `fixAvailable` names 16.1.1 and calls it semver-major,
so it is an attempt with a gate, not a routine bump.

#### Files to edit

`dashboard/package.json`, `dashboard/package-lock.json`.

#### TDD

- `npx vitest run src/pages/rag` — the gate.
- `npm audit --omit=dev` — `prismjs` gone from the report, or the attempt is reverted.

#### Acceptance Criteria

- Either `npm audit --omit=dev` `returns` no `prismjs` advisory AND `npx vitest run src/pages/rag`
  exits 0, or the bump is reverted and T3.2 runs.

#### DoD

- `npm run build` exits 0 — a rendering dependency that breaks the bundle is not a fix.

### T3.2 — allowlist what remains, where it is caused

#### Objective

An allowlist entry per surviving advisory, each with a ≤90-day sunset and the measured reason; the
`nanoid` cause registered upstream or recorded as unregistrable.

#### Why this step (action + reasoning)

`nanoid` cannot be fixed from this repository: it arrives because `@theokit/ui` declares `vite` as a
runtime dependency. Bumping something here would be a fix that fixes nothing while making the
report green — the exact shape of dishonesty the deps golden rule's allowlist exists to prevent.

#### Files to edit

`.claude/rules/deps-audit-allowlist.txt`, `BACKLOG.md`.

#### Acceptance Criteria

- Every entry has six fields and a sunset ≤ 90 days (`deps-audit-golden-rule.md § 4`).
- The `nanoid` entry names `@theokit/ui`'s runtime `vite` dependency as the cause, and says the
  package is not bundled.

#### DoD

- `python3 .claude/skills/deps-audit/...` or `npm audit --omit=dev` reports nothing unexplained.

## Phase 4: B-280 — stop paying for a DOM nobody uses

### T4.1 — move the non-DOM files to the node environment

#### Objective

Every test file that touches no DOM API declares `@vitest-environment node`.

#### Why this step (action + reasoning)

Environment construction is the largest single line in the run (690–732 s, against 461–487 s of
actual tests) and 130 of 379 files pay it for nothing. Starvation is a budget problem, and this is
the budget.

#### Evidence

`transform 26.51s, setup 133.55s, import 562.67s, tests 487.42s, environment 690.34s`; 379 test
files, 227 touching the DOM, 22 already declaring `node`, 130 neither.

#### Files to edit

up to 130 `*.test.ts(x)` (one comment line each).

#### TDD

The suite is the test: a file that needed jsdom fails immediately and loudly.

#### Acceptance Criteria

- `npx vitest run src` exits 0.
- The `environment` line of the summary is measurably lower than 690 s, and the number is recorded.

#### DoD

- Every file that could not move keeps jsdom with the reason written beside it.

### T4.2 — the invariant that keeps them off

#### Objective

`environment-fit.test.ts`: a test file that references no DOM API must declare
`@vitest-environment node`.

#### Why this step (action + reasoning)

`commit 05132088` cleaned a domain and left no guard; three months later the same domain had
regressed. A one-time pass over 130 files without an invariant is that commit again.

#### TDD

- `test_a_dom_free_file_without_the_pragma_is_reported` — a fixture with no DOM reference and no
  pragma is a finding.
- `test_a_file_using_screen_is_not_reported` — the negative counterpart.
- `test_a_file_declaring_node_is_not_reported` — idempotence.

#### Acceptance Criteria

- Deleting the pragma from one migrated file and running `npx vitest run src/lib/environment-fit.test.ts`
  `returns` a non-zero exit — proved by mutation, and the transcript pasted into the commit.

#### DoD

- The guard runs in the suite and names file:line for every finding.

### T4.3 — measure the shuffle, N times

#### Objective

`npx vitest run src --sequence.shuffle` run N ≥ 3 consecutive times, with results and machine load
recorded.

#### Why this step (action + reasoning)

Four runs before this slice failed on three different files, always by timeout. A single green run
would not distinguish a fix from a lucky schedule.

#### Acceptance Criteria

- `npx vitest run src --sequence.shuffle` run `>= 3` consecutive times with every exit code recorded.
  All zero → B-280 closes; any non-zero → B-280 stays open carrying the new count.

#### DoD

- The result is written in `BACKLOG.md` whichever way it goes.

## Phase 5: B-242 — the anchorable sixteen

### T5.1 — anchor what a positive case can exist for

#### Objective

Each of the 16 ANCHORABLE assertions gains a case asserting the same selector present, or a
recorded reason why the classifier was wrong about it.

#### Evidence

The classifier's list, measured: `device-success:117`, `recovery:331,536`, `environments:232,233`,
`alerts:558`, `overview-kpi-strip:38`, `signal-detail-sheet:211`, `project-detail:116`,
`project-status:80`, `catalogo:484`, `diff:123`, `promptly/overview:131`, `playground:162`,
`rag/analytics:79`, `api-keys:253`.

#### TDD

Per assertion: break the screen, confirm the NEW case reddens while the absence assertion stays
green, restore.

#### Acceptance Criteria

- Every assertion counted as fixed has a recorded mutation: with the screen broken,
  `npx vitest run <file>` `returns` a non-zero exit naming the NEW case, and the transcript is
  pasted into the commit.
- `unanchoredIn` `< 91`.

#### DoD

- `git diff --name-only` for this commit lists only `*.test.tsx`.

### T5.2 — lower the ceiling and record the composition

#### Acceptance Criteria

- `npx vitest run src/lib/absence-assertion-ratchet.test.ts` passes both `toBe` cases.
- The docblock of `src/lib/absence-assertion-ratchet.test.ts` `contains` the three-way split
  (anchorable / fixture / absent-everywhere) with a count per class.

#### DoD

- Raising the ceiling by 1 fails `the ceiling matches disk`.

## Phase 6: the record

### T6.1 — CHANGELOG and BACKLOG

#### Acceptance Criteria

- `CHANGELOG.md [Unreleased]` gains one line per user-visible change, each `contains` a `(B-NNN)`.
- Each `BACKLOG.md` block `contains` the before/after numbers AND the command that measured them —
  the line the last slice's review found missing.
- A status flips only where its DoD holds: `grep -c 'status: shipped'` in each touched block
  `equals` 1 only for the items whose acceptance criteria above all passed.

#### DoD

- `git status --porcelain` `returns` empty after the commit.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| one owner for the key→label rule | T1.1, T1.2 |
| the owner is load-bearing, proved by mutation | T1.3 |
| the detector learns its measured tail | T2.1 |
| the tail's 46 declarations are migrated | T2.2 |
| the identifier guard returns to zero | T2.3 |
| the interface-text guard is not widened as a side effect | D2, T2.1 (TDD) |
| the SHIPPED vulnerability is removed or allowlisted with a reason | T3.1, T3.2 |
| the non-shipped HIGH is addressed where it is caused | T3.2, D3 |
| the suite stops paying for a DOM it does not use | T4.1 |
| that stays true — an invariant, not a one-time pass | T4.2 |
| shuffle is measured N times, not once | T4.3 |
| the anchorable absence assertions are anchored | T5.1 |
| the B-242 ceiling follows, and the remainder is attributed | T5.2 |
| one commit per item — no bundling | R7, T6.1 |
| the record carries the measuring command | T6.1 |
