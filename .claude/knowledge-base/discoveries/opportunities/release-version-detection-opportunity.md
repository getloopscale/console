# Opportunity: the release chain cannot read the version it is releasing from

**Item:** B-228
**Repo:** theo-cloud
**Mode:** review
**Date:** 2026-08-12
**Baseline:** `67bcba8c` (workspace)

## Context

`cycle-release` cuts a semver tag from `develop → main`. Its very first step is to answer
"what version are we on?", because the bump level is applied to that answer. In this branching
model the answer is not in the history of the branch the release is authored on, and the step
that tries to read it is the only step in the slice with no module and no test.

This opportunity measures how far the read is off, why the model makes it inevitable, and what
the two-sided drift between tags and `CHANGELOG.md` looks like today.

## Corner 1 — Evidence

### The defect the item registered, re-measured and still true

`.claude/skills/release/SKILL.md:67` — the only place the chain decides what version it is
releasing *from*:

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
```

`.claude/rules/cycle-release.md:28` documents the same command as the contract.

Measured on 2026-08-12, on `workspace`, tree clean, after `git fetch --tags`:

| Question | Command | Answer |
|---|---|---|
| What does the chain read? | `git describe --tags --abbrev=0` | **`v0.29.0`** |
| Same, from the integration branch | `git describe --tags --abbrev=0 origin/develop` | **`v0.29.0`** |
| What is actually released? | `git describe --tags --abbrev=0 origin/main` | **`v0.85.0`** |
| Highest tag that exists at all | `git tag --sort=-v:refname \| head -1` | **`v0.85.0`** |
| Is the released tag reachable from here? | `git merge-base --is-ancestor v0.85.0 HEAD` | **NO** |

The command is not malfunctioning. It answers *"the newest tag in THIS history"*, and in this
branching model no release tag is ever in the history of `workspace` or `develop`: tags are cut
on the `develop → main` merge commit (`v0.85.0` → `a85a4eb7 Merge pull request #468`,
`v0.84.0` → `f78665b7 Merge pull request #462`) and `main` is never merged back. `v0.29.0` is
simply the last time the lines happened to touch — roughly 56 releases ago.

### Why it was never caught: the broken step is the one with no script

The release slice is otherwise well-factored. `compute_next_version.py` **receives** the current
version as `--current` and is a pure function over it — it never touches git, and it has tests.
The step that produces that input is an inline shell one-liner in a Markdown file. It has no
module, no test, and no name.

That asymmetry is the finding. The chain's only untested step is its only wrong step.

### Second-order damage, measured — larger than the item recorded

The item recorded "two cuts have no changelog section". The full set difference between tags and
`CHANGELOG.md` sections, measured today:

```
tags WITHOUT a changelog section:      0.10.0 0.11.0 0.12.0 0.13.0 0.69.5 0.84.0 0.85.0   (7)
changelog sections WITHOUT a tag:      0.80.0 0.81.0 1.0.0 1.0.1                          (4)
```

And the two halves are on different branches, which is what makes it a live inconsistency rather
than untidy history:

- `origin/main` is tagged **`v0.85.0`**, but the `CHANGELOG.md` on `origin/main` announces
  **`0.83.1`** as the most recent release. A consumer reading the public contract on the release
  branch is two cuts behind what the release branch actually is.
- `[1.0.0]` was written by `6c618990 chore(release): 1.0.0` and is on `origin/develop`, never on
  `main`, never tagged. `[1.0.1]` (`64fdcf9e`) exists only on `workspace`. Both carry a
  released-style dated header — `## [1.0.0] - 2026-08-11` — for versions that do not exist.

Two release cuts stacked with neither landed. The chain wrote the *released* header before the
merge that would make it true, then cut a second one on top of the first.

### Correction to this item's own intake

The item's `evidence` block says `CHANGELOG.md:241` records `[0.83.1]` as the most recent version.
On `workspace` that is now **stale**: `[1.0.1]` and `[1.0.0]` sit above it (lines 128 and 174).
The claim is still exactly true of `origin/main`, which is the branch that matters for the
"what is released" question. Recording the drift rather than silently re-pointing the line.

## Corner 2 — Constraint Relation

