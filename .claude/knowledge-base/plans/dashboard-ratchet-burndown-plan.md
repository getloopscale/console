# Plan: burn down the two open dashboard ratchets — assertions that cannot fail, and identifiers in the wrong language

**Items:** B-242, B-241
**Slug:** `dashboard-ratchet-burndown`
**Date:** 2026-08-12
**Baseline sha:** `face8c87`
**Upstream opportunity:** `.claude/knowledge-base/discoveries/opportunities/dashboard-ratchet-burndown-opportunity.md`

## Goal

Move both open dashboard ratchets down by doing the work they were freezing, and leave each one
guarding a smaller population than it does today:

- **B-242** — anchor the absence assertions whose selector text exists nowhere in their file, so
  they can actually fail, and lower `CEILING_UNANCHORED` to whatever the disk then says. Every
  anchoring is proved by deleting the production behaviour and watching the test go RED.
- **B-241** — migrate Portuguese identifiers in `dashboard/src` to English with a **type-aware**
  rename built on the TypeScript language service already installed, lower both ceilings, and — if
  and only if the population reaches zero — convert the ratchet into a guard that REJECTS a
  Portuguese identifier, with a self-test proving the rejection.

Comments stay Portuguese. That is the repo's convention, it is written into B-241's own DoD, and
the reverted sweep's worst damage was to prose inside them.

## Context

Both items are ratchets with a freshly assigned owner (registered 2026-08-12 by the sweep for
caveats nobody owned). A ratchet stops the population growing; it never makes it shrink. Two of the
six dashboard ratchets — `data-access-layer` (B-244) and `ambiguous-null` (B-235) — were burned
down earlier today, 53 → 3 and 39 → 4. These two are what is left.

They are one plan and not two because they share a failure mode that this repository has now paid
for four times in one day: **a detector that measures a spelling instead of a defect, and a
self-test that guards a copy of the rule instead of the rule.** B-242's own block records it
happening inside B-242; B-235's records it inside B-235. Any change to either detector in this
slice must be proved by mutation before a ceiling moves.

## Baseline Context (deep review of current state)

Measured 2026-08-12 at `face8c87`, tree clean, on `workspace`. Suite: **378 files / 3318 tests
green**.

### Files that will be touched

| File | LoC | Role today | Change |
|---|---|---|---|
| `dashboard/src/lib/absence-assertion-ratchet.test.ts` | 406 | Freezes 102 unanchored / 98 files | Ceilings lowered; docblock records the batch |
| `dashboard/src/test/absence-assertion.ts` | 182 | The B-242 detector | **Unchanged unless a defect is found** — see D2 |
| ~15 `*.test.tsx` under `dashboard/src/pages`, `dashboard/src/components` | varies | Screen tests holding unanchored assertions | One anchored assertion each, or a recorded reason |
| `dashboard/scripts/rename-identifiers.mjs` | 0 (new) | — | NEW — the type-aware rename harness |
| `dashboard/scripts/rename-identifiers.test.mjs` | 0 (new) | — | NEW — its tests, run by vitest |
| `dashboard/scripts/identifier-map.json` | 0 (new) | — | NEW — the reviewed Portuguese→English map |
| `dashboard/src/lib/identifier-language-ratchet.test.ts` | 132 | Freezes 484 / 277 | Ceilings lowered; becomes a rejection only at zero |
| `dashboard/src/test/i18n-guard.ts` | 284 | `MARCADOR`, `ehIdentificadorPT`, both scanners | Unchanged — reused, not rewritten |
| ~60 production `.ts`/`.tsx` under `dashboard/src` | varies | Hold Portuguese identifiers | Renamed by the harness |
| `CHANGELOG.md` | — | Public contract | `[Unreleased]` entries |
| `BACKLOG.md` | — | The registry | B-242 / B-241 blocks updated with measured outcomes |

### Current callers / dependents

| Symbol | Declared in | Consumed by |
|---|---|---|
| `absenceAssertionsIn`, `unanchoredIn`, `selectorCore` | `src/test/absence-assertion.ts` | `src/lib/absence-assertion-ratchet.test.ts` only |
| `varrerIdentificadores`, `ehIdentificadorPT` | `src/test/i18n-guard.ts` | `src/lib/identifier-language-ratchet.test.ts` only |
| `varrerInterface` | `src/test/i18n-guard.ts` | `src/lib/i18n-guard.test.ts` (the ACTIVE interface-text guard) |
| `MARCADOR` | `src/test/i18n-guard.ts` (module-private) | `ehIdentificadorPT` and `varrerInterface`, in-file |
| every Portuguese identifier | ~60 production files | their own modules, plus the test files importing them |

