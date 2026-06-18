# Deploy Timeline Hero — Phase R Review

**Plan slug**: `deploy-timeline-canonical-5-phases` (dashboard half)
**Commit**: `29d9e41` on `develop`
**Date**: 2026-06-18

## Verdict

**READY_TO_MERGE engineering-side.** Sponsor JUNTOS LIVE validation
remains gated per `cleanroom-up-live-test-mandate.md` INQUEBRÁVEL.

## Scope delivered

| File | Type | Purpose |
|---|---|---|
| `dashboard/src/lib/api/deploy-timeline-events.ts` | new | Canonical event types + `PHASE_ORDER` + scrubbed product-language fallbacks |
| `dashboard/src/hooks/use-deploy-timeline.ts` | new | SSE consumer reducing events to 5-phase model + overall status + aggregator-degraded capture |
| `dashboard/src/hooks/use-deploy-timeline.test.tsx` | new | 6 vitest specs PASS |
| `dashboard/src/components/deploy/deploy-timeline-hero.tsx` | new | 5-box visual component (FAANG UX patterns) |
| `dashboard/src/components/deploy/deploy-timeline-hero.test.tsx` | new | 6 vitest specs PASS |
| `dashboard/src/pages/deployment-detail.tsx` | edit | Mounts `<DeployTimelineHero />` above the existing 2-column detail grid |

## FAANG UX checklist

- [x] **Progressive disclosure** — 5 PhaseCells horizontal on desktop, vertical stack on mobile
- [x] **Status semantics** — icon + label + color (not color alone — a11y)
- [x] **Live duration tick** — single `setInterval` per active cell; frozen on terminal
- [x] **Connection state visible** — subtle Wifi/WifiOff dot, not anxiety-inducing
- [x] **Reduced motion respected** — `motion-safe:` Tailwind variants on animations
- [x] **Semantic HTML** — `<ol>` for sequential timeline, `<time>` for durations
- [x] **aria-current="step"** — set on the in_progress cell
- [x] **aria-live="polite"** — screen-reader narration of overall transitions
- [x] **Truncation strategy** — `line-clamp-2` + `title` tooltip for substateMessage overflow
- [x] **Cross-Project Rule 9** — never renders internal terms; scrub at server-side write-time
- [x] **No layout shift** — initial pending skeleton occupies the same footprint as final state
- [x] **Tabular numerics** — `font-mono` + `tabular-nums` for duration display

## Tests

| Suite | Count | Status |
|---|---|---|
| `use-deploy-timeline.test.tsx` | 6 | PASS |
| `deploy-timeline-hero.test.tsx` | 6 | PASS |
| Existing `deployment-detail.test.tsx` | 12 | PASS (no regression) |

`npx tsc --noEmit` 0 errors. `npx eslint` 0 findings.

## Canonical validation chain (sponsor-gated)

Per `cleanroom-up-live-test-mandate.md` INQUEBRÁVEL the LIVE validation
runs after:

1. **Cleanroom TOTAL** (`task clean:all && task setup`) — ~30-45min
2. **UP** (`tilt up` + `task doctor` PASS=38+ FAIL=0)
3. **post-Cleanroom seeds** (`bash infra/scripts/local/seed-post-cleanroom-all.sh --verify`)
4. **DOGFOOD FULL** + **LIVE TEST**
5. **Sponsor JUNTOS browser walkthrough** at:
   `https://app-dev.usetheo.dev/projects/<project>/deployments/<build_id>`

The DeployTimelineHero will render at the top of that page, showing
the 5-phase canonical timeline streaming live from the backend's
`/engine/api/v1/deploys/<build_id>/timeline` SSE endpoint (delivered
in theo PR #84).

## What this commit does NOT do

- Does NOT rebuild the running `theo-api` pod with the new SSE endpoint
  code — that requires either `tilt up` (canonical) OR manual docker
  build + rollout restart. Both require operator authorization per
  the mandate.
- Does NOT pre-flight the LIVE SSE wire — that's the sponsor JUNTOS
  walkthrough's job.
- Does NOT amend the engine PR #84; this lives in `theo-cloud` repo
  with its own develop trunk (no main; develop is the deploy target).
