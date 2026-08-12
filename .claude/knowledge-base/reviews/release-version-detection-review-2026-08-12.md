# Review — `release-version-detection` (B-228)

**Date:** 2026-08-12 · **Branch:** `workspace` · **Range:** `3ebd0bdf..56dc2400`
**Agents:** 4 in parallel — architecture, test-quality, cross-validation, wiring + hard gates

## Verdict

**`READY_TO_MERGE_WITH_FOLLOWUPS`**

No BLOCKER at any agent. Six HIGH findings were raised; **all six are fixed and verified**, not
mitigated in prose. What remains above the `READY_TO_MERGE` bar is followup debt that is
registered and owned, which is the precise condition `cycle-review § Verdicts` names for this
token: *"the blocking work is closed and provable; the debt is real and named."*

## HIGH findings — all closed

| # | Agent | Finding | Closed by |
|---|---|---|---|
| H1 | wiring | `patch_install.sh` shipped `SKILL.md` and five sibling scripts but **not** `detect_current_version.py`, while the same slice removed the `\|\| echo "v0.0.0"` fallback. A patched consumer would run Step 2 against a missing file, get an empty `LAST_TAG`, and feed `--current ''` into the version computation. | `6688464c` — manifest entry, Step 2 halts loudly, 3 tests assert the wiring mechanically |
| H2 | architecture | `_stdlib_packages()` returned an empty set when `go` was off PATH, fell through to the proxy, and re-created **B-252**: `encoding/json` → 404 → HARD `symbol_fabrication_go`. Reproduced independently: 9 failures with go removed. | `6688464c` — toolchain probe; unverifiable is `None`, never `False`, and is not cached |
| H3 | architecture | The three `go` invocations read the process CWD while every sibling subprocess passes an explicit `cwd`; `lru_cache` made the first module graph global to the process. | `6688464c` — `_go_workdir()` + `reset_go_resolution_cache()` |
| H4 | tests | Deleting `--merged <ref>` survived **both** integration tests; killed only by a fake keying on the command string, not the outcome. | `56dc2400` — real repo with a tag on an unmerged branch, plus the contrast test |
| H5 | tests | The CLI contract the chain consumes (`--quiet`, `__str__`, exit 2) had zero coverage; `main()` entirely untested. Three surviving mutations, each silently breaking the chain. | `56dc2400` — all three mutations verified killed |
| H6 | tests | `severity="HARD"` unpinned: one token to `SOFT_FLOOR` survived all 193 tests and would turn a `/review`-blocking cap into an advisory note — two hours after B-256 allowlisted 21 findings on that severity. | `56dc2400` |
| H7 | cross-val | The implementation log `cycle-implement § Output` mandates did not exist; no `.progress-*.json`, no mini-reviews. | `6688464c` — written, **including its own deviations** |

Seven, not six — H4/H5 were counted as one by the agent that found them.

## Mutation testing

41 mutations run by the test reviewer; **22 killed, 19 survived**. Of the 19: 4 were the HIGH
findings above, 8 were MEDIUM (M2 loosening negatives, M3 ambiguous-not-cached, M4 shape-change
guard, M5 unreadable file, M6 I/O error paths, M7 cache TTL, M8 `git_runner` raiser), and the
rest LOW. Fixed this round: H4, H5, H6, M4, M5, L3, plus M1 (suite required a real `go` binary)
and M3 (fixed earlier in `6688464c`).

Explicitly re-verified after fixing, rather than assumed: the four HIGH mutations were re-applied
one at a time and each is now **KILLED**.

## Hard gates (`cycle-review § Hard gates`)

| Gate | Result |
|---|---|
| Failing tests on the branch | **PASS** — 387 passed across the four touched suites. Two failures exist elsewhere (`plan-confidence`, `discover-plan-confidence`), **proven pre-existing** by the reviewer in a detached worktree at `3ebd0bdf`. |
| New secrets committed | **PASS** — no secret-shaped paths or values in added lines |
| Direct commit to `main` | **PASS** — all commits on `workspace`; `git branch --contains HEAD` → `workspace` only |
| `Co-Authored-By` trailer | **PASS** — none, across all commits |
| CHANGELOG updated | **PASS** — every B-NNN in the slice has an entry under `[Unreleased]` |

## Registered followups

Every caveat has an owner. None is left in prose.

| Item | What |
|---|---|
| B-256 | 21 pre-existing unreachable Go symbols, allowlisted with sunset 2026-11-10 + ADR |
| B-258 | `arch-check` ships `emit_config.py` with no caller; the skill reaches no installer and no rule |
| B-259 | plan-snapshot uncovered set 40 → 42; this slice contributed 2 |
| B-250 | a plugin patch silently reverted committed fixes in the working tree |
| B-253 | code-quality reports cite paths with the leading slash stripped |
| B-255 remainder | M6, M7, M8 mutations (I/O error paths, cache TTL, `git_runner` raiser) — not fixed this round, named here |

## Open MEDIUM findings, not fixed and not hidden

- **M2 (tests)** — two loosening mutations survive: `startswith(f"{module}/")` → `startswith(module)`
  (a typosquat of a private module would resolve), and the stdlib membership test widened to a
  prefix match (`net/httpFAKE` would resolve as stdlib). Both turn a HARD finding into a silent
  pass, which is the direction that matters most for this detector. **Worth fixing before the
  next slice touches `_registry.py`.**
- **M1 (architecture)** — `_registry.py` now has two reasons to change (HTTP registries + local Go
  toolchain) and the name is a misnomer. Extraction to `_go_resolution.py` recommended.
- **M2 (architecture)** — `VersionSource`: three concrete implementers exist and the source name is
  consumed, so it is not speculative generality; but two of the three differ only by a git args
  tuple and the third is a constant. Proportionate, not minimal.
- **M3 (architecture)** — `GitCommandError` carries two meanings (a git failure, and "you built a
  detector without a total source"). One typed error, one meaning.

## Scope note

15 of the 22 commits in this range are **not** B-228. Each carries its own `B-NNN`, was registered
before being fixed, and exists because `/code-quality` returned `FAIL_HARD` on this slice for
reasons that had nothing to do with it. `git diff --name-only 5e1569af~1 2ab933cc` returns exactly
the nine files the plan's Baseline Context named — no creep into the plan itself.

## Cross-references

- Plan: `.claude/knowledge-base/plans/release-version-detection-plan.md`
- Implementation: `.claude/knowledge-base/implementations/release-version-detection-implementation.md`
- Code-quality: `.claude/knowledge-base/audits/release-version-detection-code-quality-2026-08-12.md` (`FAIL_SOFT`, 0 HARD, 21 soft caps dismissed by ADR)
- ADR: `.claude/knowledge-base/adrs/ADR-b256-preexisting-go-dead-code.md`
