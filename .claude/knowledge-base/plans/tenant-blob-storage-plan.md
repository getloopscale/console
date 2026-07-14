---
slug: tenant-blob-storage
milestone_id: M7
created_at: 2026-07-14
goal: "Ship M7 Tenant Blob Storage — the 4th consumer-key vertical: /v1/storage/* API (6 ops) in theo-cloud + engine migration + dashboard Storage page + theo storage CLI + @usetheo/storage TS SDK + dogfood journey specs, private-only, tenant-global, quota-enforced (402/413), metered from day 1."
version: "1.1"
---

# Plan: tenant-blob-storage (M7 — complete solution)

## Context

Customer-requested managed file storage, sponsor-grilled and blueprint-locked. This plan implements ROADMAP `theo-cloud/ROADMAP.md § M7` consuming three upstream artifacts (all committed):

1. **Product grill** (8 decisions): `theo/.claude/knowledge-base/grills/tenant-blob-storage-grill.md` — tenant-global namespace, single store + virtual folders, private-only, 6 core ops, auth EXCLUSIVELY via existing `theo_live_*` keys + `storage:read`/`storage:write` scopes, caps Starter 100MB/25MB · Pro 5GB/100MB · Team 25GB/500MB · Enterprise custom/5GB.
2. **Feature grill** (M7 DoD/deps/risks): `theo-cloud/.claude/knowledge-base/grills/tenant-blob-storage-feature-grill.md` — deps M1+M3 (both `[x]`).
3. **DISCOVER blueprint** (SHIPPABLE 100.0, 4 ADRs): `theo/.claude/knowledge-base/discoveries/blueprints/tenant-blob-storage-blueprint.md` — proxy data path, fork-and-own S3 client, shared-PG metadata, DIP-mock unit + real-MinIO integration tests.

**Sponsor decision 2026-07-14 (this session):** SDK = TypeScript now (`@usetheo/storage` in `theo-memory/packages/`), Python SDK is a NAMED DEFERRAL (the `theo-sdk` repo listed in the umbrella CLAUDE.md does not exist on disk). T6.2 amends the M7 DoD accordingly.

## Baseline Context

**Git state at plan time:** theo-cloud `develop@37c6ccd` (clean except third-session WIP in `dashboard/src/pages/register.*` + `internal/routes/register_proxy*` — DO NOT touch/commit those files); theo `develop@b657e0f2` (synced with origin); theo-cli `develop` 4 commits behind origin (T4.0 pulls first); theo-memory (OSS sibling, separate repo).

### Files that will be touched

| File (existing) | Role for this plan | Key facts |
|---|---|---|
| `theo-cloud/internal/routes/api_keys.go:95-107` | Scope registry (`validScopes`) | Add `storage:read`, `storage:write` here; typo-guard comment at :87 |
| `theo-cloud/internal/auth/scope.go:103-144, 182-250` | Key resolution + `RequireScope(db, scope)` middleware | SHA-256 key lookup on `theo_api_keys` (revoked/expiry-aware); 403 `SCOPE_REQUIRED` at :219. Storage routes use THIS directly (in-process vertical — NO broker/ForwardAuth needed, unlike rag which proxies an external service) |
| `theo-cloud/internal/billing/cost_aggregator.go:164-191` | Plan-tier lookup + `cost_counters` upsert | `SELECT plan FROM subscriptions WHERE account_id = (SELECT account_id FROM tenants WHERE id=$1) AND status='active'` (:177); counters keyed (tenant_id, plan_tier, metric, period) |
| `theo-cloud/internal/config/config.go:132-143` | Config pattern (`RagBaseURL` etc.) | Add S3 endpoint/bucket/creds config (none exists today — verified) |
| `theo-cloud/cmd/main.go:1400-1480` | Router mount + `mountRagDashboard` pattern | New `mountStorageAPI` (RequireScope) + `mountStorageDashboard` (requireJWT); `:193` doc-comment: theo-cloud does NOT run migrations — engine owns schema |
| `theo-cloud/internal/routes/rag_dashboard.go:49-76` (+ its `_test.go`) | BFF proxy handler + stub-interface test pattern | Template for storage dashboard handlers + tests |
| `theo/api/internal/db/migrations/` (last: `000056_lens_fired_alerts`) | Engine-owned migrations | New tables land as `000057` in the ENGINE repo (governance-gated production path) |
| `theo-cloud/dashboard/src/pages/rag.tsx` (+ `rag.test.tsx`, `components/layout/app-sidebar.tsx`) | Dashboard page + vitest + sidebar patterns | Template for `storage.tsx` |
| `theo-cli/src/register/project.ts:13-61` (+ `config/store.ts:27-69`, `adapters/source-upload.ts:40-136`, `lib/exit-codes.ts:10-23`, `output/formatter.ts:52-54`) | CLI command/auth/upload/json/exit-code patterns | `theo storage` mirrors these; upload adapter shows multipart FormData + ApiError mapping |
| `theo-memory/packages/core/src/index.ts` (+ `src/infrastructure/theokit/index.ts:56-72`) | SDK barrel + theokit-binding subpath pattern | `@usetheo/storage` mirrors as `packages/storage` |
| Reference clones (pinned): `storage@afcfbfd`, `hasura-storage@570896c`, `pocketbase@089ca8a`, `go-cloud@a12ddce` | Blueprint evidence | `pocketbase/tools/filesystem/internal/s3blob/s3/` is the shape for the S3 client; its `uploader_test.go`/`s3_test.go` are the SigV4 test-vector source |

