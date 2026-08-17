# Release run — dashboard-ratchet-burndown (B-242, B-241)

**Date:** 2026-08-13
**Input verdict:** `READY_TO_MERGE_WITH_FOLLOWUPS` (`.claude/knowledge-base/reviews/dashboard-ratchet-burndown-review-2026-08-13.md`)
**Verdict:** `PR_OPEN_AWAITING_APPROVAL`

## What happened

| Step | Result |
|---|---|
| detect current version | `v1.0.2`, source `release-branch-tag` (`detect_current_version.py`) |
| compute next version | `1.0.3` (`compute_next_version.py --current v1.0.2`) — computed, **not written** |
| `[Unreleased]` non-empty | yes (`changelog_section_nonempty.py --section Unreleased`, exit 0) |
| push | `face8c87..8afce770 workspace -> workspace` |
| promotion PR | **#485** — `workspace → develop`, open, awaiting human approval |
| merge | **not done** — see below |
| `develop → main` PR | **not opened** — see below |
| tag / GitHub release | **not cut** |

## Why the chain stops here, and it is a rule and not a limitation

`cycle-release § Hard gates` locks the merge behind a human-approved PR. Beyond that, **B-263**
records an exception granted once, on 2026-08-12, for PR #475 and #476, and states its own scope in
the block: *"NOT authorized and NOT done: any further `develop → main` merge. This session's work
lands on develop, unreleased, and waits for the next cut like any other work."*

So the promotion PR is open and neither PR is merged by me.

## Why no version header was written

`cycle-release § Chain` sequences the `[Unreleased]` → `[{version}]` rewrite before the PRs. It was
deliberately skipped, and the reason is in this repository's own registry: **B-268** —
*"O CHANGELOG anuncia uma versão 1.0.1 que nunca foi lançada"*. Writing `## [1.0.3]` while the merge
that would make 1.0.3 exist is explicitly unauthorised reproduces that defect exactly.

The version is computed and recorded above, so whoever opens the release does not have to re-derive
it. `[Unreleased]` carries the entries as written.

## What the reviewer of #485 is being asked to accept

- fixed-order suite: 380 files / 3361 tests green; `tsc` clean; `lint` clean (knip 30/30)
- `/code-quality` `FAIL_SOFT`, entirely pre-existing Go findings owned by B-256 and dismissed by
  `ADR-b256-preexisting-go-dead-code`; 0 `.go` files touched by the slice
- **the shuffle DoD does not hold**, for a measured pre-existing reason, registered as B-280
- four followups registered rather than mentioned: B-277, B-278, B-279, B-280
- B-242 stays open at 91 with its composition measured; only B-241 flips to `shipped`

## Cross-references

- Plan: `.claude/knowledge-base/plans/dashboard-ratchet-burndown-plan.md`
- Implementation: `.claude/knowledge-base/implementations/dashboard-ratchet-burndown-implementation.md`
- Review: `.claude/knowledge-base/reviews/dashboard-ratchet-burndown-review-2026-08-13.md`
- Code-quality audit: `.claude/knowledge-base/audits/dashboard-ratchet-burndown-code-quality-2026-08-13.md`
- Governance scope: `BACKLOG.md` § B-263
