# Review — dashboard-ratchet-burndown (B-242, B-241)

**Slice:** `face8c87..HEAD` on `workspace`
**Plan:** `.claude/knowledge-base/plans/dashboard-ratchet-burndown-plan.md` (`SHIPPABLE`, 92.8)
**Implementation:** `.claude/knowledge-base/implementations/dashboard-ratchet-burndown-implementation.md`
**Upstream code-quality:** `.claude/knowledge-base/audits/dashboard-ratchet-burndown-code-quality-2026-08-13.md`

## Verdict

**`READY_TO_MERGE_WITH_FOLLOWUPS`**

Two BLOCKERs and seven HIGH findings were raised and **all are closed in this slice**, each with a
test that fails against the previous behaviour. What remains is named, registered debt: one
pre-existing test-infrastructure flake (**B-280**) and three process criteria that cannot be
retro-fitted without rewriting history. Per `cycle-review.md`, that is this verdict and not
`READY_TO_MERGE` — the blocking work is provably closed, the debt is real, and calling it a clean
green would be the same overstatement the review caught in the record.

## Commits under review

```
c5817b33  fix(dashboard): two BLOCKERs in the rename harness, found by adversarial review (B-241)
70c788ac  docs(audit): the /code-quality record for the ratchet-burndown slice
1153d7df  refactor(dashboard): the code reads in one language — 484 -> 0 (B-241)
a70c2c7b  feat(dashboard): a type-aware rename harness for the identifier migration (B-241)
2b36f6d0  docs(backlog): register B-277 and B-278, both measured during the B-242 batch
817fb159  test(dashboard): eleven absence assertions could not fail; 102 -> 91 (B-242)
```

## Hard gates (`cycle-review.md` § Hard gates)

| Gate | Result | Evidence |
|---|---|---|
| Tests green on the working branch | PASS (fixed order) | 380 files / 3361 tests |
| Tests green under shuffle | **FAIL — pre-existing** | see § Shuffle, below; registered as B-280 |
| No new secrets committed | PASS | `git diff --name-only face8c87..HEAD \| grep -ciE '\.env\|credentials\|\.pem$\|\.key$'` → 0 |
| No direct commit to `main` | PASS | branch is `workspace` |
| No `Co-Authored-By` trailer | PASS | `git log --format=%B \| grep -ci co-authored-by` → 0 |
| `CHANGELOG.md` updated | PASS | entries per item, plus a correction (below) |
| Upstream code-quality ∈ {PASS, PASS_WITH_CAVEATS, FAIL_SOFT + ADR} | PASS | `FAIL_SOFT`, entirely the 21 pre-existing Go dead exports owned by B-256 and dismissed by `ADR-b256-preexisting-go-dead-code`; slice touched 0 `.go` files |

## Specialist reviewers

Three ran in parallel against the committed state, each required to produce evidence by execution.

| Reviewer | Method |
|---|---|
| harness adversary | 29 mutants against the rename tool; boundary audit of all 303 object-literal key changes |
| cross-validation | re-derived every numeric claim from the two trees independently; walked all 9 tasks and 16 Coverage-Matrix rows |
| test quality (frontend-dashboard) | broke production per anchor and observed which case reddened |

## Findings, and what happened to each

### BLOCKER — both closed

| # | Finding | Closure |
|---|---|---|
| B1 | `applyCollisionOverrides` reused ONE harness across six override entries. `InMemoryProject` snapshots files at construction, so entry n+1 planned against pristine text and wrote the whole file back — discarding entry n's edits in any shared file while reporting both `renamed`. Reproduced: `one.ts` exported `promptName` while `consumer.ts` still imported `nome`; the script printed `6 edit(s)`, zero failures. | Harness rebuilt per entry. Test `two overrides touching a COMMON file both survive` fails against the old shape. |
| B2 | `ShorthandGuard` knew one of two shorthand shapes. It refused `return { nome }` and allowed `const { nome } = await res.json()` — the worse direction: compiles, suite green, field silently `undefined` at runtime. | `shorthandShapeOf` covers both. Test `REFUSES a shorthand DESTRUCTURING too` fails against the old guard. |

### HIGH — all closed

| # | Finding | Closure |
|---|---|---|
| H1 | The three billing anchors did NOT detect the regression their own docblock claimed. The label rule exists twice in `billing.tsx` (`:193`, `:314`); mutating one left all 20 cases green. | Asserts the exact count (2, one per renderer). Single-site mutation now reddens only the anchor — verified. |
| H2 | My `consultaErro` widening (`\b[a-z]\w*Error\b`) exempted 93 files at once — `throwOnError` (a fetch option), `onError` (a mutation callback), `formatDeployError` (a function name). Lowering a ratchet by widening the guard's vocabulary is what B-238 recorded. | Reverted. The predicate that was actually wrong was `iniciaLeitura`: `promptly/create.tsx` asserts absence over a local computation and entered the population through `useMutation(` — a WRITE. `Mutation` joins the does-not-read list, with a case per half plus a counter-case pinning the reverted widening out. |
| H3 | The identifier guard passed while scanning 4 files instead of 492 — no corpus floor, and the rejection case scans a temp dir, so it proves the detector and not the scan. | `CORPUS_FLOOR` added and proved: blinding the traversal reddens it. |
| H4 | Six of eight declaration kinds in `#declares` had no test; dropping any changed real behaviour with the suite green. | One case per kind, each also asserting a non-zero edit count — which nothing did before. |
| H5 | `isProductionFile` had no test, and judged the ABSOLUTE path: a checkout under any directory containing `src/test` classified the whole codebase as tests (`renamed: 0`, no error, ratchet frozen). | Judged relative to the root; four cases including the pathological one. |
| H6 | `#refuseOverlap` could be deleted with the suite green — unreachable within a run — and a comment cited a proving case that did not exist. | `EditPlan` exported and tested directly (3 cases). The claim is now true. |
| H7 | The purity claim (§ Record, below). | Corrected in all four places. |

