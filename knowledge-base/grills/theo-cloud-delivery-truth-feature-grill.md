---
slug: theo-cloud-delivery-truth
generated_by: roadmap-feature
date: 2026-07-30
status: completed
target_milestone: M22
roadmap: theo-cloud/ROADMAP.md
---

# Focused grill — `theo-cloud-delivery-truth`

## Provenance of answers

This grill was NOT conducted as four interactive turns. The four answers were **derived from a
completed `/loop-devops-audit` run on the same repository** (45 findings, 9 SOC 2 controls, verdict
`INVALID` score 46.0, evidence in `devops-audit-output/devops-audit.db`), plus two scope decisions
the operator stated explicitly. Each answer below is labelled with its source. Deriving beats
re-asking when measured evidence already answers the question; inventing an answer the audit did not
support would be the failure mode this label exists to prevent.

## Step 1 — slug collision check

Ran against every `### M<N> — [state] <name>` header in `theo-cloud/ROADMAP.md` (M0…M21).

**Partial collision found and adjudicated: M21 — "Painel discreto de versões dos serviços" `[x]`.**

M21 delivered the `/status` page, the `Service | State | Version | Built` table, and the aggregate
over four data-plane services. It is real and shipped — verified: `dashboard/src/pages/status.tsx`,
route registered at `dashboard/src/app.tsx:499`, backend package `internal/serviceversions/`, tests
present.

Not a blocking collision. M22 does not rebuild M21's panel; it **adds `theo-cloud` itself to it**.
`cmd/main.go:168` enumerates exactly four targets — `theo-memory`, `theo-rag`, `theo-lens`,
`theo-storage`. The service that serves the page is absent from it.

## Step 3 — out-of-scope cross-check

Checked the feature description against all three items in `### Explicitly out of scope`:

| Out-of-scope item | Keywords | Overlap? |
|---|---|---|
| `account_members` / multi-user-per-Account RBAC | account, members, RBAC, multi-user | none |
| JWT major version bump | JWT, version, bump, breaking | none — "version" here means token schema, not build metadata |
| Changing data-plane workspace semantics | workspace, tenant, data-plane, semantics | none |

**Result: no overlap.** The nearest lexical near-miss is "version" in the JWT item; the milestone's
"version" is build provenance (`/v1/version` reporting a commit), an unrelated sense. Recorded as a
checked negative rather than a skipped step.

## Q1 — What is this feature and why NOW?

**Source: derived from audit + operator statement.**

Make `theo-cloud` provably trustworthy end-to-end on the public-dev host, and make it say so on the
page that already exists for exactly that purpose.

Why now, with measurements:

- **There is no quality gate on the path to production.** `publish.yml` declares no `needs` on
  `ci`/`quality`/`security-sast`. Measured over the supportable window: 12 commits published a
  production image while a gate was red; `3daf3663` shipped two images with `ci`, `quality` and
  `Security SAST` all failing. The host converges `:develop` within ~5 minutes, so each went live.
- **The service cannot report what it is running.** `/v1/version` answers `401`, and the host
  reconciler counts that `401` as "provenance converged". The third convergence axis is a false
  green — the exact failure the workspace `CLAUDE.md` warns about.
- **M21's panel exists but omits the one service that serves it.** Adding `theo-cloud` to the target
  list today would render it `unreachable`, because of the `401` above. The two defects are one.
- **The reference model already solves this next door.** `theo-memory/.github/workflows/publish.yml:143`
  gates publish behind `needs: [guard-release-on-main, gate-ci, gate-contract]` and passes
  `trivy/sign/verify: true` on develop. Same vendored reusable, same parameters — `theo-cloud` simply
  does not pass them. This is unherited configuration, not a platform limit.

## Q2 — Dependencies

**Source: derived.**

**`M21`.** All 21 prior milestones are `[x]`, so any dependency is satisfied at declaration time and
most would be decorative — M21's own text makes that argument about itself. M21 is named anyway
because it is a *substantive* dependency: M22 extends the aggregate M21 built, and if M21's panel
were ever reverted, M22's DoD would be unbuildable rather than merely unordered.

## Q3 — Definition of done

**Source: derived from audit findings, narrowed by operator scope decision.**

Scope decision (operator, stated): **one milestone, covering only what this repository can close by
itself.** Cross-repo and owner-level items are recorded as out of scope with their destination.

DoD is in the milestone block. Every bullet is mechanically verifiable from this repo or from a
`gh`/HTTP call against the public-dev environment.

## Q4 — Top 2 NEW risks

**Source: derived.**

1. **Gating `publish` behind the test workflows converts every flaky gate into a blocked deploy.**
   The measured failure rate on develop is high, and the audit attributed it to *reproducible* red
   gates rather than non-determinism (`rerun_rate = 0.017`, below the 0.05 floor). So the risk is not
   flakiness — it is that real failures currently invisible to delivery become visible as stopped
   delivery. That is the intended behaviour, and it will feel like a regression the first week.
   Mitigation: land the gate and fix the red gates in the same milestone, not after it.

2. **Adding `theo-cloud` to its own status aggregate creates a self-probe.** The collector runs
   inside the process it would now probe. A naive wiring makes the page's health depend on the very
   request path it is reporting on, and a partial outage could produce a page that hangs instead of
   one that says "degraded". Mitigation: report `theo-cloud` from in-process build metadata rather
   than by issuing an HTTP call to itself, and keep the existing per-target timeout policy untouched
   for the four remote services.

## Step 5 — SOTA delta

**Not run.** `knowledge-base/references/` was intentionally left empty at inception (documented in
the roadmap's `## State-of-the-art references`). The reference for this milestone is a sibling
repository in the same workspace, `theo-memory`, which is already on disk and already cited with
file:line in the audit. Cloning an external peer to study a pattern that exists internally would be
the opposite of parsimony.

## Operator decisions recorded

| Decision | Value |
|---|---|
| Scope | One milestone, this repo only; cross-repo + owner items → out of scope with destination |
| `GOMOD_TOKEN` rotation | **Immediate action, outside the milestone.** Past Actions caches already hold the token; waiting for a milestone to close keeps the exposure open. The milestone covers only the `Dockerfile` fix that prevents recurrence. |
