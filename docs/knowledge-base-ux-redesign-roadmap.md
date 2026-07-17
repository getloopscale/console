# Knowledge Base — UX Redesign Roadmap

> Complete UX redesign of the dashboard **Knowledge Base** module (the `/rag/*` pages).
> Goal: turn 8 loosely-related tools into **one premium, coherent knowledge workspace** with a
> Notion-style document editor, and retire the cramped right-side slide-over (`Sheet`) pattern.
>
> Status: **PROPOSED** (2026-07-17). Owner: dashboard. Consumes the Cycle 6+1 pipeline —
> each milestone runs `/to-plan → /implement → /review → /release` and is **not done without a
> LIVE Google Chrome proof on `app-dev.usetheo.dev`** (per `.claude/rules/cleanroom-up-live-test-mandate.md`).

---

## 1. Why (the problem)

The Knowledge Base is 8 sub-pages (`Overview, Collections, Documents, Wiki, Ask, GraphRAG, Analytics,
Connectors`) that feel like separate tools bolted together. Three concrete UX failures:

1. **Right-side `Sheet` overload.** Three surfaces slide a cramped (`sm:max-w-2xl`) panel from the right:
   - `wiki.tsx:250-288` — page reader that shows **plain text, not rendered markdown**.
   - `chunks-panel.tsx:59-134` — chunk editor squeezed into the slide-over.
   - `graphrag.tsx:433-469` — community report drill-down.
2. **No real editor.** Wiki page authoring is a plain `<textarea>` (`wiki.tsx`) with OKF frontmatter
   built by a string helper — no blocks, no slash commands, no live feel. The OKF index renders as a
   `<pre>` markdown dump instead of a navigable folder tree, even though OKF pages already carry folder
   paths (`tables/customers.md`, `api/auth.md`).
3. **No unifying mental model.** Each page is its own island; nothing ties Wiki ↔ Documents ↔ Ask ↔ Graph.

## 2. Mental model (the reframe)

> **Knowledge Base = your team's knowledge, organized into Collections.**
> A collection holds **Documents** (ingested sources) + **Wiki pages** (authored) + a **Graph**
> (derived). **Ask** queries across all of it.

The landing becomes the collections **home** (pick/see a collection + KPIs + quick actions: *New page*,
*Upload*, *Ask*). The Wiki becomes a **document workspace** (left folder/page tree from OKF paths, main
canvas is the page). Product language only — never expose `vector`, `pgvector`, `S3`, `bucket`, `chunk-embedding`
internals in user-facing copy (Unbreakable **Rule 3**). "Chunk" stays (it is a real, user-facing editing unit).

## 3. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Block editor library | **TipTap** (headless) | Renders 100% in `@usetheo/ui` (dark / purple), biggest ecosystem, full control of slash menu / bubble menu / drag handles. We build the menus on our own primitives so it looks like **Theo**, not like a vendor editor. Trade-off vs BlockNote (faster but Mantine UI) accepted for design-system fidelity. |
| Wiki read/edit surface | **Full-page route** `/rag/wiki/:collectionId/:pageId` (+ `/new`) | Rich, multi-step authoring belongs on a full page; a modal would block reference to source content (UX research: modals for concise/confirm tasks only). |
| Chunk editing | **Full-page** document detail `/rag/documents/:id`, chunks **inline-editable** | High-frequency, repetitive technical edits favor in-place editing over any overlay. |
| GraphRAG report | **Modal (`Dialog`)** with the graph visible behind a semi-transparent overlay | Concise, read-only drill-down = modal; keeps spatial context of the map. |
| Raw OKF YAML | **Never shown to users** | Metadata (type/tags/description/path) is edited in a friendly rail; YAML is serialized on save. |
| Save model | **Autosave** (debounced) + optimistic tree updates + "Saved · now" affordance | Notion-grade feel; explicit discard uses a confirmation modal only. |
| Page lifecycle contract | **Land update / rename-move / delete first (KB0)** | The Notion editor cannot edit, move, or delete pages on a create-only API. This is a governed (T2) contract change spanning theo-rag + BFF; it leads the roadmap so it never blocks the editor. |

## 4. Information architecture & navigation

- Sidebar keeps the **Knowledge Base** drill-in (`app-sidebar.tsx`), but the sub-nav is reframed around
  the mental model: **Home** (collections) · **Wiki** · **Documents** · **Graph** · **Ask** · **Analytics** · **Connectors**.
