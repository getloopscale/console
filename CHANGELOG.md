## [Unreleased]
### Added
- **Platform API Gateway M6 (slice 1): ForwardAuth authz-brain endpoint (`/internal/authz/forward`).** A new `routes.ForwardAuthHandler` is the endpoint the Traefik edge delegates to per request: it validates the inbound `theo_live_*` (via `auth.ResolveAPIKey`), checks the required scope, mints the per-tenant downstream credential (via the Model B broker), and returns it as the `Authorization` response header on ALLOW (200) for the edge to inject upstream. Every DENY path (401 invalid key, 403 missing scope, **503 fail-closed** on a backend/mint error or empty mint — EC-1/EC-2) NEVER carries an `Authorization` header, so the edge copies nothing and makes no upstream call without an explicit ALLOW. DIP-clean (injected resolver + minter interface); 8 unit tests incl. a race-aware concurrent path. (platform-api-gateway-edge-slice1 T0.2, ADR D1/D7)
- **Platform API Gateway M6 (slice 1): inbound `theo_live_*` validation extracted as `auth.ResolveAPIKey`.** The `theo_api_keys` lookup + tenant resolution is now a single shared path (`auth.lookupAPIKey`) reused by `RequireScope` (middleware) and the upcoming ForwardAuth authz endpoint — so the Traefik edge delegates inbound auth to the SAME validation as the in-process middleware (DRY, Rule 9). Typed errors `ErrInvalidCredential` / `ErrBackendUnavailable` make an infra outage fail-closed (never reported as a bad key — EC-1); an empty-tenant row is rejected at the boundary (EC-3); a non-Bearer scheme is rejected without a DB hit (EC-6). `RequireScope` behavior is unchanged. (platform-api-gateway-edge-slice1 T0.1, ADR D1)
- **Model B: TheMemory control-plane admin client + per-tenant credential broker.** `internal/themory.AdminClient` mints/revokes per-tenant `theo_live_*` keys via TheMemory's `POST /v1/admin/keys` using a `memory:platform-admin` credential (control-plane only). `internal/themory.Broker` resolves a per-tenant key for the data path via a lazy cache-aside LRU+TTL with `singleflight` coalescing (one mint per tenant under concurrency) and **fails closed** on a mint error (never falls back to the master key). New env `THEMORY_PLATFORM_ADMIN_KEY`. (model-b-credential-broker T1.1/T2.1, ADR D1/D3)

### Changed
- **Gateway → TheMemory data path now authenticates with a PER-TENANT key, not a shared master key.** The `themory.Client` resolves the per-request Bearer from the authenticated tenant via the broker; the data client holds NO master credential, so TheMemory enforces tenant isolation from the credential and a gateway path bug can no longer cross tenants. The master/platform credential is now control-plane only (mint/rotate/revoke). The boot capability probe uses a separate platform-keyed client; the memory-export worker threads the tenant into its detached context. (model-b-credential-broker T3.1, ADR D1)

### Removed
- **`BFFKeyVault` + the ~21 `/v1/dashboard/memory/*` pass-through wrappers.** The vault minted per-user `theo_live_*` keys into the cloud's own Postgres (which TheMemory never validated) and discarded the secret — dead machinery. The dashboard surface now registers the shared `MemoryHandler` directly under the session-JWT chain; the per-tenant key comes from the broker. Removed the dead `THEOCLOUD_BFF_KEY_TTL_HOURS` config. (model-b-credential-broker T4.1, ADR D4)

### Fixed
- **Dashboard now surfaces a memory-backend outage instead of masking it (silent-failure fix).** `cloudFetch` returned `null` on any non-2xx, so React Query treated a backend error as success: the `/memory/playground` Remember form cleared silently (the user believed the write landed) and the `/memory` overview rendered fabricated `0/0/0/0` KPI tiles over an outage — the pre-existing error `Alert`s were dead code. Added an opt-in `{ throwOnError: true }` flag + typed `ApiError` to `cloudFetch`/`engineFetch` (default `T | null` contract unchanged for the other 49 callers); the 3 Playground mutations + the metrics query opt in, so a non-2xx now routes to `isError` → the existing Alert renders, the Playground input is retained, and the KPI strip is suppressed (no fake zeros). The overview KPI strip now renders only on a settled success — a skeleton shows while the query is pending/retrying, so fabricated `0/0/0/0` can never paint during a slow load either (not just on error). Auth-expiry on an opted-in call now surfaces as a typed `ApiError(401)` (the form is retained) instead of a silent `null`. Verified live in Chrome against a non-2xx memory backend. (dashboard-memory-error-surfacing, ADR D2/D3)