`src/test/` is deliberately outside the identifier scan (`arquivosDeProducao` skips `test`, and
every `*.test.ts?(x)`), so the 484 are all production declarations. The harness must nonetheless
load the test files into its program: a cross-file symbol renamed without updating its test usages
breaks compilation.

### Domain glossary

| Term | Meaning here |
|---|---|
| **ratchet** | A test freezing a population count so it can only fall. Not a ban. |
| **anchored** (absence assertion) | The same selector is asserted PRESENT somewhere in the same file, so the absence assertion can fail. |
| **never-leak assertion** | "this text must never render" — discriminating, but with no positive case by construction. Owned by B-276, **out of scope here**. |
| **honest class** (of B-242) | An unanchored assertion whose selector text appears nowhere else in the file. 67 of the 102. |
| `MARCADOR` | The committed decision about which words are unambiguously Portuguese. Reused, never re-derived. |
| **local** identifier | A name declared in exactly one file. 217 of the 277. |
| **wire key** | A JSON property name crossing the HTTP boundary. Measured to be English everywhere (opportunity § Corner 1). |

### Architecture boundaries affected

None crossed. B-242 touches test files and two constants. B-241 renames identifiers inside a
private application package: no HTTP contract (measured — `openapi/*.yaml` and Go `json:` tags carry
no Portuguese key), no exported package surface (`dashboard/package.json` is `"private": true`).

The new harness is **tooling**, not application code: it lives in `dashboard/scripts/` beside
`check-guard-pairs.mjs` and `check-knip-ratchet.mjs`, is never imported by `src/`, and therefore
never reaches a bundle.

## Prior Art & Related Work

- **The reverted sweep** (B-241 § `tentativa_1`): 270 files touched, prose corrupted inside
  comments, homonym collisions, `git restore`. Its two lessons are this plan's two hard
  constraints, and D1 exists to satisfy both by construction rather than by care.
- **B-244 and B-235, both closed today.** Their shape is the one this plan copies: migrate for a
  reason the user can see, prove the detector by mutation, then move the ceiling.
- **`commit 05132088`** — migrated the Skills domain to English and left no guard; three months
  later the same domain had four new Portuguese strings. That is why B-241's DoD ends in a guard
  and not in a clean tree.
- **B-269** — replaced hand-rolled scanning with `ts.createSourceFile` across these detectors. D1
  is the same argument one step further: for a *rename*, the compiler also already ships the
  answer.
- **B-276** — owns the never-leak class. This plan must not absorb it; the two rules are
  different and the attempt to merge them moved 50 assertions at once and broke an invariant.

## Dependencies

| Dependency | Version | Already installed? | Rule 9 note |
|---|---|---|---|
| `typescript` | 5.x (`dashboard/package.json` devDependency) | **yes** | The language service (`ts.createLanguageService`, `findRenameLocations`) is the rename engine. Nothing new is added. |
| `vitest` | 4.1.10 | yes | Runs the harness's own tests. |
| Node `node:fs`, `node:path` | stdlib | yes | File I/O for the harness. |

**No new dependency is introduced.** A dedicated codemod library (`jscodeshift`, `ts-morph`) would
be rung 4 of the parsimony ladder answered wrongly: `ts-morph` is a wrapper over the very API being
used, and the API is already here.

## Objective

1. `unanchored` < 102, with `CEILING_UNANCHORED` matching disk, and every fix proved RED-first.
2. A committed, tested, type-aware rename harness that cannot touch a comment.
3. Portuguese identifier occurrences well below 484, both ceilings matching disk.
4. The identifier guard converted to a rejection **only** if the population reaches zero.
5. Suite green in fixed order and under shuffle; `typecheck` and `lint` clean.

## ADRs

### D1 — Rename through the TypeScript language service, never through text

**Decision.** The migration harness builds a `ts.LanguageService` over the dashboard's real program
(production + test files) and renames each symbol with `findRenameLocations(fileName, position,
/* findInStrings */ false, /* findInComments */ false, {})`, applying the returned spans from the
end of each file backwards.

