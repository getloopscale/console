# theo-cloud — Account-level Tenancy Roadmap

> Generated 2026-06-27 from `.claude/knowledge-base/adrs/ADR-account-level-tenancy.md` (the locked design).
> This is a **macro** roadmap. Decomposition into tasks is the job of `/to-plan` per milestone.
> Scope is already locked by the ADR — this roadmap sequences its delivery, it does not re-open the design.

## Vision

Make theo-cloud a true **nested multi-tenant (B2B2C)** control-plane: an independent developer (an
**Account**) can build a solution on Theo and resell it to **N of their own clients**, each a fully
isolated **Tenant** — without any theo-data module (theo-memory, theo-rag, …) changing its
per-tenant contract. Account is added **above** the existing tenant; `workspace_id == tenant_id`
stays true; the data-plane never sees Account.

## Problem

**Root problem:** the control-plane is **flat** today — a `theo_live_*` key resolves directly to one
tenant/workspace (1 key → 1 tenant). There is no **Account** entity grouping multiple isolated
tenants per customer, so an independent developer cannot serve N isolated clients under one
billing/admin identity. Billing is per-tenant (`subscriptions UNIQUE(tenant_id)`), which can't model
"one developer, N projects".

**Whose pain:** independent developers / companies (the paying **Cliente Theo**) who want to resell a
Theo-based solution to several of their own clients with hard data isolation and a single bill.

## Users

- **Primary:** independent developers / small companies (the Account / Cliente Theo) — self-serve, provision 1..N isolated tenants on demand.
- **Secondary:** the Account's own clients (each a Tenant) and their end-users (User tier) — never interact with the Account layer directly.

## Scope

### In scope (V1 — required to call this project alive)

- `accounts` table + `account_id` on `tenants` and `theo_api_keys` (the forward-compat seam, planted on `subject`/`tenant_id`, completed).
- Account provisioning on signup (v1: 1:1 user↔account); an Account provisions **N isolated Tenants** on demand.
- `UserContext.AccountID` + `ResolveAPIKey` resolving `account_id`; broker validates `account → tenant` **lazily** (theo-memory unchanged).
- **Billing per-Account** (`subscriptions` → account) + project (tenant) quota metered per Account.
- **Non-destructive 2-phase migration** (`000034`–`000040`): nullable → backfill → `NOT NULL`. Old `theo_live_*` keep working throughout.
- theo-memory / every theo-data module **unchanged** — Account lives only in the control-plane.

### Explicitly out of scope

