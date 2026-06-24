# COMPLETE live-test RE-VALIDATION (post-v0.9.1) — 2026-06-24

Re-ran the full live test against a FRESH stack bring-up of the fixes (real OpenAI). Confirms the 3 gaps + surfaces; surfaced + corrected an F-4 false-confident fix.

## Setup
Fresh `dev/run.sh` bring-up (real OpenAI `text-embedding-3-small`), gateway rebuilt from develop, host vite dashboard, themory v0.22.0.

## Results

| Gap / surface | Live result | Status |
|---|---|---|
| **LT-1** (migrate race) | Fresh bring-up: `themory-migrate` exit 0; themory-mcp boots, NO crash | ✓ CLOSED |
| **F-1** (gateway 4xx→502) | `POST /v1/memory/skills codeLanguage=python` via gateway → **422 INVALID_BODY** with real upstream message (NOT 502) | ✓ CLOSED |
| **F-4** (dashboard sub-nav) | See correction below | ✓ CLOSED (corrected) |
| SDK remember/recall (real) | remember 201; recall cross-lexical "ship containerized apps to a cluster" → ArgoCD/Helm fact **0.4975** | ✓ |
| SDK episodes (`?scope=user`) | 200, items returned | ✓ |
| SDK skills (valid ts) | 201 | ✓ |
| MCP native episodes (v0.22.0) | 8 tools incl `episodes`, real recall (confirmed earlier this session; image unchanged) | ✓ |

## F-4 — false-confident fix CAUGHT live, then corrected (Rule 3)

**v0.9.1 shipped an INSUFFICIENT F-4 fix.** The fix was `navigate(path, { viewTransition: true })` (RR-native), and the unit test asserted the CALL SHAPE — which passed. But driving the real Chrome proved the bug PERSISTED: clicking a Memory sub-nav item changed the URL but left the panel stale on Overview (Overview still `pressed`); only a reload rendered the target.

**Root cause:** `/memory/*` routes are `React.lazy` + `Suspense` with NO `Outlet` (flat sibling routes). ANY View Transition wrapper (raw `document.startViewTransition` OR RR-native `{ viewTransition: true }`) snapshots the old DOM before the lazy chunk commits (React 19 + RR v7) → frozen panel.

**Correction (this session, commit 288dbd9):** revert to PLAIN `navigate(path)` — the proven pre-T5.3 behavior. **Verified live:** clicking Skills (no reload) → Skills panel renders; clicking Episodes (no reload) → Episodes panel renders (after the lazy chunk resolves; the first post-click snapshot raced the async load — a 2nd snapshot confirmed the render). Crossfade animation sacrificed for correctness.

**Test lesson:** the unit test asserting the navigate call shape gave false confidence. Rewrote it to assert plain navigate (path only, no viewTransition arg) as a regression guard against re-introducing any wrapper. The DEFINITIVE proof is the live browser drive — a unit test cannot catch a View-Transition/lazy-Suspense render freeze in jsdom (jsdom has no `startViewTransition`).

## Verdict

**Complete live test PASS across UX + APIs + MCP + SDK** with real OpenAI, on a fresh bring-up of the fixes. F-1 + LT-1 closed as shipped in v0.9.1; F-4 required a correction (committed to develop, verified live) → ship as v0.9.2.

## Follow-up
- **Ship v0.9.2** with the F-4 correction (the v0.9.1 F-4 was a real, now-fixed regression).
- theo-memory: THEMEMORY_SKIP_MIGRATIONS parity in run-mcp-server (unchanged from before).
- Operational: rotate the 3 exposed credentials before production.