**Rationale, with the alternatives that were considered and rejected:**

- *Textual `re.sub`/`sed` with word boundaries* — **rejected, and not on theory: it was tried and
  reverted** (B-241 § `tentativa_1`). It cannot see that `entrada` inside a comment is prose, and
  it cannot see that `erro` collides with an `error` already in scope. Both failures are inherent
  to reading a program as text.
- *Strip comments, substitute, re-insert* — rejected. It fixes lesson 1 and leaves lesson 2
  untouched, and it re-implements a lexer the compiler already contains (Rule 9, and the exact miss
  B-269 corrected in `source-scan.ts`).
- *`ts-morph` / `jscodeshift`* — rejected as rung 4 of the parsimony ladder: a dependency wrapping
  an API already installed.
- *Hand-editing 277 names across ~60 files* — rejected. It is the option most likely to produce a
  silent miss, and it leaves nothing behind for the next batch.

**Consequences.** Comments are unreachable by construction, not by care — `findInComments: false`
means a comment is never in the returned spans. Shadowing collisions are still possible (the
service renames the symbol, it does not check the destination scope is free), so D3's batch
protocol exists. The harness needs the whole program in memory, which costs seconds per run and is
paid once per batch.

### D2 — The B-242 detector is not touched unless a defect is proved

**Decision.** This slice lowers the ceiling by fixing TESTS. `src/test/absence-assertion.ts` changes
only if a specific miscount is demonstrated, and then the correction is proved by mutation before
the number moves.

**Rationale.** Four times in one day in this repository, a ceiling fell because a detector was
narrowed rather than because code improved (B-238, B-243, B-235, and B-242's own
`third_measurement`). The alternative — allowing detector tuning inside a burn-down slice — is what
produced each of those. Refusing it here costs nothing: 67 assertions are available to fix without
touching the detector at all.

**Consequences.** If a false positive is found among the 67, it is recorded in the plan's outcome
and left counted, rather than being cleared by loosening the rule. That is a deliberately
conservative number.

### D3 — Batch protocol: one name per rename, `tsc` per batch, suite per phase

**Decision.** The harness renames one symbol at a time. After each batch of names it runs
`tsc --noEmit`; a batch that fails to compile is reverted whole (`git restore` of the batch's
files) and its names are re-attempted individually or moved to the manual list.

**Rationale.** The reverted sweep wrote 249 files before `tsc` had anything to say. The compiler is
the only mechanical detector of a collision, so the batch size determines how much work a collision
can destroy. Batches are ordered `local` names first (217 of 277) because a name living in one file
cannot collide with a homonym in another.

**Alternatives.** *One `tsc` at the end* — rejected, that is the reverted sweep. *One `tsc` per
name* — rejected as disproportionate: a full typecheck of this project costs ~20 s, and 277 of them
is 90 minutes of waiting to catch a class of error a batch already localises.

### D4 — The guard flips only at zero, and never by loosening `MARCADOR`

**Decision.** `identifier-language-ratchet.test.ts` becomes a rejection (`expect(found()).toEqual([])`)
only when the measured population is 0. Below that it stays a ratchet with a lowered ceiling.

**Rationale.** B-241's DoD says the guard enters last, for a measured reason: enabled early it
rejects the migration's own intermediate states. And the tempting shortcut — removing words from
`MARCADOR` so the count reaches zero sooner — would silently weaken the ACTIVE interface-text guard
that shares the list (`varrerInterface`, `i18n-guard.test.ts`). Two consumers, one list: loosening
it to close this item would open the other.

**Alternatives.** *Flip the guard early and allowlist the remaining names* — rejected: the
allowlist would have to hold up to 277 entries, which is the population wearing a different name,
and `code-quality-golden-rule.md § 4` requires a sunset per entry. *Remove words from `MARCADOR`
until the count reaches zero* — rejected on measurement, not taste: `varrerInterface` reads the
same list and is an ACTIVE guard, so every word removed here silently widens what may appear on
screen. *Split `MARCADOR` into two lists, one per consumer* — rejected as the two-lists-drift
failure the supplement's own docblock records avoiding.

**Consequences.** A partial migration leaves B-241 open with a lower number, which is the honest
outcome and is what the item's status field is for.

