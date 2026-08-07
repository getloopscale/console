# Blueprint — M6 True full-chain e2e (the real user journey)

**Slug:** full-chain-e2e · **Milestone:** M6 · **Date:** 2026-06-28
**Repo under change:** `theo-cloud` control plane (Go + dev infra + CI)
**Cycle:** DISCOVER (internal-architecture investigation — the harness already exists; M6 wires the missing seam)
**Verdict target downstream:** READY_TO_MERGE

## Problem

No automated test drives the REAL ecosystem chain. The frontend is tested with `VITE_USE_MOCKS=true` (never hits the BFF); the backend e2e inject SYNTHETIC seeded JWTs (`seedAPIKey`) and the isolation tests (M1/M3) mint through a `captureMinter` STUB, never real themory. The two halves meet at a mocked seam. M6 builds ONE automated full-chain test that drives a real Kratos login → JWT exchange → BFF → real broker mint → real themory → assertion, proving account-tenancy holds across the REAL chain, and runs it in CI.

## Evidence map (real file:line)

### Coverage Corner 1 — Integration / Tests (what exists, what's missing)

- **Headless Kratos login recipe ALREADY EXISTS in bash:** `theo/infra/tests/e2e/dashboard-engine-proxy_test.sh:50-96` — `GET /self-service/login/browser` (init flow + CSRF cookie jar) → extract `csrf_token` + `action` → `POST {action}` with `{csrf_token,identifier,method:password,password}` → extract `ory_kratos_session` from Set-Cookie → `POST /v1/auth/session/token` with that cookie → `access_token` JWT → `GET /engine/api/v1/projects` with Bearer. M6 ports this to Go.
- **Session-token exchange seam:** `theo-cloud/internal/routes/session_token.go:19-134` — `POST /v1/auth/session/token` validates the Kratos cookie via `GET {kratosInternal}/sessions/whoami`, calls `TenantProvisioner.EnsureTenant(subject,email)` → `(tenantID, accountID)`, issues the `theo_session_*` JWT with `account_id` claim (M3). Errors: 429/502/401/500 typed.
- **Existing full-stack e2e (real themory):** `theo-cloud/tests/e2e/{tenant_isolation_e2e_test.go,memory_e2e_test.go,edge_forward_auth_e2e_test.go}` drive the REAL gateway→broker→themory path. `tenant_isolation_e2e_test.go:32` proves tenant A≠B via per-tenant key. These use `seedAPIKey` (synthetic `theo_live_*`), NOT real login — the seam M6 closes.
- **The harness:** `theo-cloud/tests/e2e/run.sh` builds host binaries → `docker compose -f tests/e2e/docker-compose.e2e.yaml up -d --wait --wait-timeout 240` → exports `E2E_CLOUD_URL/E2E_THEMORY_URL/E2E_PG_CLOUD_DSN` → `go test -tags e2e ./tests/e2e/...` → teardown (`down -v` unless `KEEP_UP=1`).
- **The gap in the e2e compose:** `theo-cloud/tests/e2e/docker-compose.e2e.yaml` has `pg-themory, pg-cloud, mock-openai, themory, theo-cloud` — **NO kratos**. The full-chain test needs Kratos added (the dev compose `docker-compose.dev.yaml` + `dev/kratos/kratos.yml` is the reuse source).
- **Skip-guard inconsistency:** `account_m0/tenant_isolation/edge_forward_auth/ship_criterion_m3/account_broker_m1/billing_per_account_m2` SKIP gracefully on missing `E2E_PG_CLOUD_DSN`; `memory_e2e_test.go` (`TestMemoryE2E_*`) FAIL loudly (no skip-guard) — M6 adds guards so `go test ./...` stays clean.

### Coverage Corner 2 — Dependencies

- **No new Go dependency.** The full-chain test uses stdlib `net/http` + `database/sql` + the existing test seeding helpers.
- **Infra images (all available / pullable):** `oryd/kratos:v1.3.1` (present), `ankane/pgvector:v0.5.1` (present), `postgres:16-alpine`, `themory-e2e:latest` (present), mock-openai (built from host binary). Docker 29 + Compose v5 present; `theo-memory` source present at `/home/paulo/Projetos/usetheo/theo-data/theo-memory` (so themory is buildable; pre-built `themory-e2e:latest` lets us skip the rebuild with `THEMORY_IMAGE`+`THEMORY_SKIP_BUILD`).

### Coverage Corner 3 — Tools

- Kratos dev config: `theo-cloud/dev/kratos/kratos.yml` — password login enabled, **email verification DISABLED** (registration immediately yields an active session; no SMTP loop). Pre-verified identity provisioning via Kratos **admin API** `POST /admin/identities` with `verifiable_addresses:[{verified:true}]` (`theo/infra/scripts/local/seed-admin-usetheo-dev.sh:165-173`).
- `go test -tags e2e`, `docker compose --wait` (health-gated readiness), `testutil` for metric asserts.
- CI: GitHub Actions `ubuntu-latest` (docker + go preinstalled).

