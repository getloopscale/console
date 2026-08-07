---
slug: standard-modal-component
generated_by: roadmap-feature
milestone_id: M14
date: 2026-07-18
status: completed
---

# Feature grill — standard-modal-component (M14)

Requirements were resolved during the immediately-preceding Wiki-redesign conversation
(two decisions locked via AskUserQuestion), so the 4 grill answers are synthesized from
that just-made decision rather than re-interviewing (don't re-litigate decided things).

## Q1 — What is this feature and why now?

Make "modal" the system-wide standard for transient action screens by shipping ONE
reusable componentized modal (`AppModal`) on top of the `@usetheo/ui` `Dialog`, and route
the Wiki's action screens through it. **Why now:** the Wiki redesign just shipped with
New folder / Search / New page as ad-hoc surfaces (New page in a side pane); the sponsor
wants all such action screens to be a single standardized modal so the system does not
diverge per-screen ("CRIE ALGO COMPONENTIZADO ... PADRÃO DE TODO O SISTEMA").

## Q2 — Dependencies (which milestones must be [x])?

None blocking. Foundational UI infra: the dashboard + `@usetheo/ui` `Dialog` already
exist; applied to the Wiki first (RAG dashboard surfaces exist). Workspace + remaining
screens roll onto `AppModal` in follow-up passes.

## Q3 — Definition of Done

See M14 block in ROADMAP.md (6 bullets): reusable `AppModal` + tests; Wiki New folder /
New page via AppModal (New page leaves the side pane); `NewFolderDialog` rebuilt on
AppModal (shared with Workspace, no Workspace page change); reading/editing stays in the
split; typecheck/lint/tests/build green; LIVE-validated on dev-public.

## Q4 — Top 2 new risks

1. `NewFolderDialog` is shared with Workspace — rebuilding on AppModal could ripple a
   regression. Mitigation: preserve props/behavior; full test suite is the net; defer
   other Workspace screens.
2. Focus trap/restore (a11y) + PWA SW stale-bundle after deploy. Mitigation: build on the
   design-system Dialog (a11y-correct); verify served bundle hash + hard-reload.

## Scope decisions (locked via AskUserQuestion, this session)

- **Modal scope:** only ACTION screens (New folder, New page, Search) become modal;
  reading/editing an existing page stays in the master-detail split.
- **Rollout:** reusable component + apply to the Wiki now; Workspace + other screens later.

## Out-of-scope cross-check

No overlap with ROADMAP.md `### Explicitly out of scope` (those are tenancy/JWT items).
No milestone-name collision.
