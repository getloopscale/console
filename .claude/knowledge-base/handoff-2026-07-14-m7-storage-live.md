---
type: handoff
created_at: 2026-07-14
created_by: claude-opus-4-8 (workstation session)
topic: M7 tenant blob storage — engineering COMPLETE + real-infra tested; LIVE deploy+validation on dev-public droplet remains
status: engineering DONE (pushed to develop, 4 repos); integration-proven vs real PG+MinIO; SDK published to npm; ONLY the dev-public LIVE deploy + validation remains (operator/droplet-gated)
---

# Handoff — M7 tenant blob storage: deploy + LIVE-validate on dev-public

> **For the Claude session running ON the dev-public droplet (`theo-e2e-runner`, 165.227.121.20).**
> Read top to bottom. It is self-contained. The workstation session built + tested
> the WHOLE M7 storage vertical (backend + CLI + SDK + dashboard + migration +
> journey) and pushed it to `develop` in all repos, proven against REAL local
> Postgres + MinIO. What is left is exactly ONE thing you can do and the
> workstation cannot: **deploy it to dev-public and validate it LIVE**.

> ### ⚠️ Update 2026-07-14 (architecture pivot — sponsor-confirmed): TWO valid LIVE paths
>
> Storage was extracted into a SEPARATE data-plane service **`theo-storage`** (new repo
> `usetheodev/theo-storage`, pushed) and theo-cloud gained a **thin-proxy mode** (`STORAGE_UPSTREAM_URL`,
> `internal/storageproxy`, commit `0277b1e`). Both paths satisfy the SAME `routes.StorageService`
> interface. For flipping the **M7 checkbox** you may take EITHER LIVE path — pick the lower-risk one:
>
> - **Path A (recommended for the checkbox flip — lowest risk): in-process vertical on dev-public.**
>   Exactly § 3 below — set `STORAGE_S3_*` on the theo-cloud deployment, apply migration 000057, seed a
>   storage-scoped key, run the LIVE chain. `STORAGE_UPSTREAM_URL` stays UNSET → the in-process vertical
>   serves `/v1/storage/*` unchanged. This is what the M7 DoD describes; it flips the checkbox.
> - **Path B (strategic direction, proven LOCAL this session, LIVE deploy is more work): separate service
>   behind the edge.** Deploy the `theo-storage` container (its `Dockerfile` + `docker-compose.yml` + README
>   are in the repo) in `header` auth mode behind the edge/broker, set `STORAGE_UPSTREAM_URL` on theo-cloud
>   → theo-cloud proxies to it injecting `X-Theo-Tenant`. Proven end-to-end LOCAL: theo-cloud handler →
>   `storageproxy` → header-mode `theo-storage` → real PG+MinIO (`-tags=integration` E2E GREEN), plus the
>   `@usetheo/storage` SDK 6/6 against the live standalone service. Do Path B as a follow-up once Path A has
>   flipped the checkbox, OR do it directly if the edge wiring for a new data service is already scripted.
>
> Fresh re-verification this session (local Docker, all GREEN): theo-cli 9/9 · dashboard 4/4 ·
> `@usetheo/storage` SDK 6/6 (live service) · theo-storage domain+glue · theo-cloud in-process integration
> (real PG+MinIO) · proxy strangler-fig E2E. The M7 engineering DoD is 100% evidenced; only the LIVE
> ceremony (Cleanroom + Red Team) remains to flip the checkbox.

## 1. TL;DR — what is done vs what remains

**DONE (engineering, all on `develop`, pushed to origin):**
- Full `/v1/storage/*` Go API vertical in **theo-cloud** (upload/download/list/stat/delete/share + unauthenticated share-redemption), gated by new `storage:read`/`storage:write` scopes on existing `theo_live_*` keys.
- **theo engine**: migration `000057_storage_objects` (+ J-26 dogfood journey `infra/tests/livetest/dogfood/journey_j26_storage_live_test.go`).
- **theo-cli**: `theo storage {upload,download,list,stat,delete,share}`.
- **SDK**: `@usetheo/storage@0.1.0` — **published to npm, live**.
- **dashboard**: Storage page + BFF `/v1/dashboard/storage/*`.
- **Proven against REAL infra** (local Docker PG16 + MinIO): s3x SigV4 round-trip, full Service e2e chain, full HTTP path — all `-tags=integration` GREEN. Hermetic suite GREEN. `/code-quality`-clean (go vet, tsc, jest, vitest).
- **Adversarial `/review` run** → 4 HIGH + 2 MEDIUM real bugs found and FIXED with regression tests (HIGH-1 unbounded body, HIGH-4 overwrite-then-fail data loss, MEDIUM-2 LIKE injection, MEDIUM-3 pagination, LOW-3 compensation logging). HIGH-3 pending-row reaper is a documented ADR-D2 deferral. Cross-tenant isolation + share-token crypto confirmed CLEAN.

