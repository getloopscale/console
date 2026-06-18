# Changelog

All notable changes to `github.com/usetheodev/theo-cloud` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

### Changed
- cloud-API config loader now fail-fasts in production when the memory proxy is enabled but its bearer is missing (install-config-contract Slice 1, T4.1): `config.Validate()` rejects `THEMORY_API_KEY` empty while `THEMORY_BASE_URL` is set — documented as required on the field but previously unenforced (the proxy would have called theo-data unauthenticated). 3 new tests (-race).

### Added
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
