# Plan: the release chain reads the version it is actually releasing from

**Item:** B-228
**Slug:** `release-version-detection`
**Date:** 2026-08-12
**Baseline sha:** `3ebd0bdf`
**Upstream opportunity:** `.claude/knowledge-base/discoveries/opportunities/release-version-detection-opportunity.md`

## Goal

Replace the release chain's version-detection step — today an untested inline shell substitution
that returns `v0.29.0` while the released version is `v0.85.0` — with a named, tested module that
reads the newest tag reachable from the release branch, reports which source answered, and is
proven against a repository shaped like this one (tag on a merge commit that is not an ancestor of
the authoring branch). Correct `cycle-release.md § Chain` to stop naming the wrong command, and
close the tag/CHANGELOG drift in the direction Unbreakable Rule 6 permits.

## Context

`cycle-release § Chain` step 1 answers "what version are we on?", and every later step is applied
to that answer: the bump, the `chore(release):` commit subject, the CHANGELOG header, the
annotated tag. A wrong answer there is not a cosmetic defect — it is the version that gets
published.

The slice is otherwise well-factored. `compute_next_version.py` receives the current version as
`--current` and is a pure function over it, with tests. The step that produces that input has no
module and no test. This plan closes exactly that asymmetry and nothing else.

## Baseline Context (deep review of current state)

Measured 2026-08-12 at `3ebd0bdf`, tree clean, on `workspace`.

### Files that will be touched

| File | LoC | Role today | Change |
|---|---|---|---|
| `.claude/skills/release/scripts/detect_current_version.py` | 0 (new) | — | NEW — the module the step lacks |
| `.claude/skills/release/tests/test_detect_current_version.py` | 0 (new) | — | NEW — unit + integration tests |
| `.claude/skills/release/SKILL.md` | 265 | Step 2 embeds `git describe` as shell | Replace the substitution with a call to the module |
| `.claude/rules/cycle-release.md` | 122 | `§ Chain` line 28 names `git describe` | Correct the contract |
| `CHANGELOG.md` | 1919 | `[Unreleased]` + released sections | Add missing `[0.85.0]`, `[0.84.0]`; record the historical tail |
| `BACKLOG.md` | 8990 | registry | B-228 → `shipped` |

### Current callers / dependents

| Caller | Site | What it consumes |
|---|---|---|
| `SKILL.md` Step 2 | `.claude/skills/release/SKILL.md:67` | `LAST_TAG` shell variable, fed to `--current` |
| `compute_next_version.py` | `.claude/skills/release/scripts/compute_next_version.py:13` | `--current v1.2.3`, already parameterised — **no change needed** |
| `cycle-release.md § Chain` | `.claude/rules/cycle-release.md:28` | documents the command as the contract |

Nothing else in the repository reads a version this way. Verified:
`grep -rn "git describe" .claude/ scripts/` returns exactly those two hits.

### Domain glossary

| Term | Meaning here |
|---|---|
| **released version** | The newest semver tag reachable from `origin/main`. In this model tags are cut on the `develop → main` merge commit. |
| **authoring branch** | `workspace` — where all work is born (`git-safety.md § 1`). No release tag is ever its ancestor. |
| **detection source** | One ordered way of answering "what is the released version": release-branch tag, highest semver tag, or the `v0.0.0` floor. |
| **bump level** | `major`/`minor`/`patch`, applied by `compute_next_version.py` to the detected version. Out of scope here. |
| **drift** | A tag with no `CHANGELOG.md` section, or a section with no tag. Measured in both directions. |

### Architecture boundaries affected

One boundary, and the plan is about restoring it: **locate** (which version are we on) versus
**bump** (what comes next). `compute_next_version.py` already owns *bump* as a pure function.
*Locate* is the half that leaked into prose. After this plan each half is a module with one reason
to change, per `.claude/rules/architecture.md § 3`.

The new module owns the only impure part (invoking git) and takes that capability by injection, so
the pure ordering logic is testable without a repository — `architecture.md § 2` (DIP).

## Prior Art & Related Work

- `.claude/skills/release/scripts/compute_next_version.py` — the shape to mirror: a single
  responsibility, arguments in, value out, exit codes documented in the module docstring.