### MEDIUM

| # | Finding | Disposition |
|---|---|---|
| M1 | `janela → window` shadowed the DOM global in `promptly/detail.tsx`, in a component whose docblock reasons about `window.location`. Latent. | Renamed to `revisionsRange`; the map test now records which targets shadow a global. |
| M2 | The map maps two names to one target (`novo`, `proxima` → `next`) and nothing checked it; a self-colliding map makes the harness emit a duplicate-identifier program. | Target-uniqueness case; the one legitimate pair is recorded so a NEW collision fails. |
| M3 | `identifier-map.test.mjs`'s coverage case is vacuous now that the population is zero (proved: −40 entries, still green). | Kept and labelled vacuous-today (it regains teeth when B-279 widens the detector), with an entry-count case that has teeth now. |
| M4 | `.d.ts` counted by the ratchet, excluded from the harness — the one divergence in a pair claimed to mirror. | Aligned. |
| M5 | "17 cases" in the record; there were 13. | Corrected to the measured count (21 after the BLOCKER fixes), with the error named. |
| M6 | The map was added in the SAME commit as the rename, so T2.2's ordering AC ("map committed strictly before the first rename commit") has no evidence in history. | **Not fixed** — cannot be retro-fitted without rewriting history. Recorded here and in the plan's outcome. |
| M7 | `1153d7df` bundles rename + map + guard flip + records (170 files), against R6 and `cycle-implement` § Anti-patterns. It is what makes H7 possible: hand edits are indistinguishable from harness output in the diff. | **Not fixed**, same reason. It is the concrete cost, and it is now written where the next slice will read it. |

### LOW

Mutation transcripts described rather than pasted (T1.1 AC 1); T1.1's "test files only" DoD broken by
the same bundling; the measuring command absent from the BACKLOG blocks; the per-name wire-key check
recorded globally rather than per name; the harness has no programmatic caller (its only automated
exercise is its own test file, which T3.2 accepts via the "documented next batch" branch, B-279);
two off-by-one pointers (`billing.tsx:315` → `:314`) — **corrected**.

## The record — the finding that matters most

Four documents (implementation summary, commit body, `CHANGELOG`, `BACKLOG`) stated:

```
comment lines changed across the whole diff   ->  0
string literals changed across the whole diff ->  0
```

Cross-validation re-derived it by parsing both trees and comparing multisets, and got **2 and 2**.

The measurement was true when it was taken — immediately after the harness ran — and stopped being
true half an hour later, when the 25 tests `tsc` could not catch were hand-fixed into the same
commit. One of those fixes is `toHaveProperty('campo')` → `'field'`: a string literal, named three
paragraphs below the claim in the same document.

This is precisely the defect the slice exists to remove, committed by the document reporting the
removal. It is corrected in all four places to the claim that is actually true and actually
verified — **the harness changed no comment and no literal; three files in the same commit were
hand-edited and two of those edits did** — and the bundling that made the two indistinguishable is
recorded as M7.

## Shuffle

The plan's Objective 5, R7, T2.3 DoD and B-241's own `dod` require green under shuffle. It was
never run before this review, and it does not pass on this machine.

```
cross-validation run   FAIL  lens/overview.test.tsx    M60 …            (findByText timeout)
this run               FAIL  lens/evaluators.test.tsx  M76 …            Test timed out in 20000ms
                             377 passed | 1 failed (378)
isolated, 3 consecutive runs   lens/evaluators.test.tsx --sequence.shuffle → 15 passed each time
```

Three facts, together: a different file each run, always a TIMEOUT and never an assertion, and
neither file touched by the slice (`git diff face8c87..HEAD` empty for both). That is worker
starvation under load — the mode `vitest.config.ts` documents in its own docblock and which already
justified raising the timeouts to 20 s once. Both measurements were taken with two other sessions
running suites on the same machine.

Registered as **B-280**, with the DoD written against the class rather than against whichever file
happened to lose the race.

## What held up under attack

- **D2 — the B-242 detector was not touched.** `src/test/absence-assertion.ts` is byte-identical;
  `git log face8c87..HEAD -- dashboard/src/test/` is empty for it. The 102 → 91 fall is entirely
  test-side work. In a repository where four ceilings fell in one day because a detector was
  narrowed, this was the plan's most important constraint and it holds exactly.
- **D4 — `MARCADOR` was not loosened, and the guard flipped only at a measured zero.** The
  population was measured independently at 0, not inferred from the guard passing.
- **Every load-bearing number reproduces:** 102 → 91, eleven anchored, 98 files, 484 → 0, 277 → 0,
  217 local-only, 276 map entries + 6 per-file targets, knip 30/30.
- **No key crossing an HTTP, storage or URL boundary changed**, audited by AST over all 303 key
  changes in the diff — request bodies, response reads, msw payloads, `localStorage`, URL params.
- **Eight of eleven anchors discriminate genuinely**; the other three were the H1 finding and now do.

## Followups (the gate on this verdict)

Every item below is registered, not mentioned:

| Item | What |
|---|---|
| **B-280** | shuffle fails by timeout under load; class-level DoD |
| **B-277** | the duplicated usage-label rule in `billing.tsx` that let a single-site mutation survive |
| **B-278** | HIGH CVE in `prismjs` via `react-syntax-highlighter`, in production dependencies |
| **B-279** | the identifier detector's tail, measurable only now that the body is gone |
| **B-242** | stays open at 91 with its composition measured |
| M6 / M7 | recorded in this report and in the implementation summary; no item, because they are process facts about commits already made, not work to be done |
