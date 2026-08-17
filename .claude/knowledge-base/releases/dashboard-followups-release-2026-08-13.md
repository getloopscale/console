---
slug: dashboard-followups
date: 2026-08-13
verdict: PR_OPEN_AWAITING_APPROVAL
pr: https://github.com/usetheoai/theo-cloud/pull/485
head: 8dff133e
---

# RELEASE — `dashboard-followups`

## Verdict

**`PR_OPEN_AWAITING_APPROVAL`.** The promotion PR is open and updated. Nothing was merged, no tag was
cut, no GitHub release was published.

## What was done

| Step | Result |
|---|---|
| Input verdict | `READY_TO_MERGE_WITH_FOLLOWUPS` — `.claude/knowledge-base/reviews/dashboard-followups-review-2026-08-13.md` |
| Branch | `workspace`, clean tree |
| Push | `4a63fd9e..8dff133e` → `origin/workspace` |
| Promotion PR | **#485** `workspace → develop`, updated in place — 49 commits, `MERGEABLE` |
| Merge | **not performed** |
| Tag | **not cut** |
| GitHub release | **not published** |

## Why the chain stops here

Two independent gates, and both point the same way.

**`cycle-release § Hard gates`** — *"the merge step ALWAYS waits for a human-approved PR"*. #485 has
no review decision. Merging it would be the assistant approving its own work, which is the one thing
the gate exists to prevent.

**`BACKLOG.md § B-263`** — the maintainer authorised exactly two merges on 2026-08-12 (#475
`develop → main` for v1.0.0, #476 the promotion behind it) and scoped the exception explicitly:

> NOT authorized and NOT done: any further `develop → main` merge. This session's work lands on
> develop, unreleased, and waits for the next cut like any other work.

So there is no version bump in this run, no `[Unreleased]` rewrite, and no tag. `[Unreleased]` stays
populated on purpose: this work is *promoted*, not *released*, and the next cut is what will name it.

Recording this rather than treating the pause as an error is the point. B-263 exists because the
same deadlock — an autonomous goal whose last stage is reserved for a human — was resolved twice in
two days by exception, and its own DoD asks that the pattern stay visible. Reaching for a third
would be answering a question about the gate by ignoring it.

## State of the delivery

```
suite            381 files / 3385 tests passed, exit 0
tsc --noEmit     clean
eslint           clean
knip ratchet     30/30, other classes at zero
npm audit        --omit=dev: 0 vulnerabilities   (was: 1 high, GHSA-2v37-7h3g-55p8)
npm run build    exit 0
```

## Milestone

The plan carries no `milestone_id` — this is backlog-driven maintenance, not roadmap work — so no
`ROADMAP.md` checkbox is in scope and none was touched. Per `cycle-release`, that is a WARN and not
a blocker.

## What a human needs to do

1. Review and merge **#485** (`workspace → develop`).
2. When the next release is cut, `develop → main` with a semver tag. That cut is a separate decision
   and is not authorised by anything in this session.

## Cross-references

- `.claude/rules/cycle-release.md` § Hard gates, § Verdicts
- `.claude/knowledge-base/reviews/dashboard-followups-review-2026-08-13.md`
- `BACKLOG.md` § B-263 — the scoped governance exception this run does not extend
- `.claude/rules/git-safety.md` § 1