- `.claude/skills/release/tests/conftest.py` — the existing test harness for this slice; it puts
  `scripts/` on `sys.path`, so the new test file needs no new plumbing.
- `.claude/skills/release/scripts/flip_milestone_checkbox.py` + its test — the precedent in this
  slice for a script that touches repository state and is still unit-testable.
- B-247 / B-248 (shipped in this same session at `c5a7afdb`, `3ebd0bdf`) — both were defects in
  *checkers of evidence*, found because this item's own opportunity could not be scored. They are
  the reason the DISCOVER artifact for B-228 exists at all.

## Dependencies

**None added.** The module uses only the Python standard library — `argparse`, `re`, `subprocess`,
`sys`, `dataclasses`, `typing` — and the `git` binary the release chain already requires and
already invokes (`.claude/skills/release/SKILL.md:67`). Parsimony ladder rung 2
(`.claude/rules/parsimony-ladder.md`): the stdlib does it, so nothing is installed.

No new dependency means no new CVE surface for this slice. The pre-existing surface (`git`, the
CPython runtime) is unchanged by this plan and is not re-audited here.

## Objective

1. `detect_current_version.py` returns `v0.85.0` in this repository today.
2. The ordering of sources is explicit, and the answer names the source that produced it.
3. A test fails against the old `git describe` behaviour on a fixture repository with this repo's
   shape — proving the test would have caught the defect.
4. `cycle-release.md § Chain` and `SKILL.md` Step 2 agree with each other and with the model.
5. Tags `v0.84.0`/`v0.85.0` gain CHANGELOG sections; the pre-`0.69.5` tail is recorded as accepted.

## ADRs

### D1 — The primary source is the highest semver tag REACHABLE FROM the release branch

**Decision.** The first source consulted is `git tag --merged origin/main --sort=-v:refname`,
taking the first semver match; the fallback drops the `--merged` filter (highest semver tag
anywhere); the floor is `v0.0.0`.

**Rationale.** The question has two independent parts, and the command must satisfy both:
*released* (⇒ reachable from `main`) and *newest* (⇒ **highest version**, not most recent commit).
`--merged` supplies the first, `--sort=-v:refname` the second.

**Amended by MF-1** (`.claude/knowledge-base/plans/release-version-detection-edge-cases.md`) — the first draft of this ADR chose
`git describe --tags --abbrev=0 origin/main`, which satisfies only the first part. `describe`
walks ancestry and returns the *nearest* tag. Probed in a synthetic repo tagged
`v0.83.1 → v0.85.0 → v0.83.2`:

```
git describe --tags --abbrev=0 main            ->  v0.83.2
git tag --merged main --sort=-v:refname | head -1  ->  v0.85.0
```

A hotfix numbered below a shipped release and merged after it — an ordinary event — would have made
the chain compute the next version from `v0.83.2` and publish `v0.84.0`, a tag that already exists.
The plan would have replaced a wrong command with a subtly wrong one.

**Alternatives considered.**

- *`git describe --tags --abbrev=0 origin/main`.* Rejected by MF-1, above. It was the obvious
  choice and it is wrong for a reason that only shows up under a hotfix.
- *Highest semver tag anywhere* (`git tag --sort=-v:refname | head -1`). Rejected as the primary:
  it answers "the highest number anyone ever cut", which includes a tag pushed on a branch that was
  never released, and a tag cut by mistake. It is kept as the **fallback** because it needs no
  remote ref, and a chain that cannot answer at all is worse than one that answers from a weaker
  source and says so.
- *Read the version from `CHANGELOG.md`.* Rejected: the CHANGELOG is the artifact this very item
  proves can drift from the tags in both directions. Deriving the tag from the drifting document
  would make the drift undetectable.
- *Keep `git describe` and merge `main` back into `develop` after each release.* Rejected: it
  changes the branching model declared in `git-safety.md § 1` to accommodate a tool, and it would
  need an ADR against that rule rather than within this slice.

### D2 — Inject the git invocation rather than calling subprocess directly

**Decision.** The detector receives a runner callable; production supplies one that shells out to
git, tests supply fakes for the ordering logic **and** a real temporary repository for the
behaviour that matters.

