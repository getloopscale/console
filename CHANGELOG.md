# Changelog

All notable changes to `github.com/usetheodev/theo-cloud` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

### Added
- **Memory proxy: the 3 missing verbs — remember / recall / reflect — now proxy through the gateway AND the dashboard BFF** (plan `theo-memory-dashboard-full-integration` Phase 1). `themory.Client` gained `Remember`/`Recall`/`Reflect` conforming to TheMemory's real `POST /v1/{remember,recall,reflect}` (`{userId,...}` bodies; `{items}`/`{results}`/result-passthrough responses). `MemoryHandler` exposes them on the SDK surface (`/v1/memory/*`) and `DashboardMemoryHandler` fronts them on the session surface (`/v1/dashboard/memory/{remember,recall,reflect}`). Subject is derived from auth ONLY, never the body (#memory-integration).
- **Dashboard BFF now fronts exports + webhooks (+ deliveries/replay)** so the dashboard reaches them via the session path — closes the 401 the Exports/Webhooks tabs hit when they called the SDK-only `/v1/memory/*` with a browser session. `DashboardMemoryHandler.WithOps(...)` wires the existing ops handlers behind the mint; routes mounted under `/v1/dashboard/memory/{exports,webhooks}/*`. A disabled feature returns an honest 404 (logged), not a silent failure (#memory-integration).
- **Hard-delete (GDPR) surfaced through the proxy** — `themory.Client.Forget` gained a `hard bool`; the forget handler reads `?hard=true` (default soft). Threaded into the webhook `memory.forgotten` payload (#memory-integration).
- **Date-range filter (`from`/`to`, RFC3339) threaded into the scope list** — `ListOptions.From/To` are now sent to the provider's `GET /v1/scopes/{type}/{id}/memories` (ADR D3; provider-side `created_at` filter lands in TheMemory Phase 2). `openapi/themory.yaml` + the consumer contract test extended for all of the above (#memory-integration).

### Security
- Closed a cross-tenant delete IDOR in the memory proxy. TheMemory's `POST /v1/forget` is workspace-scoped, and the gateway uses one master key (= one workspace) for all customers — so delegating a raw `memoryId` let a customer delete another customer's memory by id. `themory.Client.Forget` now verifies the id belongs to the authenticated subject's scope BEFORE delegating, returning 404 (no existence leak) otherwise. Proven by `tests/e2e` (cross-tenant forget denied) (#memory-integration).

### Changed
- **Memory proxy now conforms to TheMemory's REAL contract** (its code-generated `/v1/openapi.json`), replacing the earlier hand-authored consumer-expectation spec that had drifted (`/memories`, `/metrics`, `/entities`, `DELETE /memories/{id}`, `X-Theo-User-Id` scoping — none existed on the real server). `internal/themory/client.go`: `List` → `GET /v1/scopes/user/{subject}/memories` (tenant isolation via **subject-in-path**, not the ignored `X-Theo-User-Id` header); `Forget` → `POST /v1/forget`; field mapping `items/text/nextCursor` → `memories/content/next_cursor`. `openapi/themory.yaml` rewritten to the real provider subset; contract + client unit tests rewritten accordingly (#memory-integration).
- `metrics` (`total_memories` only, derived by counting the scope) and `entities` (empty) degrade honestly until TheMemory ships server-side endpoints — tracked on the TheMemory roadmap (P0, post-integration). The usage counters (`retrieval_api_usage`/`add_events`) report 0 rather than fabricated values (#memory-integration).
- cloud-API config loader now fail-fasts in production when the memory proxy is enabled but its bearer is missing (install-config-contract Slice 1, T4.1): `config.Validate()` rejects `THEMORY_API_KEY` empty while `THEMORY_BASE_URL` is set — documented as required on the field but previously unenforced (the proxy would have called theo-data unauthenticated). 3 new tests (-race).

### Changed
- **Dashboard: bumped `@usetheo/ui` 0.12.0-next.0 → 0.13.0** (latest published) to pick up the design-system's standardized spacing/token updates. `tsc -b` passes (no API breaks); app verified rendering against the dev stack (#dashboard-ux).

### Fixed
- **Dashboard: fixed missing vertical spacing across the whole Memory module.** Root cause: `PageShell` (`@usetheo/ui`) wraps its content children in a single gap-less `<div>{content}</div>`, so a page that passes multiple sections renders them flush (measured inter-section gap = 0). The canonical fix (used by `overview.tsx` + `project-detail.tsx`) is to pass a single `<div className="space-y-6">` wrapper. The 5 memory screens were missing it. Wrapped the content of `memory.tsx`, `memories.tsx`, `entities.tsx`, `exports.tsx` in `space-y-6` (inter-section gap now 24px). Also standardized card content onto the DS `Card.Body` primitive (`memories.tsx` filter, `webhooks.tsx` `DeliveryCard`) — keeping the DS-default `Card.Body` padding (no ad-hoc overrides). Validated each screen in the browser; `tsc -b` clean (#dashboard-ux).
- **Dashboard: the "Your new API key" dialog now closes via the (x) / ESC / overlay.** The post-create secret-reveal dialog gated *every* close path on the "I've copied my key safely" checkbox (`handleClose` early-returned when `!copied`, and `onOpenChange` routed through it), so the (x) button appeared clickable but did nothing until the box was checked. Dismissing without copying is an allowed (lossy) path by design (recovery = revoke + create new), so the acknowledgement gate now applies ONLY to the primary "Done" button; the (x)/ESC/overlay dismiss unconditionally. `api-keys.tsx` (#dashboard-ux).
- **Dashboard memory page no longer 401s** — the BFF handler `routes.DashboardMemoryHandler` (`/v1/dashboard/memory/*`, session-JWT → mints a server-side `theo_live_*` key via `auth.BFFKeyVault` → delegates to the memory proxy) existed but was **never wired** into `cmd/main.go`, so the dashboard (which sent a session JWT to the SDK-only `/v1/memory/*` scope routes) always got 401. Wired the vault + handler under `requireJWT`, and repointed the dashboard's core memory calls (metrics / list / entities / forget in `memory.tsx`, `memories.tsx`, `entities.tsx`, `billing.tsx`) to `/v1/dashboard/memory/*`. `/v1/memory/*` stays SDK-only (`theo_live_*`). Validated end-to-end in a browser: register via Kratos → dashboard → Memory tab shows real seeded memories (#memory-integration).

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
- **Dashboard: "API Tokens" shortcut in the main sidebar** (new `Developer` group, between Memory and Billing) — surfaces the existing API-keys page (create / rotate / revoke / lineage) one click from the root nav instead of only under Settings → Developer. Routed at a top-level `/tokens` so the root sidebar stays active (a `/settings/*` path would drill into the Settings submenu); `/settings/tokens` and the `/api-keys` redirect are unchanged. Validated in-browser (#dashboard-ux).
- **Local dev stack (`docker-compose.dev.yaml` + `dev/` + `make dev-up`)** — runs the REAL apps for end-user validation: dashboard (real Ory Kratos login), gateway, TheMemory (REST + OpenMemory-compatible MCP over SSE), Postgres (engine schema via `migrate/migrate`) + pgvector, single dev origin on http://localhost:5173 (vite dev proxy). `make dev-up|dev-down|dev-logs`. MCP at `http://localhost:8765/{client}/sse/{user}` (drop-in for OpenMemory clients). LLM defaults to a hermetic mock; export `OPENAI_API_KEY` for real recall. See `dev/README.md` (#memory-integration).
- **End-to-end harness for the theo-cloud ↔ TheMemory integration** (`tests/e2e/` + root `Makefile`): `make e2e` boots the full real path (pgvector + postgres + a hermetic OpenAI-compatible mock + the real TheMemory server + theo-cloud) via `docker-compose.e2e.yaml` and drives a Go test (`-tags e2e`) through the gateway's `/v1/memory/*` endpoints against the REAL services — no external network or API cost. Mints a `theo_live_*` key the same way the gateway does, seeds a memory via the real `POST /v1/remember`, and asserts list / forget / scope-isolation / IDOR. `make e2e-up|e2e-down|e2e-logs` for the debug loop (#memory-integration).
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
