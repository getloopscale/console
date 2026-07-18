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