### Current callers / dependents

| Symbol/seam | Current callers | Impact of this plan |
|---|---|---|
| `validScopes` map (api_keys.go) | key-create/rotate routes validate against it | additive: 2 new keys; existing callers unaffected (regression-tested in T2.1) |
| `RequireScope(db, scope)` (scope.go:182) | rag + observability + memory routes mount it | new caller: `/v1/storage/*` mounts it; no change to the middleware itself |
| `cost_counters` upsert (cost_aggregator.go:187) | billing metering writes `egress_bytes` etc. | new metric row `storage_bytes`; same table, same upsert shape |
| `theo_api_keys` table (SHA-256 lookup) | every scoped vertical | unchanged; storage reads the same resolution path |
| engine migrations chain (…000056) | `task db:migrate` on the engine | appends 000057; engine owns the schema (theo-cloud never migrates — main.go:193) |

### Domain glossary

- **store** — the single tenant-global object namespace (one per tenant, no named buckets).
- **path** — object key with `/`-delimited virtual folders (no directory table).
- **share token** — short-lived HMAC-signed token embedded in a URL granting read access to ONE path.
- **aggregate cap** — per-plan total bytes across the store (HTTP 402 on exceed).
- **per-file cap** — per-plan maximum object size (HTTP 413 on exceed).
- **reserve / commit / compensate** — the three phases of a quota-safe upload (ADR D2).

### Architecture boundaries affected

theo-cloud imports `theo-contracts v0.2.0` (go.mod:65) and MUST NOT import `theo/` engine code (decomposition acyclic invariant). Schema migrations live in the engine repo as SQL (not a Go import). The S3 client is BORN in theo-cloud (`internal/storage/s3x`) — the engine's `api/internal/s3/uploader.go` stays engine-internal and is NOT reused. The storage vertical is in-process (no external service proxied), so it uses `RequireScope` directly at the boundary — unlike rag, which needs broker + ForwardAuth because it proxies theo-rag. Product-language discipline at the API/CLI/UI boundary follows `.claude/rules/public-copy.md`.

## Prior Art