**REMAINS (droplet-only — the whole reason for this handoff):**
- The running dev-public theo-cloud image is OLD: `GET https://app-dev.usetheo.dev/v1/storage/objects` returns **404** (route absent), while `/v1/rag` + `/v1/memory` return 401 (deployed). So storage is NOT deployed yet.
- Deploy the latest `develop` theo-cloud (rebuild image → the storage routes appear), configure the S3 backend, apply migration 000057, seed a storage-scoped key, then run the LIVE chain.
- Flip the ROADMAP M7 checkbox ONLY after the LIVE chain is GREEN + (per the mandate) the QA Red Team step.

## 2. Commits (all pushed to origin/develop)

- **theo-cloud** `develop` head ≈ `92fb4d2` (storage vertical + review fixes + integration tests + docs). Storage commits: `10dde0f` s3x, `5f7ca82` caps+share, `626a4d1` config+service, `7635295` quota+PG, `042bb65` service, `09c1d61` HTTP handlers, `37daf54` scopes+metering, `8e0890b` main.go wiring, `4a7c777` review fixes, `5dbedc0` integration tests.
- **theo** engine `develop` head `111ac72b` — migration `000057_storage_objects.{up,down}.sql` + J-26 journey.
- **theo-cli** `develop` head `c6c5129` — `theo storage` command group.
- **npm**: `@usetheo/storage@0.1.0` already public.

## 3. Deploy + LIVE steps (the droplet session runs these)

> These are surgical (no destructive Cleanroom needed just to prove storage). A
> parallel session was seen running `tilt up --host 0.0.0.0` with
> `THEO_HELMFILE_ENV=dev-public` on the droplet — coordinate; do not fight its tilt.

1. **Get latest develop into the droplet's theo-cloud repo** (wherever it is checked out — the workstation could not find it under `/root`; the parallel tilt session has it). `git pull --ff-only origin develop`. Confirm `internal/storage/` exists and `grep -c "v1/storage" cmd/main.go` == 3.
2. **Configure the S3 backend for the storage vertical.** theo-cloud gates the vertical on `cfg.StorageEnabled()` — ALL of these env vars must be set on the theo-cloud deployment (all-or-none; `internal/config/config.go` validates + fails fast if partial). MinIO is already in-cluster; point at it:
   - `STORAGE_S3_ENDPOINT` (the in-cluster MinIO service URL, path-style)
   - `STORAGE_S3_BUCKET` (create it, e.g. `theo-storage`)
   - `STORAGE_S3_REGION=us-east-1`
   - `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET_KEY` (MinIO creds)
   - `STORAGE_SHARE_SECRET` (≥32 chars — HMAC key for share tokens)
   Wire these the same way the other verticals' secrets are wired (helmfile values / theo-cloud Secret). Create the MinIO bucket.