## Drawbacks & Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | A rename collides with a homonym already in the destination scope | high (the reverted sweep hit it) | D3: `local` names first, `tsc --noEmit` per batch, whole-batch revert |
| R2 | A renamed `PropertySignature` is a wire key → green suite, broken product | **measured near-zero** | Opportunity § Corner 1: no Portuguese key in `openapi/*.yaml` or in any production Go `json:` tag. Each of the 108 property signatures is still eyeballed for a `res.json()` cast before its batch |
| R3 | An anchoring "fix" makes a test pass more easily instead of making it able to fail | medium — this is the defect class of the whole item | Every anchoring proved by deleting the production behaviour and observing RED. A green suite is not accepted as proof |
| R4 | A translated name is worse than the original (`razaoDoCusto` → `reasonOfCost`) | medium | The map is generated then read line by line; awkward outputs are hand-corrected before any rename runs |
| R5 | The harness silently renames nothing and reports success | medium | Its own tests assert the edit count, and the ratchet's number is the independent second count |
| R6 | Renaming churns ~60 files and buries a real change in the diff | certain | The rename commits carry no behaviour change and are separate from every other commit in the slice |
| R7 | The suite passes in fixed order and fails under shuffle | low | Shuffle run is a DoD line, not an afterthought (B-240 is the precedent) |
| R8 | Partial migration leaves the repo in two languages, worse than either | low | The population only ever falls; a half-migrated file still compiles and still reads consistently within a symbol |

## Unresolved Questions

- Q1 — **how many of the 67 honest-class assertions can actually be anchored?** Unknown before
  reading them. Reading the first sample already shows three sub-shapes inside that 67: an empty-state text
  asserted absent while data is present (anchorable — a sibling case renders it), a removed section
  asserted never to return (`'No recent previews'` — no positive case can exist), and a selector
  built from a variable (`overview.test.tsx:173`) which the detector's own docblock names as a known
  false positive. The plan commits to reading them and recording the split, not to a number.
- Q2 — **will the identifier population reach zero in this slice?** Unknown. It depends on how many
  names survive R1 and R4. D4 makes the answer observable rather than assumed.
- Q3 — **file names stay Portuguese** (`catalogo.tsx`, `composicao.ts`, `painel-de-abas.tsx`, …). No
  detector measures them and B-241's DoD does not name them. Deliberately out of scope; a separate
  item if anyone wants it.
- Q4 — **does `dashboard/scripts/rename-identifiers.mjs` survive the migration?** If the population
  reaches zero the harness has no remaining user and becomes a knip/dead-code finding. Resolved in
  T3.2 by decision at that point, not now.

## Failure scenarios

No network, no database, no queue — the harness's only external interaction is the filesystem and
the `tsc` subprocess.

| Scenario | Expected behaviour |
|---|---|
| `identifier-map.json` names a symbol that no longer exists | The harness reports it as `not-found` and continues; the summary lists them |
| `findRenameLocations` returns `undefined` (rename not allowed at that position — e.g. a symbol from `node_modules`) | Skipped and reported, never silently counted as renamed |
| The target name already exists in the same scope | `tsc --noEmit` fails the batch → whole-batch revert (D3) |
| A file is unreadable / write fails | The harness throws with the path; no partial-write recovery is attempted, because the batch is revertible from git |
| `tsc` binary missing | The harness throws; it must never report a batch verified when the verifier did not run (the exact defect class B-270 recorded four times over) |

## Concurrency tests

(none — single-threaded). The harness processes one symbol at a time and writes files
synchronously; vitest's parallelism touches only reading, and the ratchets are pure functions over
file contents.

## Dependency Graph

```
T1.1 (anchor the honest class) ──> T1.2 (lower the B-242 ceilings)
T2.1 (harness + tests) ──> T2.2 (map) ──> T2.3 (batch migration) ──> T2.4 (lower the B-241 ceilings)
                                                                          │
                                                        T3.1 (guard, only if zero) <──┘
                                                        T3.2 (harness disposition)
T1.2, T2.4, T3.x ──> T4.1 (CHANGELOG + BACKLOG)
```

Phase 1 and Phase 2 are independent and could run in either order; Phase 1 first because it is the
smaller and it establishes the RED-first discipline the slice is judged by.

## Phase 1: B-242 — assertions that can fail

### T1.1 — Anchor the honest-class assertions, each proved RED-first

#### Objective

For each unanchored absence assertion whose selector text exists nowhere else in its file, either
add a case that asserts the SAME selector present when the element renders, or record why the file
cannot have one.