### Security
- **Closed the gateway confused-deputy (CWE-441) on the interactive memory data path.** Combined with the per-tenant key cutover above, a key bound to tenant A can no longer read tenant B's memory through the gateway (provider-enforced) — proven by the build-tagged `tests/e2e/tenant_isolation_e2e_test.go` (run via `make e2e` against the Model B dev stack) plus deterministic unit/handler fail-closed coverage. **Leak fix (GAP-4):** the user-facing API-key surface (`list` / `revoke` / `rotate` / `lineage`) now excludes legacy `bff_minted` shadow rows, so an internal gateway artifact never surfaces in (or is mutated through) a customer's key list. New deployment knobs: `THEMORY_PLATFORM_ADMIN_KEY` (gateway, control-plane mint credential) + `THEMEMORY_REQUIRE_CREDENTIAL=true` (themory, fail-closed multi-tenant). (model-b-credential-broker, ADR D1/D4)

## [0.9.2] - 2026-06-24
### Fixed
- **F-4 follow-up: dashboard Memory sub-nav now genuinely re-renders on click (corrects v0.9.1).** The v0.9.1 F-4 fix (react-router v7 native `navigate(path, { viewTransition: true })`) was verified live in Chrome to be INSUFFICIENT: the unit test asserted the call shape, but in the running app the panel still stayed stale until reload. Root cause: the `/memory/*` routes are lazy + Suspense with no `Outlet`, so ANY View Transition wrapper (raw `document.startViewTransition` OR RR-native `viewTransition`) snapshots the old DOM before the lazy chunk commits (React 19 + RR v7). Corrected to PLAIN `navigate(path)` — the proven pre-T5.3 behavior — verified live: clicking Skills→Episodes re-renders each panel without reload. Crossfade animation sacrificed for correctness. Unit test rewritten to assert plain navigate (no viewTransition arg) as a regression guard. (live-test-gaps-fix, F-4 correction)

## [0.9.1] - 2026-06-24
### Fixed
- **Gateway no longer launders a TheMemory upstream 4xx into a misleading 502 (F-1).** When TheMemory rejects a request with a client error (e.g. `422 INVALID_BODY` on an unsupported skill `codeLanguage`), the gateway now propagates the SAME 4xx status with the upstream `{code,message}` so the consumer can fix their request — instead of collapsing it to `502 MEMORY_UPSTREAM_UNAVAILABLE` ("try again", which a bad body can never satisfy). A shared `writeUpstreamError` helper uses a FAIL-CLOSED consumer-fault allowlist: only `{400, 413, 422}` (bad body/params/oversized) pass through with the upstream `{code,message}`; EVERYTHING else — upstream 5xx/timeout/network, gateway-master-key `401/403/429`, and any unexpected/future 4xx — is laundered to `502 MEMORY_UPSTREAM_UNAVAILABLE` so provider drift fails closed rather than mis-attributing an infra condition to the consumer. Applied to all 13 memory handlers (404/409 sentinel pre-checks unchanged); the logged upstream body is CR/LF-sanitized. Discovered in the 2026-06-24 complete live test. (live-test-gaps-fix, F-1)
- **Dashboard Memory sub-nav now re-renders on click (F-4).** The sidebar wrapped `navigate()` in a raw `document.startViewTransition`, which snapshots the DOM before React commits the route → the URL changed but the panel stayed stale until a manual reload (live in Chrome/Edge/Safari; invisible to jsdom tests). Switched to react-router v7's native `navigate(path, { viewTransition: true })`, which sequences the transition around the route commit. Removed the now-dead `lib/view-transitions.ts` helper. (live-test-gaps-fix, F-4)
- **Dev stack: eliminated the concurrent migrate-on-boot race (LT-1).** `themory` (REST) and `themory-mcp` both ran `runMigrations()` on boot against the same pg-themory; on a new migration they raced (`CREATE INDEX IF NOT EXISTS` is not atomic under concurrent DDL → one container crashed). Added a dedicated one-shot `themory-migrate` init container (mirroring `cloud-migrate`/`kratos-migrate`); both long-running containers now wait for its `service_completed_successfully`, and the REST server runs with `THEMEMORY_SKIP_MIGRATIONS=true`. Migrations apply exactly once, before either starts. (live-test-gaps-fix, LT-1)

