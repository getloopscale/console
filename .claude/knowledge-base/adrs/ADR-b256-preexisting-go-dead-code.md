# ADR — Allowlist the 21 pre-existing unreachable Go symbols rather than delete them

**Status:** accepted
**Date:** 2026-08-12
**Context item:** B-256 · **Surfaced by:** B-255 · **Blocking:** B-228
**Sunset:** 2026-11-10 (90 days, the maximum `code-quality-golden-rule.md § 4` permits)

## Context

`/code-quality` returned `FAIL_HARD` on the B-228 slice with cap
`dead_code_unallowlisted_go`. `FAIL_HARD` blocks `/review` by contract
(`.claude/rules/cycle-code-quality.md` § Hard gates).

Two facts decide this ADR:

1. **The B-228 slice touched zero Go files.** `git diff --name-only 3ebd0bdf..HEAD | grep -c '\.go$'`
   returns 0. The findings are pre-existing and unrelated to the change being gated.
2. **They were already being reported, illegibly.** Before B-255 fixed the D1 parser they arrived
   as five findings named `<unknown>` at `<unknown>:0:0`. The count rose from 5 to 21 because the
   parser started descending into the tool's per-function output — no new debt was created today.

## Decision

Allowlist all 21 with a 90-day sunset and a per-symbol rationale. Do not delete them, and do not
weaken the cap.

## Rationale

The obvious action — delete what the dead-code tool calls dead — is **wrong for two of the three
classes**, and the allowlist exists precisely so that a pre-existing finding does not force a bad
change under gate pressure.

**Class 1 — called by the language runtime (4 symbols).** `Secret.String`, `GoString`,
`MarshalJSON`, `MarshalText` are invoked by `fmt` and `encoding/json`, never by our code.
`CHANGELOG.md § [0.83.1] Security` records the same conclusion reached independently: deleting any
of them makes a credential serialize in clear text again, **with no test going red**. `deadcode`
reasons about calls in our source; it cannot see a call the runtime makes.

**Class 2 — test seams (4 symbols).** `WithClock`, `WaitForWorkers`,
`WithInsecureCookieForTests` ×2. `deadcode` analyses reachability from `main` and does not build
the test binaries, so a constructor option used only by tests reads as unreachable. Deleting them
breaks the suite.

**Class 3 — metrics helpers (13 symbols).** The only ones that may be genuinely dead. A metric
helper nobody calls means a signal nobody emits, which is worth knowing either way — but deciding
it requires reading each call site and the dashboards that consume the series, which is B-256's
work and not something to settle inside a release-tooling fix.

## Alternatives considered

- **Delete all 21 now.** Rejected: it reintroduces a security defect (class 1) and breaks tests
  (class 2), and the gate would go green over a worse codebase. This is the outcome the ADR exists
  to prevent.
- **Block B-228 until B-256 is done.** Rejected: it holds a correct release-version fix hostage to
  unrelated debt, and the release chain is currently computing versions from a tag 56 releases
  stale. Nothing about waiting makes either problem smaller.
- **Lower `dead_code_unallowlisted_go` from HARD to SOFT.** Rejected: that is softening a gate for
  every finding forever to accommodate 21 known ones. The allowlist is scoped and dated; a cap
  change is neither.
- **Allowlist without an expiry.** Not available, and correctly so — `§ 4` caps the sunset at 90
  days. An exemption nobody has to revisit is a deletion of the finding.

## Consequences

- `dead_code_unallowlisted_go` is downgraded one level for these 21 lines only. Any other
  unreachable Go symbol still fires at HARD.
- On **2026-11-10** every entry expires and all 21 re-fire at full severity. If B-256 has not
  classified them by then, the gate goes red again — which is the intended pressure.
- Each entry names one `file:line`, so exempting one never exempts another. Before B-255 this was
  impossible: all five findings shared a single allowlist key built from `<unknown>`.

## Cross-references

- Mechanism and the 90-day ceiling: `.claude/rules/code-quality-golden-rule.md` § 4
- Gate this unblocks: `.claude/rules/cycle-code-quality.md` § Hard gates
- Entries: `.claude/rules/code-quality-allowlist.txt`
- Owner of the classification work: B-256 in `BACKLOG.md`
- Parser fix that made them legible: B-255
