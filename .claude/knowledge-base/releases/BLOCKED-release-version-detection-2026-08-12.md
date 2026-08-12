# Release — BLOCKED

**Slug:** `release-version-detection` (B-228) · **Date:** 2026-08-12
**Input verdict:** `READY_TO_MERGE_WITH_FOLLOWUPS` (`.claude/knowledge-base/reviews/release-version-detection-review-2026-08-12.md`)
**Verdict:** `BLOCKED` — **superseded 2026-08-12 by `v1.0.0-release.md`**

> The block was real and is left standing as the record of it. It was cleared not by
> anything changing in the work, but by the maintainer explicitly authorizing the merge
> of #475 — the human-approval gate being passed by a human, which is what it is for.
> The exception's scope is `BACKLOG.md` B-263.

## Why

`cycle-release § Pre-conditions` — *"Do NOT trigger when: a release PR is already open
(`gh pr list --base main --head develop --state open` non-empty)."*

Measured 2026-08-12:

```
gh -R usetheoai/theo-cloud pr list --base main --state open
  #475  "Release v1.0.0"   develop → main   OPEN   MERGEABLE   created 2026-08-11T15:27:55Z

gh -R usetheoai/theo-cloud pr list --base develop --head workspace --state open
  #476  "release(1.0.1): dashboard code-review sweep — 46 items closed, 8 killed, 44 measured"
```

Both legs of the chain already have an open PR. `workspace` is **81 commits** ahead of
`origin/develop`, of which **15 are this session's** and not yet pushed.

## This is the cycle working, not failing

The pre-condition exists to stop a third release cut landing on top of two unmerged ones — and
that stacking is precisely the damage B-228's own opportunity measured:

```
CHANGELOG sections with no tag:  0.80.0  0.81.0  1.0.0  1.0.1
tags with no CHANGELOG section:  0.84.0  0.85.0  (+ the pre-0.69.5 tail)
```

`[1.0.0]` sits on `origin/develop` and `[1.0.1]` only on `workspace`, neither tagged, because two
release cuts were made without the first landing. Cutting a `1.0.2` now would add a third.

## The gate that cannot be automated

`cycle-release § Hard gates` — *"PR approval gate (LOCKED) — the merge step ALWAYS waits for a
human-approved PR. Auto-merging into `main` violates Unbreakable Rule 4."*

`B-229` records that a one-time exception was granted on 2026-08-11 for PR #470, under explicit
authorization, and states its own scope so it cannot read as precedent: *"ONE merge, authorized
once, for this release."* It does not extend here.

So #475 waits for a human, and nothing in this session merges it.

## What is done, and what is not

**Done and committed on `workspace`:** DISCOVER, PLAN, IMPLEMENT, CODE-QUALITY (`FAIL_SOFT`,
0 HARD, 21 soft caps dismissed by ADR), REVIEW (`READY_TO_MERGE_WITH_FOLLOWUPS`, 7 HIGH closed).
387 tests green across the four touched suites.

**Not done:** nothing has been pushed, no PR opened, no PR merged, no tag cut. The 15 commits sit
locally on `workspace`.

## The decision that belongs to a human

Pushing `workspace` would add 15 commits — B-228 plus eleven tooling defects found on the way — to
the **already-open PR #476**, whose title describes a dashboard code-review sweep. That is a
choice with two defensible answers and no default worth assuming:

1. **Push.** The work reaches `develop` through the normal promotion path. Cost: #476 stops
   matching its own title and carries two unrelated bodies of work.
2. **Hold.** The commits stay local until #475 lands and #476 is merged or retitled. Cost: the
   release-version fix does not reach anyone, and the chain keeps computing versions from a tag
   56 releases stale.

Neither is reversible-by-default once taken, which is why it is recorded here rather than decided.

## Cross-references

- Review: `.claude/knowledge-base/reviews/release-version-detection-review-2026-08-12.md`
- Implementation: `.claude/knowledge-base/implementations/release-version-detection-implementation.md`
- Governance exception that does NOT extend here: `B-229` in `BACKLOG.md`