## [0.9.0] - 2026-06-23

### Added
- **Cross-repo flat skills list on the programmatic SDK surface (`GET /v1/memory/skills/all`).** The cross-repo flat skills listing — previously only on the dashboard BFF (`/v1/dashboard/memory/skills/all`, JWT/session) — is now also on the SDK surface (`/v1/memory/*`, `theo_live_*` Bearer + `RequireScope("memory:read")`), at scope parity with the per-repo `GET /v1/memory/skills`. So an SDK-key consumer (not just the dashboard) can list ALL skills for its subject across every repo (each row carrying its bare `repoId`, with `limit`/`offset`/`q`). Thin one-route addition: it reuses the EXISTING generic `MemoryHandler.ListSkillsAll` (bare authed subject, anti-spoof — `?subject` ignored; 502 on upstream error) — no handler change, no themory change, BFF route unchanged. Closes the programmatic-vs-dashboard asymmetry flagged by the `skills-cross-repo-flat-list-gateway` `/review`. (skills-cross-repo-sdk-symmetry, M3)

## [0.8.1] - 2026-06-23

### Fixed
- **Dashboard test suite is globally green again + restored regressed J-19 runtime-logs feature.** `cd dashboard && npm run test` had 16 failing tests across 6 logs/SSE files. Root-cause triage found 10 were real REGRESSIONS (J-19 feature code lost in a develop merge / an incomplete scaffold), not stale tests: (1) `useLogStream` dropped `eventTypes: ['log']` + the theo-api `{timestamp,line,step}→{ts,msg,source}` mapping — named log frames were silently dropped; restored. (2) `runtime-logs` lost the `?env=production&since=<range>` stream-path query + the `TimeRangePicker` mount; restored. (3) `LogViewer` was missing ANSI rendering (`parseAnsi`), the 3s empty-state delay (cancelled on disconnect), and the line-click `#L<i>` permalink; restored. The remaining failures were a real root cause in the TEST ENV, not stale assertions: jsdom lacked Pointer Capture polyfills, so Radix `Select` never opened in tests (the `TimeRangePicker` `role="option"` failures) — added `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture` to the test setup, which fixed all 4 Radix-option failures with ZERO test rewrites. Two genuinely-stale mock-handler assertions were aligned (SSE-stream count 3→4 after the deploy-timeline stream; SBOM response shape to the current `{build_id, apps[]}` contract). Also restored two J-19 behaviors the first pass under-implemented (caught by `/review`): the per-line permalink READ side (on mount, `#L<n>` scrolls that line into view + pins it) and the runtime-logs `droppedCount` threading (the FIFO-overflow indicator was dead UI on the page). And pinned `vitest` `testTimeout`/`hookTimeout` to 20s so the import-heavy 143-file suite is deterministically green under worker contention (the prior intermittent `pages.smoke`/`projects` timeouts were starvation, not logic). No `@skip`, no deleted tests; full suite green across 3 consecutive runs (143 files, 1005 passed, 8 pre-existing skips). (dashboard-logs-sse-suite-repair)

## [0.8.0] - 2026-06-23

### Added
- **Skills tab lists ALL skills across repos (cross-repo flat list).** The dashboard Skills tab now lists every skill the agent has learned across EVERY repo by default — no more "enter a repo" gate. New themory client method `ListSkillsAll(subject, opts)` + BFF route `GET /v1/dashboard/memory/skills/all` proxy to the themory v0.21.0 endpoint `GET /v1/scopes/skill/:subject/all` (the BFF passes the BARE authenticated subject; the provider prefix-scans `{subject}:%` for tenant isolation). The tab gains a Repo column, a description search (`q`), and offset pagination; delete (curation) uses each row's own `repoId`. The skill code is NOT a table column — it lives in a per-row "View details" dialog (keeps the list scannable; code/instructions belong in a details view). Store-only guardrail preserved (delete-only; no code editor/executor). **Deploy-gated on themory v0.21.0.** (skills-cross-repo-flat-list-gateway)

## [0.7.0] - 2026-06-23