3. **Apply migration 000057 to the dev-public DB** (engine owns migrations): `cd /root/theo && task db:migrate` (or the canonical migrate path) — applies `000057_storage_objects` (CREATE TABLE storage_objects + 2 indexes). Verify `to_regclass('storage_objects')` is not null.
4. **Redeploy theo-cloud** so the new image (with the storage routes) is live — via the tilt/helmfile path the parallel session uses. Verify: `GET https://app-dev.usetheo.dev/v1/storage/objects` (no key) now returns **401** (fail-closed), not 404.
5. **Seed a storage-scoped key.** Mint a `theo_live_*` key carrying `storage:read` + `storage:write` (the scopes are already in the `validScopes` registry at `internal/routes/api_keys.go`). Export it as `THEO_STORAGE_KEY`.
6. **Run the LIVE chain** — two ways, both should be GREEN:
   - The J-26 journey: `cd /root/theo && THEO_STORAGE_KEY=<key> go test -tags=live ./infra/tests/livetest/dogfood/ -run J26 -v` (Scenario A edge 401 + Scenario B upload→stat→download-bytes-equal→delete→404).
   - Or a raw curl chain against `https://app-dev.usetheo.dev` (or cloud-dev) with the key: PUT `/v1/storage/objects/probe/x.txt` (201) → GET stat (200) → GET download (bytes equal) → POST `/v1/storage/share` (200, url) → GET the shared url unauthenticated (200 + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`) → DELETE (204) → GET stat (404).
7. **Capture evidence** (baseline per `steady-state-baseline.md`) + record the sponsor verbatim.
8. **Flip ROADMAP M7 checkboxes** in `theo-cloud/ROADMAP.md` only after 6+7 GREEN and the QA Red Team step per `cleanroom-up-live-test-mandate.md`.

## 4. Reproduce the real-infra proof locally (optional confidence check)

The workstation validated everything with local Docker; you can too:
```
docker run -d --name pg -e POSTGRES_PASSWORD=itest -e POSTGRES_DB=storage_itest -p 15499:5432 postgres:16
docker run -d --name minio -p 19000:9000 -e MINIO_ROOT_USER=ak -e MINIO_ROOT_PASSWORD=sk minio/minio server /data
# create bucket theo-storage-itest; apply 000057_storage_objects.up.sql to the DB; also `CREATE TABLE tenants(id text primary key, account_id text); CREATE TABLE subscriptions(account_id text, plan text, status text);`
export STORAGE_TEST_DATABASE_URL="postgres://postgres:itest@127.0.0.1:15499/storage_itest?sslmode=disable"
export S3X_TEST_ENDPOINT=http://127.0.0.1:19000 S3X_TEST_BUCKET=theo-storage-itest S3X_TEST_ACCESS_KEY=ak S3X_TEST_SECRET_KEY=sk
cd theo-cloud && go test -tags=integration ./internal/storage/... ./internal/routes/ -run "Integration|E2E|RealMinIO|RealInfra|ConcurrentUploads|TestHTTP_Storage|TestS3X" -v
```
All PASS (proven this session).

## 5. Gotchas (read before acting)

- **Parallel session on the droplet.** One was running `tilt up dev-public` (CODEX_COMPANION_SESSION_ID=bc1def16…). Coordinate — do NOT run `task clean:all` blind (destroys the running dev-public).
- **Storage vertical is CONFIG-GATED.** If `STORAGE_S3_*` is not fully set, theo-cloud logs `STORAGE_S3_* not set — /v1/storage/* endpoints disabled` and the routes stay 404. All-or-none validation is in `config.go`.
- **Metering is Prometheus-only in the MVP** (`theo_storage_bytes_written_total`). It does NOT write `cost_counters` — deliberate (the engine's `cost_counters.metric` CHECK is contract-guarded to theo-contracts `plan.CostMetric`; adding `storage_bytes` there is deferred to when storage billing lands). Do NOT "fix" this by widening the CHECK — it's the documented ADR-D4 decision.
- **PGTierResolver fail-loud.** It resolves the plan tier from `subscriptions`/`tenants`; on `ErrNoRows` → `starter` (fail-safe), on any OTHER DB error → propagates → the upload 503s. In dev-public those tables exist, so this is fine; if you see a 503 on upload, check the tier query.
- **Never commit the npm token / any secret.** The `.npmrc` used to publish was gitignored + removed. The `STORAGE_SHARE_SECRET` and MinIO creds go in a Secret, never in git.
- **No Co-Authored-By trailer** (project hard gate).
- **Honesty (Rule 3):** the checkbox flips only with real LIVE evidence + Red Team. Engineering-green ≠ LIVE-green.

## 6. Artifacts to read

1. This file.
2. `theo-cloud/.claude/knowledge-base/plans/tenant-blob-storage-plan.md` (v1.1, SHIPPABLE 95.6 — the master plan; ADRs D1-D5).
3. `theo/.claude/knowledge-base/discoveries/blueprints/tenant-blob-storage-blueprint.md` (SHIPPABLE 100.0 — architecture, 4 ADRs).
4. `theo-cloud/.claude/knowledge-base/reviews/tenant-blob-storage-edge-cases-2026-07-14.md` (EC-1/EC-2 security).
5. `theo-cloud/docs/products/storage.md` (the 6-op reference — API/CLI/SDK).
6. `theo-cloud/ROADMAP.md § M7` (DoD + engineering-status note).
