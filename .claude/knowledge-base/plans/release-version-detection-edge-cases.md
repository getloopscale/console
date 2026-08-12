# Edge cases — `release-version-detection` (B-228)

**Plan:** `.claude/knowledge-base/plans/release-version-detection-plan.md`
**Date:** 2026-08-12
**Probed at:** `3ebd0bdf`

Each item below was **probed**, not imagined. The probe is recorded so a reader can re-run it.

## MUST-FIX

### MF-1 — `git describe --abbrev=0` orders by ancestry, not by version

The plan's ADR D1 chose `git describe --tags --abbrev=0 origin/main` as the primary source. That
command answers *"the nearest tag walking back from this ref"*, which is **not** *"the highest
version released"*. They diverge the moment a lower-numbered tag is cut later on the release
branch — a hotfix merged after a feature release, which is an ordinary event, not an exotic one.

Probed in a synthetic repository with exactly that shape:

```
tag v0.83.1 → tag v0.85.0 → tag v0.83.2      (all on main, in commit order)

git describe --tags --abbrev=0 main            ->  v0.83.2     ← nearest by ancestry
git tag --merged main --sort=-v:refname | head -1  ->  v0.85.0 ← highest version
```

**Consequence if unfixed:** the release chain would compute the next version from `v0.83.2` and
publish `v0.84.0` — a tag that already exists. The plan would have replaced a wrong command with a
subtly wrong one, and the new test suite would have been green because the fixture in T1.2 has
only monotonically increasing tags.

**Fix:** the primary source becomes `git tag --merged <ref> --sort=-v:refname`, taking the first
semver match. This asks the question the plan's own Goal states — *the newest tag reachable from
the release branch*, where "newest" means highest version, not most recent commit.

**Owner:** T1.1 (module) and T1.2 (test).
**Acceptance criterion:** a test builds the three-tag repository above and asserts the detector
returns `v0.85.0`; the same test asserts `git describe --abbrev=0` returns `v0.83.2`, so the test
documents *why* the obvious command was rejected and fails if that premise ever changes.

## Probed and NOT a problem

| # | Hypothesis | Probe | Result |
|---|---|---|---|
| P-1 | Some tags are lightweight, so `--merged`/`describe` disagree | `git cat-file -t v0.85.0 v0.84.0 v0.29.0` | all three are `tag` (annotated). Not an issue today; the semver filter makes it irrelevant either way. |
| P-2 | Non-semver tags (`nightly`, `rc-1`) pollute the version sort | `git tag \| grep -vE '^v?[0-9]+\.[0-9]+\.[0-9]+$'` | zero hits today. The filter is kept regardless — absence today is not a guarantee, and the filter costs one line. |
| P-3 | `git describe origin/main` needs a fresh fetch to be right | ran it with the ambient (unfetched) ref | returned `v0.85.0` correctly; it reads the local ref, so staleness is the operator's `git fetch`, which the plan already states. |
| P-4 | `origin/main` may not exist in every environment | `git for-each-ref refs/remotes/` | exists here. The fallback path in D1 already covers absence, and it is a tested case rather than an accident. |

## Open, deliberately not fixed here

| # | Question | Why it stays open |
|---|---|---|
| O-1 | Should a `v0.0.0` floor answer HALT the release? | Already Unresolved Question 1 in the plan. It is a policy decision for `SKILL.md` Step 2, not a property of detection. MF-1 does not change it. |
| O-2 | `[1.0.0]`/`[1.0.1]` sections exist with no tag | Already Risk R4 and Unresolved Question 2. Belongs to a release in flight (B-229), not to this slice. |

## Over-engineering check

The plan introduces a `VersionSource` protocol with three implementations. Probed against the
parsimony ladder (`.claude/rules/parsimony-ladder.md`) rung 5 — *can it be one line?*

**Verdict: the abstraction earns its place, narrowly.** There are three genuinely different
sources with different failure modes, and the caller must know **which one answered** — a release
cut from the fallback is a different confidence level than one cut from the release branch, and a
single line returning a bare string cannot carry that. What would be over-engineering, and is
explicitly excluded: a plugin registry, a config file naming sources, or a fourth speculative
source. Three concrete cases, one protocol, no extension seam nobody asked for.