- Blueprint Q1-Q7 with 32 verified citations (see Context #3) — data path, schema, limits hook points, client strategy, test harness, local infra (delta = ZERO: MinIO + PG already in k3d).
- In-repo: the RAG vertical (scope-gated routes + BFF dashboard) and billing `cost_counters` (quota metering shape).
- `.claude/rules/architecture.md` § 2 (DIP — handlers depend on interfaces), `.claude/rules/testing.md` § 2/§ 4.1 (pyramid + negative cases), `.claude/rules/error-handling.md` (typed errors, fail-fast), `.claude/rules/parsimony-ladder.md` (rung 2: stdlib `crypto/hmac` for share tokens; rung 4: reuse `cost_counters`/`RequireScope`), `.claude/rules/public-copy.md` (product language in user-visible surfaces — no infra terms).

## Goal

Ship the complete M7 engineering scope: (G1) engine migration for storage metadata; (G2) fork-and-own S3 client in theo-cloud; (G3) `/v1/storage/*` API with 6 ops gated by new scopes; (G4) quota enforcement 402/413 + `storage_bytes` metering; (G5) share tokens (mint + redeem); (G6) dashboard Storage page via BFF; (G7) `theo storage` CLI; (G8) `@usetheo/storage` TS SDK; (G9) dogfood journey specs (hermetic-green; LIVE is operator-gated); (G10) docs + CHANGELOG + M7 DoD amendment (Python deferral).

## Coverage Matrix

| # | Goal claim | Task(s) | Verified by |
|---|---|---|---|
| G1 | migration 000057 (storage metadata) | T1.1 | migration round-trip test (23505 on dup path) |
| G2 | S3 client fork-and-own (put/get/delete/head + SigV4) | T1.2, T1.3 | SigV4 vector match + MinIO integration round-trip |
| G3 | API 6 ops + scopes | T2.1, T2.2, T2.5 | handler tests per op + 401/403 scope tests |
| G4 | quotas 402/413 + metering | T2.3, T2.4 | concurrency race test (-count=50) + counter row |
| G5 | share tokens (mint + redeem) | T2.5 | 5 typed negative cases + rate-limit 429 |
| G6 | dashboard Storage page | T3.1, T3.2 | BFF stub tests + vitest page + no-infra-term grep |
| G7 | `theo storage` CLI | T4.0, T4.1 | jest per subcommand + exit-code contract |
| G8 | `@usetheo/storage` TS SDK | T5.1 | vitest client + error mapping + tsc build |
| G9 | dogfood journey spec | T6.1 | ginkgo -dry-run enumerates ≥1 spec (no false-green) |
| G10 | docs + CHANGELOG + M7 DoD amendment | T6.2 | `[Unreleased]` entry per repo + ROADMAP amendment |

Coverage: 10/10 claims mapped (100%). All 15 tasks (T1.1–T6.2) appear in the matrix — no orphan tasks.

## ADRs

### D1 — Share token: standalone HMAC-SHA256 token (stdlib), not the theo-contracts session JWT

**Decision:** `share` mints a compact HMAC-SHA256 token over `{tenant_id, path, exp}` with a service secret (env), redeemed at `GET /v1/storage/shared/{token}` (the token IS the auth — no key needed). TTL default 15min, max 7d.

**Rationale:** Parsimony rung 2 — `crypto/hmac` + `encoding/base64` stdlib, zero deps, constant-time verify. The theo-contracts JWT is RSA session-token machinery (mint↔verify across services) — heavier and coupled to session claims. Supabase's equivalent is an HS256 JWT (same cryptographic shape).

**Alternatives considered:** (a) theo-contracts jwt — rejected: wrong claim shape, RSA key mgmt for a single-service verify; (b) S3 presigned URL rewrap (Nhost) — rejected for MVP: couples share TTL to S3 creds config and leaks nothing extra vs HMAC, kept as documented escape-hatch; (c) opaque DB-backed tokens — rejected: adds a table + cleanup job (YAGNI).

**Consequences:** secret rotation invalidates outstanding share links (documented); redemption route is the ONLY unauthenticated storage route and MUST be rate-limited (T2.5 wires the existing ratelimit middleware).

### D2 — Quota reservation via `pg_advisory_xact_lock` per tenant (reserve → upload → commit/compensate)

**Decision:** Upload path: single tx `pg_advisory_xact_lock(hashtext('storage:'||tenant_id))` → `SUM(size_bytes)` check vs plan cap → INSERT metadata row `status='pending'` with declared size; then S3 PutObject; then UPDATE `status='committed'`; on S3 failure DELETE the pending row (compensation). A pending-row TTL sweep is NOT built (YAGNI — pending rows count against quota conservatively and are visible via list filter; documented).

**Rationale:** Two concurrent uploads must not both pass a naive SUM check (money-adjacent invariant). Advisory xact locks are the house pattern (engine Rules 6/7); serializing ONLY the reserve step keeps S3 I/O outside the lock. Blueprint Q3 showed Supabase's compensation pattern (upload→truncation-check→admin delete).

**Alternatives considered:** (a) naive check-then-insert — rejected: TOCTOU race overshoots caps; (b) SERIALIZABLE isolation — rejected: retry complexity for a hot path; (c) counter column with atomic UPDATE — rejected: dual-write drift vs SUM truth.

**Consequences:** the reserve tx is short (no I/O under lock); concurrency test T2.3 proves two concurrent uploads near the cap → exactly one 402.

### D3 — No multipart upload in MVP (single PutObject, 5GB S3 single-PUT ceiling)

**Decision:** Uploads stream a single S3 PutObject. Max per-file cap (Enterprise 5GB) equals S3's single-PUT ceiling — no multipart needed.

**Rationale:** KISS; pocketbase's multipart threshold exists to optimize large files, not to enable them below 5GB. Removing multipart removes ~40% of the client surface (per pocketbase `uploader.go`).

**Alternatives considered:** pocketbase-style chunked multipart — deferred with a named trigger: raise Enterprise per-file cap above 5GB OR measured upload-reliability need.

**Consequences:** a mid-stream failure re-uploads from zero (acceptable at ≤5GB); resumable (TUS) stays deferred per blueprint D1.

### D4 — Storage caps declared in `internal/storage/caps.go` keyed by plan tier (not theo-contracts)

**Decision:** `capsForTier(tier string) (aggregateBytes, perFileBytes int64)` with the grilled values; tier read via the existing subscriptions query (cost_aggregator.go:177 pattern, extracted to a shared helper).

**Rationale:** theo-contracts `plan` vocabulary is the engine↔cloud shared contract; adding storage caps there forces a contracts release for a single-consumer table (YAGNI + decomposition friction). Local table mirrors how billing already resolves tiers in this repo.

**Alternatives considered:** theo-contracts `CapFor` extension — deferred until a SECOND consumer (engine) needs storage caps.

**Consequences:** one authoritative caps table in one file; promoting to theo-contracts later is additive.

### D5 — Dogfood journey ships hermetic-green; LIVE execution + checkbox flip are operator-gated

**Decision:** T6.1 adds the J-storage Ginkgo spec (`-tags=live`) to `theo/infra/tests/livetest/dogfood/` following the 25-journey pattern, dry-run-enumerable (no 0-spec false-green). LIVE run requires the canonical ceremony (Cleanroom TOTAL on the dev-public host + QA Red Team per the 2026-07-14 mandate) — NOT claimable by this plan.

**Rationale:** the LIVE ceremony `theo/.claude/rules/cleanroom-up-live-test-mandate.md` (INQUEBRÁVEL) + Unbreakable Rule 3. The dev-public environment lives on the `theo-e2e-runner` droplet; this session's machine cannot produce canonical LIVE evidence.

**Alternatives considered:** (a) run LIVE on this session's warm local clusters and claim GREEN — rejected: the mandate forbids warm-infra LIVE evidence, and it would be a false PASS (Rule 3); (b) skip the dogfood journey entirely and rely on unit+integration — rejected: the M7 DoD requires a journey artifact, and hermetic-enumerable specs are cheap insurance the LIVE run will find real seams; (c) block the whole plan on the operator ceremony — rejected: engineering scope (hermetic + reviewed) is deliverable now and unblocks everything except the checkbox flip.

**Consequences:** the plan's completion promise covers engineering scope (hermetic + reviewed); M7 checkbox flip waits for the LIVE gate. Honest BLOCKED > false PASS.

## Dependencies

| Dependency | Version | New? | Rule 9 justification |
|---|---|---|---|
| Go stdlib (`crypto/hmac`, `crypto/sha256`, `net/http`, `encoding/xml` not needed — S3 errors read via status codes) | go.mod Go version (existing) | no | stdlib first (parsimony rung 2) |
| `github.com/usetheodev/theo-contracts` | `v0.2.0` (already in go.mod:65) | no | existing shared contract; NOT extended by this plan (ADR D4) |
| `github.com/go-chi/chi/v5` | existing in theo-cloud go.mod | no | existing router |
| MinIO (local k3d) / S3-compatible endpoint | server-process only (AGPL — never linked/vendored) | no | blueprint license gate (ADR D4 of discovery plan) |
| theo-cli: Node stdlib `fetch`/`FormData`/`Blob` | Node 20 (existing) | no | existing upload adapter pattern (source-upload.ts) |
| dashboard: `@tanstack/react-query` + existing `cloudFetch` | existing | no | house pattern |
| `@usetheo/storage` (new package) | workspace-local, no new external deps | yes (package, not dep) | mirrors packages/core; HTTP via `fetch` |

**Zero new external dependencies across all four repos.** (`/deps-audit` should verify manifests unchanged except workspace wiring.)

## Phases and Tasks

### Phase 1 — Foundations (engine migration + S3 client + config)

#### T1.1 — Migration `000057_storage_objects` (repo: theo/)

Create `theo/api/internal/db/migrations/000057_storage_objects.{up,down}.sql`:

```sql
CREATE TABLE storage_objects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,              -- full path, virtual folders by '/'
  size_bytes  BIGINT NOT NULL CHECK (size_bytes >= 0),
  mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT storage_objects_tenant_name_uniq UNIQUE (tenant_id, name)
);
CREATE INDEX storage_objects_tenant_prefix ON storage_objects (tenant_id, name text_pattern_ops);
CREATE INDEX storage_objects_tenant_usage ON storage_objects (tenant_id) INCLUDE (size_bytes);
```

Down: `DROP TABLE storage_objects;` (forward-only discipline — down provided per house convention but never run in prod).

**Governance:** engine production path → run `/change` (T2 trigger: DB schema) + governance gate file before editing; remove after.

#### Why this step
Blueprint Q2: metadata in PG is the consensus; single table per grill decision 3 (no named buckets). `INCLUDE (size_bytes)` makes the quota SUM index-only.

#### TDD
RED: `theo/api/internal/db/migrations_test.go`-style pairing is not the house pattern; the executable check is `psql`-backed migrate test: extend the existing migration round-trip test (`go test ./api/internal/db/... -run TestMigrations`) to assert `to_regclass('storage_objects') IS NOT NULL` and unique-violation on duplicate `(tenant_id, name)` insert (`assert: second INSERT returns SQLSTATE 23505`). GREEN: migration files. Concurrency tests: (none — DDL single-threaded).

**Acceptance criteria:** `task db:migrate` (theo/) applies 000057 cleanly on a fresh DB; duplicate-path insert fails 23505; `go test ./api/internal/db/...` green.

#### T1.2 — S3 client `internal/storage/s3x` (repo: theo-cloud)

Minimal fork-and-own client (pocketbase `internal/s3blob/s3` shape, hand-written SigV4): `PutObject(ctx, key, r io.Reader, size int64, mime string) error`, `GetObject(ctx, key) (io.ReadCloser, ObjectInfo, error)` (streaming), `DeleteObject(ctx, key) error`, `HeadObject(ctx, key) (ObjectInfo, error)`. Path-style addressing (MinIO local), region-aware SigV4.

**Tenant-key derivation (EC-1 — MUST FIX, cross-tenant isolation):** the S3 object key is ALWAYS derived server-side as `{tenant_id}/{name}` by `storage.Service` (a `keyForTenant(tenantID, name) string` helper) — the `s3x` client receives the fully-derived key and NEVER a client-controlled full key. Two tenants uploading the identical `name` MUST produce DISTINCT S3 keys. This is the bytes-layer counterpart of the metadata `UNIQUE(tenant_id, name)`.

#### Why this step
Blueprint Q4/ADR D2 (fork-and-own; go-cloud wraps aws-sdk anyway; ~18 AWS modules for 4 ops is disproportionate). Client lives in theo-cloud per grill decision 7 (decomposition forbids engine import).

#### TDD
RED first: `internal/storage/s3x/sign_test.go` — SigV4 canonical-request/signature test vectors transcribed from `pocketbase/tools/filesystem/internal/s3blob/s3/s3_test.go` (pinned clone `pocketbase@089ca8a`): `assert: Authorization header == expected vector for fixed time/creds/request`. `client_test.go` — table-driven against `httptest.Server` asserting method/path/headers per op + typed error mapping (404→`ErrObjectNotFound`, 403→`ErrStorageAuth`, 5xx→`ErrStorageUnavailable`). GREEN: implement. Integration (build tag `integration`): round-trip put→head→get→delete against real MinIO (`TEST_S3_ENDPOINT`), per blueprint D4.

**Concurrency tests:** `TestClient_ConcurrentPuts` — 8 goroutines PUT distinct keys via httptest; `-race` clean (client must be stateless/share-safe).

**Acceptance criteria:** unit green with `-race`; signature vectors match pocketbase's expected outputs byte-for-byte; integration tag compiles and passes against MinIO when endpoint set.

#### T1.3 — Config + wiring seam (repo: theo-cloud)

`internal/config/config.go`: `StorageS3Endpoint`, `StorageS3Bucket`, `StorageS3AccessKey Secret`, `StorageS3SecretKey Secret`, `StorageShareSecret Secret` (+ env names, validation: all-or-none). `internal/storage/service.go`: `Service` struct owning `ObjectStore` interface (DIP — s3x implements) + `DB` + `Caps` + `Clock`.

#### Why this step
DIP boundary (architecture.md § 2): handlers depend on `storage.Service`; tests mock `ObjectStore`.

#### TDD
RED: `config_test.go` — partial S3 config → validation error (typed, names the missing var); `service_test.go` compiles the interface seam with a stub. Concurrency tests: (none — construction only). GREEN: fields + service skeleton.

**Acceptance criteria:** `go build ./...` green; config validation negative case asserts the specific message.

### Phase 2 — API vertical `/v1/storage/*`

#### T2.1 — Scopes registry + route mounting

Add `"storage:read": true, "storage:write": true` to `validScopes` (api_keys.go:95-107). Mount in `cmd/main.go`: `r.Route("/v1/storage", ...)` with `RequireScope(db, "storage:read")` on GET routes and `RequireScope(db, "storage:write")` on mutating routes (upload/delete/share-mint).

#### Why this step
Grill decision 6 — the ONLY access path. In-process vertical: `RequireScope` (scope.go:182-250) suffices; no broker/ForwardAuth (rag needs those only because it proxies an external service).

#### TDD
RED: extend `tests/unit/api_keys_create_test.go` pattern — creating a key with `storage:read` succeeds; with `storage:bogus` fails typed. Route-level: request without key → 401; key lacking scope → 403 `SCOPE_REQUIRED` (assert body code, per scope.go:219 contract). Concurrency tests: (none — registry is a static map). GREEN: registry lines + mounts.

**Acceptance criteria:** all existing api_keys tests green (no regression); new scope accepted end-to-end in handler tests (T2.2).

#### T2.2 — Handlers: upload, download, list, stat, delete

`internal/routes/storage.go` — `StorageHandler{svc *storage.Service}`:
- `PUT /v1/storage/objects/{path...}` — upload (body stream; `Content-Length` required → 411 if absent; per-file cap pre-check → 413 `FILE_TOO_LARGE`).
- `GET /v1/storage/objects/{path...}` — download (stream; sets mime/length). **EC-2 (MUST FIX):** always emit `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment; filename="..."` — the stored `mime_type` is client-declared, so inline rendering would be stored XSS; force download.
- `GET /v1/storage/objects?prefix=&limit=&cursor=` — list (committed only; keyset pagination on name). **EC-3:** `prefix` and `cursor` are ALWAYS AND-ed with `WHERE tenant_id=$1` — a cursor from tenant A yields zero rows for tenant B.
- `HEAD`-equivalent `GET /v1/storage/stat/{path...}` — metadata JSON.
- `DELETE /v1/storage/objects/{path...}` — S3 delete then metadata delete.
Path validation: reject empty, `..`, leading `/`, control chars (fail-fast at boundary, error-handling.md § 2).

#### Why this step
G3 core; product language in every error (`storage`/`files`, never S3/bucket — `.claude/rules/public-copy.md` applies to API messages surfaced by the CLI/UI).

#### TDD
RED first (table-driven, stub `ObjectStore` + real PG via existing test harness or sqlmock per house pattern in rag_dashboard_test.go): happy path per op + negative cases: invalid path → 400 typed; missing Content-Length → 411; unknown path stat/download/delete → 404 `FILE_NOT_FOUND`; S3 down on download → 503 typed (failure scenario). **EC-1 test:** two tenants uploading identical `name` → assert DISTINCT derived S3 keys (`{tenantA}/x` ≠ `{tenantB}/x`) + tenant B download of A's path → 404. **EC-2 test:** download response carries `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`. **EC-3 test:** a `cursor` minted for tenant A returns zero rows when replayed as tenant B. **EC-4 test:** 0-byte upload/download round-trips; file == per-file cap passes, cap+1 → 413 (boundary). GREEN: handlers. REFACTOR: extract path validator + `keyForTenant`.

**Concurrency tests:** covered by T2.3 (quota race) — handler layer itself stateless.

**Acceptance criteria:** `go test ./internal/routes/ -run TestStorage -race` green; every negative case asserts the SPECIFIC typed error code + message (testing.md § 4.1).

#### T2.3 — Quota enforcement (402 aggregate / 413 per-file) via reserve-commit

`internal/storage/caps.go` (grilled table, ADR D4) + `internal/storage/quota.go`: `Reserve(ctx, tenantID, size)` per ADR D2 (advisory lock + SUM + pending INSERT), `Commit`, `Compensate`. Wire into upload handler. Errors: `ErrQuotaExceeded` → HTTP 402 `STORAGE_QUOTA_EXCEEDED` (includes used/limit), `ErrFileTooLarge` → 413 (includes max for tier) — DISTINCT types, never merged.

#### Why this step
Blueprint Q3 mapping + grill decision 8. The two-error distinction is a locked product decision.

#### TDD
RED: `quota_test.go` against test PG — under cap passes; at cap fails 402-typed; per-file over → 413-typed BEFORE any store call (stub asserts zero PutObject calls). **Concurrency tests (mandatory):** `TestReserve_ConcurrentUploadsNearCap` — tenant at cap−1MB, two concurrent 1MB `Reserve` calls → exactly ONE succeeds (advisory lock proof), run with `-race`. Failure scenario: S3 PutObject fails post-reserve → `Compensate` removes pending row (assert row count returns to baseline). GREEN: implement.

**Acceptance criteria:** concurrency test deterministic across 50 local runs (`-count=50`); 402 body carries `used_bytes`/`limit_bytes`; 413 carries `max_file_bytes`.

#### T2.4 — Metering `storage_bytes` + Prometheus

On Commit: upsert `cost_counters (tenant_id, plan_tier, 'storage_bytes', period, value)` following cost_aggregator.go:187 upsert shape (value = current SUM, absolute gauge semantics documented) + `promauto` counter `theo_storage_bytes_written_total` and gauge `theo_storage_usage_bytes{tenant}` capped-cardinality note (label only in dev? — NO: use counter without tenant label + log line with tenant for ops; cardinality discipline).

#### Why this step
G4 metering-from-day-1 (grill decision 8: no overage billing MVP, but measurement feeds future billing). Wiring triad pillar 3 for the vertical.

#### TDD
RED: `metering_test.go` — Commit writes/updates the counter row (assert value == SUM committed); Prometheus counter increments by size (testutil). Concurrency tests: (covered by D2 lock — single writer per tenant during commit). GREEN: implement.

**Acceptance criteria:** counter row visible after upload in integration test; `theo_storage_bytes_written_total` present on `/metrics`.

#### T2.5 — Share: mint + redemption route

`POST /v1/storage/share` `{path, expires_in_seconds}` (scope `storage:write`) → `{url, expires_at}` with HMAC token (ADR D1). `GET /v1/storage/shared/{token}` — UNauthenticated, verifies HMAC (constant-time), TTL, object committed → streams. Rate-limited via existing ratelimit middleware. **EC-2 (MUST FIX):** the redemption stream also emits `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` (this is the only unauthenticated surface — stored-XSS neutralization is mandatory here). The token carries `tenant_id`; the S3 key is re-derived server-side as `{tenant_id}/{path}` (never from client input).

#### Why this step
G5; the one deliberate unauthenticated surface — bounded by token possession + TTL + rate limit.

#### TDD
RED: token round-trip (mint→redeem 200 with correct bytes/mime); negative cases EACH typed: expired → 410 `SHARE_EXPIRED`; tampered signature → 403 `SHARE_INVALID` (constant-time compare asserted by test using flipped byte); path deleted after mint → 404; TTL > max → 400. **EC-2 test:** redemption response carries `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` (stored-XSS neutralization on the unauthenticated route). Failure scenario: S3 unavailable at redemption → 503. Concurrency tests: (none — stateless verify). GREEN: implement.

**Acceptance criteria:** all 5 negative cases assert distinct typed codes; redemption route registered under rate limiter (test asserts 429 after burst, reusing existing ratelimit test helper).

### Phase 3 — Dashboard

#### T3.1 — BFF proxy routes `/v1/dashboard/storage/*` (requireJWT)

List/stat/delete/share-mint/upload proxied to `storage.Service` with tenant from session (`auth.GetUser`), mirroring rag_dashboard.go:49-76. Upload via multipart form (browser) → service.

#### Why this step
Dashboard never holds API keys; BFF pattern is the house rule (rag precedent).

#### TDD
RED: `storage_dashboard_test.go` with stub service interface (rag_dashboard_test.go shape): auth-missing → 401; happy list/delete/share; upload multipart happy + over-cap 402 passthrough (assert code surfaces to JSON body). GREEN: handlers + mount.

**Acceptance criteria:** `go test ./internal/routes/ -run TestStorageDashboard -race` green.

#### T3.2 — `storage.tsx` page + sidebar + vitest

Page: folder-aware list (prefix drill-in), upload button, delete w/ confirm, stat drawer, "Copy share link" (TTL select), quota bar (used/limit from a `GET /v1/dashboard/storage/usage` route added in T3.1). Sidebar entry "Storage". Product language only.

#### Why this step
G6; M7 DoD bullet 4.

#### TDD
RED: `storage.test.tsx` (rag.test.tsx pattern — mock `cloudFetch`): renders list; drill-in updates prefix param; delete confirm fires DELETE; share copies URL; quota bar shows used/limit; error state on 402 upload shows the limit message. GREEN: page. Concurrency tests: (none — UI). 

**Acceptance criteria:** `npx vitest run storage` green; `npx tsc --noEmit` clean; no infra terms in any user-visible string (grep gate: `grep -iE 's3|bucket|minio' dashboard/src/pages/storage.tsx` → only code identifiers, zero UI strings).

### Phase 4 — CLI (repo: theo-cli)

#### T4.0 — Sync repo
`git pull` (repo is 4 behind origin). No code.

**Acceptance criteria:** `git status` clean + up-to-date; `npm test` baseline green pre-change.

#### T4.1 — `theo storage` command group

`src/register/storage.ts` + `src/commands/storage.ts`: `upload <file> <path>`, `download <path> [dest]`, `list [prefix]`, `delete <path>`, `stat <path>`, `share <path> --expires <dur>`. Auth: `THEO_TOKEN`/config (store.ts pattern); upload via FormData/Blob or raw PUT with stream→buffer (source-upload.ts precedent + its Node-stream caveat). `--json` stable shapes; exit codes: 402/413 → 5 (partial/limit)?? NO — map per contract: auth 401/403 → 4; usage errors → 1; server/network → 3? House contract: 0 success, 1 usage, 2 build, 3 deploy, 4 auth, 5 partial. Storage failures are not deploy — define in plan: quota/size limit → exit 1 (usage-class, user-correctable) with typed message; network/5xx → exit 5 (partial). Document in command doc-comment (the contract source per house pattern).

#### Why this step
G7; CLI-first Rule 9 (theo CLAUDE.md).

#### TDD
RED (Jest, billing.test.ts pattern with `createDeps()` factory): each subcommand happy path asserts fetch URL/method/headers + `--json` shape snapshot; negative: 403 → exit 4 + message suggests scope grant; 402 → exit 1 + shows used/limit; network fail → exit 5. GREEN: implement. Concurrency tests: (none — single-threaded CLI).

**Acceptance criteria:** `npm test` green incl. new suite; exit-code doc-comment present (source-of-truth per house pattern); zero internal terms in output strings.

### Phase 5 — SDK TS (repo: theo-memory)

#### T5.1 — `@usetheo/storage` package

`packages/storage/`: `createStorageClient({baseUrl, apiKey, fetch?})` → `{upload, download, list, del, stat, share}`; typed errors mirroring API codes; subpath `@usetheo/storage/theokit` exporting `storageFromCtx(ctx)` (memory core theokit/index.ts:56-72 pattern). No new external deps (fetch-based). README with one runnable example.

#### Why this step
G8; sponsor decision this session (TS now, Python deferral).

#### TDD
RED (vitest/jest per package convention): client method → correct request via injected fetch stub; error mapping (402→`QuotaExceededError` with used/limit, 413→`FileTooLargeError`, 403→`ScopeError`); theokit binding resolves config from ctx. GREEN: implement. Concurrency tests: (none — thin client).

**Acceptance criteria:** package tests green; `npm run build` (tsc) clean; NO reference to theo-cloud internals (OSS boundary — public API surface only).

### Phase 6 — Journeys + docs + DoD amendment

#### T6.1 — Dogfood journey spec J-storage (repo: theo/)

`infra/tests/livetest/dogfood/journey_j26_storage_live_test.go` (`//go:build live`) following the 25-journey pattern + `helpers.go` Env: Scenario A core chain via API key (upload → stat → list → download bytes-equal → share mint → redeem → delete → 404). Hermetic gate: Ginkgo dry-run enumerates ≥1 spec (no 0-spec false-green); helper unit test for any new pure helper.

#### Why this step
G9 + ADR D5. LIVE run = operator ceremony (NOT this plan's promise).

#### TDD
RED-equivalent: `ginkgo -dry-run -tags=live` count check goes RED if spec malformed. Concurrency tests: (none — journey is sequential by design). 

**Acceptance criteria:** `go build -tags live ./infra/tests/livetest/...` exit 0; dry-run shows the new spec; `go vet -tags live` clean. Engine repo governance gate respected.

#### T6.2 — Docs + CHANGELOG + M7 DoD amendment

- theo-cloud `docs/` (or README section per house docs layout): reference for 6 ops (API/CLI/SDK), product language.
- CHANGELOG `[Unreleased] § Added` in each touched repo.
- ROADMAP M7 DoD bullet 3 amended: "SDK — TypeScript (`@usetheo/storage`) shipped; **Python SDK: named deferral 2026-07-14** (the umbrella-listed `theo-sdk` repo does not exist; creating it is its own milestone)" + CHANGELOG § Changed line.

**Acceptance criteria:** every repo touched has an `[Unreleased]` entry; ROADMAP amendment dated; no "production-ready" claims (public-copy.md).

## Critical paths (for mutation testing / D4)

- `internal/storage/quota.go` (Reserve/Commit/Compensate) — money-adjacent.
- `internal/storage/s3x/sign.go` (SigV4) — security.
- `internal/storage/share/token.go` (HMAC mint/verify) — security.
- `internal/storage/service.go` `keyForTenant` (tenant-key derivation, EC-1) — cross-tenant isolation.

## Edge-case absorption (v1.1)

Per `.claude/knowledge-base/reviews/tenant-blob-storage-edge-cases-2026-07-14.md`: EC-1 (tenant-namespaced S3 key — T1.2/T2.2) and EC-2 (nosniff + attachment on download/redemption — T2.2/T2.5) absorbed as MUST-FIX; EC-3 (cross-tenant cursor) + EC-4 (zero-byte/boundary) added to T2.2 TDD; EC-5 (unauthenticated redemption surface) documented + accepted (ADR D1 + rate limit).

## Failure scenarios

| Scenario | Expected behavior | Test |
|---|---|---|
| S3 unavailable on upload (post-reserve) | Compensate deletes pending row; 503 typed; no metadata leak | T2.3 |
| S3 unavailable on download/redemption | 503 typed (`STORAGE_UNAVAILABLE`); no partial body | T2.2 / T2.5 |
| PG down on reserve | 503 typed; zero S3 calls | T2.3 (stub asserts) |
| Client disconnect mid-upload | context cancel propagates; Compensate runs | T2.2 (ctx-cancel test) |
| Share secret rotated | outstanding tokens → 403 SHARE_INVALID (documented) | T2.5 |
| Timeout on S3 (slow) | client honors ctx deadline; typed timeout error | T1.2 |

## Drawbacks & Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Proxy bandwidth/CPU on shared cloud-API** (feature-grill risk 1) — every storage byte crosses the process serving rag/memory/observability | caps (sponsor cut aggregates 10×), `storage_bytes` + egress metering from day 1, streaming handlers (`io.Copy`, NEVER buffer whole files — reviewed explicitly), documented Nhost SigV4-rewrap escape-hatch |
| 2 | **Hand-rolled SigV4** (feature-grill risk 2) — signing bug → cross-tenant access or broken share URLs | pocketbase test vectors (T1.2), MinIO round-trip integration, share-token constant-time compare test (T2.5) |
| 3 | **Tenant-global namespace** (conscious grill override) — staging can touch prod files | path-prefix convention documented in T6.2 docs; accepted trade-off, not a mechanism gap |
| 4 | **Pending-row conservatism** (ADR D2) — a crashed upload leaves a pending row counting against quota | delete op works on pending rows too; a TTL sweep job is a named deferral (documented) |

## Unresolved Questions

(none — every decision is resolved at plan time: the product grill resolved product shape, the DISCOVER blueprint resolved architecture, and the SDK placement was resolved by the sponsor this session.)

## Test Plan (pyramid)

- **Unit (many):** s3x sign vectors + client table-driven; quota logic; share token; handlers with stub ObjectStore; CLI jest; SDK vitest; dashboard vitest.
- **Integration (moderate):** s3x round-trip vs real MinIO (`integration` tag); storage routes vs test PG; migration round-trip (engine).
- **E2E (few):** J-storage dogfood spec (hermetic-enumerable now; LIVE operator-gated per ADR D5).
- All Go tests `-race`; concurrency test T2.3 `-count=50` locally.

## Execution order

T1.1 → T1.3 → T1.2 (vectors first inside) → T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T3.1 → T3.2 → T4.0 → T4.1 → T5.1 → T6.1 → T6.2. Commits atômicos por task (`feat(storage): T2.3 ...`), suite verde por commit, CHANGELOG por repo na primeira task que o toca.