<!-- UNKNOWN: `.claude/rules/current-constraint.md` is `status = undeclared`, and this
     ecosystem does not instrument flow. Answering this corner with a confident claim would be
     the assertion-dressed-as-measurement that gate G5 exists to refuse. -->

`unknown` — no constraint is declared.

## Corner 3 — Blast Radius

Confined to this repository, and within it to the release slice. Measured:

```
grep -rn "git describe" .claude/ scripts/   →  2 hits, both about this same step:
  .claude/skills/release/SKILL.md:67        (the implementation)
  .claude/rules/cycle-release.md:28         (the contract that documents it)
```

No production source, no dashboard code, no other repository reads a version this way. Nothing
downstream of `theo-cloud` consumes the result — the value's only consumers are
`compute_next_version.py` (already parameterised, so it needs no change) and the tag/PR steps
further down the same chain.

The `CHANGELOG.md` half has a wider audience — it is the public contract (Unbreakable Rule 6) —
but the edit is additive: sections gained, never rewritten. Per Rule 6, released sections are
never edited; the missing ones are *added*, and the never-tagged `[1.0.0]`/`[1.0.1]` headers are
a live-release question, not a released section.

Because no other repo is touched, **no ADR is required** by
`discover-opportunity-golden-rule.md § 3` (ADR required only when the blast radius reaches beyond
the own repo). One is written anyway for the detection-order decision, since "prefer the tag on
`origin/main`" is a choice with a defensible alternative.

## Corner 4 — Verification

Tied to the item's `dod`:

| DoD bullet | How we will know |
|---|---|
| chain reads a version valid in this model | a named, tested module returns `v0.85.0` on this repo today, where `git describe` returns `v0.29.0`; the test asserts on a fixture repo with the same shape (tag on a merge commit not reachable from the working branch) |
| `cycle-release.md § Chain` corrected | the rule no longer names `git describe`; `grep -rn "git describe" .claude/` returns zero hits outside this opportunity |
| CHANGELOG gains v0.84.0/v0.85.0 or records why | the tags-without-sections set shrinks to the pre-0.69.5 historical tail, and that tail is recorded as accepted rather than left silent |

Where the limit plausibly moves next: the same class of defect — an untested inline shell step in
a `SKILL.md` — exists elsewhere in the release chain (`gh pr list` gating, the tag-cut step). This
item fixes the one that was measured; the class is worth a sweep, not a guess.

## Mode contract

`review` requires `file:line` + the rule violated + why it matters here. All three are above:
`.claude/skills/release/SKILL.md:67` / `.claude/rules/cycle-release.md:28`; the rule is
`cycle-release.md § Chain` contradicting its own branching model as declared in
`git-safety.md § 1`; and it matters here because the value feeds the version actually published.

## Recommendation

Give the step a name, a module and a test — the three things it lacks, in that order.

1. **Extract version detection into `detect_current_version.py`**, sibling of the already-pure
   `compute_next_version.py`. The two then compose as *locate* → *bump*, one reason to change
   each. Today the first half is a shell substitution inside prose, which is why it is the only
   untested step and, not coincidentally, the only wrong one.

2. **Order the sources explicitly, and report which one answered.** The authoritative answer is
   the newest tag reachable from the release branch (`origin/main`); the fallback, when there is
   no remote, is the highest tag by version order; the floor is `v0.0.0` for a repo with no tags.
   Reporting the source matters because "v0.85.0 via origin/main" and "v0.85.0 via version sort"
   are different confidence levels, and a release should say which it had.

3. **Correct `cycle-release.md § Chain`** so the contract stops naming `git describe`. The rule
   and the skill disagreeing is how the defect survives a fix in one of them.

4. **Close the CHANGELOG drift in the direction Rule 6 permits**: add the missing `v0.84.0` and
   `v0.85.0` sections (additive — released sections are never edited), and record the pre-0.69.5
   historical tail as accepted rather than leaving it silent. The never-tagged `[1.0.0]`/`[1.0.1]`
   headers are a live-release question and are surfaced, not rewritten here.

Deliberately NOT in scope: the same untested-inline-shell-step class elsewhere in the release
chain (the `gh pr list` gate, the tag-cut step). Measured as a class, not fixed by guess.

## Verdict

`SHIPPABLE` — every pointer resolves, the mode contract is satisfied, all four corners populated
(Corner 2 as `unknown`, which is scoped and legal).