**Rationale.** The ordering logic (try, fall back, report source) is pure and deserves fast tests.
But a fake-only suite is precisely what would have let this bug ship: a fake returning `v0.85.0`
proves nothing about a command that asks the wrong question. The integration test builds a
repository with the same shape — a tag on a merge commit not reachable from the working branch —
and is the test with real evidentiary value.

**Alternatives considered.**

- *Call `subprocess` directly and test only end-to-end.* Rejected: every ordering case then costs
  a repository build, so the fallback and floor paths would go untested in practice.
- *Mock `subprocess.run` with `unittest.mock.patch`.* Rejected: it couples the test to the call
  shape rather than the contract, and per `.claude/rules/testing.md § 6` that breaks on any
  refactor while proving nothing about behaviour.

## Drawbacks & Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | `origin/main` is absent (fresh clone, no remote, CI shallow checkout) → primary source returns nothing | medium | This is the designed fallback path, and it is a tested case, not an accident. The reported source name tells the operator which answer they got. |
| R2 | A shallow clone (`--depth=1`) has no tags at all → floor `v0.0.0` → the next release computes `v0.1.0` and looks like a catastrophic regression | low | Detection reports the source; the floor source is named explicitly so a release from `v0.0.0` is legible rather than silent. Recorded as an Unresolved Question — halting on the floor is a policy call this plan does not make. |
| R3 | Adding CHANGELOG sections for already-released versions edits public history | low | Unbreakable Rule 6 forbids editing *existing* released sections; these versions have **no** section. The change is additive. |
| R4 | The `[1.0.0]`/`[1.0.1]` headers name versions that were never tagged | **present today** | Explicitly OUT of scope and surfaced, not rewritten — they belong to a live release (B-229 records the in-flight PR). Fixing them inside this slice would mean editing a release in flight from a plan about detection. |
| R5 | The new module is only exercised by a Markdown-documented step, so nothing forces the SKILL to keep calling it | medium | The step's replacement is part of this plan's DoD and is verified by grep in the Integration Validation phase. |

## Unresolved Questions

- Q1 — **Should the chain refuse to release when detection lands on the `v0.0.0` floor?** A floor
  answer in a repository that has tags means the environment is wrong (shallow clone, no tags
  fetched), and cutting `v0.1.0` on top of `v0.85.0` would be the worst outcome this item could
  produce. Not decided here: the module reports the source honestly, and the policy of what to do
  about it belongs to the SKILL's Step 2, which this plan touches minimally on purpose.
- Q2 — **What to do about `[1.0.0]`/`[1.0.1]`.** They sit on `origin/develop` and `workspace`
  respectively with no tag. Whether they get tagged, renumbered against `v0.85.0`, or withdrawn
  is a release decision, not a detection one. Surfaced in the opportunity and left open.
- Q3 — **Does the same untested-inline-shell-step class exist elsewhere in the release chain?** The
  `gh pr list` pre-condition gate and the tag-cut step have the same shape: shell inside a fenced
  block in `SKILL.md`, with no module and no test. Measured as a class in the opportunity's
  Corner 4; not swept here, because a sweep is its own backlog item and not a guess.

## Dependency Graph

```
T1.1 (detector module + unit tests)
   ↓
T1.2 (integration test on a fixture repo with this repo's shape)
   ↓
T2.1 (SKILL.md Step 2 calls the module)  ──┐
T2.2 (cycle-release.md § Chain corrected)  ─┤→ T3.1 (CHANGELOG drift)
                                            │
                                            └→ Final Phase (integration validation)
```

T1.1 and T1.2 are ordered: the integration test is written second because it is the one that must
fail against the *old* behaviour, and demonstrating that requires the module to exist first.
T2.1/T2.2 are independent of each other and both depend on T1. T3.1 is independent of all of them
but is sequenced last so the release-critical change lands first.

## Phase 1: The module

### T1.1 — `detect_current_version.py` with an ordered, named source list

#### Objective

A module that answers "what version are we releasing from", tries sources in a declared order, and
returns both the version and the name of the source that produced it.

#### Why this step (action + reasoning — ReAct discipline)

The defect exists because this logic had no module. Extracting it is not refactoring for its own
sake: a shell substitution inside a Markdown fence cannot be imported, cannot be asserted on, and
cannot fail a suite. Every other step of this plan depends on there being something to test.

#### Evidence

