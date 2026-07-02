# Theo Lens — cloud module (pointer)

This repo gets a **Lens** module mirroring the **Memory** vertical slice, talking HTTP-only to the
`theo-lens` service (`theo-data/theo-lens`). It is **Workstream B** of a two-repo program.

**Canonical handoff / spec (both workstreams):**
`theo-data/theo-lens/docs/cloud-lens-module-handoff.md`

## Prerequisite
Workstream B's real tenant isolation depends on **Workstream A** — `theo-lens` M22 (auth +
`workspace_id` + scope-in-path + admin-key minting), in the `theo-data` repo. Ship A first.

## RUN 2 here (after A merges)
From a session rooted at this repo, on `develop`:
```
/auto-plan "theo-cloud-lens-module"
```
Cite the canonical handoff § 4 as prior art. The file checklist (22 files), the `openapi/thelens.yaml`
seam contract, the dual route surface (`/v1/lens/*` Bearer + `/v1/dashboard/lens/*` JWT), the PG
schemas, and the dashboard scope (**Landing + TraceList**, TraceDetail deferred) are all in § 4 there.

## Locked decisions
UI = Landing + TraceList · tenancy = exact `theo-memory` convention · mirror everything
(webhooks/exports/worker) · both repos A→B · full Cycle 6+1 loop. Do not re-litigate — see the
canonical handoff § 1.

## Design assets already in-repo
`dashboard/docs/theo-lens/` — Violet Forge `@theokit/ui` bundle + the **TraceList** template
(the v1 dashboard target).
