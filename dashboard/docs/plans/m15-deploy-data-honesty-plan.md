---
slug: m15-deploy-data-honesty
milestone_id: M15
created_at: 2026-07-19
goal: Rebind fabricated/hardcoded values in the deploy journey to real backend data — measured by the Scale page showing the true current replica count, the Alerts signal reflecting real alerts_active, no fabricated cascade counts, and no hardcoded repoUrl.
---

# M15 — Deploy-journey data honesty

## Goal
Every number the deploy journey shows must be real. Same defect class as the Overview Usage fix (v0.60.0).

## DISCOVER findings (evidence)
- `project-scale.tsx:20,55,82` — `DEFAULT_CURRENT_REPLICAS = 2` hardcoded into `replicas` + `currentReplicas`; `useProjectStatus` (`:70`) already fetches `status.scaling.replicas` + `status.replicas_desired` (`types.ts:485,531`). Cost card (`:234`) + confirm impact render the fake "2".
- `project-status.tsx:213` — `alerts_active` hardcoded `null`; `status.alerts_active` exists (`types.ts:491`).
- `delete-environment-dialog.tsx:18-20` + `environments.tsx` — cascade counts fabricated: page passes `workloads: deleteTarget.projects` (projects ≠ workloads) and never secrets/domains; NO `GET /environments/:name/cascade-preview` endpoint exists (`:14`).
- `deployment-detail-layout.tsx:148` — `repoUrl: null` hardcoded into `DeployTimelineHero`.

## ADR — keda-flag deferred to M16 (bottleneck / anti-rework)
DISCOVER revealed there is NO backend field for "cluster KEDA installed" — the server enforces scale-to-zero availability at apply-time via 422 (`use-scale.ts:21`). The hardcoded `clusterKedaInstalled=true` lives in `keda-toggle.tsx`, the SAME component whose "KEDA is not installed on this cluster" copy is M16's Rule-3 term-leak fix. Fixing the flag in M15 and the copy in M16 would touch `keda-toggle.tsx` twice (re-work, forbidden). DECISION: handle the whole KEDA surface in M16 (flag + copy together). M15 keeps the 4 unambiguous real-data items. Rejected: fail-closed default in M15 (would hide a working feature; no real signal to source from).

## Tasks (TDD each)
- **T1 (BLOCKER)** — Scale seeds `currentReplicas`/`replicas` from `status.scaling?.replicas ?? status.replicas_desired`, falling to a neutral default only when both absent. Cost + confirm reflect the real value. Files: `project-scale.tsx` + test.
- **T2** — `project-status.tsx` binds `alerts_active: status.alerts_active ?? null`. File + test.
- **T3** — `delete-environment-dialog` renders NO fabricated numeric cascade; keeps the qualitative warning. `environments.tsx` stops passing `workloads: projects`. Files + tests.
- **T4** — `deployment-detail-layout` no longer passes hardcoded `repoUrl: null`; drop the dead prop/affordance (no real source). File + test.

## Coverage Matrix
| Finding | Task |
|---|---|
| Scale fake replicas (BLOCKER) | T1 |
| alerts_active null | T2 |
| fabricated cascade counts | T3 |
| hardcoded repoUrl | T4 |
| keda-flag | → M16 (ADR) |

## Global DoD
typecheck 0 · ESLint 0 · full suite green · build green · LIVE on app-dev (Scale shows true replica count via a real project) · benchmark · /release + self-merge.