### Coverage Corner 4 — Techniques

- **Headless real login** (port the bash recipe to Go): provision a pre-verified Kratos identity per test user via admin API → drive the login flow via Kratos public API (cookie jar + CSRF) → exchange the session cookie at `/v1/auth/session/token` for the `theo_session_*` JWT.
- **Real broker mint** (NOT captureMinter): the JWT-authenticated BFF memory call resolves the tenant + mints a per-tenant themory key via the Model B broker → real themory. Cross-tenant isolation asserted on the REAL path.
- **Health-gated stack readiness** (`docker compose --wait`) to avoid flakiness — every service has a healthcheck.
- **CI mirrors `run.sh`** — a new `.github/workflows/test-e2e.yml` builds host binaries (with the `theo-contracts` private-module token), brings up the stack, runs the e2e, tears down. Only blocker: `theo-contracts` private module needs a GitHub token for `go mod download` (handled by building binaries on the runner with `GITHUB_TOKEN`).

## The cap-scenario scope decision (ADR-M6-3 below)

The M6 DoD names a "project-cap scenario across the chain (ties M5)". The project cap lives in the **engine** (`theo`), reachable only via the BFF's `/engine/*` proxy — but the **engine is NOT in the theo-cloud e2e stack** (which is the memory data plane: theo-cloud + themory). Adding the engine (its binary + its own migrated pg) to the e2e stack is disproportionate infra for re-proving a cap already proven at its own layer (M5 integration, 7 `-race` scenarios). Decision: the full-chain focuses on the **auth → BFF → broker → themory → isolation** journey (the seam that was previously stubbed); the project-cap remains proven at the engine layer (M5). See ADR-M6-3.

## ADRs

### ADR-M6-1 — Add Kratos to the e2e compose (reuse the dev config)

**Decision:** extend `theo-cloud/tests/e2e/docker-compose.e2e.yaml` with `kratos` + `kratos-migrate` services (image `oryd/kratos:v1.3.1`, config mounted from `dev/kratos/kratos.yml`, DSN → pg-cloud's kratos schema), and give the e2e `theo-cloud` service `KRATOS_INTERNAL_URL`/`KRATOS_PUBLIC_URL`. Reuse the dev Kratos config (email-verification disabled) verbatim — no new auth config to maintain.

**Why not run against the dev stack:** the e2e harness is hermetic + health-gated + torn down per run; the dev stack is long-lived/operator-driven. Hermetic is the CI-correct choice.

### ADR-M6-2 — Drive real login headlessly in Go (port the existing bash recipe)

**Decision:** a Go test helper provisions a pre-verified Kratos identity (admin API), runs the Kratos public-API login flow (cookie jar + CSRF), and exchanges the session cookie at `/v1/auth/session/token`. No browser/Playwright — the headless API flow is deterministic and CI-friendly (the bash recipe already proves it works). Identities cleaned up at teardown.

### ADR-M6-3 — Full-chain covers the memory journey; the engine cap stays engine-proven

**Decision:** scope the full-chain to login → JWT → BFF memory API → real broker mint → real themory → cross-tenant isolation. The engine project-cap is NOT re-proven through the chain (the engine is not in the theo-cloud e2e stack); it is cited as engine-layer-proven (M5). This keeps M6 proportionate and avoids dragging the entire engine + its pg into the theo-cloud e2e harness. If the team later wants the cap in the full-chain, add the engine to the stack as a follow-up.

### ADR-M6-4 — Add a CI test stage mirroring run.sh; skip-guards keep `go test ./...` clean

**Decision:** a new `.github/workflows/test-e2e.yml` runs the e2e on PR/push (the FIRST test stage in CI — today only `release-artifacts.yml` exists, which builds/publishes without testing). Add skip-guards to the no-guard `memory_e2e` tests so a plain `go test ./...` (no infra) SKIPs cleanly rather than failing — the CI stage is where they actually execute against the stack.

## Out of scope (YAGNI)

- Playwright/browser-driven full-chain (the headless API flow is sufficient + deterministic; the browser path is covered by the existing mocked Playwright suite for UI).
- Adding the engine to the e2e stack (ADR-M6-3).
- Dashboard vitest in CI (separate concern; M6 is the backend full-chain + its CI stage).

## Citations resolve

All `theo-cloud/...` and `theo/...` paths above were read during discovery (2026-06-28). Key anchors: `theo-cloud/internal/routes/session_token.go:{19,49,98,116}`, `theo-cloud/tests/e2e/{run.sh,docker-compose.e2e.yaml,tenant_isolation_e2e_test.go:32,memory_e2e_test.go:175,edge_forward_auth_e2e_test.go:32}`, `theo-cloud/dev/kratos/kratos.yml`, `theo/infra/tests/e2e/dashboard-engine-proxy_test.sh:{50,69,75,83,94}`, `theo/infra/scripts/local/seed-admin-usetheo-dev.sh:{165,206}`, `theo-cloud/.github/workflows/release-artifacts.yml`.
