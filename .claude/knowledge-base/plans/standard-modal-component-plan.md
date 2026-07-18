---
slug: standard-modal-component
milestone_id: M14
created_at: 2026-07-18
goal: Ship a reusable AppModal primitive and route the Wiki action screens (New folder, New page) through it, with the full dashboard test suite green and a LIVE-validated served bundle.
---

# Plan — System-wide standardized modal component (AppModal) — M14

## Goal

Ship one reusable `AppModal` (built on `@usetheo/ui` `Dialog`) and route the Wiki's
New folder + New page action screens through it — verified by the full dashboard test
suite green + a served-bundle-hash match on dev-public.

## Baseline Context

| File | State today | LoC | Role |
|---|---|---|---|
| `src/pages/new-folder-dialog.tsx` | ad-hoc `<Dialog.Content>` | 53 | shared New-folder dialog (wiki + workspace) |
| `src/pages/rag/wiki.tsx` | New page in the detail pane (split) | ~380 | the surfaces to convert |
| `src/components/ui/app-modal.tsx` | (NEW) | 0 | the primitive to create |
| `@usetheo/ui` `Dialog` | Radix-based compound | — | the base (delegated, not reinvented) |

Current callers of `NewFolderDialog`: `wiki.tsx`, `workspace.tsx` (props preserved → no Workspace page change).

## ADRs

- **ADR-1: AppModal wraps `Dialog`, does not reimplement a dialog.** Alternative rejected: hand-roll a portal + focus trap — reinvents Radix (Rule 9) and loses the a11y contract. Chosen: thin wrapper delegating to `@usetheo/ui` `Dialog`.
- **ADR-2: New page becomes a modal; reading/editing stays in the split.** Alternative rejected: make everything modal (editing long-form in a modal is worse UX). Chosen (sponsor-locked via AskUserQuestion): only action screens (create/search) modal; existing-page read/edit in the master-detail split.
- **ADR-3: `size` is a 4-token enum, not free `className`.** Alternative rejected: expose raw className for width — defeats standardization. Chosen: `sm|md|lg|xl → max-w-*`; escape hatch `contentClassName` for rare cases.

## Tasks

### Phase 1 — the primitive

#### T1 — AppModal component + tests
- **Files to edit:** `src/components/ui/app-modal.tsx` (NEW), `src/components/ui/app-modal.test.tsx` (NEW).
- **TDD (RED→GREEN):** tests assert — (a) renders `title` as the dialog's accessible name when `open`; (b) not rendered when `open=false`; (c) `size` maps to the right `max-w-*` class; (d) `footer` renders in the footer region; (e) escape / overlay / close-button call `onClose`; (f) `description` renders when provided.
- **Acceptance:** `AppModal` is controlled (`open`/`onClose`), delegates a11y to `Dialog`, exposes `size` + `footer` + `contentClassName`.
- **Concurrency tests:** (none — single-threaded UI component).

### Phase 2 — standardize the shared dialog

#### T2 — Rebuild NewFolderDialog on AppModal
- **Files to edit:** `src/pages/new-folder-dialog.tsx`.
- **TDD:** a test asserts New folder opens (title "New folder"), rejects a name containing `/`, and calls `onCreate` on the primary button / Enter. Behavior + Props interface unchanged (wiki + workspace callers untouched).
- **Acceptance:** internal skeleton now `<AppModal>`; `workspace.test.tsx` + wiki still green.

### Phase 3 — apply to the Wiki

#### T3 — Wiki New page → AppModal; reading stays in split
- **Files to edit:** `src/pages/rag/wiki.tsx`.
- **TDD:** `wiki.test.tsx` (NEW or extended) asserts — New page opens a modal (not the detail pane); on successful create the modal closes and the page opens in the split reader; opening an existing page still uses the split; Search still uses CommandPalette.
- **Acceptance:** `detailOpen = openPageID !== null` (creation no longer forces the pane); NewPageEditor rendered inside AppModal (size xl); browser full-width behind the modal.

### Phase 4 — Integration Validation (the "eat your own cooking" gate)

#### T4 — Code-quality + full gates
- typecheck (`tsc --noEmit`) 0 errors; ESLint clean on changed files; **full dashboard test suite green**; production build green; no dead/orphan export (`app-modal` has a caller).

#### T5 — Benchmark + LIVE proof + release
- Benchmark: AppModal byte cost + dedup (LoC removed from converted sites) + modal mount timing.
- Deploy to dev-public (pull + rebuild); verify the served bundle hash matches the build; wiki API 401 at edge.
- `/release` v0.56.0 (develop→main PR, self-merge, tag), flip ROADMAP M14 `[ ]`→`[x]`.

## Coverage Matrix

| DoD bullet (M14) | Task |
|---|---|
| AppModal reusable + tests (open/close, sizes, footer, escape/overlay) | T1 |
| Wiki New folder + New page via AppModal (New page leaves pane); Search = CommandPalette | T2, T3 |
| NewFolderDialog rebuilt on AppModal (shared, no Workspace page change) | T2 |
| Reading/editing stays in split; browser full-width behind modal | T3 |
| typecheck + lint + full suite + build green | T4 |
| LIVE-validated on dev-public + bundle-hash match | T5 |

## Edge cases (MUST handle)

- EC1 — modal open with `title` missing → forbidden by types (title required); Radix would warn. Types enforce it.
- EC2 — `onClose` must fire on ALL three exits (ESC, overlay, X button) — Radix routes all through `onOpenChange(false)`; tested.
- EC3 — New page create fails (mutation error) → modal STAYS open, error shown inline (no silent close).
- EC4 — focus: first input `autoFocus` inside the modal; on close, Radix restores focus to the trigger.
- EC5 — creating while a page is already open in the split → New page modal overlays; on create, replace the split with the new page.
- EC6 — PWA service worker stale bundle after deploy → verify served hash + hard reload.

## Drawbacks & Risks

1. **Shared NewFolderDialog rebuild ripples to Workspace** (severity: medium). Mitigation: preserve Props + behavior exactly; `workspace.test.tsx` + full suite (1767 tests) is the net. Owner: this cycle.
2. **Focus/a11y regression if AppModal drops a Dialog sub-part** (severity: medium). Mitigation: delegate every a11y concern to Dialog (title/description as Dialog.Title/Description); test the accessible name. Owner: this cycle.

## Unresolved Questions

(none — scope locked via AskUserQuestion this session: only action screens modal; Wiki now, Workspace later.)

## Prior Art & Related Work

`knowledge-base/discoveries/blueprints/standard-modal-component-blueprint.md` (this cycle's DISCOVER output); `@usetheo/ui` Dialog (Radix); `src/pages/new-folder-dialog.tsx` (reference shape).

## Global DoD

- All tasks' tests green; full dashboard suite green; typecheck + lint clean; build green.
- AppModal has a real caller (NewFolderDialog + Wiki) — no orphan export.
- CHANGELOG `[Unreleased]` updated; released v0.56.0; ROADMAP M14 flipped.
- LIVE served-bundle-hash match on dev-public.
