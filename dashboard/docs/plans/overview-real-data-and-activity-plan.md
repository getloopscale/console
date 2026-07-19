---
slug: overview-real-data-and-activity
milestone: overview-batch (P0+P1+P2+P3)
created_at: 2026-07-19
goal: Rebind the Overview page to real backend data and add a deploys-activity view — measured by 4/4 Usage rows bound to real /v1/billing keys (was 0/5), a rendered 7-day deploys sparkline from real stats, a working "View all" projects affordance, and zero dead affordances.
---

# Overview — real-data + activity overhaul (P0+P1+P2+P3)

## Goal

Make the authenticated home (`/rag`-adjacent `/overview`) honest and useful: every panel reads real backend data, the page answers "what happened recently", and no affordance is decorative.

## Context / DISCOVER findings (evidence)

Deep review of `src/pages/overview.tsx` + the cloud/engine backends:

- **P0 — Usage panel is fabricated.** `overview.tsx:85-89` reads billing keys `Fast Data Transfer`, `Fast Origin Transfer`, `Edge Requests`, `Build Minutes`, `Concurrent Builds`. The cloud handler `internal/routes/billing.go:321-322` (`getLimitsForPlan`) only emits `projects`, `builds_per_month`, `environments`, `seats`, `secrets_per_env`, `services_per_project`; `getUsageForTenant` (`billing.go:358`) fills those from `usage_records`. `pickMetric` returns `{value:0, max:default}` for every missing key → the whole panel shows hardcoded zeros for every tenant, forever. Vercel-mockup vocabulary that never bound to Theo's real metered dimensions.
- **P1 — No "what happened" view; but the data already exists.** `useBuildStats('7d')` already exposes `byDay: BuildStatsDay[]` (dense, zero-filled, UTC-bucketed) from `GET /api/v1/builds/stats`; its own docstring says it feeds "the Overview 'Deploys (7d)' KPI + the deploys-by-day sparkline" — the sparkline was intended but never rendered. A per-event cross-project feed is NOT possible without a new engine endpoint (`router.go` has only `/builds/{id}`, `/builds/stats`, `/projects/{name}/builds`) — building a client fan-out would be an N+1 workaround (FORBIDDEN). The stats series is the real, available signal.
- **P2 — Projects preview dead-ends at 3.** `overview.tsx:207` `filteredProjects.slice(0,3)` with no "View all" and a header search that filters but still caps at 3 (a 4th match is invisible).
- **P3 — Dead affordances.** `overview.tsx:124` "Upgrade" is a static `<Badge>` (looks clickable, does nothing). KPI cards are static text (no drill-down).

## ADRs

- **ADR-1 — One cohesive milestone, one release (NOT four).** All four items edit the same `overview.tsx`. Four separate release PRs would serially re-touch the same file → merge churn + re-work, violating "sem re-trabalho". FAANG practice is one cohesive PR per screen-level feature. Rejected alternative: 4 micro-releases (more ceremony, worse history, same-file conflicts).
- **ADR-2 — P1 is a deploys-activity sparkline from real stats, not a per-event feed.** A per-event cross-project feed needs a new engine endpoint (Go, `theo/` repo, engine deploy, T2 governance) OR a client fan-out (N+1 workaround). Both are out of scope / forbidden. The `byDay` series is real data already exposed. Rejected: fan-out (workaround), new endpoint (scope creep into engine repo).
- **ADR-3 — P0 shows account-level caps only (Projects, Builds this month, Environments, Seats).** `secrets_per_env` / `services_per_project` are per-scope limits, not account totals — aggregating them into one meter is misleading. Show the 4 account-level metrics honestly. `limit===null` → "Unlimited" (enterprise), preserved from the existing `fmtMetric`.

## Tasks (each: RED -> GREEN -> REFACTOR -> WIRING -> COMMIT)

### T-P0 — Rebind Usage to real backend keys
- Files: `src/pages/overview.tsx`, `src/pages/overview.test.tsx`.
- TDD RED: mock `useCloudApi('/v1/billing')` -> `{usage:{projects:{used:2,limit:3}, builds_per_month:{used:37,limit:100}, environments:{used:2,limit:1}, seats:{used:1,limit:1}}}`. Assert Usage renders rows "Projects" (2 / 3), "Builds this month" (37 / 100), "Environments" (2 / 1), "Seats" (1 / 1); assert NO row "Fast Data Transfer"/"Edge Requests".
- Acceptance: 4/4 rows bound to real keys; over-quota (used>limit) still renders numeric; `limit:null` → "Unlimited".

### T-P1 — Deploys activity (7-day bars) from real stats
- Files: `src/components/overview/deploys-activity.tsx` (NEW) + test, wired into `overview.tsx`.
- TDD RED: given `byDay=[{date,count}...]` (7 entries), renders 7 bars with accessible labels ("N deploys on YYYY-MM-DD"); empty/zero series renders a "No deploys in the last 7 days" state; loading renders a skeleton; error renders nothing (honest, no fabricated zeros as data).
- Acceptance: bars reflect the real `byDay` counts; total matches the "Deploys (7d)" KPI.

### T-P2 — Projects "View all (N)" + honest search
- Files: `src/pages/overview.tsx`, `src/pages/overview.test.tsx`.
- TDD RED: with 5 projects, renders 3 ProjectCards + a "View all N projects" link to `/projects`; when a search query is present, the link carries the query (`/projects` navigation) and the count reflects filtered matches.
- Acceptance: link present iff `filteredProjects.length > 3`; navigates to `/projects`.

### T-P3 — Kill dead affordances
- Files: `src/pages/overview.tsx`, `src/components/overview/overview-kpi-strip.tsx` + tests.
- TDD RED: "Upgrade" is a link/button navigating to `/billing` (role, not a static Badge). KPI cards Projects/Active envs/Plan are links (Projects→/projects, Active envs→/environments, Plan→/billing); Deploys(7d) is non-navigating (no dedicated page) OR links to nothing — keep as static.
- Acceptance: 0 dead affordances; Upgrade + 3 KPI drill-downs navigate.

## Coverage Matrix

| Finding | Task | Test |
|---|---|---|
| P0 fabricated usage | T-P0 | overview.test real-keys + no-fake-keys |
| P1 no activity view | T-P1 | deploys-activity.test bars/empty/loading |
| P2 projects dead-end | T-P2 | overview.test view-all link |
| P3 dead affordances | T-P3 | overview/kpi-strip test upgrade + drill-down links |

## Global DoD
- [ ] typecheck 0 errors, ESLint 0 warnings on touched files
- [ ] full vitest suite green (no regressions)
- [ ] production build GREEN
- [ ] LIVE deploy to app-dev + functional proof (real /v1/billing usage keys bound; sparkline renders)
- [ ] benchmark table (usage-keys real 0/5 -> 4/4; dead affordances 2 -> 0; bundle delta; new tests)
- [ ] /release develop->main PR + self-merge + tag

## Benchmark plan
- Data correctness: LIVE `GET /v1/billing` (JWT) → confirm real keys; assert UI binds them (before 0/5 real, after 4/4).
- Dead affordances: 2 → 0.
- Bundle: raw total JS kB before/after (baseline 2723 kB).
- Tests: Overview coverage before (13) / after.