`.claude/skills/release/SKILL.md:67` — the substitution being replaced.
`.claude/skills/release/scripts/compute_next_version.py:13` — the sibling whose shape is mirrored.

#### Files to edit

- `.claude/skills/release/scripts/detect_current_version.py` (new)
- `.claude/skills/release/tests/test_detect_current_version.py` (new)

#### Deep file dependency analysis

The module imports only `argparse`, `re`, `subprocess`, `sys` and `typing` from the standard
library — parsimony ladder rung 2 (`.claude/rules/parsimony-ladder.md`): no dependency is added, and
none is needed. It is imported by nothing at runtime; its consumer is a shell step. The test file
reaches it through the existing `conftest.py`, which already inserts `scripts/` on `sys.path`.

#### Pseudo-code / Signatures

```python
class VersionSource(Protocol):
    name: str
    def read(self, run: GitRunner) -> str | None: ...

class ReleaseBranchTag:      # git tag --merged <ref> --sort=-v:refname, first semver match
class HighestSemverTag:      # git tag --sort=-v:refname, first semver match (no --merged)
class FloorVersion:          # always "v0.0.0"

@dataclass(frozen=True)
class DetectedVersion:
    version: str
    source: str

class VersionDetector:
    def __init__(self, sources: Sequence[VersionSource]) -> None: ...
    def detect(self, run: GitRunner) -> DetectedVersion: ...
```

`VersionDetector` walks the sources in order and returns the first non-`None` answer with its
source name. `FloorVersion` never returns `None`, so `detect` is total — no `None` escapes, no
magic sentinel, per `.claude/rules/error-handling.md § 2`.

#### TDD

RED first, one behaviour per test, Arrange-Act-Assert:

- `test_release_branch_tag_is_preferred_when_present` — asserts source `release-branch-tag`.
- `test_falls_back_to_highest_semver_tag_when_release_branch_absent` — runner raises for the
  `origin/main` call; asserts source `highest-semver-tag`.
- `test_falls_back_to_floor_when_no_tags_exist` — asserts `v0.0.0` and source `floor`.
- `test_non_semver_tags_are_ignored_by_highest_semver_tag` — a repo tagged `nightly` and
  `v0.3.0` resolves `v0.3.0` (negative case: junk in, correct answer out).
- `test_detected_version_reports_which_source_answered` — the source name is not decorative;
  a release from the fallback must be distinguishable from one from the release branch.
- `test_git_failure_is_not_swallowed_into_a_wrong_version` — a runner that fails for *every*
  source still yields the floor, and the floor is **named** as such rather than being reported
  as a real tag (`error-handling.md § 5` — no magic values).

#### Acceptance Criteria

- `python3 -m pytest .claude/skills/release/tests/test_detect_current_version.py -q` exits 0 with
  6 tests passed.
- `python3 .claude/skills/release/scripts/detect_current_version.py` prints exactly
  `v0.85.0 (release-branch-tag)` and exits 0 in this repository at `3ebd0bdf`.
- `grep -n "except" .claude/skills/release/scripts/detect_current_version.py` shows every handler
  either returning `None` or writing to stderr — zero bare `except:` and zero handler whose body
  is only `pass` (`.claude/rules/error-handling.md § 2`).

#### DoD

- Module and tests committed atomically, message referencing B-228 and T1.1.
- `CHANGELOG.md [Unreleased]` updated.

### T1.2 — Integration test on a repository shaped like this one

#### Objective

Prove the fix against the actual failure mode, not against a fake.

#### Why this step (action + reasoning — ReAct discipline)

A unit test with a stub runner would have passed with `git describe` too — the stub returns
whatever it was told. The defect lives in the *question the command asks*, and only a real
repository with the same topology can expose it. This test is the evidence that the fix works;
the unit tests only cover the ordering around it.

#### Evidence

Measured at `3ebd0bdf`: `git merge-base --is-ancestor v0.85.0 HEAD` → NO, while
`git describe --tags --abbrev=0 origin/main` → `v0.85.0`.

#### Files to edit

- `.claude/skills/release/tests/test_detect_current_version.py` (extend)

#### TDD

- `test_tag_on_unreachable_merge_commit_is_still_detected` — build a temp repo: commit on
  `main`, branch `workspace`, diverge both, merge `workspace` into `main`, tag the **merge
  commit**, then check out `workspace`. Assert:
  - `git describe --tags --abbrev=0` from `workspace` does **not** return the tag (this
    assertion documents the defect and fails if the premise ever stops holding);
  - the detector **does** return it.

