---
slug: deploy-journey-hardening
generated_by: roadmap-feature
status: completed
date: 2026-07-19
milestones: [M15, M16, M17, M18, M19]
source: deploy-journey review 2026-07-19 (5 parallel specialist agents over ~16 surfaces)
---

# Grill — Deploy-journey hardening (M15–M19)

Requirements were NOT interactively grilled: they are fully specified by the
2026-07-19 deploy-journey review, which produced file:line evidence + severity +
a suggested fix for every finding. 95% confidence is met via that review, so the
milestones' DoD/deps/risks are derived directly from the evidence.

## Q1 — What / why now
Deploy-journey review (5 agents, ~16 surfaces) surfaced 1 BLOCKER + ~9 HIGH,
clustered into 5 themes. Same "fabricated data" defect class as the Overview
Usage bug just fixed in v0.60.0 — worth closing before it erodes user trust.

## Q2 — Dependencies
All five depend on M14 (AppModal + the shipped dashboard baseline). No new backend
endpoints — every rebound field already exists on the status/billing wire.
M19 (cleanup) is logically last (others also touch deployment-detail).

## Q3 — Definition of done
Per-milestone DoD checklists live in ROADMAP.md § M15–M19 (verifiable: TDD, gates
green, LIVE-validated on app-dev, no fabricated values, grep-clean for Sheets/terms).

## Q4 — Top new risks
Captured per milestone in ROADMAP.md (honest fallback vs fabrication; endpoint
contract verification; AppModal API delta; over-friction on rollback; deleting the
right duplicate surface).

## Out-of-scope cross-check
Checked ROADMAP.md § "Explicitly out of scope" (account_members/RBAC, JWT bump,
data-plane workspace semantics) — NO overlap with these dashboard deploy-journey
UX/bug milestones. No item removed.