#### Why this step (action + reasoning — ReAct discipline)

The 102 is not one population. 35 are never-leak assertions that discriminate without a positive
case (B-276's job, and merging the two rules was measured to move 50 at once and break the
query-kind invariant). 67 query text the file never shows in any state — those are satisfied by the
right behaviour and by the defect alike, which is precisely the thing the ratchet was built to
count. Fixing those is the only work that lowers the number without changing the rule.

#### Evidence

`dashboard/src/lib/absence-assertion-ratchet.test.ts:136` — `CEILING_UNANCHORED = 102`, and
`:202` asserts the ceiling equals disk, so there is no slack. Split measured 2026-08-12: 67 with
the text absent from the file, 35 introduced by a fixture. Highest-density files:
`pages/infra/environments.test.tsx` (5), `pages/promptly/detail.test.tsx` (5),
`pages/lens/traces/columns.test.tsx` (3), `pages/overview/overview.test.tsx` (3),
`pages/settings/billing.test.tsx` (3).

#### Files to edit

The `*.test.tsx` files holding the chosen assertions. No production file changes in this task.

#### TDD

RED-first here is inverted from the usual shape, and deliberately so: the test already passes. What
must be proved is that it passes **for the right reason**.

Per assertion:

1. Delete or break the production behaviour the assertion is about (remove the conditional that
   hides the element, rename the string, drop the guard).
2. Run the file. If it stays GREEN, the assertion is confirmed unable to fail — this is the RED
   step, and its absence is the defect.
3. Restore the production code. Add the positive case asserting the same selector present.
4. Repeat step 1. The test must now go RED.
5. Restore. Suite green.

`test_absence_assertion_can_fail_when_behaviour_deleted` is the shape; it is executed by hand per
assertion rather than encoded, because "delete the behaviour" is file-specific.

#### Acceptance Criteria

- Every assertion counted as fixed has a recorded mutation: with the production behaviour deleted,
  `npx vitest run <file>` reports that case FAILING, and the transcript is pasted into the commit.
- No assertion is "fixed" by deleting it: `git diff` shows a case ADDED and every counted
  absence-assertion selector unchanged, character for character.
- `unanchoredIn` reports `< 102` across the corpus.

#### DoD

- `git diff --name-only` lists only paths matching `*.test.tsx`.
- `npx vitest run` exits 0.
- The batch and its per-file breakdown are written into the docblock of
  `src/lib/absence-assertion-ratchet.test.ts`.

### T1.2 — Lower the B-242 ceilings to match disk

#### Objective

`CEILING_UNANCHORED` (and `CEILING_FILES`, if a file left the population entirely) set to the
measured value, with the docblock recording what moved and why.

#### Why this step (action + reasoning)

The ratchet asserts ceiling *equals* disk (`:202`, `:225`), so leaving the constant above the real
number re-opens exactly the slack B-244 found and closed: each fix silently buys room for a new
offender. The equality gate is what makes the number trustworthy, and it only works if the constant
follows every fall on the same commit.

#### Evidence

`absence-assertion-ratchet.test.ts:202` — `expect(unanchored().length).toBe(CEILING_UNANCHORED)`.
`:225` — the same for files.

#### Files to edit

`dashboard/src/lib/absence-assertion-ratchet.test.ts`.

#### TDD

The ratchet itself is the test: with the constant stale, `the ceiling matches disk` fails. Set it,
observe green. Then a mutation check — raise the constant by one and confirm the same case fails —
proving the equality gate is live and not merely `<=`.

#### Acceptance Criteria

- `npx vitest run src/lib/absence-assertion-ratchet.test.ts` passes both `toBe` cases, so each
  ceiling `equals` the number on disk.
- Raising `CEILING_UNANCHORED` by 1 and re-running the same command FAILS `the ceiling matches
  disk` — the equality gate is proved live, not assumed.
- The docblock of `src/lib/absence-assertion-ratchet.test.ts` states the batch: how many were
  anchored, how many were never-leak on reading, and which of the 67 were left and why.

#### DoD

- `npx vitest run src/lib/absence-assertion-ratchet.test.ts` exits 0.
- `git log --oneline -1` shows a subject containing `B-242`.

## Phase 2: B-241 — the language of the code

### T2.1 — The type-aware rename harness

#### Objective

