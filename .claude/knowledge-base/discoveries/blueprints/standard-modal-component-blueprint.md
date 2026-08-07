# Blueprint — System-wide standardized modal component (AppModal) — M14

Date: 2026-07-18
Cycle: DISCOVER output for milestone M14.
Scope reference: `ROADMAP.md § M14`, `knowledge-base/grills/standard-modal-component-feature-grill.md`.

## Objective

Design ONE reusable, componentized modal primitive (`AppModal`) that becomes the
system-wide standard for transient action screens, applied to the Wiki first.

## Prior art (evidence)

- **`@usetheo/ui` `Dialog` is built on `@radix-ui/react-dialog`** — `node_modules/@usetheo/ui/dist/components/primitives/dialog/dialog.d.ts` imports `* as DialogPrimitive from "@radix-ui/react-dialog"`. Radix Dialog implements the WAI-ARIA dialog pattern: `role="dialog"`, `aria-modal`, focus trap on open, focus RESTORE to the trigger on close, ESC-to-close, overlay-click-to-close, scroll lock. **AppModal delegates all of this — it reimplements none of it (Rule 9 — Don't Reinvent).**
- **Compound API available:** `Dialog` (root: `open`, `onOpenChange`), `Dialog.Content` (`ContentProps extends ComponentPropsWithoutRef<Radix.Content> & { hideCloseButton? }` — so it accepts `className`), `Dialog.Header/Body/Footer/Title/Description/Trigger/Close/Overlay`.
- **The gap AppModal fills:** `Dialog.Content` has NO `size` token — each of ~21 sites that use `<Dialog.Content>` today (inventory below) picks an ad-hoc width. AppModal standardizes `size` (sm/md/lg/xl → `max-w-*`) + the header(title)/body/footer skeleton + controlled `open`/`onClose`.
- **Reference model:** `NewFolderDialog` (`src/pages/new-folder-dialog.tsx`) is the closest existing shape (Dialog + Header/Title/Description + Body + Footer with Cancel/primary). It is shared by `wiki.tsx` AND `workspace.tsx` — rebuilding it on AppModal standardizes both from one edit while keeping its Props identical (no Workspace page change).

## Inventory (the duplication AppModal consolidates)

~21 files construct `<Dialog.Content>` skeletons ad-hoc (measured 2026-07-18):
`components/dialogs/{bulk-delete-projects,cancel-build,delete-environment,plan-limit-upgrade-modal,promote,promote-to-production,redeploy,rollback}`, `components/scaling/scale-dialog`, `components/secrets/{delete-secret,rotate-secret}`, `components/domains/domain-troubleshoot-sheet`, `pages/{api-keys,memory/skills,memory/webhooks,settings/webhooks,rag/connectors,rag/graphrag,lens/traces/saved-views,new-folder-dialog}`. M14 introduces AppModal + converts the Wiki surfaces; the rest roll on in follow-up passes (roadmap-declared).

## Design decision — AppModal contract

A thin opinionated wrapper over `Dialog`:

| Concern | Decision |
|---|---|
| Base | `@usetheo/ui` `Dialog` (Radix) — a11y + focus by delegation |
| Control | `open: boolean` + `onClose: () => void` → `onOpenChange={(o) => { if (!o) onClose() }}` |
| Size | `size?: 'sm'\|'md'\|'lg'\|'xl'` → `max-w-md\|max-w-lg\|max-w-2xl\|max-w-4xl` on `Dialog.Content` |
| Structure | `title` (required ReactNode), `description?`, `children` (body), `footer?` (actions slot) |
| a11y | title → `Dialog.Title` (labels the dialog); description → `Dialog.Description` (describes it) — never omit the title (Radix warns without it) |
| Close button | keep design-system default (`hideCloseButton` opt-out available) |

**Non-goals (KISS/YAGNI):** no new animation, no size beyond 4 tokens, no nested-modal stack manager, no imperative API — controlled props only.

## Bottlenecks (analysed)

1. **Duplication (the real one):** 21 ad-hoc dialogs. AppModal is the dedup primitive. *Benchmark = bytes added by AppModal vs LoC/bytes a converted site drops.*
2. **Bundle size:** AppModal adds NO dependency (reuses Dialog + Radix already bundled). Net add ≈ the wrapper only. Measured in the benchmark.
3. **Render:** modal is a Radix portal sibling → the browser list behind it does NOT re-render when the modal opens. New-page editing inside the modal is isolated.
4. **Focus (a11y):** the editor inside the modal must receive focus under the Radix trap — `autoFocus` on the first input; Radix restores focus to the trigger on close. Edge case covered in tests.

## Coverage of DoD (M14) → where satisfied

| DoD bullet | Satisfied by |
|---|---|
| `AppModal` reusable + tests (open/close, sizes, footer, escape/overlay) | Task 1 |
| Wiki New folder + New page via AppModal; New page leaves the pane; Search stays CommandPalette | Task 3 |
| `NewFolderDialog` rebuilt on AppModal (shared Wiki+Workspace, no Workspace page change) | Task 2 |
| Reading/editing stays in split; browser full-width behind modal | Task 3 |
| typecheck + eslint + full suite + build green | Task 4 (code-quality) |
| LIVE-validated on dev-public + served-bundle-hash match | Task 5 (deploy + proof) |

## References

- `node_modules/@usetheo/ui/dist/components/primitives/dialog/dialog.d.ts` — Dialog compound + Radix base.
- `src/pages/new-folder-dialog.tsx` — reference dialog shape (shared component to rebuild).
- `src/pages/rag/wiki.tsx` — the surfaces to convert (New page in the detail pane → modal).
- WAI-ARIA Authoring Practices — Dialog (Modal) pattern (implemented by Radix Dialog).