- `test_hotfix_numbered_below_a_shipped_release_does_not_win` — **MF-1 regression.** Build a repo
  tagged `v0.83.1 → v0.85.0 → v0.83.2` on the release branch. Assert:
  - `git describe --tags --abbrev=0` returns `v0.83.2` — the assertion that documents why the
    obvious command was rejected, and fails if git's behaviour ever changes;
  - the detector returns `v0.85.0`.

  Without this case the T1.2 fixture has only monotonically increasing tags, so both commands
  agree and the suite would be green on the wrong implementation.

  Both are negative cases in the sense of `.claude/rules/testing.md § 4.1`: the environment is
  hostile to the naive command, and each asserts the specific correct answer, not merely
  "something was returned".

#### Acceptance Criteria

- The test builds its repository in `tmp_path` and touches no user git config
  (`-c user.email=... -c user.name=...` passed per invocation).
- The test is deterministic: no wall-clock, no network, no reliance on the ambient repo.

#### DoD

- Committed atomically referencing B-228 and T1.2.

## Phase 2: The chain agrees with the model

### T2.1 — `SKILL.md` Step 2 calls the module

#### Objective

The documented step stops embedding the wrong command.

#### Why this step (action + reasoning — ReAct discipline)

A tested module nobody calls fixes nothing. This is pillar (a) of the wiring triad in
`.claude/rules/cycle-implement.md § Wiring triad` — the caller — and without it the module is dead
code by the definition `.claude/rules/cycle-code-quality.md` uses.

#### Evidence

`.claude/skills/release/SKILL.md:67`.

#### Files to edit

- `.claude/skills/release/SKILL.md`

#### TDD

Markdown is not executable, so the test is a grep-based guard in the integration phase rather than
a unit test — stated plainly rather than pretending a unit test covers it:
`grep -rn "git describe" .claude/` must return zero hits outside the knowledge-base.

#### Acceptance Criteria

- `grep -c "detect_current_version.py" .claude/skills/release/SKILL.md` returns at least 1, and
  the matched line pipes its output into `compute_next_version.py --current`.
- `grep -c "git describe" .claude/skills/release/SKILL.md` returns 0.
- Step 2's fenced block writes the detected source name into the release record template, so
  `knowledge-base/releases/{version}-release.md` carries a `version_source:` line.

#### DoD

- Committed referencing B-228 and T2.1; `CHANGELOG.md` updated.

### T2.2 — `cycle-release.md § Chain` corrected

#### Objective

The contract stops naming a command that cannot answer the question in this model.

#### Why this step (action + reasoning — ReAct discipline)

The rule and the skill are two copies of one decision. Fixing only the skill leaves the rule as a
correct-looking instruction to reintroduce the defect — which is how it would come back.

#### Evidence

`.claude/rules/cycle-release.md:28`.

#### Files to edit

- `.claude/rules/cycle-release.md`

#### Acceptance Criteria