`dashboard/scripts/rename-identifiers.mjs`: given a map of `{portuguese: english}`, renames each
symbol through the TypeScript language service and reports, per name, `renamed` (with edit count),
`not-found`, or `skipped` (with a reason).

#### Why this step (action + reasoning)

The migration's blocker was never the translation — it was that every mechanical route tried so far
reads a program as text, and a program is not text. The compiler resolves a symbol to its
declaration and its references; it knows a comment is a comment. Building on that removes both
lessons of the reverted sweep at once, and D1 records why each cheaper route was rejected.

#### Evidence

`typescript` is already a devDependency (`dashboard/package.json`), and this repository already uses
its parser for exactly this reason in `src/test/source-scan.ts` and `src/test/i18n-guard.ts`
(B-269). `ts.LanguageService#findRenameLocations` takes `findInStrings` and `findInComments` flags,
both of which will be `false`.

#### Files to edit

`dashboard/scripts/rename-identifiers.mjs` (new), `dashboard/scripts/rename-identifiers.test.mjs`
(new).

#### Deep file dependency analysis

The harness reads `dashboard/tsconfig.json` for compiler options and enumerates `src/**/*.ts?(x)`
— **including** `*.test.ts?(x)`, because a cross-file symbol whose test usages are not updated
stops compiling. It writes only files inside `dashboard/src`. It imports `typescript`, `node:fs`,
`node:path` and nothing else.

#### Pseudo-code / Signatures

```js
createHarness({ projectRoot, files })      // -> { rename, apply, summary }
  rename(from, to)   // locate declaration of `from`; findRenameLocations(..., false, false)
                     // -> { status: 'renamed'|'not-found'|'skipped', edits: n, reason? }
  apply()            // write edits per file, applying spans from highest offset to lowest
```

Edits are applied back-to-front per file so an earlier span's offsets stay valid — the one
correctness detail a naive forward pass gets wrong.

#### TDD

Written against a temporary directory, so the cases are hermetic and fast:

- `test_renames_a_symbol_and_its_usages_across_files` — two files, one exporting `nome`, one
  importing it; both updated.
- `test_does_not_touch_the_same_word_inside_a_comment` — the reverted sweep's first lesson,
  encoded: a file whose comment contains `entrada` in prose keeps the comment byte-identical.
- `test_does_not_touch_the_same_word_inside_a_string_literal` — user-facing text is the
  interface guard's business, never the rename's.
- `test_does_not_touch_an_unrelated_local_with_the_same_name_in_another_scope` — the property that
  separates a symbol rename from a substitution.
- `test_reports_not_found_for_a_name_that_does_not_exist` — a stale map entry is reported, never
  silently counted as done.
- `test_applies_multiple_edits_in_one_file_back_to_front` — two occurrences on one line; both
  correct. Forward application corrupts the second, so this case fails on the naive implementation.

#### Acceptance Criteria

- `npx vitest run scripts/rename-identifiers.test.mjs` exits 0 with 6 passing cases, and each case
  FAILS against a deliberately broken harness (the back-to-front case against a forward pass; the
  comment case against `findInComments: true`).
- The harness `writes` no path outside `dashboard/src`, asserted by a case that points it at a temp
  directory and checks the written set `equals` the expected set.
- `node scripts/rename-identifiers.mjs --map /dev/null` `returns 0` and `prints` `renamed: 0`.

#### DoD

- `npx vitest run scripts/` exits 0.
- The harness has a caller (T2.3) in the same slice — `git grep -n rename-identifiers` `returns`
  at least one hit outside its own files.

### T2.2 — The translation map, generated then read

#### Objective

`dashboard/scripts/identifier-map.json`: every one of the 277 distinct Portuguese names paired with
an English name, ordered so the `local` batch comes first.

#### Why this step (action + reasoning)

277 names is too many to translate by hand without drift and too few to translate blindly. Word-by-
word generation from the committed `MARCADOR`/supplement vocabulary produces a first draft in one
pass; reading it is what catches `razaoDoCusto` → `reasonOfCost` before it reaches ~60 files.
Generating and then reviewing is also what makes the map reviewable in the PR — a reader can
disagree with a single line instead of re-deriving the whole thing.

#### Evidence

Measured distribution: 277 distinct names, 217 of them `local`. Kinds: 190 `VariableDeclaration`,
108 `PropertySignature`, 82 `Parameter`, 71 `FunctionDeclaration`, 23 `InterfaceDeclaration`, 8
`TypeAliasDeclaration`, 2 `MethodDeclaration`.

