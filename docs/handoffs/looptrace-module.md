---
type: Handoff
title: LoopScale Lens — cloud module
description: Pointer to the canonical two-repo handoff for the Lens module, which mirrors the Memory vertical slice and talks HTTP-only to the looptrace service.
tags: [lens, handoff, workstream, memory-mirror]
generated: { by: claude-opus-5/okf-export, at: 2026-08-05 }
status: stable
sources:
  - id: repo-history
    resource: docs/looptrace-module-handoff.md
    title: LoopScale Lens cloud module pointer, at its pre-bundle path in this repository
    last_modified: 2026-07-02
---

> **Layout note (2026-08).** The `loopscale-data` monorepo no longer exists. Read every
> `loopscale-data/<x>` path below as the standalone sibling repo `loopscale-platform/<x>`
> (e.g. `loopscale-data/looptrace` → `loopscale-platform/looptrace`).


# LoopScale Lens — cloud module (pointer)

This repo gets a **Lens** module mirroring the **Memory** vertical slice, talking HTTP-only to the
`looptrace` service (`loopscale-data/looptrace`). It is **Workstream B** of a two-repo program.

**Canonical handoff / spec (both workstreams):**
`loopscale-data/looptrace/docs/cloud-lens-module-handoff.md`

## Prerequisite
Workstream B's real tenant isolation depends on **Workstream A** — `looptrace` M22 (auth +
`workspace_id` + scope-in-path + admin-key minting), in the `loopscale-data` repo. Ship A first.

## RUN 2 here (after A merges)
From a session rooted at this repo, on `develop`:
```
/auto-plan "loop-console-lens-module"
```
Cite the canonical handoff § 4 as prior art. The file checklist (22 files), the `openapi/looptrace.yaml`
seam contract, the dual route surface (`/v1/lens/*` Bearer + `/v1/dashboard/lens/*` JWT), the PG
schemas, and the dashboard scope (**Landing + TraceList**, TraceDetail deferred) are all in § 4 there.

## Locked decisions
UI = Landing + TraceList · tenancy = exact `loopmem` convention · mirror everything
(webhooks/exports/worker) · both repos A→B · full Cycle 6+1 loop. Do not re-litigate — see the
canonical handoff § 1.

## Design assets already in-repo
`dashboard/docs/looptrace/` — Violet Forge `@getloopscale/loopzero-ui` bundle + the **TraceList** template
(the v1 dashboard target).

- Vertical slice this module mirrors, and the governance it inherits:
  [`governance/dashboard`](/governance/dashboard.md) (Memory Section invariants and dashboard scope).