- `§ Chain` describes detection without naming `git describe`.
- `python3 .claude/scripts/check_xrefs.py` passes (the rule's cross-references still resolve).

#### DoD

- Committed referencing B-228 and T2.2.

## Phase 3: The public contract

### T3.1 — Close the tag/CHANGELOG drift additively

#### Objective

Every tag from `0.69.5` onward has a CHANGELOG section, or the absence is recorded with its
reason.

#### Why this step (action + reasoning — ReAct discipline)

`CHANGELOG.md` is the public contract (Unbreakable Rule 6): if a change is not in it, it did not
happen. Two releases currently claim nothing. The older tail (`0.10.0`–`0.13.0`, `0.69.5`) predates
the discipline and cannot be honestly reconstructed — recording that is the truthful option, and
silently leaving it looks identical to an oversight.

#### Evidence

Measured 2026-08-12: tags without sections `0.10.0 0.11.0 0.12.0 0.13.0 0.69.5 0.84.0 0.85.0`;
`origin/main`'s CHANGELOG tops out at `0.83.1` while `origin/main` is tagged `v0.85.0`.

#### Files to edit

- `CHANGELOG.md`

#### Acceptance Criteria

- `grep -c '^## \[0.84.0\]' CHANGELOG.md` and `grep -c '^## \[0.85.0\]' CHANGELOG.md` each return 1,
  and each header carries the date of its own annotated tag (`git log -1 --format=%ad v0.84.0`).
- Every bullet under those two sections names a change present in
  `git log v0.83.1..v0.84.0` / `git log v0.84.0..v0.85.0` — verified commit by commit, never
  written from memory.
- `CHANGELOG.md` contains exactly one paragraph recording that tags `0.10.0`–`0.13.0` and `0.69.5`
  predate the discipline and have no reconstructable section.
- `git diff origin/main -- CHANGELOG.md | grep -c '^-'` returns 0 for lines inside any pre-existing
  `## [x.y.z]` section — the change is purely additive (Unbreakable Rule 6).

#### DoD

- Committed referencing B-228 and T3.1.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| version detection is a named, tested module | T1.1 |
| reads the newest tag reachable from the release branch | T1.1 (D1 ordering), T1.2 |
| "newest" means highest version, not nearest commit (MF-1) | T1.1 (D1 amended), T1.2 |
| reports which source answered | T1.1 |
| proven against a repo shaped like this one | T1.2 |
| `cycle-release.md § Chain` stops naming the wrong command | T2.2 |
| the chain actually calls the module | T2.1 |
| tag/CHANGELOG drift closed in the Rule-6-permitted direction | T3.1 |

Every claim in the Goal maps to at least one task; every task maps to a claim. 100%.

## Global Definition of Done

- `python3 -m pytest .claude/skills/release/tests/ -q` green.
- `python3 -m pytest .claude/skills/discover-confidence/tests/ -q` still green (35 passed) — this
  session touched that suite and must not regress it.
- `grep -rn "git describe" .claude/skills .claude/rules` → zero hits.
- `python3 .claude/scripts/check_xrefs.py` → PASS.
- Running the detector in this repository prints `v0.85.0` / `release-branch-tag`.
- `CHANGELOG.md [Unreleased]` carries one entry per user-visible change, written for the consumer.
- `BACKLOG.md` B-228 → `status: shipped` with a `shipped_note` recording what was and was not done.

## Failure scenarios (when I/O external)

The module shells out to `git`, which is external I/O. Each mode has a declared behaviour and a
test:

| Scenario | Behaviour | Covered by |
|---|---|---|
| `origin/main` does not exist (no remote / never fetched) | primary source returns `None`, fallback answers, source name reports the downgrade | `test_falls_back_to_highest_semver_tag_when_release_branch_absent` |
| repository has no tags at all | floor `v0.0.0`, source named `floor` | `test_falls_back_to_floor_when_no_tags_exist` |
| `git` exits non-zero for every source | still the floor; the failure is surfaced on stderr, never swallowed | `test_git_failure_is_not_swallowed_into_a_wrong_version` |
| `git` binary absent | `FileNotFoundError` propagates — unrecoverable, and a release must not proceed pretending otherwise (`error-handling.md § 2`) | asserted in `test_git_failure_is_not_swallowed_into_a_wrong_version` |
| tags exist but none is semver | non-semver tags ignored; floor if none remain | `test_non_semver_tags_are_ignored_by_highest_semver_tag` |

No network call is made: `git describe origin/main` reads the local ref, and refreshing it is the
operator's `git fetch`, not this module's job.

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
python3 -m pytest .claude/skills/release/tests/ -q
python3 -m pytest .claude/skills/discover-confidence/tests/ -q
python3 .claude/skills/release/scripts/detect_current_version.py     # expect: v0.85.0 (release-branch-tag)
grep -rn "git describe" .claude/skills .claude/rules                  # expect: no output
python3 .claude/scripts/check_xrefs.py
```

### Acceptance Criteria

All five commands behave as annotated. The third is the one that matters: it is the exact question
the chain asks, answered in the repository where it was measured wrong.

### If Validation Fails

Return to the failing task, not to the plan. If the failure shows the *plan* was wrong — for
instance if `origin/main` turns out not to be an available ref in the environments the chain runs
in — stop and return to `/to-plan` per `.claude/rules/cycle-implement.md § Anti-patterns`, rather
than patching the module to accommodate a model the plan mis-stated.