- Collection is a **first-class context** carried across sub-pages (pick once, persists) instead of a
  per-page `Select` re-picked everywhere.
- The Wiki workspace has its own **left folder/page tree** (built from OKF `path`) as the primary nav
  inside the canvas — this replaces the `<pre>` index.

## 5. The Notion-style editor (centerpiece — KB3)

- **Regions:** left folder/page tree · center canvas · right "Details" rail (collapsible).
- **Canvas:** breadcrumb (Collection / folder / page) → **title as H1** ("Untitled" placeholder) → block
  canvas. Slash `/` menu (heading, list, checklist, code, table, quote, callout, divider), markdown
  input rules (`# `, `- `, `` ``` ``, `> `), bubble menu on selection (bold/italic/code/link), drag handles.
- **Details rail (OKF, no YAML):** Type = `Select` (concept/metric/runbook/…), Tags = chips, Description =
  short textarea, Folder/path = breadcrumb-editable.
- **Read ↔ Edit:** page opens **read-first** (rendered markdown, prose typography ~68ch measure, code
  blocks with `CopyButton`, callouts); "Edit" flips to the block editor. Autosave on edit.
- **Empty state:** big friendly CTA + **templates** (Concept / Runbook / API reference) that pre-seed the
  OKF type + a skeleton of blocks.
- **Serialization:** editor ⇄ OKF markdown must round-trip losslessly (frontmatter + body). Golden test
  fixtures per block type; the editor produces the OKF content string consumed by the page lifecycle API (KB0).

## 6. Signature "premium" details

1. **Cmd+K** command palette scoped to KB (*New page*, *Go to page*, *Ask…*, jump to any doc).
2. **Slash menu** — keyboard-first, icon-grouped (Basic / Media / Advanced).
3. **"Ask this page"** affordance in the editor (wires Wiki ↔ Ask, citation-backed).
4. **Hover peek** — preview card when hovering a page in the tree.
5. **Autosave micro-interaction** — "Saving… ✓ Saved", never a blocking modal.

---

## 7. Milestones

Dependency order: **KB0 (contract) ∥ KB1 (frontend foundations)** run in parallel at the start; KB2 needs
KB1; KB3 (editor) needs KB1 **and** KB0; KB4/KB5/KB6/KB7 parallelizable after KB1; KB8 needs KB0 (rename/move)
and closes the cross-cut. Each milestone ships behind a LIVE Chrome proof.

### KB0 — Wiki page lifecycle contract (backend — leads the roadmap)
**Objective:** Close the create-only gap so the editor can **update**, **rename/move** (change OKF path),
and **delete** wiki pages.
**Scope:** *Investigate first* — confirm what already exists (theo-rag upserts by `external_id`, so
**content update may already work** via re-POST; the real gap is likely explicit rename/move + delete).
Then land, end-to-end: theo-rag endpoints (`PATCH`/`PUT` page content + OKF metadata; rename/move that
rewrites `path`; `DELETE`), BFF proxies in `internal/rag/data_client.go` + `internal/routes/rag_dashboard.go`
(`UpdateWikiPage` / `MoveWikiPage` / `DeleteWikiPage`), and the dashboard data-client hooks.
**Governance:** T2 contract change (theo-rag + BFF) — ADR + review per `pre-release-governance.md`.
**DoD:** update a page's body + metadata via API (OKF round-trips); rename/move changes `path`; delete
removes it; idempotency preserved. **LIVE:** exercise update/move/delete over `okf-grouping-demo` (curl or
dashboard) with a Chrome/HTTP proof.

### KB1 — Frontend foundations (parallel start; blocks all UI work)
**Objective:** Establish the redesign substrate so every later UI milestone drops in cleanly.
**Scope:** reading/prose design tokens (type scale, measure, spacing, callout/code styling in `@usetheo/ui`
idiom); **TipTap spike + wrapper** (`<KbEditor>` headless config: StarterKit + tables + code + slash menu +
bubble menu, all styled with our primitives); full-page route scaffolding (`/rag/wiki/:collectionId/:pageId`,
`/rag/documents/:id`); scaffolding to retire the 3 Sheets (feature-flag or route swap).
**DoD:** TipTap renders a sample OKF doc in Theo styling; new routes resolve; deps audited (`/deps-audit`);
no visual regression on untouched pages. **LIVE:** editor shell renders on `app-dev`.

### KB2 — Wiki workspace (read)
**Objective:** Replace the wiki `Sheet` with a full-page read workspace + real folder tree.
**Scope:** left folder/page tree from OKF `path` (collapsible folders, "+ New page" per folder) — replaces
the `<pre>` index; full-page **read** view with **rendered markdown** (sanitized) + prose typography; page
peek; empty state.
**DoD:** `wiki.tsx` Sheet removed; markdown renders (not plain text); tree groups by folder identically to
`buildOkfIndex`; XSS-safe render. **LIVE:** open `okf-grouping-demo`, see the grouped tree + a rendered page.

### KB3 — Notion editor (create/edit) — centerpiece
**Objective:** Effortless block authoring, OKF metadata without YAML.
**Depends on:** KB1 (editor shell) + KB0 (update endpoint).
**Scope:** TipTap block editor (slash, markdown shortcuts, tables/code/callout), title-as-H1, Details rail
(Type/Tags/Description/path), **autosave** (via KB0 update), templates, edit↔read toggle.
**DoD:** create + edit a page end-to-end via blocks; editor ⇄ OKF markdown round-trip golden tests pass;
autosave + optimistic tree update. **LIVE:** create a page with headings/list/code + tags via the editor,
then edit it; it appears in the tree + is Ask-searchable.

### KB4 — Documents + Chunks redesign
**Objective:** Retire the chunk `Sheet`; make ingestion + chunk editing first-class.
**Scope:** full-page document detail `/rag/documents/:id` with **inline-editable chunks** (edit → save →
re-embed, with status), upload/paste ingest UX polish, status affordances (processing/ready badges,
polling), delete via `ConfirmDialog`.
**DoD:** `chunks-panel.tsx` Sheet removed; chunk edit re-embeds inline; ingest states legible. **LIVE:**
upload a doc, edit a chunk inline, confirm re-embed.

### KB5 — GraphRAG redesign
**Objective:** Retire the report `Sheet`; polish the graph experience.
**Scope:** community report → **modal** with the graph visible behind; community panel + focus/collapse
polish; report reading typography.
**DoD:** `graphrag.tsx` Sheet removed; report opens as modal keeping the graph in context. **LIVE:** open a
community report over a real graph.

### KB6 — Ask + Analytics redesign
**Objective:** Make querying and observability feel premium.
**Scope:** Ask as citation-first surface (strategy selection legible, sources as cards, "ask this page"
entry point); Analytics visual pass (metric hierarchy, per-collection scale progressive disclosure).
**DoD:** Ask sources render as navigable cards; analytics hierarchy scannable. **LIVE:** ask a question,
follow a citation; view per-collection scale.

### KB7 — Collections + Connectors + Landing (cohesion)
**Objective:** Unify the module into one home.
**Scope:** KB **landing = collections home** with quick actions (New page / Upload / Ask); collections
management polish; connectors flow polish (already modal); carry the collection context across sub-pages.
**DoD:** landing ties the 8 surfaces; collection context persists; connectors flow unchanged functionally.
**LIVE:** land → pick collection → jump to Wiki/Documents/Ask without re-picking.

### KB8 — Delight & accessibility (closing cross-cut)
**Objective:** Keyboard-first, memorable, accessible across the whole module.
**Depends on:** KB0 (rename/move for tree drag).
**Scope:** **Cmd+K** palette, **Ask-this-page**, **hover peek**, **drag-to-reorganize** the folder tree
(updates OKF path via KB0 move), full keyboard pass, mobile/responsive, a11y audit (focus order, roles, contrast).
**DoD:** Cmd+K works; tree drag updates path; a11y checks pass; mobile usable. **LIVE:** full-module walk-through.

---

### Phase 2 — Notion-grade polish (KB9-KB14)

Added 2026-07-17 after KB0-KB8 shipped: the wiki structure was sound but the reading/editing surface still felt flat ("desconfigurado"). Phase 2 makes the prose and the editor feel like Notion.

- **KB9 — Prose engine (the fix).** Install + `@plugin` the `@tailwindcss/typography` engine under Tailwind v4 (was missing → `prose` classes generated nothing) and bind an unlayered Notion-grade theme to the design tokens: heading scale, bordered/zebra tables, chip inline-code, panelled code blocks, task-list checkboxes. DoD: compiled bundle contains `.prose` rules; rendered markdown shows distinct heading hierarchy + bordered table + code panel (LIVE render proof).
- **KB10 — Blocks.** Code blocks with syntax highlighting + copy button; callouts/quotes styled; images/links polished. DoD: a fenced code block renders highlighted with a working copy control.
- **KB11 — Notion editor affordances.** Slash `/` menu to insert blocks, bubble menu on selection, `+ add block` control. DoD: typing `/` opens an insert menu; selecting text shows a formatting bubble.
- **KB12 — Editor polish.** Placeholders, interactive checklists, collapsible toggles, auto-focus. DoD: empty editor shows placeholder; a checklist item toggles and round-trips to markdown.
- **KB13 — OKF metadata rail + templates.** Right-hand metadata panel (type/tags/description) + starter templates (Concept/Runbook/API) + autosave indicator. DoD: creating from a template pre-fills body + frontmatter; edits show a saving indicator.
- **KB14 — Read/edit toggle + command palette + final polish.** One-click read<->edit toggle, Cmd+K palette to jump between pages, hover peek on the tree. DoD: toggle switches modes without navigation; Cmd+K opens a page search.

## 8. Global invariants (every milestone)

- **Product language (Rule 3):** no `vector`/`pgvector`/`S3`/`bucket`/`embedding-internals` in user copy.
- **LIVE proof gate:** Cleanroom-or-warm-with-override + Google Chrome proof on `app-dev.usetheo.dev`
  before any `IMPLEMENTATION_COMPLETE`. No delivery without a screenshot of the working behavior.
- **TDD:** failing test first (component + interaction). Markdown render must be XSS-sanitized (negative tests).
- **Contract changes are governed:** KB0 (and any later endpoint) touching theo-rag / BFF is T2 — ADR +
  review per `pre-release-governance.md`. KB2+ are **frontend-only** against the stable `/v1/dashboard/rag/*`.
- **Design fidelity:** built on `@usetheo/ui` primitives; no vendor UI leaking through (TipTap headless).

## 9. Drawbacks & risks

| Risk | Severity | Mitigation |
|---|---|---|
| Page lifecycle contract (KB0) is bigger than expected (rename/move rewrites path everywhere) | HIGH | KB0 *investigates first*; content-update may already exist via `external_id` upsert — scope only the real gap. Governed T2. |
| TipTap slash/bubble/drag menus are non-trivial to build on custom primitives | HIGH | KB1 spike de-risks the wrapper before feature work; budget it explicitly. |
| Editor ⇄ OKF markdown round-trip lossy (tables, callouts, frontmatter) | HIGH | Golden round-trip fixtures per block type in KB1/KB3; fail-closed on unknown blocks. |
| Autosave races / lost edits | MEDIUM | Debounce + version/etag check on save; conflict → confirmation modal (never silent overwrite). |
| Rendered markdown XSS | MEDIUM | Sanitize on render; negative-case tests; no raw HTML passthrough by default. |
| Scope creep across 8 pages | MEDIUM | Strict per-milestone DoD + LIVE gate; KB2/KB3 ship value before touching the rest. |

## 10. Open questions (resolve at `/to-plan` time)

- KB0: does theo-rag's `external_id` upsert already cover **content update**, so KB0 only adds
  **rename/move + delete**? (Confirm in the KB0 investigation step.)
- Folder **reorganize** (drag) — does moving a page rewrite its OKF `path` server-side (KB0 move endpoint),
  or is path client-derived only? (Affects KB8.)
- Templates — stored where (client-static vs a collection of template pages)?

## 11. How to run this

Per milestone, in order of the dependency graph (KB0 ∥ KB1 first):

```
/to-plan "KB<N> — <objective>"   →  /edge-case-plan  →  /deps-audit  →  /plan-confidence
   →  /implement KB<N>   →  /code-quality  →  /review KB<N>   →  /release
   →  LIVE Chrome proof on app-dev.usetheo.dev  (screenshot in the release/knowledge-base)
```

## References (UX research, 2026-07-17)

- TipTap vs Lexical vs Plate — https://trybuildpilot.com/609-tiptap-vs-lexical-vs-plate-editor-2026
- Best Rich Text Editors 2026 (Velt) — https://velt.dev/blog/best-rich-text-editors-react-comparison
- BlockNote — https://github.com/TypeCellOS/BlockNote
- Modal vs Separate Page decision tree (Smashing) — https://www.smashingmagazine.com/2026/03/modal-separate-page-ux-decision-tree/
- Modal UX best practices (LogRocket) — https://blog.logrocket.com/ux-design/modal-ux-best-practices/
- Slideouts, Modals, Overlays (Adobe Commerce) — https://developer.adobe.com/commerce/admin-developer/pattern-library/containers/slideouts-modals-overlays