### Changed
- **Card border visual consistency (canonical end-to-end).** Bump
  `@usetheo/ui` 0.13.1 → 0.13.2 (mirror of `@theokit/ui@0.18.1` from
  `usetheodev/theo-ui` PR #17 / merge commit `65496a0`). The upstream
  PR fixed a long-standing inconsistency: the `Card` primitive used
  `border` alone (no token suffix), which fell back to the browser's
  user-agent stylesheet `currentColor` in Tailwind v4 — rendering a
  visible light/white border against the violet-forge dark theme.
  `UsageMeter` was the only canonical-correct surface, using
  `border border-border` (semantic token via `--color-border`).
  QA caught this on theo-cloud dev-public Overview screen: USAGE card
  had no white border, but Projects + Quick actions did. Upstream
  patched 14 components (`Card` primitive + 13 composites including
  `ProjectCard`, `PreviewEnvCard`, `EnvVarEditor`, etc.) to use
  `border border-border` consistently. Affects every Card-based surface
  across the dashboard — no dashboard source change required; pure
  npm bump.
- (#119 canonical end-to-end) Bump `@usetheo/ui` 0.13.0 → 0.13.1 +
  `overview.tsx` now passes `'idle'` directly to the ProjectCard
  `status` prop. The published `@usetheo/ui@0.13.1` (mirror of
  `@theokit/ui@0.18.0` from `usetheodev/theo-ui` PR #16 / merge
  commit `a3719c0`) adds `'idle'` to the canonical
  `DeploymentStatus` union with neutral gray variant + dot tone +
  "Idle" label. Replaces the 2026-06-18 stopgap that collapsed
  backend `'idle'` to `'cancelled'` because the UI lib didn't
  expose it. Projects that have never deployed now render with a
  neutral Idle badge — visually distinguished from amber-pulsing
  `'queued'` ("deploy in progress") AND from `'cancelled'`
  ("explicitly stopped"). Closes #119 of
  `qa-dogfood-cleanup-2026-06-21` end-to-end: canonical surface
  ships at `theo-ui` source + LIVE reaches dev-public via npm
  publish + dashboard bump.

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
    - (#123 / #142) **Canonical fix shipped** — `pages/project-scale.tsx`
      now seeds `resolvedPlanTier` from
      `useProjectStatus(name).status.plan_tier` (engine `GET
      /api/v1/projects/{name}/status` — sibling theo commit adds the
      field). Single canonical SoT: the same `PlanTierStore` the engine
      uses to enforce `POST /scale` now also feeds the slider ceiling
      pre-Apply. Mutation response still wins post-save
      (server-authoritative per ADR D1 EC-2). Replaces the
      2026-06-22 stopgap that depended on Known Gap #116 cloud BFF
      `/v1/billing` (404). Type added at `lib/api/types.ts`
      `ProjectStatusDetail.plan_tier?: string`. Older engines that omit
      the field cause the page to keep the 'starter' fallback — graceful
      degradation.
  Wire contract change in sibling theo commit (`*time.Time` + `omitempty`).
- TheMemory e2e oracle (`tests/e2e/memory_e2e_test.go`): the gateway round-trip now asserts memory presence/isolation/survival by **memory ID** instead of literal content substrings (`"blue"` / `"Lisbon"`). A real extraction LLM normalizes — and may translate — the raw text into a canonical fact (gpt-4o-mini stored `"i live in Lisbon"` as `"user mora em Lisboa"`), which broke the content-substring assertions when the e2e ran against real OpenAI instead of the verbatim echo-mock. The ID-based oracle is real-LLM-robust and strictly stronger (a leak that survives translation would have slipped past the old `!Contains("Lisbon")` isolation check). Surfaced by a live theo-cloud ↔ TheMemory v0.20.0 integration run with a real LLM. (live-test-real-llm-oracle)

### Added
- Episodes timeline (episodes-gateway-dashboard): proxies TheMemory v0.14.0's `GET /v1/scopes/{type}/{id}/episodes` through the gateway — `GET /v1/memory/episodes` (SDK, `memory:read`) + `GET /v1/dashboard/memory/episodes` (BFF) — forwarding cursor/order/asOf/text-filter params. New dashboard "Episodes" tab: a cursor-paginated, bi-temporal-aware (`asOf` replay) event timeline over the subject's memories with newest/oldest toggle and literal text filter. Shared-key D3 rule (scope≠user → empty page). (episodes-gateway-dashboard)
- Graph-aware recall over the gateway + dashboard (gateway-graphexpand-recall-ui, EG-1): the recall path now forwards TheMemory v0.20.0's `graphExpand` option — `RecallOptions.GraphExpand` + the `recallRequest` body field (omitempty) on the SDK client, a boundary-validated `graphExpand` (`hops` 1|2, `limit` 1..100; 0/omitted → provider default) on `POST /v1/memory/recall` (shared by the dashboard BFF `/v1/dashboard/memory/recall`), and the OpenAPI `/v1/recall` request schema documents it. New dashboard Playground "Graph expand" toggle (hops 1|2) that surfaces memories connected by a shared entity (1 hop) or relation edge (2 hops). DEFAULT OFF → recall byte-unchanged. Thin passthrough (TheMemory owns the traversal); ZERO new dependency, no new route. (gateway-graphexpand-recall-ui)

## [0.6.0] - 2026-06-21

### Added
- Boot-time provider-capability guard (F1): when `THEMORY_BASE_URL` is set, the gateway probes the provider's `GET /v1/openapi.json` at startup and **refuses to boot** if the provider is reachable but does NOT advertise the scoped-forget `DELETE` route (deploy-ordering bug — gateway ahead of TheMemory v0.12.0 — that would make forget-by-id silently not-delete). Transient failures (provider unreachable / non-2xx / unparseable openapi) log a warning and proceed. Escape hatch: `THEMORY_SKIP_CAPABILITY_CHECK=true`. (#themory-gateway-provider-capability-guard)

## [0.5.0] - 2026-06-21

### Changed
- Gateway `Forget` now deletes via TheMemory's scope-checked `DELETE /v1/scopes/user/{subject}/memories/{id}` (+`?hard`) instead of an O(scope) `listAll()` ownership pre-check + workspace-only `POST /v1/forget`. Ownership is enforced server-side (cross-scope/missing → 404, no existence leak); the gateway issues one DELETE. External behavior (`Forget` signature, 404 semantics) is unchanged. **DEPLOY-GATE:** requires TheMemory **v0.12.0** deployed (the DELETE endpoint); do not deploy the gateway ahead of the provider. (#themory-gateway-forget-cutover)
- `MetricsResult.RetrievalAPIUsage` / metrics doc corrected: `retrieval_api_usage` is now REAL (TheMemory v0.12.0 persists a per-scope recall counter), no longer hardcoded 0. Parse code was already correct; only the comments were stale. (#themory-gateway-forget-cutover)

### Removed
- Internal-only: dead `listAll()` + `maxListPages` + `forgetBody` in `internal/themory/client.go` (the forget ownership pre-check was their only caller). NO consumer-facing API removed — the public `Forget` contract is unchanged. (#themory-gateway-forget-cutover)

## [0.4.0] - 2026-06-20

### Added
- e2e: graph round-trip (`remember`→`GET /v1/memory/graph`) + invalid-scope-400 + per-subject isolation, vs the Slice-2 themory image. (themory-graph-gateway-dashboard Phase 3)
- **Dashboard graph view** at `/memory/graph` — interactive force-directed view of the entity relation graph via `react-force-graph-2d` (zoom/pan/drag, connectivity-based clustering with per-cluster color, node size by frequency, hover neighbor-highlight, directional edges with relation labels, isolated extraction-noise muted to the periphery); scope tabs, empty + error states; reachable via a "View Graph" hub card + sidebar entry. Supersedes the initial dependency-free SVG (ADR graph-viz-lib over ADR D1). (themory-graph-gateway-dashboard)
- **`GET /v1/memory/graph`** + BFF **`GET /v1/dashboard/memory/graph`** — proxy TheMemory's entity relation graph (`{nodes, edges}`) through the gateway (shared `Graph` handler, `memory:read` scope; `scope!="user"`→empty; nodes+edges always arrays). Mirrors the entities integration. (themory-graph-gateway-dashboard)
- Graph view UX: a view-only synthetic **hub root** anchoring each cluster representative + isolated nodes into one star (larger circle, no label, dashed/arrow-less spokes; excluded from the entity/relation counts; "Hub view" toggle); a conservative **alias merge** (single-token short forms fold into their prefix canonical — "Acme"→"Acme Corporation" — without false-merging "São Paulo" into "Universidade de São Paulo"); and a **"Hide N unconnected"** toggle. (themory-graph-gateway-dashboard graph-ux)


### Changed
- dev stack systematized in `make dev-up`: `dev/run.sh` now REBUILDS the themory image from the sibling repo each run (cached → fast; `THEMORY_SKIP_BUILD=1` to opt out) so the dev stack always reflects theo-memory current code (e.g. the `/graph` surface); a dev-only vite CSP transform injects localhost/127.0.0.1 dev origins into `form-action`+`connect-src` so dashboard login works under `make dev-up` (production CSP unchanged). (themory-graph-gateway-dashboard dev-ergonomics)
- e2e: the entities round-trip now asserts EXTRACTED entity nodes (TheMemory Slice 1 entity-extraction changed `/entities` from `attributed_to`-derived to real extracted nodes). (themory-graph-gateway-dashboard)


### Fixed
- dashboard build: exclude the `rollup-plugin-visualizer` artifact (`dist/bundle-stats.html`) from the workbox SW precache via `globIgnores` — the analysis treemap is not an app asset and exceeded the 2 MiB precache limit (hard-failed `vite build` once it grew past the threshold). (themory-graph-gateway-dashboard graph-viz-lib)

## [0.3.0] - 2026-06-19

### Added
- **Skills WRITE surface** through the gateway (skills-write-surface T3.1-T3.3): `POST /v1/memory/skills?repoId=` (SDK, `memory:write`) + `DELETE /v1/memory/skills/{skillID}?repoId=` (SDK, `memory:delete`) + the BFF equivalents `POST`/`DELETE /v1/dashboard/memory/skills[/{skillID}]` (JWT, mint→delegate). Client `AddSkill`/`ForgetSkill`. Upstream repoId namespaced `{subject}:{repoId}` (D3 multi-tenant isolation; repoId required, no `:`; subject-injectivity guard). Dedup-collision → 409; cross-repo/cross-workspace/non-existent forget → 404. Store-only (no executor). (#skills-write-surface)
- Dashboard **Skills tab curation**: a delete (forget) control + ConfirmDialog on each skill row (skills-write-surface T4.1). D2 store-only — the ONLY write control is delete; NO code editor / create form / executor (agents author via SDK/MCP; humans curate).

## [0.2.0] - 2026-06-19

### Added
- Read-only **Skills browse** surface for the memory dashboard: a new **Skills tab** (`/memory/skills`) backed by `GET /v1/memory/skills?repoId=` (SDK, `memory:read`) + `GET /v1/dashboard/memory/skills?repoId=` (BFF, JWT). The tab lists a repo's Voyager-style skills `{ id, hash, description, code, codeLanguage, createdAt, derivedFrom, supersededBy }` (a repoId input gates the fetch; truncation at the cap is disclosed; derived/null-code skills render gracefully). The upstream repoId is namespaced as `{subject}:{repoId}` so two customers using the same bare repoId never share a skill scope (multi-tenant isolation); repoId is required and rejected if it contains `:`. Read-only — no executor/editor/sandbox. (plan `dashboard-phase2b-skills-browse` T3.1-T4.1) (#dashboard-phase2b-skills-browse)

## [0.1.0] - 2026-06-19

### Added
- **Memory Playground: attribution-on-write (`attributedTo`) + bi-temporal recall (`asOf`)** (plan `dashboard-phase2a-attribution-asof`). The remember panel gains an optional "Attributed to (peer)" field; the recall panel gains an optional "As of (UTC)" datetime-local picker (widened to RFC3339). Threaded through the gateway client + handlers + BFF (the BFF passes the body through unchanged). The recall handler validates `asOf` is RFC3339 at the boundary (400, not a 502 laundered from the provider). **attribution-write semantics:** because TheMemory applies the caller's `attributedTo` only on the verbatim path, the gateway sends `infer:false` when a peer is supplied (owner decision 2026-06-19) so the attributed fact persists; without a peer, the default LLM-extraction path is unchanged. Proven by `tests/e2e` (remember-attributed → asOf recall → entities contains the peer). No new TheMemory endpoint (fields already exist on `RememberBody`/`RecallBody`). **Validation caveat (honest disclosure):** the green `make e2e` ran against a TheMemory image with the companion metadata-aggregation fix overlaid (the clean image rebuild was blocked by a transient upstream `sharp`/libvips CDN timeout); the fix is in TheMemory source + unit-proven — re-run a clean `make e2e` once the CDN recovers (#memory-integration).


- **Memory proxy: the 3 missing verbs — remember / recall / reflect — now proxy through the gateway AND the dashboard BFF** (plan `theo-memory-dashboard-full-integration` Phase 1). `themory.Client` gained `Remember`/`Recall`/`Reflect` conforming to TheMemory's real `POST /v1/{remember,recall,reflect}` (`{userId,...}` bodies; `{items}`/`{results}`/result-passthrough responses). `MemoryHandler` exposes them on the SDK surface (`/v1/memory/*`) and `DashboardMemoryHandler` fronts them on the session surface (`/v1/dashboard/memory/{remember,recall,reflect}`). Subject is derived from auth ONLY, never the body (#memory-integration).
- **Dashboard BFF now fronts exports + webhooks (+ deliveries/replay)** so the dashboard reaches them via the session path — closes the 401 the Exports/Webhooks tabs hit when they called the SDK-only `/v1/memory/*` with a browser session. `DashboardMemoryHandler.WithOps(...)` wires the existing ops handlers behind the mint; routes mounted under `/v1/dashboard/memory/{exports,webhooks}/*`. A disabled feature returns an honest 404 (logged), not a silent failure (#memory-integration).
- **Hard-delete (GDPR) surfaced through the proxy** — `themory.Client.Forget` gained a `hard bool`; the forget handler reads `?hard=true` (default soft). Threaded into the webhook `memory.forgotten` payload (#memory-integration).
- **Date-range filter (`from`/`to`, RFC3339) threaded into the scope list** — `ListOptions.From/To` are now sent to the provider's `GET /v1/scopes/{type}/{id}/memories` (ADR D3; provider-side `created_at` filter lands in TheMemory Phase 2). `openapi/themory.yaml` + the consumer contract test extended for all of the above (#memory-integration).
- **Dashboard: Memory Playground (`/memory/playground`)** — the live remember / recall / reflect surface that fulfills the overview's "Try Playground — remember and recall live" promise (which previously linked to the flat list). Three panels: Remember (text + optional category → write), Recall (query → scored results with cosine score badges), Reflect (button → consolidation result). All via the dashboard BFF; routed + added to the Memory submenu + the Explore card repointed. 4 vitest specs (#dashboard-ux #memory-integration).
- **Dashboard: hard-delete (GDPR) opt-in in the forget flow** — the Memories forget ConfirmDialog gained a "Permanently erase (GDPR, cannot be recovered)" checkbox that threads `?hard=true` through the BFF forget; default stays the audit-preserving soft delete (ADR D4) (#dashboard-ux).

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
- **Memory metrics + entities now consume TheMemory's real subject-scoped endpoints** (`GET /v1/scopes/user/{subject}/{metrics,entities}`), replacing the gateway's O(scope) `total` derivation + the empty-entities stub. `MetricsResult` carries real `total_memories`/`entity_count`/`add_events` (retrieval honest-0); entities are the distinct `attributed_to` peers (user scope only — non-user tabs return empty in the single-subject-per-customer model). `openapi/themory.yaml` + contract + client tests extended (#memory-integration).
- **Memory proxy now conforms to TheMemory's REAL contract** (its code-generated `/v1/openapi.json`), replacing the earlier hand-authored consumer-expectation spec that had drifted (`/memories`, `/metrics`, `/entities`, `DELETE /memories/{id}`, `X-Theo-User-Id` scoping — none existed on the real server). `internal/themory/client.go`: `List` → `GET /v1/scopes/user/{subject}/memories` (tenant isolation via **subject-in-path**, not the ignored `X-Theo-User-Id` header); `Forget` → `POST /v1/forget`; field mapping `items/text/nextCursor` → `memories/content/next_cursor`. `openapi/themory.yaml` rewritten to the real provider subset; contract + client unit tests rewritten accordingly (#memory-integration).
- `retrieval_api_usage` remains an honest `0` (TheMemory has no persisted recall counter yet) rather than a fabricated value; `total_memories`/`entity_count`/`add_events` are now real (see the metrics/entities Changed entry above) (#memory-integration).
- cloud-API config loader now fail-fasts in production when the memory proxy is enabled but its bearer is missing (install-config-contract Slice 1, T4.1): `config.Validate()` rejects `THEMORY_API_KEY` empty while `THEMORY_BASE_URL` is set — documented as required on the field but previously unenforced (the proxy would have called theo-data unauthenticated). 3 new tests (-race).
- **Dashboard: bumped `@usetheo/ui` 0.12.0-next.0 → 0.13.0** (latest published) to pick up the design-system's standardized spacing/token updates. `tsc -b` passes (no API breaks); app verified rendering against the dev stack (#dashboard-ux).

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


### Fixed
- **Dashboard: Exports + Webhooks tabs no longer 401** — both pages called the SDK-only `/v1/memory/*` surface with a browser session; repointed every call (exports create/status/download; webhooks list/create/delete + per-webhook deliveries + replay) to the session BFF `/v1/dashboard/memory/*`. Date-range inputs on the Memories page now widen the `YYYY-MM-DD` value to a full-day RFC3339 range so the new provider filter accepts it (was a silent no-op). `webhooks.tsx` content wrapped in the `space-y-6` layout standard (the one Memory screen still missing it). Test mocks/assertions retargeted to the BFF paths (#dashboard-ux #memory-integration).

- **Dashboard: fixed missing vertical spacing across the whole Memory module.** Root cause: `PageShell` (`@usetheo/ui`) wraps its content children in a single gap-less `<div>{content}</div>`, so a page that passes multiple sections renders them flush (measured inter-section gap = 0). The canonical fix (used by `overview.tsx` + `project-detail.tsx`) is to pass a single `<div className="space-y-6">` wrapper. The 5 memory screens were missing it. Wrapped the content of `memory.tsx`, `memories.tsx`, `entities.tsx`, `exports.tsx` in `space-y-6` (inter-section gap now 24px). Also standardized card content onto the DS `Card.Body` primitive (`memories.tsx` filter, `webhooks.tsx` `DeliveryCard`) — keeping the DS-default `Card.Body` padding (no ad-hoc overrides). Validated each screen in the browser; `tsc -b` clean (#dashboard-ux).
- **Dashboard: the "Your new API key" dialog now closes via the (x) / ESC / overlay.** The post-create secret-reveal dialog gated *every* close path on the "I've copied my key safely" checkbox (`handleClose` early-returned when `!copied`, and `onOpenChange` routed through it), so the (x) button appeared clickable but did nothing until the box was checked. Dismissing without copying is an allowed (lossy) path by design (recovery = revoke + create new), so the acknowledgement gate now applies ONLY to the primary "Done" button; the (x)/ESC/overlay dismiss unconditionally. `api-keys.tsx` (#dashboard-ux).
- **Dashboard memory page no longer 401s** — the BFF handler `routes.DashboardMemoryHandler` (`/v1/dashboard/memory/*`, session-JWT → mints a server-side `theo_live_*` key via `auth.BFFKeyVault` → delegates to the memory proxy) existed but was **never wired** into `cmd/main.go`, so the dashboard (which sent a session JWT to the SDK-only `/v1/memory/*` scope routes) always got 401. Wired the vault + handler under `requireJWT`, and repointed the dashboard's core memory calls (metrics / list / entities / forget in `memory.tsx`, `memories.tsx`, `entities.tsx`, `billing.tsx`) to `/v1/dashboard/memory/*`. `/v1/memory/*` stays SDK-only (`theo_live_*`). Validated end-to-end in a browser: register via Kratos → dashboard → Memory tab shows real seeded memories (#memory-integration).


### Security
- Closed a cross-tenant delete IDOR in the memory proxy. TheMemory's `POST /v1/forget` is workspace-scoped, and the gateway uses one master key (= one workspace) for all customers — so delegating a raw `memoryId` let a customer delete another customer's memory by id. `themory.Client.Forget` now verifies the id belongs to the authenticated subject's scope BEFORE delegating, returning 404 (no existence leak) otherwise. Proven by `tests/e2e` (cross-tenant forget denied) (#memory-integration).


### Notes
- Known pre-existing dashboard test debt inherited from the upstream develop branch:
  several J-19 runtime-logs vitest specs (named SSE events + shape mapping,
  TimeRangePicker wiring, time-range-picker, ANSI spans, empty-state timing,
  mock handlers) assert behavior the develop impl had not yet completed (J-19 tests
  vs the J-17 thin-wrapper refactor are out of sync on develop itself). These are NOT
  caused by the extraction; the Go module + the dashboard BUILD are GREEN. Tracked for
  separate J-19 completion.

