# ADR-0011 — Dismiss the 21 Go soft caps for the `dashboard-followups` slice

**Status:** accepted
**Date:** 2026-08-13
**Scope:** this slice only. Not a standing dismissal, not a threshold change.

## Context

`cycle-review § Pre-conditions` admits a `FAIL_SOFT` code-quality verdict only when it is
"accompanied by an ADR dismissing each soft cap". The audit at
`.claude/knowledge-base/audits/dashboard-followups-code-quality-2026-08-13.md` returned:

```
Verdict:              FAIL_SOFT
Hard caps triggered:  soft_cap_go
Findings:             23 total — 0 HARD, 21 SOFT_CAP, 0 SOFT_FLOOR, 2 INFO
```

The `/review` of this slice found the ADR missing and the pre-condition therefore unsatisfied. It
was right, and this file is the answer rather than an argument that the gate should not have fired.

## The 21, and why they are one finding rather than twenty-one

Every SOFT_CAP is `dead_code_unallowlisted_go` — an unreachable **Go** symbol — and every one is
already carried in `code-quality-allowlist.txt` (each row ends `[allowlisted]`). They fall in three
groups:

| Group | Symbols | Why unreachable by static reading |
|---|---|---|
| `internal/metrics/*` | `IncTokenExchange`, `IncDeviceFlow`, `ObserveTenantProvisioning`, `IncAuthRejection`, `IncWebhook`, `IncCheckout`, `IncUsageDrift`, `IncSubscriptionFallback`, and the `*Value` readers | **Genuinely dead — see the correction below.** |
| `internal/config` | `Secret.String`, `Secret.GoString`, `Secret.MarshalJSON`, `Secret.MarshalText` | Interface satisfaction. They exist so a secret cannot be printed or serialised by accident; nothing calls them directly and that is the point. Exercised implicitly by `secret_test.go`, which round-trips a `Secret` through `fmt` and `json.Marshal` |
| `internal/billing`, `internal/routes` | `CostAggregator.WithClock`, two `WithInsecureCookieForTests`, `MemoryExportsHandler.WaitForWorkers` | Test seams, each with a caller in a `_test.go` |

### Correction, 2026-08-13 — the metrics row above was wrong

This ADR first said the thirteen metric helpers were "the runtime-metric third of the wiring triad,
wired at their emission sites". Measured a few hours later, while closing B-256:

```
$ grep -rn "metrics\.IncWebhook(\|metrics\.IncCheckout(\|metrics\.IncAuthRejection(" \
        --include="*.go" . | grep -v _test.go
(nothing)

$ grep -c "metrics\." internal/routes/memory_webhooks.go      # the actual webhook handler
0
```

Every call to those helpers comes from `internal/metrics/metrics_test.go` — their own unit tests,
which assert that incrementing does not panic. **No production code emits any of them.** A counter
with no emission site does not record a low number; it records a flat zero forever, and a dashboard
built on it reads as "no auth rejection has ever happened".

So they are not instrumentation that a static reader cannot see. They are instrumentation that is
not wired, which is exactly the finding `dead_code_unallowlisted_go` was firing about, and the
allowlist entry was carrying an explanation that did not hold.

**The dismissal below still stands** — the slice it covers contains zero `.go` files and blocking a
dashboard test-guard slice on control-plane instrumentation would be the bundling `/review` flagged
three times in it. What changes is the disposition of the debt: it is not "already wired, invisible
to the tool", it is "not wired", and it is now measured and owned by B-256 rather than described
incorrectly here.

This is the second ADR in one day whose *mechanism* was asserted rather than measured, after
`ADR-b278`. Both were correct about what to do and wrong about why, and in both cases one command
would have refuted the sentence before it was written.

## Decision

Dismiss all 21 for this slice and proceed to `/review`.

## Rationale

**They are not this slice's code.** `dashboard-followups` touches
`dashboard/src/**`, `dashboard/scripts/**`, `CHANGELOG.md`, `BACKLOG.md` and
`.claude/knowledge-base/**`. It adds no Go, deletes no Go, and calls no Go. The diff
`4a63fd9e..HEAD` contains zero `.go` files. Every one of the 21 predates the slice and is unchanged
by it.

**The gate is doing its job; the verdict is just repo-wide.** `/code-quality` audits the tree, not
the diff. On a repository that carries a standing Go debt, every slice in every language inherits
the same `FAIL_SOFT`. That is a property of the instrument, not a signal about this work.

**Blocking here would be the wrong lever.** The debt is real and should be paid — but paying it
means either wiring or deleting instrumentation in the Go control plane, which is a different
domain (`control-plane`, not `frontend-dashboard`), a different specialist, and a change that must
be measured against its own runtime. Attaching it to a dashboard test-guard slice would be the
bundling that `/review` flagged three separate times in this very slice.

Alternatives considered:

- **Fix the 21 now** — rejected. Cross-domain scope creep, and a metric deleted because a static
  reader could not see its caller is how observability disappears.
- **Widen the allowlist so the verdict becomes PASS_WITH_CAVEATS** — rejected. They are already
  allowlisted; the allowlist downgrades by one level and `FAIL_SOFT` is where that lands. Reaching
  for a threshold change to move a verdict is exactly the report-gaming this repository refused one
  ADR ago over `nanoid`.
- **Declare the gate broken** — rejected. A repo-wide audit returning a repo-wide verdict is
  correct behaviour. What was missing is this file.

## Consequences

- `/review` proceeds for this slice with the pre-condition satisfied on the record.
- This dismissal expires with the slice. The next slice inherits the same `FAIL_SOFT` and needs its
  own justification, which is the friction that keeps the debt visible.
- The underlying debt is not written off. It belongs to the `control-plane` domain and needs its own
  backlog item, measured there.

## Cross-references

- `.claude/rules/cycle-review.md` § Pre-conditions
- `.claude/rules/code-quality-golden-rule.md` § 1, § 4
- `.claude/knowledge-base/audits/dashboard-followups-code-quality-2026-08-13.md`
- `.claude/knowledge-base/reviews/dashboard-followups-review-2026-08-13.md`
