---
slug: m20-environments-as-project-dimension
milestone_id: M20
created_at: 2026-07-19
goal: Re-home environment management from the confusing global /environments page into the project context — measured by env create/promote/delete being scoped to the route project (the project-guess deleted), the global nav item gone, and /environments redirecting.
---

# M20 — Environments as a project dimension

## Goal
Fix the System-Design defect: `/environments` is a global top-level page that mixes every project's envs and GUESSES the project for mutations. Move it into the project, where the domain scopes it.

## DISCOVER findings (evidence)
- `app-sidebar.tsx:108` — `/environments` is a top-level nav item (peer of Projects).
- `environments.tsx:114` — project guessed: `?project=` ?? first-project ?? the `'teste'` fixture; used for create/promote/delete.
- Backend `GET /api/v1/environments` = `ListEnvironments(tenantID)` — tenant-wide (cross-project). Namespace is `theo-<tenant>-<project>-<env>` (env is per-project).
- The other nine per-project surfaces are already `/projects/:name/*` (secrets, scale, logs, status, deployments, previews, readiness, connect, repository). Environments is the odd one out.
- `overview-kpi-strip.tsx:66` — the "Active envs" KPI links to `/environments`.
- Blast radius of removing `/environments`: sidebar (1), route (1), KPI link (1).

## ADR-1 — Scope refinement: re-home now, cross-surface switcher deferred (KISS + bottleneck)
The roadmap M20 DoD item "a project-level environment switcher is the single source of the active environment, read by secrets/domains/scale/logs/deployments" is REFINED OUT of M20 for three evidence-based reasons:
1. **No shared project layout.** The `/projects/:name/*` routes are flat siblings (verified `app.tsx:381-437`); a switcher read by all surfaces needs a shared layout (Outlet + env context) wrapping ~9 routes — a structural routing refactor, high-risk to the deploy journey.
2. **Domains does not fit** a page-scoped-by-env model — it is a flat list with a per-row env, not a surface you "scope to one env".
3. **KISS / "simple to use"** — the user's north star is simplicity. The real defect is env-as-global-page + project-guess. Re-homing fixes that. A 9-route switcher refactor is ambition, not simplicity.
The env switcher across surfaces becomes an explicit future enhancement (a follow-up milestone if desired). Rejected alternative: introduce the shared layout + switcher now (risk + scope-creep, violates "sem re-trabalho / 100% funcional").

## Tasks (TDD each)
- **T1** — Project-scoped environments page: `environments.tsx` takes the project from the route param (`useParams().name`), DELETING the `?project=`/first/`'teste'` guess; filters the env list to the route project; create/promote/delete pass the route project. Files: `environments.tsx` + test.
- **T2** — Routing: `app.tsx` adds `/projects/:name/environments` (ProjectGuard) and replaces the global `/environments` route with `<Navigate to="/projects" replace />` (redirect, no bookmark 404). Files: `app.tsx` + a redirect test.
- **T3** — Nav: remove `Environments` from the sidebar main group; point the Overview "Active envs" KPI at `/projects`. Files: `app-sidebar.tsx`, `overview-kpi-strip.tsx` + tests.
- **T4** — Discoverability: add an "Environments" link on the project-detail page (alongside Deployments/Connect). File: `project-detail.tsx`.

## Coverage Matrix
| Finding | Task |
|---|---|
| env global top-level page | T2 + T3 |
| project guess in mutations | T1 |
| KPI links to removed page | T3 |
| env unreachable from project | T4 |
| cross-surface switcher | ADR-1 (deferred) |

## Global DoD
typecheck 0 · ESLint 0 · full suite green · build green · LIVE on app-dev (env create/promote/delete from `/projects/:name/environments`; global nav gone; `/environments` redirects) · benchmark · /release + self-merge + M20 checkbox flip.