- **`account_members` / multi-user-per-Account RBAC** — *why excluded:* v1 is 1:1 user↔account; team membership is a v2 follow-up (ADR § Still open #1).
- **JWT major version bump** — *why excluded:* `account_id` is added **additively** (forward-compat) in `theo-contracts`; a breaking token version is not needed for V1 (ADR § Still open #2).
- **Changing data-plane workspace semantics** — *why excluded:* the `workspace_id == tenant_id` invariant and the Model B per-tenant mint (CWE-441 closure) are preserved; no theo-memory change is in scope.

> Items in this list are off-limits for V1. To reconsider, write a new roadmap revision — do not silently expand scope.

## Constraints

| Category | Constraint |
|---|---|
| Stack | theo-cloud control-plane (Go) + pg-cloud (PostgreSQL); migrations live in the `theo` engine repo (`api/internal/db/migrations`); data-plane (theo-memory, TS) untouched |
| Compliance / legal | Pre-release governance; CWE-441 per-tenant isolation must be preserved; migration MUST be non-destructive (no downtime, legacy keys keep working) |
| Deadline | None hard; pre-release cadence |
| Team | 1 developer (owner) + LLM pair (Claude) |
| Runtime target | local-env (`make up-local` + `make memory-up`) for LIVE validation; cloud = EKS via Helm charts |
| Budget | n/a (uses existing pg-cloud + control-plane infra) |

## Success criteria

**V1 ship criterion (measurable):** an LIVE e2e in which **one Account provisions two isolated
Tenants**, a `theo_live_*` resolves to `{AccountID, TenantID}`, each tenant's data is isolated in
theo-memory (cross-tenant read returns nothing), **both tenants are billed under the one Account's
subscription** with project-count metered per Account, AND a pre-existing single-tenant `theo_live_*`
still returns 200 (backward-compat holds).

**North-star metric (tracked post-launch):** number of Accounts provisioning **≥ 2 isolated tenants**
self-served (the independent-developer-reselling usage that the Account layer exists to enable).

---

## Milestones

> Each milestone has a checkbox in its header. Flip `[ ]` → `[x]` as you complete it (or let `cycle-release` flip it post-merge when the plan carries `milestone_id`). Status lives in this document.

### M0 — [x] Account foundation (walking skeleton, backward-compatible)

**Objective:** introduce the Account entity end-to-end (schema → provisioning → `UserContext.AccountID`) with everything NULL-tolerant, so the architecture is proven without breaking any existing flow.

**Definition of done (all must hold):**

- [ ] Migrations `000034` (`accounts` table, `acct-{16hex}`) + `000035/036` (nullable `account_id` on `tenants`/`theo_api_keys`) + `000037` backfill (one default Account per tenant owner) + `000038/039` link — applied; pg-cloud green.
- [ ] On signup, `TenantProvisioner` creates the Account (1:1 user↔account v1) + a default Tenant inside it; an Account can provision an additional isolated Tenant.
- [ ] `UserContext.AccountID` populated; `ResolveAPIKey` reads `account_id`; reads tolerate NULL (legacy keys); a pre-existing single-tenant `theo_live_*` still resolves and returns 200.
- [ ] Wiring triad per new symbol (caller + integration test + runtime metric); CHANGELOG `[Unreleased]` updated.

**Dependencies:** none (foundation).

**Top risks:**

1. Backfill picks the wrong owner→Account mapping → assert one Account per distinct `tenants.owner_id`; integration test on a seeded multi-tenant fixture.
2. A read path forgets NULL-tolerance and 500s on a legacy key → negative-case test with a pre-migration key.

### M1 — [x] Broker per-Account-scoped mint (lazy validation)

**Objective:** make ForwardAuth/broker Account-aware — authorize `account → tenant` ownership and mint the per-tenant downstream key with `accountID` in the cache key — while theo-memory stays unchanged.

**Definition of done:**

- [ ] `TenantKeyMinter.KeyForTenantScoped(ctx, accountID, tenantID, scopes)`; cache key includes `accountID`; broker **lazily** trusts the resolver's validated `account→tenant` relationship.
- [ ] ForwardAuth rejects a credential whose `account_id` does not own the targeted `tenant_id` (cross-account attempt → 403); the minted key carries only the Tenant (no `account_id` crosses to the data-plane).
- [ ] Model B / CWE-441 round-trip still green: client key stripped, per-tenant key injected; theo-memory `openapi/themory.yaml` seam unchanged.

**Dependencies:** M0.

**Top risks:**

1. Cache-key collision if `accountID` omitted → unit test proving two accounts with same tenant-name mint distinct keys.
2. Lazy validation trusting an unvalidated relationship → ensure the resolver (not the broker) is the single authorization point; integration test for the cross-account 403.

### M2 — [x] Billing per-Account (+ project quota)

**Objective:** move billing from per-tenant to per-Account so all of an Account's tenants share one plan + metered usage, with tenant (project) count quotaed per Account.

**Definition of done:**

- [ ] `subscriptions` gains `account_id` (backfilled from the tenant's Account); plan + metered usage + project-quota resolve at the Account level; `UNIQUE(tenant_id)` retired in favor of per-Account.
- [ ] Provisioning an (N+1)th tenant beyond the Account's plan quota fails with a typed error (negative-case test).
- [ ] e2e: two tenants under one Account aggregate usage under that Account's single subscription.

**Dependencies:** M0 (M1 not required — billing is independent of the mint path).

**Top risks:**

1. Double-billing during the per-tenant→per-Account cutover → migrate read path behind a flag; reconcile test on seeded subscriptions.
2. Quota check race when two tenants provision concurrently → concurrency test (atomic quota decrement / row lock).

### M3 — [x] Enforce + propagate (Phase 2)

**Objective:** close the migration — make `account_id` `NOT NULL` and propagate `account_id` into the JWT (additive) so SDKs adopt it in parallel.

**Definition of done:**

- [ ] Migration `000040` sets `account_id` `NOT NULL` on `tenants`/`theo_api_keys` after the backfill window; no NULLs remain (verified pre-flight).
- [ ] JWT carries `account_id` (additive, forward-compat) via `theo-contracts`; existing tokens without it still validate during the transition.
- [ ] Full V1 ship-criterion e2e passes LIVE (one Account, two isolated tenants, per-Account billing, legacy key 200).

**Dependencies:** M0, M1, M2.

**Top risks:**

1. `NOT NULL` flip with residual NULLs → pre-flight `COUNT(*) WHERE account_id IS NULL` gate before the migration; abort if non-zero.
2. SDK breakage from JWT change → keep `account_id` optional in the contract for the transition; consumer-driven contract test in `theo-contracts`.

### M4 — [x] Engine project-cap enforcement

**Objective:** make the per-Account project cap actually BIND — enforce it at the engine's project-creation path, closing the enforcement descoped from M2 (M2 resolved the cap per-Account but never enforced it at creation, because projects/AI-agents are created in the engine, not via tenant-creation in theo-cloud). Implementation lands in the `theo` engine repo; tracked here as the account-tenancy follow-up, like the M2/M3 migrations.

**Definition of done:**

- [ ] Engine project-creation resolves the Account's cap (`tenant → account → plan_limits`) and rejects the (N+1)th project beyond the cap with a typed error + HTTP 422 (`PROJECTS_EXCEED_PLAN`), mirroring the canonical `REPLICAS_EXCEED_PLAN` pattern (Red Team theo-cloud#101).
- [ ] Negative-case test: a Starter Account (cap=1) creating a 2nd project gets the typed error (closes the M2-descoped quota bullet).
- [ ] Concurrency: two simultaneous creations at the cap boundary cannot both succeed (atomic count+insert — per-account advisory lock OR conditional/unique insert), proven under `go test -race`.
- [ ] Unlimited plan (enterprise, cap=NULL) is never blocked; grandfathered over-cap accounts keep their existing projects (block-new-only — no retroactive break or read failure).
- [ ] Runtime metric `plan_limit_violations{metric="max_projects_per_account"}` increments on rejection (wiring triad pillar c — observability).

**Dependencies:** M2, M3.

**Top risks:**

1. Check-then-create race → two concurrent creations both read `count < cap` and both insert, overrunning the cap. Mitigation: atomic count+insert (per-account advisory lock OR conditional/unique insert) + `-race` boundary test.
2. Mutable cap / grandfathered accounts → a plan downgrade (cap drops below current count) or accounts already over cap. Enforcement bars NEW creation without breaking existing projects or failing reads (explicit block-new-only, tested).

---

### M5 — [x] Hermetic project-cap (close deploy-path bypass #106)

**Objective:** make the per-Account project cap airtight on BOTH creation paths. M4 enforced the explicit `POST /api/v1/projects` path; the deploy-time `EnsureProject` safety-net (`theo deploy <new-name>` → build-orchestrator auto-create) is a SECOND project-row insert path that does NOT consult the cap. Close it without introducing a nested-lock deadlock in the team's build-submit transaction. Tracked as `usetheodev/theo-cloud#106`. Implementation lands in the `theo` engine repo.

**Definition of done:**

- [ ] `EnsureProject` (deploy-time auto-create) consults the same per-Account cap as `CreateProject` before inserting a new project row; over-cap → typed rejection surfaced to the deploy flow (not a silent 500).
- [ ] Deadlock-safe: the cap check composes with the existing build-submit transaction without nesting two advisory locks on overlapping keyspaces (discovery MUST map the build-submit tx lock order first).
- [ ] Existing deploys to ALREADY-EXISTING projects are never blocked (cap applies only to the NEW-project branch of `EnsureProject`).
- [ ] Concurrency: a `theo deploy <new>` racing a `POST /api/v1/projects` at the boundary can't both create — exactly one wins, `-race` proven.
- [ ] Metric `plan_limit_violation{metric=max_projects_per_account}` increments on the deploy-path rejection too (parity with M4).
- [ ] `#106` closed with the verification comment + evidence.

**Dependencies:** M4.

**Top risks:**

1. Nested advisory lock → if the build-submit tx already holds a lock and the cap check takes another on a different keyspace, two concurrent deploys can deadlock. Mitigation: discovery maps the existing lock order; reuse the SAME advisory-lock key (hashtext(accountID)) or do the count+insert in the build-submit tx itself, never a second nested lock.
2. Surfacing the typed rejection through a deploy flow that historically returned generic errors → ensure the 422-equivalent reaches the CLI/user honestly instead of being swallowed as a build failure.

---

### M6 — [x] True full-chain e2e (the real user journey)

**Objective:** close the most material test-coverage gap — there is no automated test that drives the REAL ecosystem chain. Today the frontend is tested with `VITE_USE_MOCKS=true` (never hits the BFF) and the backend e2e inject synthetic JWTs (never go through Kratos/browser); the two halves meet at a mocked seam. Build ONE automated full-chain test that drives a real session through every layer and asserts the outcome the user would see.

**Definition of done:**

- [ ] A single automated e2e drives: real Kratos login → JWT exchange at `/v1/auth/session/token` → authenticated call through the theo-cloud BFF → engine/memory data path → assertion on the real response (no `VITE_USE_MOCKS`, no synthetic seeded JWT).
- [ ] The test proves account-tenancy holds across the REAL chain: a tenant-A session cannot read tenant-B data end-to-end (not stubbed `captureMinter` — real broker → real themory).
- [ ] Includes a project-cap scenario across the chain (ties in M5: a deploy/create beyond cap is rejected end-to-end).
- [ ] Runs in CI: a workflow stage spins up the Model B stack (themory + pgvector + mock-openai + theo-cloud + kratos) and runs the chain; full-stack e2e (`memory_e2e`, `edge_forward_auth_e2e`) gain proper skip-guards so `go test ./...` stays clean while CI runs the real thing.
- [ ] Honest seam documentation: a short doc records exactly what the full-chain test covers vs. what stays unit/mocked, so future readers don't mistake coverage.

**Dependencies:** M3 (JWT account_id propagation), M5 (hermetic cap, so the cap scenario is meaningful), the Model B dev stack (`make dev-up`).

**Top risks:**

1. Headless Kratos login flakiness → driving the real auth flow in CI can be brittle (CSRF tokens, redirects, email verification). Mitigation: discovery maps the dev-stack auth shortcuts already used by `dev/run.sh`; use the same provisioning path, not the production email loop.
2. CI cost/time → spinning the full Model B stack per run is heavy. Mitigation: gate the full-chain stage to run on release PRs / nightly, not every push; keep the fast Go/vitest suites on every push.

---

### M7 — [x] Tenant Blob Storage (managed file storage — complete solution)

> Added 2026-07-14 by `/roadmap-feature` (slug: `tenant-blob-storage`). See CHANGELOG `[Unreleased] § Added`. Sponsor mandate: COMPLETE solution — all journeys, UI, SDK, everything.

**Objective:** ship the customer-requested managed file storage ("storage files", S3 wrapper) as the 4th consumer-key vertical (`/v1/storage/*` alongside memory/observability/rag) — tenant-global private store with virtual folders, 6 core operations, accessed EXCLUSIVELY via existing `theo_live_*` API keys with new `storage:read`/`storage:write` scopes — across every surface: API, CLI, SDK, dashboard UI, dogfood journeys and docs.

**Definition of done:**

> **Engineering status 2026-07-14 (LIVE-gated):** all engineering DoD below is IMPLEMENTED + evidenced. Beyond hermetic tests, the vertical is now PROVEN end-to-end against REAL Postgres + REAL MinIO (local Docker): s3x SigV4 round-trip, full Service chain (upload→download→share→redeem→delete + quota + HIGH-4), and the full HTTP path with EC-2 headers all GREEN (`-tags=integration`) across theo-cloud (API vertical + dashboard), theo-cli (CLI), the `@usetheo/storage` TS SDK, and theo engine (migration 000057 + J-26 journey). Checkboxes stay `[ ]` until the LIVE validation ceremony (Cleanroom + Red Team on the dev-public droplet, per ADR D5 + `cleanroom-up-live-test-mandate.md`) flips them — engineering evidence is necessary but not sufficient. One deviation from DoD: metering is Prometheus-only in the MVP (`theo_storage_bytes_written_total`), NOT written to `cost_counters` — writing a storage metric to the engine's contract-guarded billing table before storage billing exists is premature (YAGNI + blueprint ADR D4); deferred to when storage billing lands.
>
> **Architecture pivot 2026-07-14 (sponsor-confirmed):** storage was extracted into a SEPARATE data-plane service `theo-storage` (new repo `usetheodev/theo-storage`), reached via the edge like theo-memory/theo-rag, and consumed locally by Theokit Studio via the `@usetheo/storage` SDK. The tested domain (quota reserve→commit→compensate under advisory lock, server-derived tenant keys EC-1, HMAC share tokens, EC-2 download hardening) was transplanted verbatim (a composition-root swap, not a rewrite) behind a swappable auth boundary (`static` dev bearer / `header` Model B broker). theo-cloud's in-process vertical became a THIN PROXY via `STORAGE_UPSTREAM_URL` (new `internal/storageproxy`, strangler-fig): unset → in-process (unchanged), set → forwards to theo-storage injecting `X-Theo-Tenant`. Re-verified GREEN this session (fresh, local Docker): theo-cli 9/9, dashboard 4/4, `@usetheo/storage` SDK 6/6 against the live standalone service, theo-storage domain+glue tests, theo-cloud in-process integration (real PG+MinIO), and the proxy strangler-fig E2E (theo-cloud handler → proxy → header-mode theo-storage → PG+MinIO). The LIVE dev-public ceremony (Cleanroom + Red Team) — now covering the deploy of `theo-storage` behind the edge — remains the gate for flipping these checkboxes.

- [ ] **API vertical** `/v1/storage/*` LIVE in the cloud-API with the 6 core operations (`upload`, `download`, `list` by prefix, `delete`, `stat`, `share` temporary signed URL), gated by `storage:read`/`storage:write` scopes registered in the existing `internal/routes/api_keys.go` registry + `scope_middleware`; per-tier caps enforced — **HTTP 402** on aggregate (Starter 100MB · Pro 5GB · Team 25GB · Enterprise custom), **HTTP 413** on per-file (25MB/100MB/500MB/5GB) — two DISTINCT typed errors, never merged; `MetricStorageBytes` metering from day 1.
- [ ] **CLI** `theo storage {upload,download,list,delete,stat,share}` shipped in theo-cli — exit codes 0-5, stable `--json`, zero infra terms in output (Rule 3: "storage"/"files", never S3/bucket/MinIO).
- [ ] **SDK** — TypeScript `@usetheo/storage` (publishable npm package at `sdk/storage-ts`) consuming the same API-key auth, with typed errors + a working example. **Amended 2026-07-14:** the Python SDK is a **named deferral** — the `theo-sdk` repo listed in the umbrella CLAUDE.md does not exist on disk; creating a Python SDK from scratch is its own milestone. TS SDK ships now (sponsor-decided this session).
- [ ] **Dashboard UI** — Storage page in the theo-cloud dashboard: folder browse, upload, delete, stat, generate `share` link; plan quota usage visible (used/limit).
- [ ] **Dogfood journeys** — J-storage journey(s) covering CLI + API + UI LIVE-validated with recorded evidence, house journey pattern + sponsor JUNTOS walkthrough.
- [ ] **Tests per blueprint D4** — unit with DIP-interface mocks; integration against real MinIO with full mint→redeem round-trip of share URLs; hand-rolled SigV4 validated against pocketbase test-vectors; negative cases assert typed errors (402 ≠ 413).
- [ ] **Docs + CHANGELOG** — reference docs for the 6 operations across API/CLI/SDK in product language; wiring triad (caller + integration test + runtime metric) per new symbol.

**Dependencies:** M1 (broker per-Account-scoped mint — the `theo_live_*` keys + scopes that are storage's ONLY access path), M3 (enforce + propagate — the per-Account enforcement chain the 402 caps plug into). M5 is explicitly NOT a dependency (orthogonal deploy-path fix).

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. Proxy data path = cost/bottleneck on the shared cloud-API — every storage byte crosses the same process serving rag/memory/observability. Mitigation: aggressive caps (sponsor cut aggregates 10×), `MetricStorageBytes` + egress metering from day 1, stream timeouts, and a documented architectural escape-hatch (Nhost-style stateless SigV4-rewrap) if the proxy becomes a measured bottleneck.
2. Hand-rolled SigV4 is security code we own — new presign + multipart in the fork-and-own client; a signing bug means cross-tenant file access or silently broken share URLs. Mitigation: pocketbase test-vector validation + mint→redeem round-trip against real MinIO + typed-error negative cases. (Conscious 3rd risk, accepted in the product grill: tenant-global namespace lets staging touch production files — mitigated by path-prefix convention, not mechanism.)

**Why now (from grill Q1):**

Direct customer demand — sponsor verbatim 2026-07-14: "Uma feature que os clientes estão pedindo é storage files onde ele (pode ser wrapper S3)". Deployed apps today would need external S3 to store files; the platform's promise is the app working with zero external config. Product decisions grilled in `theo/.claude/knowledge-base/grills/tenant-blob-storage-grill.md` (8 decisions, READY_FOR_PLAN); architecture locked in the SHIPPABLE 100.0 blueprint `theo/.claude/knowledge-base/discoveries/blueprints/tenant-blob-storage-blueprint.md` (4 ADRs; SOTA peers supabase/storage + hasura-storage + pocketbase + go-cloud already cloned + pinned in the theo repo catalog).

---

### M8 — [x] RAG Connectors reach real users (dashboard page + BFF proxy + OAuth authorization broker)

> Added 2026-07-16 by `/roadmap-feature` (slug: `rag-connectors-ux-oauth-broker`). See CHANGELOG `[Unreleased] § Added`. Subsumes theo-cloud#191 (page + proxy); the OAuth broker is the deeper gap. Prior art: theo-rag#97 (connectors platform in SDK/MCP, closed + LIVE-proven).

**Objective:** turn theo-rag's fully-built 12-provider connectors platform (API + SDK + MCP) into a real human journey in the dashboard — a Connectors page, a BFF that proxies `/v1/rag/connectors`, and the missing piece that makes "connect a data source" one click: an **OAuth authorization broker at the edge** ("Connect with X" → provider consent → callback → `code`→`refresh_token` exchange → `POST /connect`). Today theo-rag deliberately accepts only a pre-obtained `refresh_token` ("the app secret + browser redirect live at the edge"), and that edge does not exist — so connect is developer-only.

**Definition of done:**

- [ ] BFF proxies `/v1/dashboard/rag/connectors/*` (list/connect/sync/get/delete) with the same Model-B per-tenant mint + scope enforcement the other rag routes use (`rag:write` connect/sync, `rag:read` list/get, `rag:delete` delete).
- [ ] **OAuth authorization broker** at the BFF for the OAuth-refresh providers (Google Drive, Gmail, Dropbox, Box, Microsoft-365, Salesforce, Atlassian): `GET /authorize/{provider}` → consent redirect (signed, single-use, **tenant-bound state** + PKCE); `GET /callback/{provider}` → exchange `code`→`refresh_token` → `POST /v1/rag/connectors/{provider}/connect` with `collection_id` + `refresh_token`. The app `client_id`/`client_secret` + `redirect_uri` live ONLY at the edge (never in theo-rag, never in git); the `refresh_token` never reaches the browser (server-to-server).
- [ ] Non-OAuth providers (GitHub PAT, Notion token, Slack bot token, S3 IAM, Zendesk API key, Web crawler) get a typed, server-side credential form in the page (no OAuth dance needed).
- [ ] Dashboard `dashboard/src/pages/rag/connectors.tsx`: list connections (provider · collection · status), "Add source" → provider picker → "Connect with X" (OAuth) or credential form (non-OAuth), per-connection "Sync now" + "Disconnect"; nav entry added to `pages/rag.tsx`.
- [ ] Secret-safety: no credential / `refresh_token` ever reaches the browser or a log (the broker holds it only in-flight); product language only (Rule 3 — "source"/"connect", never OAuth-internal jargon in user copy).
- [ ] Dogfood journey (J-connectors) LIVE-validated on dev-public: an OAuth consent round-trip for ≥1 provider (or a documented sandbox stand-in) **and** a non-OAuth paste-credential connect, both dashboard UI → BFF → theo-rag, with recorded evidence (Cleanroom + JUNTOS per `cleanroom-up-live-test-mandate.md`).

**Dependencies:** M1 (Model-B per-Account-scoped mint — the per-tenant key the BFF injects to reach theo-rag). theo-rag#97 is prior art, not a blocker.

**Top risks (new):**

1. OAuth app registration + secret custody for up to 8 OAuth providers is real operational surface (per-provider `client_id`/`secret`, `redirect_uri` allow-listing, refresh, revocation). Mitigation: ship the broker for 1-2 highest-demand providers first (Google Drive, Dropbox); the rest stay paste-credential until their OAuth app is registered; secrets live in the edge secret store only.
2. The `state`/PKCE + per-tenant binding must be airtight or a callback could attach a source to the wrong tenant/collection (OAuth mix-up / CSRF). Mitigation: signed, single-use, tenant-bound state; the callback validates state→tenant BEFORE the connect POST; negative-case test for a forged/stale state.

**Why now (from grill Q1):** theo-rag#97 just closed — the connectors platform is complete, reachable via SDK/MCP, and LIVE-proven — but a human still cannot connect a source anywhere in the product (no page, no proxy, no OAuth dance). The engine is done; this is the last mile between "built" and "usable." Grounded in the total-program surface audit (API+SDK+MCP+UI) that filed theo-cloud#191; requirements captured in `knowledge-base/grills/rag-connectors-ux-oauth-broker-feature-grill.md`.

---

### M9 — [x] GraphRAG reachable in the Ask UI (strategy selector)

> Added 2026-07-16 by `/roadmap-feature` (slug: `graphrag-in-ask-ui`). See CHANGELOG `[Unreleased] § Added`. Independent of M8.

**Objective:** surface theo-rag's already-shipped retrieval strategies — including **GraphRAG** (`global` community-summary sensemaking + `graph` entity-graph traversal) — in the dashboard Ask page, which today only calls the default `vector` strategy, leaving the headline differentiator invisible.

**Definition of done:**

- [ ] BFF `/v1/dashboard/rag/answers` (+ retrievals where applicable) forwards the optional `strategy` param (`vector|keyword|hybrid|graph|global`) unchanged to theo-rag; default stays `vector` (backward-compatible — no behavior change when absent).
- [ ] `dashboard/src/pages/rag/ask.tsx` gains a strategy selector (design-system `Select`) with outcome-shaped labels ("Fast", "Keyword", "Hybrid", "Entity graph", "Global sensemaking"); the choice threads into the ask request as progressive-disclosure (advanced), default unchanged.
- [ ] The Ask result surfaces which strategy answered and the router trace/fallback when the API returns it, so a user sees when `global` fell back to `vector` (honest — never a silent degrade).
- [ ] Journey: an Ask through the dashboard with `strategy=global` on a graph-enabled collection returns a community-grounded answer; on a non-graph collection it fails-closed to vector without error — both recorded.

**Dependencies:** none (M8 not required — Ask already works end-to-end; this only exposes an existing param).

**Top risks (new):**

1. `global` requires the collection to have run graph extraction / community detection; exposing it without signaling that prerequisite invites "empty/degraded answer" confusion. Mitigation: the UI shows the fail-close behavior and (if the API exposes it) whether the collection is graph-ready; copy sets expectations.
2. Five strategies can overwhelm the default journey. Mitigation: default remains `vector`, the selector is advanced/progressive-disclosure, labels are outcome-shaped not internal jargon.

**Why now (from grill Q1):** GraphRAG is a real differentiator (Microsoft-GraphRAG-style global sensemaking), fully built + tested in theo-rag (community-detection/report/store + global/graph retrievers, exposed on SDK/MCP with fail-close-to-vector), yet `ask.tsx` never sends a `strategy` — the capability is unreachable in the product. A small BFF passthrough + one selector unlocks it. Requirements in `knowledge-base/grills/graphrag-in-ask-ui-feature-grill.md`.

---

### M10 — [x] GraphRAG knowledge-graph explorer (always-on)

> Added 2026-07-16 by `/roadmap-feature` (slug: `graphrag-explorer-always-on`). See CHANGELOG `[Unreleased] § Added`. Depends on M9.

**Objective:** turn GraphRAG from a hidden retrieval strategy into a first-class, always-on EXPLORER. The knowledge graph (entities + relationships + hierarchical communities) is built once at ingestion and persisted, so it is shown the moment a collection is picked — no question needed — as an interactive graph beside the community reports.

**Definition of done:**

- [ ] theo-rag exposes read endpoints `GET /v1/collections/:id/graph?level=&limit=` (top-N entities by degree + edges among them + community per node) and `GET /v1/collections/:id/communities?level=` (report summary + members), read-scoped (`rag:read`) + workspace-scoped, over the persisted graph (no schema change) — merged to `main`.
- [ ] theo-cloud BFF proxies both under `/v1/dashboard/rag/collections/{id}/{graph,communities}` (per-tenant key, fail-closed, opaque) — merged to `main`.
- [ ] `dashboard/src/pages/rag/graphrag.tsx` renders a force-directed graph (nodes coloured by community, sized by degree) + a community-reports panel + a Leiden level slider, ON collection-pick (no question); Ask is a secondary panel — merged to `main`.
- [ ] LIVE-validated on dev-public (the graph renders for a graph-enabled collection); released `develop → main` in both repos.

**Dependencies:** M9 (GraphRAG reachable in Ask — same theo-rag capability + BFF surface).

**Top risks (new):**

1. A `develop → main` release cut bundles the whole unreleased backlog (theo-cloud + theo-rag). Mitigation: validate the rest of the backlog before the cut; split releases if needed; the merge is human-gated (Rule 4).
2. The graph canvas is fixed-size and top-N-bounded; dense graphs render tightly. Mitigation: resize + collapse/expand deferred to M13.

**Why now:** the explorer is already engineering-complete + LIVE-validated cross-repo this session (theo-rag `9481ae8`, theo-cloud `22755ca`; DB=endpoint=render 35/56/7 confirmed), but is NOT in the roadmap nor released. This milestone FORMALIZES it and cuts the release that flips the checkbox — so shipped reality matches the roadmap.

---

### M11 — [x] Upload documents (PDF / office / CSV / image) from the dashboard

> Added 2026-07-16 by `/roadmap-feature` (slug: `dashboard-file-upload`). See CHANGELOG `[Unreleased] § Added`. Depends on M6.

**Objective:** let a user ingest real FILES (PDF, office, CSV, image) from `/rag/documents`. Today the dashboard only accepts PASTED TEXT (a Textarea → `POST /v1/documents/raw`), even though theo-rag's engine fully supports files (unpdf + docling loaders, scanned-doc detection) via `POST /v1/documents` (multipart).

**Definition of done:**

- [ ] `/rag/documents` gains a file picker / drag-drop dropzone accepting PDF, office, CSV, and image (client-side type + size validation; clear rejection on unsupported/oversize).
- [ ] theo-cloud BFF proxies the multipart upload to theo-rag `POST /v1/documents` with the per-tenant key (file streamed/forwarded opaquely; `ingest_mode` hi-res/fast honoured).
- [ ] Ingest status surfaces in the documents list (async 202 → poll → ready / failed); a parse failure shows a typed error, never a silent drop.
- [ ] LIVE-validated on dev-public: upload a real PDF → the document appears → chunks are ingested → it is answerable via Ask.

**Dependencies:** M6 (the documents journey exists end-to-end).

**Top risks (new):**

1. Multipart body size + timeout limits at the BFF and the edge (Caddy) — a large PDF could 413/timeout. Mitigation: bound the size client-side + server-side with a clear typed error; stream rather than buffer where possible.
2. Scanned-PDF / OCR (docling hi-res) latency + cost. Mitigation: expose the ingest-mode choice, keep ingestion async with visible status.

---

### M12 — [x] Connect data sources from the dashboard (OAuth + paste-credential)

> Added 2026-07-16 by `/roadmap-feature` (slug: `dashboard-connectors-usable`). See CHANGELOG `[Unreleased] § Added`. Depends on M8.

**Objective:** make connectors actually USABLE from the UI. Today the "Connect a source" dialog (M8) shows no connectable provider: the OAuth "Connect with X" list is empty until an operator registers an OAuth app, and non-OAuth (paste-credential) providers are not exposed in the dashboard at all.

**Definition of done:**

- [ ] At least one OAuth provider is registered (operator: `THEO_RAG_OAUTH_<P>_CLIENT_ID/_SECRET`) so "Connect with X" runs end-to-end LIVE: consent → callback → `refresh_token` → connect → first sync.
- [ ] A paste-credential form for non-OAuth providers (S3 key / web URL / token) posts to the connect proxy from the dashboard (credential forwarded opaquely, never logged — Rule 8).
- [ ] theo-rag `CONNECTOR_VAULT_KEY` is configured on dev-public so a connect SUCCEEDS (not `503 connector_vault_unconfigured`) and the credential is encrypted at rest.
- [ ] LIVE-validated on dev-public: a real connect (OAuth or paste-credential) + first sync ingests documents into a collection.

**Dependencies:** M8 (connectors page + BFF proxy + OAuth broker exist).

**Top risks (new):**

1. OAuth app registration is an operator action in a third-party console (Google/Dropbox) — this milestone cannot complete fully autonomously; the OAuth-consent half needs a real app.
2. Credential custody: connector credentials (refresh_token / S3 keys) must be encrypted at rest via the connector vault and never appear in logs. Mitigation: the vault-key gate + the opaque-forward discipline already established in M8.

---

### M13 — [x] GraphRAG rich explorer (community reports + interactions)

> Added 2026-07-16 by `/roadmap-feature` (slug: `graphrag-rich-explorer`). See CHANGELOG `[Unreleased] § Added`. Depends on M10.

**Objective:** enrich the GraphRAG explorer from a static read into a real exploration surface — generate the community-report SUMMARIES (today they render "Summary not generated yet."), make reports clickable, let communities expand/collapse, and make the graph canvas full-page.

**Definition of done:**

- [ ] Community-report generation runs for a graph-enabled collection so `graph_communities.summary` / the report table is populated — no "Summary not generated yet." for such collections.
- [ ] Reports are clickable → full report text + findings (Microsoft-GraphRAG report structure), in a side panel or sheet.
- [ ] Communities expand/collapse in the graph (community super-node ↔ member entities); selecting a node/community highlights it and its neighbourhood.
- [ ] The graph canvas is full-page / resizable (not fixed 640×440); large graphs stay navigable (top-N / collapse / WebGL as needed).
- [ ] LIVE-validated on dev-public.

**Dependencies:** M10 (the explorer + the graph/communities endpoints exist).

**Top risks (new):**

1. LLM cost of report generation is O(communities) LLM calls. Mitigation: theo-rag already caches reports by content-sha (survives community re-clustering); generate on-demand, reuse on unchanged communities.
2. Visualization performance on dense graphs (thousands of nodes). Mitigation: top-N-by-degree, community super-nodes (collapse/expand), WebGL rendering for large graphs.

---

### M14 — [x] System-wide standardized modal component (AppModal)

> Added 2026-07-18 by `/roadmap-feature` (slug: `standard-modal-component`). See CHANGELOG `[Unreleased] § Added`. Depends on the dashboard + `@usetheo/ui` Dialog (foundational — already present).

**Objective:** make "modal" the system-wide standard for transient action screens by shipping ONE reusable, componentized modal (`AppModal`) built on the design-system `Dialog`, and route the Wiki's action screens (New folder, New page, Search) through it — so future screens reuse one primitive instead of each inventing its own dialog/pane. Reading/editing an existing page stays in the master-detail split (not a modal — long-form editing belongs in a pane).

**Definition of done:**

- [ ] `dashboard/src/components/ui/app-modal.tsx` — a reusable modal (sizes sm/md/lg/xl, header/title/description + body + footer-actions slot) built on `@usetheo/ui` `Dialog` (not reinvented — Rule 9), with unit tests (open/close, sizes, footer render, escape/overlay close).
- [ ] Wiki (`/rag/wiki`): New folder and New page open through `AppModal` (New page moves OUT of the side pane into the modal; on create it closes and opens the new page in the split reader). Search stays the `@usetheo/ui` CommandPalette (the design-system search modal).
- [ ] `NewFolderDialog` is rebuilt on `AppModal` so the Wiki AND Workspace "New folder" share the one standardized primitive without touching Workspace page code.
- [ ] Reading/editing an existing page remains in the master-detail split (unchanged); the browser is full-width behind an open modal.
- [ ] Typecheck + ESLint + the full dashboard test suite green; production build green.
- [ ] LIVE-validated on dev-public (`app-dev.usetheo.dev/rag/wiki`): New folder + New page modals open/close/create; the served bundle hash matches the build.

**Dependencies:** none blocking — the dashboard and `@usetheo/ui` `Dialog` already exist; the primitive is applied to the Wiki first (the RAG dashboard surfaces exist). Workspace + remaining screens roll onto `AppModal` in follow-up passes.

**Top risks (new):**

1. `NewFolderDialog` is shared with the Workspace — rebuilding it on `AppModal` could ripple a visual/behavior regression into the Workspace "New folder". Mitigation: preserve the exact props + behavior; the full dashboard test suite (1767 tests) is the regression net; convert only `NewFolderDialog`, defer other Workspace screens.
2. A modal primitive must trap + restore focus (accessibility) and the PWA service worker can serve a stale bundle after deploy. Mitigation: build on the design-system `Dialog` (already focus-correct + a11y); post-deploy verify the served bundle hash matches the build and hard-reload to clear the SW.

---

### M15 — [x] Deploy-journey data honesty (M-A)

**Objective.** Every number the deploy journey shows must be REAL — rebind the fabricated / hardcoded values surfaced by the 2026-07-19 deploy-journey review to the backend data that already exists. Same defect class as the Overview Usage fix (v0.60.0): UI bound to values the API never populated.

**Definition of done:**

- [ ] Scale page shows the REAL current replica count from `useProjectStatus` (`status.scaling.replicas ?? replicas_desired`), NOT the hardcoded `DEFAULT_CURRENT_REPLICAS = 2`; the cost delta + confirm-impact paragraph reflect the true current value (`project-scale.tsx:20,82,234`). Falls back to a neutral state only when the field is genuinely absent.
- [ ] `project-status.tsx` binds `alerts_active` from `status.alerts_active` (present on the wire, `types.ts:491`) instead of hardcoded `null`, so the Alerts signal reflects reality (`:213`).
- [ ] The KEDA / scale-to-zero cluster-availability flag is sourced from the status/scale response (fail-CLOSED default), not hardcoded `true` (`project-scale.tsx:81`).
- [ ] `delete-environment-dialog` cascade counts are accurate (real workloads/secrets/domains) OR the numeric cascade lines are removed and only the qualitative warning kept — no fabricated blast-radius number (`:122`); `deployment-detail-layout` no longer passes a hardcoded `repoUrl: null` (`:148`).
- [ ] TDD for each rebind (RED asserts real value, no hardcode); typecheck + ESLint + full dashboard suite + production build green; LIVE-validated on `app-dev.usetheo.dev` with a real project (Scale shows the true replica count).

**Dependencies:** M14 (baseline). No new backend endpoint — all fields already exist on the status/billing wire.

**Top risks (new):**

1. The status endpoint may omit `scaling` for never-deployed projects → the fallback must be honest (neutral / "—", never a fabricated "2"). Mitigation: fall back only when the field is truly absent; assert this in a negative-case test.
2. Accurate cascade counts may need a backend field that isn't emitted yet. Mitigation: if absent, DROP the number (qualitative warning only) rather than invent one — honesty over completeness.

---

### M16 — [x] Rule 3 term-leaks + deploy-journey dead-ends (M-B)

**Objective.** Remove the internal-implementation terms leaking into user-facing copy (Unbreakable Rule 3) and the navigation dead-ends found in the deploy journey.

**Definition of done:**

- [ ] No internal terms in user-facing copy: `cosign` (`project-connect.tsx:481`) and `KEDA` / `cluster` (`keda-toggle.tsx:97`) replaced with product language (e.g. "signed, verifiable image"; "scale-to-zero isn't available on your plan/region").
- [ ] Opening a project ranked beyond the 50-project page no longer shows a false "Project not found": `project-detail.tsx` resolves the single project via a name-scoped fetch (`GET /projects/:name`) instead of `.find()` over a client-capped list (`:44`).
- [ ] Runtime logs are not hardwired to `?env=production`: an env selector (or status-derived env) plus an explicit empty-state when the chosen env has no release — no silent empty viewer (`runtime-logs.tsx:28`).
- [ ] Domains list surfaces `total` and/or pagination so capped rows are reachable (`domains.tsx:159`).
- [ ] TDD; gates green; LIVE-validated (a >50-project tenant opens the 51st project; a preview-only project sees a real logs empty-state, not a hang).

**Dependencies:** M14 (baseline).

**Top risks (new):**

1. The single-project fetch (`GET /projects/:name`) must return the shape the detail page needs. Mitigation: verify the endpoint contract before swapping the client `.find()`; keep a graceful fallback.
2. The runtime-logs env selector must not regress the common production-default case. Mitigation: default to the project's active env from status; production stays the default when it has a release.

---

### M17 — [x] Deploy-journey Sheets → centered modals (M-C)

**Objective.** Finish the owner's "no lateral panels" mandate for the deploy journey — migrate the 5 remaining `Sheet` side-panels to the standardized centered `AppModal` (M14).

**Definition of done:**

- [ ] `create-project-sheet`, `create-environment-sheet`, `add-domain-sheet`, `add-secret-sheet`, and `signal-detail-sheet` render as centered `AppModal` (not lateral drawers), preserving props / behavior / validation.
- [ ] `create-environment-sheet`'s three return branches (error / empty / form) are all converted; the form submit is wired via `AppModal` `footer` + a form `id`.
- [ ] No `Sheet`-based side panel remains anywhere in the deploy journey (grep-clean in the migrated files).
- [ ] TDD per migrated surface; gates green; LIVE-validated each modal opens/closes/submits centered.

**Dependencies:** M14 (AppModal primitive exists).

**Top risks (new):**

1. `AppModal`'s API (`onClose` / `footer` prop) differs from `Sheet` (`onOpenChange` / `<Sheet.Footer>`), so wiring bugs are easy. Mitigation: reuse the M14 migration pattern; the full suite is the regression net.
2. `add-secret-sheet` is security-sensitive — the migration must NOT change masking / `type=password` / no-echo behavior. Mitigation: a negative-case test asserting the secret value is never rendered survives the migration.

---

### M18 — [x] Destructive-action safety + fail-silent errors (M-D)

**Objective.** Close the destructive-action friction gaps and the fail-silent error paths in the deploy mutations so a stray click can't revert a release and a failed action never hides its reason.

**Definition of done:**

- [ ] Non-production rollback requires a real confirmation (not a one-click revert) — friction scaled to risk, parity in spirit with the production confirm-phrase (`rollback-dialog.tsx:40`).
- [ ] `project-connect` Disconnect is behind a confirmation AND has a `catch` that surfaces the error to the user (no silent no-op) (`:259`).
- [ ] Add-domain binds Project / App / Environment via `Select` populated from real projects/envs — no free-text typo path that registers a domain against a non-existent workload (`add-domain-sheet.tsx:83`).
- [ ] `usePromoteEnvironment` uses `{ throwOnError: true }` and maps the typed 4xx codes (BUILD_NOT_TERMINAL / PROJECT_NOT_FOUND / ENV_NOT_FOUND) to specific messages — parity with the already-fixed `useRedeploy` (`use-environments.ts:101`).
- [ ] TDD including negative-case tests that assert the SPECIFIC typed error surfaces (not a generic guess); gates green; LIVE-validated (a failed promote shows the specific reason; a non-prod rollback asks to confirm).

**Dependencies:** M14 (baseline); soft-after M17 if add-domain becomes a modal in that pass (not blocking).

**Top risks (new):**

1. Over-friction on non-prod rollback could annoy day-to-day use. Mitigation: a lightweight confirm (single explicit step), not the full type-the-phrase gate reserved for production.
2. Turning on `throwOnError` may surface errors elsewhere that were previously swallowed. Mitigation: audit `usePromoteEnvironment` callers; ensure each renders the error rather than crashing.

---

### M19 — [x] Deploy-journey cleanup + Live-URL parity (M-E)

**Objective.** Remove the duplicated / drifting deploy surfaces and add the missing "click your deployed app" affordance (Vercel-parity).

**Definition of done:**

- [ ] Exactly ONE deployment-detail implementation is routed; the dead one (`deployment-detail.tsx` vs `deployment-detail-layout.tsx`) is deleted after confirming the routed component in `app.tsx`; the humanize-author (`:215`) + hours-aware `formatDuration` (`:57`) divergences are resolved in the survivor.
- [ ] The legacy `PromoteDialog` (dropdown variant) is deleted after confirming no live caller (the sponsor-preferred `PromoteToProductionDialog` stays) — removing the reintroduced promote race.
- [ ] A succeeded deploy prominently surfaces the Live URL (`BuildApp.url`, `types.ts:228`) — the "here's your app, click it" link — rendered only when a real active release exists (no fabricated URL).
- [ ] `formatDuration` extracted to `@/lib/format` (hours-aware) and used by BOTH the list and the detail view (DRY).
- [ ] TDD; `/code-quality` confirms the deleted surfaces have zero callers (no dead code); gates green; LIVE-validated (a succeeded deploy shows a clickable Live URL).

**Dependencies:** M14 (baseline); logically LAST of M-A..M-E (M-A/M-B/M-D also touch `deployment-detail`, so delete the duplicate after they land to avoid rebase churn).

**Top risks (new):**

1. Deleting the wrong deployment-detail impl breaks the route. Mitigation: confirm the routed component in `app.tsx` FIRST; the full suite + a LIVE smoke are the net.
2. The Live URL must render only for a genuinely serving release. Mitigation: gate on the real active-release/status URL — never synthesize a URL for a non-serving build.

---

### M20 — [x] Environments as a project dimension

**Objective.** Move environment management out of the confusing global top-level `/environments` page and into the project context, where the domain actually scopes it (canonical namespace `theo-<tenant>-<project>-<env>`). Make the journey coherent — Overview → Project → Environment switcher → per-env surfaces — and make every environment mutation know its project instead of guessing it.

**Why now.** System Design review (2026-07-19): `/environments` is the ONLY one of 10 per-(project,env) dimensions modelled as a global top-level nav item — the other nine (`secrets`, `scale`, `logs`, `status`, `deployments`, `previews`, `readiness`, `connect`, `repository`) are already nested under `/projects/:name/*`. The global page's `GET /api/v1/environments` mixes every project's envs, and its create/promote/delete GUESS the project (`?project=` ?? first-project ?? the `'teste'` fixture) — a control surface that can't correctly scope its own actions. Industry SOTA (Vercel/Railway/Render/Heroku) all scope environment to the project. This is an IA/System-Design defect, not polish.

**Definition of done:**

- [ ] `/environments` is removed from the top-level sidebar nav; environments live at `/projects/:name/environments` (a project sub-route/tab, consistent with the other nine per-project surfaces). A redirect from the old `/environments` path prevents bookmarked-link 404s.
- [ ] Create / promote / delete environment operate on the UNAMBIGUOUS project from the route — the `?project=` ?? first-project ?? `'teste'`-fixture guess is deleted; the project is the route param.
- [ ] (Refined out per plan ADR-1 — deferred) A project-level environment switcher unifying secrets/domains/scale/logs/deployments requires a shared project layout (the `/projects/:name/*` routes are flat siblings) and does not fit `domains` (flat per-row env); it is a follow-up enhancement, not the KISS "simple to use" core of this milestone. M20 re-homes env management into the project (the actual defect); the cross-surface switcher is explicitly deferred.
- [ ] If a cross-project environment overview is retained for operators, it is READ-ONLY (no create/promote/delete) — every mutation lives only where the project is known.
- [ ] TDD; typecheck + ESLint + full dashboard suite + production build green; LIVE-validated on `app-dev.usetheo.dev` (create + promote + delete an environment from inside a project; the global nav item is gone; old `/environments` redirects).

**Dependencies:** M15–M19 (deploy-journey hardening baseline, all `[x]`) — M17 (centered AppModal) supplies the create/promote/delete modals this milestone re-homes; M18 (add-domain env Select, rollback env-aware confirm) already assumes a per-project env model.

**Top risks (new):**

1. Removing a top-level nav item + re-homing the route touches routing, the sidebar, and every internal link to `/environments`. Mitigation: grep all `/environments` references; ship a redirect (`/environments` → the project context or the projects list) so old links/bookmarks don't 404; the full suite is the regression net.
2. The environment switcher must not regress the existing per-surface env handling (secrets filter, M16 runtime-logs selector, scale's production default). Mitigation: introduce the switcher as the single source of the active env and route each surface through it incrementally, keeping `production` as the default; assert per-surface env behaviour with tests before and after.

---

### M21 — [x] Painel discreto de versões dos serviços

**Objetivo:** dar verdade ao indicador de status do sidebar e expor, num painel discreto,
qual versão de cada serviço Theo está de fato implantada.

O rodapé do sidebar já mostra `● Operational` com `role="status"` e
`aria-label="System status: all systems operational"` — **hardcoded**. Ele fica verde com
todos os serviços fora do ar. Isso é pior que ausência: quem olha para de procurar.
Somado a isso, hoje não há como saber qual versão está implantada sem SSH no host.

**Gatilho (medido em 2026-07-28):** a imagem do theo-memory ficou **nove commits sem
construir** e ninguém percebeu; o theo-rag trocou de versão **duas vezes em quatro
minutos** (`36ccf49` → `3dc878c`), invisível para todos.

**O que já existe e é reusado** (nenhuma peça nova de infraestrutura):

| Peça | Onde |
|---|---|
| `GET /v1/version`, contrato idêntico | theo-memory, theo-rag, theo-lens |
| Clients por capacidade | `internal/{themory,rag,thelens,storage}` |
| Slot discreto no rodapé | `dashboard/src/components/layout/app-sidebar.tsx` |

**Conteúdo exibido:** `version` + estado + horário (`built_at` quando houver).
**NÃO** expõe `git_sha` — é dado de infraestrutura.

**Escopo:** ambiente de **dev** apenas. `theo-storage` aparece como `not_deployed` em vez
de ser omitido — omiti-lo esconderia que ele existe e não subiu.

**Definition of done:**

- [ ] Um `GET` no gateway agrega os três serviços **em paralelo**, com timeout curto, devolvendo por serviço `{name, version, state, built_at}`.
- [ ] Os **três** estados têm teste: `ok`, `unreachable`, `not_deployed` — e `unreachable` **nunca** exibe a última versão conhecida.
- [ ] O `●` do rodapé do sidebar deixa de ser hardcoded e reflete o agregado.
- [ ] Clicar nele abre a página.
- [ ] A resposta carrega o horário da **coleta**, distinto do `built_at`.

**Dependencies:** nenhuma. Os 21 milestones anteriores estão `[x]`, então qualquer
dependência declarada estaria satisfeita na hora e seria decorativa. As peças reusadas
(clients, sidebar, endpoints) já existem e não são milestones pendentes.

**Top risks (new):**

1. **O agregador segura o sidebar.** A rota consulta três serviços por request; se um pendurar sem timeout, ela segura o sidebar **inteiro** — um painel de diagnóstico derrubando a navegação é o pior desfecho possível, porque a ferramenta que existe para revelar falha vira a falha. Mitigação: timeout curto por serviço + render otimista, com o `●` nunca bloqueando a renderização.
2. **Regressão global pelo componente compartilhado.** `app-sidebar.tsx` é usado por **todas** as páginas; regressão ali não é local. Mitigação: a suíte já existe (`app-sidebar.test.tsx`, `app-sidebar-nav.test.tsx`) e passa a cobrir os três estados.

---

### M22 — [x] theo-cloud diz a verdade sobre si mesmo (entrega confiável + presença no painel)

> Added 2026-07-30 by `/roadmap-feature` (slug: `theo-cloud-delivery-truth`).
> See CHANGELOG `[Unreleased] § Added`. Grill: `knowledge-base/grills/theo-cloud-delivery-truth-feature-grill.md`.

**Objetivo:** fechar o caminho de entrega do `theo-cloud` para que nada chegue ao host de
public-dev sem passar pelos testes, e fazer o serviço reportar honestamente qual versão está
rodando — aparecendo na página `/status` ao lado dos outros, com `Service · State · Version · Built`.

**Gatilho (medido em 2026-07-30, `/loop-devops-audit`, veredito `INVALID` score 46.0):**

| O que foi medido | Número |
|---|---|
| Commits que publicaram imagem com gate vermelho | **12** (`3daf3663` subiu 2 imagens com `ci`+`quality`+`SAST` falhando) |
| `needs` do `publish.yml` sobre `ci`/`quality`/`security-sast` | **nenhum** |
| Resposta do `/v1/version` do theo-cloud | **401**, contada pelo reconciliador como "proveniência confere" |
| Serviços no agregado de `/status` (`cmd/main.go:168`) | **4** — o theo-cloud não está entre eles |
| Canais em que o gate Trivy roda | **nenhum** — `trivy` default `false`, `publish.yml` nunca o passa |
| Jobs sem `timeout-minutes` | **12 de 13** |

O modelo de referência resolve isto no mesmo workspace: `theo-memory/.github/workflows/publish.yml:143`
declara `needs: [guard-release-on-main, gate-ci, gate-contract]` e passa `trivy/sign/verify: true` no
caminho develop, usando **o mesmo reusable vendorizado**. Não é limite de plataforma — é configuração
não herdada.

**Definition of done:**

- [ ] `publish.yml` não publica imagem sem `ci`, `quality` e `security-sast` verdes — gates invocados por `workflow_call` (síncrono, mesmo run, preserva `github.sha`), nunca `workflow_run`. Verificável: um commit com teste vermelho não produz job `images` bem-sucedido.
- [ ] O canal `:develop` sai escaneado e assinado — `trivy: true`, `sign: true` — e `provenance` deixa de receber o literal `false`. Verificável: `cosign verify` resolve para a tag `:develop` publicada.

  > **`verify` permanece preso a tag, por ADR 0004 (ACCEPTED, 2026-07-30) § D1** —
  > `.claude/knowledge-base/adrs/0004-m22-dod-verify-e-concurrency.md`. O texto original deste item
  > pedia `verify: true` no canal develop; a implementação assina incondicionalmente mas só
  > *verifica* em tag. Motivo: `cosign verify` resolve contra Rekor/Fulcio **depois** do push, então
  > uma indisponibilidade do Sigstore reprovaria um run cuja imagem **já foi publicada** — e o
  > reconciliador do host converge por `:develop` a cada 5 min, adotando uma imagem que o pipeline
  > declara ter falhado. O raio de dano é assimétrico: em tag não há reconciliador convergindo.
  >
  > O critério observável do item continua satisfazível — `sign: true` é incondicional e a âncora de
  > identidade aceita `refs/heads/develop` — mas **ninguém o executa automaticamente**, e isso é a
  > dívida: uma regressão de assinatura no canal que a produção consome só apareceria na próxima tag.
  > Destino registrado no ADR: verificação out-of-band do `:develop` (job agendado ou step
  > `continue-on-error`), nenhuma das duas reintroduzindo o modo de falha acima.
  >
  > Emenda escrita em 2026-07-31, após a review do milestone apontar que esta divergência — ao
  > contrário da do item 6 — estava decidida em ADR mas não refletida aqui. O texto do DoD afirmava
  > algo que o código não faz.
- [ ] `GET /v1/version` do theo-cloud responde sem 401 e reporta o commit **da imagem em execução**. Verificável: o valor bate com `org.opencontainers.image.revision` da imagem que o host roda.
- [ ] `theo-cloud` aparece em `https://app-dev.usetheo.dev/status` junto aos demais, com as quatro colunas já existentes, alimentado por **metadados de build in-process** — nunca por uma chamada HTTP do serviço para si mesmo.
- [ ] O `Dockerfile` não deixa credencial em camada: o `git config --global` da linha 20 deixa de persistir `/root/.gitconfig`, que hoje é exportado ao cache do Actions por `cache-to: mode=max`.
- [ ] Higiene de pipeline fechada: `timeout-minutes` em todo job que pode carregá-lo, as 9 actions não pinadas fixadas por SHA (prioridade `dorny/paths-filter`, o único terceiro e justamente o que decide se a imagem sai), e a chave de `concurrency` do publish **presa ao ref**, travada por teste.

  > **A prescrição de re-chavear `concurrency` por commit foi rejeitada em ADR 0004 (ACCEPTED,
  > 2026-07-30)** — `.claude/knowledge-base/adrs/0004-m22-dod-verify-e-concurrency.md` § D2. O sintoma
  > que o DoD nomeia (run duplicado) já foi fechado por outro mecanismo: o M22 removeu o gatilho
  > `push:` de `ci.yml` e `quality.yml`, que passaram a ser invocados por `workflow_call`. O run deixa
  > de **existir** em vez de ser iniciado e cancelado — degrau 1 da parsimônia, e mais barato, porque
  > um run cancelado ainda paga fila e setup. Confirmado em 2026-07-31: os dois workflows declaram
  > apenas `workflow_call` + `pull_request`, e **todo duplicado observado no histórico é de 23–29/07,
  > anterior à cirurgia**.
  >
  > Re-chavear por commit também quebraria o caso tag: `github.sha` é **idêntico** entre o push de uma
  > tag e o commit de develop que ela aponta, então uma chave por SHA faria um run cancelar o outro,
  > perdendo um dos dois artefatos.
  >
  > Acrescentado em 2026-07-31: a decisão passou a ser travada por teste em
  > `internal/ci/publish_controls_test.go` (`TestPublishConcurrencyStaysKeyedByRefNotCommit` mais um
  > guard sintético que prova que a asserção reprova a configuração ruim). O ADR registrava a decisão;
  > o teste impede que alguém a desfaça lendo só o texto deste DoD.

**Não entra neste milestone** (registrado aqui, não na seção macro de escopo — cada item com destino):

| Item | Por que fora | Destino |
|---|---|---|
| Rotação do `GOMOD_TOKEN` + purge do cache `gha` | Caches passados já contêm o token; esperar o milestone fechar mantém a exposição aberta | **Ação imediata**, decisão do operador em 2026-07-30 |
| Reconciliador convergente + eixo de proveniência tratando 401 como INDETERMINADO | O script vive em `theo-ops`, outro repositório | `theo-ops` |
| Branch protection / segregação de funções (CC6.3, CC8.1) | `403 Upgrade to GitHub Pro` — decisão de plano ou de divulgação, não tarefa de engenharia | Decisão do dono |
| `theo-host-firewall.service` morto, portas em `0.0.0.0` | Hardening de host; sem exposição ativa (probe externo: todas closed/filtered) | `loop-security-audit` |
| Instância órfã `theo-workspace-theo-cloud-1` (26h desatualizada) | Operação de host, não código deste repo | `theo-ops` |

**Dependencies:** `M21`. Os 21 anteriores estão `[x]`, então a dependência seria decorativa na
maioria dos casos — M21 é nomeada por ser **substantiva**: este milestone estende o agregado que ela
construiu, e sem ele a quarta linha da DoD não teria onde aterrissar.

**Top risks (new):**

1. **Colocar o gate converte falha invisível em entrega parada.** A taxa de falha medida em develop é
   alta, e a auditoria a atribuiu a gates *reprodutivelmente* vermelhos, não a flakiness
   (`rerun_rate = 0.017`, abaixo do piso de 0.05). Ou seja: o risco não é teste instável — é que
   falhas reais, hoje invisíveis para a entrega, passem a aparecer como entrega bloqueada. É o
   comportamento pretendido, e vai parecer regressão na primeira semana. Mitigação: fechar os gates
   vermelhos **dentro** deste milestone, não depois dele.
2. **Auto-probe no agregado.** O coletor roda dentro do processo que passaria a sondar. Uma fiação
   ingênua faz a saúde da página depender do próprio caminho de request que ela reporta, e uma falha
   parcial produziria uma página que trava em vez de uma que diz "degradado". Mitigação: reportar o
   `theo-cloud` por metadados de build in-process e deixar a política de timeout dos quatro serviços
   remotos intacta.

**Why now:** o `/status` existe desde M21 e omite justamente o serviço que o serve; adicioná-lo hoje
o mostraria `unreachable`, porque o `/v1/version` responde 401. O mesmo 401 é o eixo de proveniência
que o reconciliador conta como verde. E acima dos dois, nada impede que código com teste vermelho
chegue ao host em ~6 minutos. Os três são o mesmo problema visto de três ângulos: o sistema não
consegue provar o que está rodando.

---

### M23 — [x] A camada de confiança fica visível no dashboard (leitura)

> Added 2026-07-31 by `/roadmap-feature` (slug: `theo-cloud-trust-dashboard`).
> See CHANGELOG `[Unreleased] § Added`. Grill: `knowledge-base/grills/theo-cloud-trust-dashboard-feature-grill.md`.

**Objetivo:** dar ao operador as duas primeiras superfícies da capacidade `trust` no dashboard —
uma visão geral com KPIs e tendências, e a lista de violações de política navegável até a conversa
de origem — atravessando as três camadas que lens e RAG já usam (data client Go → rota BFF → tela
React), com dado real vindo da instância implantada do `theo-trust`.

**Gatilho (medido em 2026-07-31 contra a instância implantada e os dois repositórios):**

| O que foi medido | Resultado |
|---|---|
| `theo-trust` responde pela borda pública com a chave real do operador | `GET /v1/trust/version` → **200** `develop-6f17600`; `policy-violations` → **200** com dados |
| Telas de trust no dashboard | **zero** — `ls dashboard/src/pages` não tem `trust` |
| Broker Model B por tenant | **existe e testado** — `internal/trust/broker.go`, `internal/trust/admin_client.go` |
| Rotas BFF consumindo esse broker | **zero** — `grep -rn "internal/trust" internal/routes/` não retorna nada |
| Data client de leitura para o `theo-trust` | **inexistente** (o análogo do lens é `internal/thelens/data_client.go`) |

A capacidade produz sinal que hoje só é observável por `curl`. A parte cara — isolamento por tenant,
cunhagem de menor privilégio, fail-closed sem fallback master — **já está pronta**; falta o caminho
de leitura e a superfície.

**Definition of done:**

- [ ] Data client de leitura em `internal/trust` consome o broker existente por tenant, resolvendo o Bearer por requisição a partir do JWT — **sem credencial permanente e sem fallback master**. Verificável: um resolver que falha produz zero requisição upstream (paridade com `internal/thelens/data_client.go`).
- [ ] Rotas BFF `GET /v1/dashboard/trust/trends`, `/policy-violations` e `/conversations/{id}` atrás de `requireJWT`, exigindo `trust:read`. Verificável: chamada sem o escopo responde 403, não 200 com dado de outro tenant.
- [ ] Páginas `/trust` (visão geral, KPIs + tendências) e `/trust/violations` (lista + detalhe navegável até a conversa) sob o `DESIGN.md` travado, com validação manual 5Q-3s pelo revisor — o gate universal daquele documento.
- [ ] Isolamento por tenant provado por teste: dois tenants distintos, a resposta de um nunca contém linha do outro.
- [ ] **Funcional e2e:** chave real do dashboard → tela → BFF → broker → API do `theo-trust` implantada → dado real renderizado. Um milestone que compila e testa, mas cuja tela não mostra dado vindo do serviço implantado, NÃO fecha.

**Dependências:** M21 `[x]` e M22 `[ ]`. A dependência de M22 é **de sequência, não técnica** — nada
em M22 bloqueia este trabalho; a decisão (operador, 2026-07-31) é que o painel de status seja
confiável antes de somar mais uma capacidade a ele. `cycle-roadmap` só selecionará M23 quando M22
fechar.

**Top risks (new):**

1. **O BFF vira um segundo caminho de autorização para o mesmo serviço.** Hoje o `theo-trust` é Level 1 na borda — `dev/traefik/dynamic.yml:82`: *"theo-trust authenticates its OWN trust_live_* bearer keys ... so NO forward-auth at the edge"*. Dois caminhos que divergem em autorização é a classe de defeito que o Model B fechou (CWE-441). *Mitigação:* o BFF exige o mesmo escopo do serviço e o broker cunha pela interseção de menor privilégio — nunca uma chave mais forte que a do chamador.
2. **Amplificação de cunhagem.** Uma tela com vários painéis pode multiplicar chamadas ao broker. *Mitigação:* o cache com TTL já existe e é testado (`TestBroker_CacheHit_NoSecondMint`); medir a taxa de mint por carga de tela antes de fechar.

**Não entra neste milestone:**

| Item | Por que fora | Destino |
|---|---|---|
| Registro de validators e auditoria de enforcement | Caminho de mutação, perfil de risco distinto | **M24** |
| Graduar o `theo-trust` de Level 1 para Level 2 na borda | Decisão de arquitetura de borda, independente do dashboard | ADR própria |
| Ingestão de conversas pelo dashboard (`POST /v1/conversations`) | Escrita no plano de observação; nenhum caso de uso pediu | não planejado |

---

### M24 — [x] Operar guardrails pelo dashboard (validators + auditoria de enforcement)

> Added 2026-07-31 by `/roadmap-feature` (slug: `theo-cloud-trust-dashboard`).
> See CHANGELOG `[Unreleased] § Added`. Grill: `knowledge-base/grills/theo-cloud-trust-dashboard-feature-grill.md`.

**Objetivo:** permitir que o operador veja o catálogo de guardrails do seu tenant, crie e remova
validators, **teste antes de salvar**, e audite o que o enforcement inline bloqueou — fechando o
ciclo entre configurar uma política e observar o efeito dela.

**Gatilho:** o registro `/v1/validators` existe, é multi-tenant e tem contrato de erro tipado
(`422 INVALID_SPEC`, `422 VALIDATOR_NAME_RESERVED`, `409 CONFLICT`), mas a única forma de exercitá-lo
hoje é `curl` ou o `dev/validators-console` do `theo-trust` — que o próprio README declara
**dev-only, "never ships"**. `GET /v1/enforcement-events` registra cada bloqueio inline e nada o lê.

**Definition of done:**

- [ ] Rotas BFF `GET/POST /v1/dashboard/trust/validators`, `DELETE .../validators/{id}` e `POST .../validators:test`, cada uma exigindo o escopo correspondente — `trust:read` para listar, `trust:write` para criar/testar, `trust:delete` para remover. Verificável: uma chave só de leitura recebe 403 no DELETE.
- [ ] Tela de registro mostra o catálogo **mesclado** (plataforma + tenant), distinguindo visualmente o que é herdado do que o tenant criou.
- [ ] **Testar antes de salvar é obrigatório no fluxo**, não opcional: a tela exercita `POST /v1/validators:test` (dry-run) e mostra o resultado antes de permitir a criação. Um validator mal configurado não é erro de UI — é enforcement inline derrubando conversa em produção.
- [ ] Erros tipados do serviço chegam ao usuário **com a mensagem do serviço**, nunca como "erro genérico". Verificável: criar uma guardrail `moderation` num deploy sem classificador renderiza o texto do `422 INVALID_SPEC` que `usetheoai/theo-trust#35` introduziu — não "ocorreu um erro".
- [ ] Remoção é ação destrutiva isolada, com confirmação, conforme a regra de zonas destrutivas do `DESIGN.md`.
- [ ] Tela de auditoria lê `GET /v1/enforcement-events` com categoria e conteúdo redigido — **nunca conteúdo bruto**.
- [ ] **Funcional e2e:** criar → testar → salvar → bloquear de verdade pelo `/v1/guard` → aparecer na auditoria, tudo pela tela, contra a instância implantada.

**Dependências:** M23 `[ ]`. Reusa o data client e o padrão de rota que M23 estabelece; sem ele, este
milestone reimplementaria a mesma camada.

**Top risks (new):**

1. **O dashboard passa a criar objetos que bloqueiam tráfego inline do tenant.** Um validator errado derruba conversas em produção. *Mitigação:* dry-run obrigatório no fluxo (DoD acima) e o contrato `422` fail-fast na fronteira.
2. **Erro de escopo vira ação destrutiva.** `DELETE` de um validator do tenant é irreversível pela UI. *Mitigação:* escopo `trust:delete` separado de `trust:write` — a separação já existe no serviço e no catálogo de escopos do `theo-cloud` — mais confirmação explícita na tela.

**Não entra neste milestone:**

| Item | Por que fora | Destino |
|---|---|---|
| Portar o `dev/validators-console` como está | É ferramenta de teste manual do `theo-trust`, declarada "never ships"; serve de referência funcional, não de código | referência apenas |
| Editar um validator existente (PUT) | O serviço não expõe update — só create/delete. Adicionar o verbo é decisão do `theo-trust` | `theo-trust` |
| Superfície de temas (`GET /v1/themes`) | Nenhum caso de uso pediu; entra quando houver | não planejado |

### M25 — [ ] Operar prompts pelo dashboard (catálogo, revisões, promoção de label)

> Added 2026-08-02 by `/roadmap-feature` (slug: `theo-cloud-promptly-dashboard`).
> See CHANGELOG `[Unreleased] § Added`. Grill: `knowledge-base/grills/theo-cloud-promptly-dashboard-feature-grill.md`.

**Objetivo:** dar ao operador a superfície mínima para **descobrir** quais prompts existem no seu
tenant, **inspecionar** as revisões e os labels de ambiente de um deles, e **promover** um label
para outra revisão — fechando o ciclo entre versionar um prompt e decidir qual versão serve
produção.

**Gatilho:** `dashboard/src/pages/` tem diretório para `lens`, `memory`, `rag` e `trust`; **não
tem** para `promptly`. O serviço está no ar (`develop-43215ef`) e a promessa dele é *"promover
revisões entre ambientes sem redeploy"* — mas o ato de promover só existe por `curl`, SDK ou MCP.
Quem opera não tem superfície.

**Definition of done:**

- [ ] **Os endpoints que faltam existem no `theo-promptly` antes da tela** — derivados por medição, tela a tela, contra `develop=43215ef`: `GET /prompts` (catálogo) e `GET /prompts/:name/policies/:label` (a política que governa a promoção) respondem **404 hoje**. Verificável: os dois respondem `200` com corpo tipado, e o catálogo é **paginado e sem `content`** (`?limit` 1..500 com `400 invalid_limit` fora da faixa, cursor `?after`, header `Link; rel="next"` — o mesmo contrato que `/revisions` já cumpre).
- [ ] Rotas BFF `GET /v1/dashboard/promptly/prompts`, `.../prompts/{name}`, `.../prompts/{name}/revisions`, `.../prompts/{name}/labels` e `PUT .../prompts/{name}/labels/{label}`, cada uma exigindo o escopo correspondente — `promptly:read` para ler, `promptly:write` para promover. Verificável: uma chave só de leitura recebe **403** no `PUT`, e o controle negativo é a mesma chave recebendo **200** num `GET`.
- [ ] **Erro tipado do upstream chega à tela com a mensagem do serviço**, nunca como "erro genérico" — `internal/promptly/upstream_error.go`, espelhando `internal/trust/`. Verificável: uma promoção recusada pela política renderiza o texto do serviço, e não `502`.
- [ ] Catálogo lista **sem renderizar corpo de prompt** e distingue **falha de leitura de ausência de dados** (`EmptyState` com título distinto — `DESIGN.md § 5`, `§ 6`). Verificável: com o upstream fora, a tela diz que a leitura falhou; com o tenant vazio, diz que não há prompts.
- [ ] Detalhe pagina revisões **no servidor**, com `limit` pequeno e **explícito** — nunca o default de 100, porque cada item carrega `content` integral. Verificável: a requisição que a tela emite carrega `?limit=`.
- [ ] **A promoção mostra a política vigente ANTES do ato** e confirma nomeando **qual revisão deixa de servir aquele label** — não "o item será alterado" (`DESIGN.md § 16`). Verificável: promover `prod` de `v4` para `v7` exibe "prod deixa de servir a v4" na confirmação.
- [ ] Navegação nas **duas metades**: entrada em `Capabilities` com `drillsInto: 'promptly'`, o objeto do submenu, **e a linha em `resolveActiveMenu`**. Verificável: chega-se a cada tela **clicando a partir da raiz**, nunca digitando a URL.
- [ ] Lógica de projeção e validação **fora do React**, testada sem browser; handlers de mock registrados; a jornada inteira coberta por **um** e2e (catálogo → detalhe → promover), contra a instância implantada.

**Dependências:** M24 `[x]` — reusa o data client, o `upstream_error` e o padrão de tela que ele
estabeleceu; sem ele este milestone reimplementaria a mesma camada.

**Dependência cross-repo (bloqueante):** os dois endpoints do primeiro DoD vivem no
`theo-promptly`, logo em outro plano (`umbrella-scope.md`: um `target_project` por plano). A UI
**não começa** antes deles — uma tela de catálogo sem catálogo é meia tela, e o `DESIGN.md § 0`
pede pequena e inteira.

**Top risks (new):**

1. **A tela move o ponteiro que serve produção.** Promover troca, sem redeploy, o prompt que agentes em execução resolvem — a promessa do produto é também o perigo dele. Um clique errado não derruba nada: muda comportamento em silêncio, que é pior de diagnosticar. *Mitigação:* a política vigente é exibida **antes** do ato (por isso o `GET` de políticas entra neste milestone, e não fica para depois), e a confirmação nomeia a revisão que deixa de servir o label.
2. **O catálogo é o primeiro índice que este produto terá.** Um índice sem teto nasce com a dívida que o `#47` custou nas revisões. *Mitigação:* paginado e sem `content` desde o primeiro commit, com a mesma validação de fronteira que `/revisions` já cumpre.

**Não entra neste milestone:**

| Item | Por que fora | Destino |
|---|---|---|
| Editor de prompt em tempo real e **diff visual** entre revisões | O `ROADMAP.md` do `theo-promptly` exclui **UI rica/colaborativa** no V1. Este milestone entrega a **UI mínima** que a própria razão daquela exclusão prevê — a exclusão **não é revisada** | fora do V1 |
| Criar/editar prompt pela tela | Escrita de conteúdo é outra classe de risco (revisões são imutáveis); a promoção já cobre o ato central | milestone futuro |
| Rollback pela tela | `POST /rollback` exige `label` (M8 do produto) e move um ponteiro — merece a mesma confirmação, depois de a promoção estar provada | milestone futuro |
| Datasets e evaluation runs | Exigem **dois** índices novos no `theo-promptly` (`GET /evaluations/datasets` e `/runs` — medidos 404); é outro milestone com outra dependência cross-repo | milestone futuro |
| Auditoria como tela própria | `GET /audit` exige `?resource=` ou `?actor=` (medido `400 missing_filter`) — serve como aba de um detalhe, não como índice | aba, milestone futuro |

---

---

## State-of-the-art references

No peers were cloned for this roadmap: the design is locked in the ADR and the reference model is
**Supabase** (`Organization → Project → users`), documented in
`.claude/knowledge-base/adrs/ADR-account-level-tenancy.md` and `theo-workspace/docs/tenancy-system-design.md`.
A SOTA peer clone (the normal `/roadmap-init` step) was intentionally skipped per KISS/YAGNI — there
is no implementation to study beyond the documented Supabase mapping.

---

## Revision protocol

- **Marking progress:** flip the checkbox in the milestone header (or let `cycle-release` flip it when the plan carries `milestone_id: M<N>`).
- **Adjusting a milestone's DoD:** edit in place, note the date in CHANGELOG.md.
- **Adding a milestone post-M3:** use `/roadmap-feature` to append `## M4 — [ ]` without renumbering.
- **Removing a milestone:** mark it `~~M<N> — [-] name (cancelled YYYY-MM-DD — reason)~~` rather than deleting.

## Unresolved at inception

- `account_members` (multi-user-per-Account RBAC) timing — deferred to v2; resolve before any team-membership milestone.
- JWT versioning strategy (`account_id` additive vs. token major bump) — coordinate in `theo-contracts` before M3.