#### Files to edit

`dashboard/scripts/identifier-map.json` (new).

#### TDD

- `test_map_has_no_duplicate_targets_within_a_file_scope` — two Portuguese names mapping to the
  same English name in the same file is a collision the compiler would catch late; catch it here.
- `test_every_mapped_target_is_not_itself_flagged_portuguese` — the map is checked against
  `ehIdentificadorPT`, so a half-translated target (`nomeDoUser`) cannot enter.
- `test_map_covers_every_name_the_scanner_reports` — coverage, so a name cannot be silently
  skipped.

#### Acceptance Criteria

- Every entry is read before any rename runs: `git log --oneline` shows the commit adding
  `dashboard/scripts/identifier-map.json` strictly BEFORE the first rename commit.
- No entry whose target `ehIdentificadorPT` still flags — asserted by a case that `returns false`
  for every value in the map.
- Every `PropertySignature` name in the map is checked against `grep -n "res.json()"` in its own
  file before its batch runs (R2), and the check is recorded in the commit body.

#### DoD

- `npx vitest run scripts/` exits 0 with the three map cases passing.

### T2.3 — Batch migration

#### Objective

Run the harness over the map in batches, `local` names first, with `tsc --noEmit` after each batch
and a whole-batch revert on failure.

#### Why this step (action + reasoning)

D3's protocol exists because the compiler is the only mechanical detector of the collision class
that killed the previous attempt, and because batch size decides how much work one collision
destroys. `local` first because a name in one file cannot collide with a homonym elsewhere — it is
the 217-name batch with the lowest risk per rename.

#### Evidence

B-241 § `tentativa_1`: 249 files modified before `tsc` was consulted, with redeclaration and type
errors, and a full revert.

#### Files to edit

~60 production files under `dashboard/src`, mechanically.

#### TDD

The gates are the tests, and they run per batch:

1. `npx tsc --noEmit` — clean.
2. `npx vitest run` — green.
3. `varrerIdentificadores` count — strictly lower than before the batch.

A batch failing (1) is reverted whole and its names re-attempted one at a time. A batch failing (2)
with a clean (1) means a behavioural coupling to a name — recorded, reverted, and moved to the
manual list.

#### Acceptance Criteria

- No batch is left partially applied: `git status --porcelain` `returns` empty between batches.
- Every rename is a rename: `git diff -U0` shows no changed line inside a comment, a string
  literal, or JSX text.
- `varrerIdentificadores(SRC).length` `< 484`.

#### DoD

- `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` green.
- Rename commits carry no behaviour change.

### T2.4 — Lower the B-241 ceilings to match disk

#### Objective

`CEILING_OCCURRENCES` and `CEILING_DISTINCT` set to the measured values; the `local`-batch
assertion's threshold updated to whatever remains true.

#### Why this step (action + reasoning)

Same equality gate as T1.2: both ceilings assert equality with disk, so a stale constant fails the
suite, and a constant left high would leave room for new Portuguese names to appear as "no change".

#### Evidence

`identifier-language-ratchet.test.ts:83-89` — both ceilings asserted `toBe` against disk.
`:96-97` — the `local` floor, currently `>= 210`.

#### Files to edit

`dashboard/src/lib/identifier-language-ratchet.test.ts`.

#### Acceptance Criteria

- `npx vitest run src/lib/identifier-language-ratchet.test.ts` passes both `toBe` cases, so each
  ceiling `equals` the number on disk.
- The `local` floor is re-derived from the new population rather than left at a number that no
  longer describes anything — the new bound `contains` the measured `localOnly.size`.
- The docblock of `src/lib/identifier-language-ratchet.test.ts` records the batch and the method.

#### DoD

- `npx vitest run src/lib/identifier-language-ratchet.test.ts` exits 0.

## Phase 3: The guard, and what happens to the harness

### T3.1 — Convert the ratchet to a rejection — only at zero

#### Objective

If and only if the population reaches 0: replace the ceiling assertions with
`expect(found()).toEqual([])`, with a message that tells the next author what to do, plus a
self-test proving the guard REJECTS a Portuguese identifier.

#### Why this step (action + reasoning)

