# Changelog

All notable changes to `github.com/usetheodev/theo-cloud` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

### Fixed
- `qa-dogfood-cleanup-2026-06-21` — dashboard slice closing 7 of 11 issues from the
  2026-06-21 QA dogfooding run against `https://app-dev.usetheo.dev`:
    - (#118) `lib/format.ts` adds `isZeroTime()` pure helper with prefix-match per
      EC-4 (handles `0001-01-01T00:00:00Z`, RFC3339Nano, `+00:00` suffix variants).
      `overview.tsx` + `project-detail.tsx` use it as defense-in-depth on top of the
      backend pointer + `omitempty` switch. `formatDate()` returns em-dash for
      zero-time literals.
    - (#119) `overview.tsx` ProjectCard `status` now consumes canonical
      `p.last_deploy_status` (already release-aware via the engine's
      `pkg/enforcement.MapProjectStatus`) instead of deriving from `last_deploy ?
      'live' : 'queued'` which contradicted the hero/list state when releases were
      absent. Maps backend `'idle'` to UI `'queued'` because `@usetheo/ui`
      DeploymentStatus enum has no `'idle'`.
    - (#120) `project-connect.tsx` Repository panel branch label renamed to
      "Deploy branch (Theo)" so the user distinguishes it from GitHub's
      `default_branch`. Overview-side branch surfacing tracked as additive wire
      follow-up (rendering `'main'` as documented placeholder per ADR-Q3).
    - (#121) `deployments.tsx` + `project-detail.tsx` empty-state CTAs are
      deploy-centric ("Trigger a deploy with `theo deploy`…" + "Open repository
      tab") instead of the legacy "Connect a repository" affordance that
      contradicted the actual `Connected ACTIVE` state.
    - (#125) `audit.tsx` Table.Row `key` switched to composite `key={e.id ||
      'idx:' + idx}` so legacy audit rows with empty/null IDs no longer collapse
      to a single React key.
    - (#126) `audit.tsx` adds `displayAction(action, resource_type)` pure helper
      that remaps known raw-SQL ops to canonical domain events
      (`tenant.member.added`, `project.created`, etc.) and renders unknown raw
      verbs as `[unmapped: insert audit_entries]` instead of silently leaking
      the SQL verb. ACTOR fallback flipped from `'—'` to `'[unknown]'` so a
      reader distinguishes WHEN-missing from ACTOR-missing.
    - (#127) `components/secrets/add-secret-sheet.tsx` +
      `components/secrets/bulk-upload-sheet.tsx` default `availableEnvs` flipped
      from `['production', 'staging']` to `['preview', 'production']` per
      ADR-Q6 — canonical PaaS lexicon is preview + production. NEW hermetic
      audit at `lib/env-terminology.test.ts` with anchored EC-1 regex
      (`(availableEnvs|defaultEnvs)\s*[:=].*['"]staging['"]`) so generic test
      fixtures + dev-mocks data do not false-positive.
  Wire contract change in sibling theo commit (`*time.Time` + `omitempty`).

### Added
- **Contextual "Promote to Production" action — FAANG-canonical replacement for the legacy from→to dropdown dialog.**
  Sponsor PRD-level deep-dive 2026-06-18: in the canonical PaaS model (preview + production only,
  per `project_paas_envs_preview_production_only` mandate) the destination of a promote is ALWAYS
  production and the source is ALWAYS the deploy the user is currently looking at. The legacy
  `PromoteDialog` asked the user to pick from + to via dropdowns + offered an "Include other projects"
  checkbox + "+ Create new environment..." sentinel — all of which were tax for zero ergonomic
  gain (only 1 real path exists) AND introduced a race (a new deploy could replace the "active
  release of source env" between view-open and submit). New surface adopted the Vercel/Netlify
  pattern: a primary `Promote to Production` button on the preview deploy detail page that opens
  a confirmation modal with phrase symmetry (`promote to production`, matching `rollback production`)
  + sticky info toast trail + transitional badge during the ~90s sync window + automatic cache
  invalidation on the canonical (builds.list / builds.detail / projectStatus.detail) tuple. The
  legacy `PromoteDialog` and its 2 call sites remain functional — Phase 5 of the rollout will
  delete them after sponsor validates the new flow. Same-day generalization: `use-rollback-in-flight`
  → `use-mutation-in-flight` with `kind: 'rollback' | 'promote' | 'redeploy'` discriminator; the
  rollback-specific reader is preserved as a thin back-compat wrapper so existing code paths and
  tests stay green. 22 hermetic regression locks across the new dialog + the new generalized hook
  + the BuildHeader visibility rules (only show for preview-env succeeded builds when callback
  wired — production builds + non-wired call sites both stay quiet).
- Artifact supply-chain pipeline (ROADMAP_AWS AM6): `artifacts` GitHub Actions workflow
  building the 2 theo-cloud images (`theo-cloud` cloud-API + `theo-dashboard`) via the reusable
  `build-publish` workflow hosted in the `theo` repo (cross-repo `uses:`). **Dual-channel + low-cost:**
  `develop` push builds only CHANGED images, tags `:develop`/`:develop-<sha>`, unsigned (fast/cheap);
  a `v*` tag builds BOTH with SBOM + provenance + keyless cosign and tags `:X.Y.Z`/`:latest`.
  Levers: paths-filter change-detection, GHA layer cache, amd64-only, `cancel-in-progress` on dev.
- `Taskfile.yml` — T2.4 of plan canonical-tests-rewrite-v2 v1.0 per ADR-2026-06-17-T3.
  Closes F-001 BLOCKER from the engine audit 2026-06-17-canonical-tests-deep-review.
  Dual Go (cloud-API) + Node (dashboard SPA) targets: `task build:api` / `task build:dashboard`
  / `task test:api` (Go race) / `task test:dashboard` (Vitest) / `task test:smoke` (T2.6) /
  `task test:contract` (stub for Phase 2 Pact-go themory consumer contract) / `task lint` /
  `task ci`. Aligns with engine task surface.
- Extracted from the `theo` monorepo (`cloud/`) into this standalone repository
  via `git filter-repo` (history preserved) — M4 of the decomposition roadmap.
  Contains the Go cloud-API (`cmd/` + `internal/`) and the React/TSX dashboard
  (`dashboard/`, `@theo/dashboard`).
- `docs/dashboard-governance.md` — the dashboard's active mandates (Memory Section
  invariants, the 20 dashboard-journey plans, the sponsor priority chain, and the
  dashboard-specific common mistakes), migrated verbatim from the engine's
  `theo/CLAUDE.md` to where the dashboard code now lives — M5 of the decomposition
  roadmap. `CLAUDE.md` points to it.

### Changed
- **BREAKING (build): pinned `github.com/usetheodev/theo-contracts` to v0.1.0 (M5 version-pin cutover).**
  Dropped the local `replace => ../theo-contracts` in `go.mod`; consumes the published module. `Dockerfile`
  no longer needs the `theo-contracts` BuildKit build-context — it fetches the pinned **private** module
  via `GOPRIVATE` + a short-lived token mounted as a buildx `--secret` (never baked in a layer). Build is
  now self-contained. Verified: `go build ./... && go test ./... -race` GREEN; resolves theo-contracts v0.1.0.
- Rewrote `CLAUDE.md` into a full self-governing governance contract for any Claude Code
  instance working in this repo: what the repo is + its leaf position in the decomposition
  graph, where the Cycle 6+1 governance lives (the umbrella `../.claude/`), stack table,
  real build/test commands, the Non-Negotiable Rules (CR-9 cloud abstraction, acyclic
  invariant, idempotent+order-independent webhooks), architecture + seam map, the
  Durable-enforcement section (engine-hosted `acyclic-graph` gate, cross-repo contract
  matrix, `replace`-to-pinned cutover), a Common Mistakes table for the billing/auth/
  dashboard code that migrated here, and a pre-completion checklist — M5 of the
  decomposition roadmap.
- Go module path renamed `github.com/usetheo/theo/cloud` → `github.com/usetheodev/theo-cloud`
  (matches the repository URL; internal imports rewritten).
- Consumes the contract vocabulary from the standalone `github.com/usetheodev/theo-contracts`
  module (jwt/serviceauth/plan), wired via local `replace => ../theo-contracts` (`require v0.0.0`).
  The cutover to a pinned published version is documented in
  `theo/docs/version-pin-cutover-runbook.md` and is NOT yet executed (owner-gated).
- dashboard log-stream now exposes `droppedCount` (J-19 T1.3 R3) — the FIFO
  `maxLines` cap counts dropped lines; `LogViewer` renders a "N older line(s) dropped"
  indicator. (completed during the M4 extraction to unblock the dashboard build)

### Notes
- Known pre-existing dashboard test debt inherited from the upstream develop branch:
  several J-19 runtime-logs vitest specs (named SSE events + shape mapping,
  TimeRangePicker wiring, time-range-picker, ANSI spans, empty-state timing,
  mock handlers) assert behavior the develop impl had not yet completed (J-19 tests
  vs the J-17 thin-wrapper refactor are out of sync on develop itself). These are NOT
  caused by the extraction; the Go module + the dashboard BUILD are GREEN. Tracked for
  separate J-19 completion.
