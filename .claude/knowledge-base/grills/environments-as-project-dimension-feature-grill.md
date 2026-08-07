---
slug: environments-as-project-dimension
generated_by: roadmap-feature
status: completed
date: 2026-07-19
milestone_id: M20
source: System Design review 2026-07-19 (environment IA / domain-scope analysis)
---

# Grill — Environments as a project dimension (M20)

Requirements were NOT interactively grilled: they are fully specified by the
2026-07-19 System Design review of the `/environments` screen (evidence:
`environments.tsx:114` project-guess; `app-sidebar.tsx:108` top-level nav;
backend `ListEnvironments(tenantID)` cross-project; namespace
`theo-<tenant>-<project>-<env>`; the nine sibling `/projects/:name/*` surfaces).
95% confidence met via that evidence.

## Q1 — What / why now
`/environments` is the only per-(project,env) dimension modelled as a global
top-level page; it mixes every project's envs and GUESSES the project for
create/promote/delete. Structural IA defect; industry SOTA scopes env to project.

## Q2 — Dependencies
M15–M19 (deploy-journey hardening, all [x]); M17 (AppModal) supplies the modals
re-homed here; M18 already assumes a per-project env model.

## Q3 — Definition of done
In ROADMAP.md § M20 (route re-home to /projects/:name/environments, remove global
nav, delete the project-guess, project-level env switcher unifying per-env
surfaces, read-only cross-project overview if retained, TDD + gates + LIVE).

## Q4 — Top new risks
Route/nav/link migration (mitigation: grep + redirect + suite); env-switcher must
not regress secrets/logs/scale env handling (mitigation: incremental single-source
switcher, production default, before/after tests).

## Out-of-scope cross-check
ROADMAP.md § "Explicitly out of scope" (account_members/RBAC, JWT bump, data-plane
workspace semantics) — NO overlap with a dashboard IA/nav refactor. No item removed.