B-241's DoD asks for a guard that fails on a Portuguese identifier, and the reason is `05132088`:
the Skills domain was migrated once, left unguarded, and re-accumulated. A guard that reports zero
by vacuity would repeat the failure of the first interface guard (recorded in `i18n-guard.ts`'s own
docblock — it "reported zero with Portuguese still on screen"), so the rejection case is not
optional decoration; it is the half that proves the guard can fail.

#### Evidence

`i18n-guard.test.ts:86-103` is the shape to copy: the interface guard carries a positive case
proving it sees what exists to be seen, in a temp directory.

#### Files to edit

`dashboard/src/lib/identifier-language-ratchet.test.ts`.

#### TDD

- `test_guard_rejects_a_portuguese_identifier` — a temp file declaring `const nomeDoCampo = 1`
  produces a finding.
- `test_guard_accepts_english` — the negative counterpart, so the rejection is not trivially true.
- `test_comments_in_portuguese_are_still_allowed` — the convention, asserted rather than assumed.

#### Acceptance Criteria

- The guard flips only when `varrerIdentificadores(SRC).length` `equals 0`. At any other number this
  task does not run, and the item stays open with a lower ceiling — recorded in `BACKLOG.md`.

#### DoD

- If flipped: `npx vitest run src/lib/identifier-language-ratchet.test.ts` exits 0 with all three
  cases passing, and the rejection case FAILS against a detector stubbed to `return []`.

### T3.2 — Decide the harness's disposition

#### Objective

Decide, at the end of the migration, whether `rename-identifiers.mjs` stays.

#### Why this step (action + reasoning)

If the population reached zero, the harness has no remaining caller and becomes exactly the
`dead_code_unallowlisted` finding `/code-quality` is built to catch (B-258 is the precedent in this
repo: a script with no caller). If work remains, it has a user and stays. Deciding it here — rather
than leaving it and discovering it at the gate — is the point.

#### Acceptance Criteria

- Either `git grep -n rename-identifiers` `returns` a caller or a documented next batch, or the
  harness is deleted in the same slice.
- `npm run lint` (which includes the knip ratchet) `returns 0` either way.

#### DoD

- `/code-quality` `returns` no new `dead_code_unallowlisted_typescript` finding attributable to
  this slice.

## Phase 4: The record

### T4.1 — CHANGELOG and BACKLOG

#### Objective

`CHANGELOG.md [Unreleased]` entries for both items; `BACKLOG.md` B-242 and B-241 blocks updated with
the measured outcomes, and their status advanced only as far as the measurement supports.

#### Why this step (action + reasoning)

Unbreakable Rule 6: a change not in the changelog did not happen. And `cycle-maintenance`'s single
rot the loop exists to prevent is a block whose status was advanced by hand rather than by a
verdict — so a partial migration must read as partial.

#### Files to edit

`CHANGELOG.md`, `BACKLOG.md`.

#### Acceptance Criteria

- `CHANGELOG.md [Unreleased]` gains one line per user-visible change, each `contains` a `(B-NNN)`
  reference.
- Each `BACKLOG.md` block records the number BEFORE and AFTER and the command that measured it.
- `status: shipped` appears only where the DoD holds; otherwise the block keeps `status: triaged`
  with the new number.

#### DoD

- `git status --porcelain` `returns` empty after both files are committed with the slice.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| unanchored absence assertions anchored so they can fail | T1.1 |
| every anchoring proved RED-first, not by a green suite | T1.1 (TDD), T1.2 (mutation on the ceiling gate) |
| `CEILING_UNANCHORED` follows the fall | T1.2 |
| never-leak class left to B-276, not absorbed | T1.1 (Why this step), D2 |
| the B-242 detector is not narrowed to move the number | D2, T1.2 |
| a type-aware rename that cannot touch comments | D1, T2.1 |
| Portuguese identifiers migrated to English | T2.2, T2.3 |
| collisions caught before they destroy a batch | D3, T2.3 |
| no wire contract broken by a rename | R2, T2.2 (Acceptance Criteria) |
| both identifier ceilings follow the fall | T2.4 |
| the guard rejects Portuguese identifiers | T3.1 |
| the guard enters last, and only at zero | D4, T3.1 |
| comments stay Portuguese | D1 (`findInComments: false`), T2.1 TDD, T3.1 TDD |
| suite green in fixed order and under shuffle | T2.3 DoD, T4.1 |
| no orphan tooling left behind | T3.2 |
| the record matches what was actually measured | T4.1 |
