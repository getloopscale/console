---
slug: full-chain-e2e
milestone_id: M6
created_at: 2026-06-28
goal: Build one automated full-chain e2e that drives a real Kratos login → JWT exchange → BFF → real broker mint → real themory → assertion, proving account-tenancy isolation across the REAL chain (not the captureMinter stub), runnable hermetically and in CI.
---

# Plan — M6 True full-chain e2e (the real user journey)

## Goal

Close the most material test-coverage gap: no automated test drives the REAL ecosystem chain (frontend uses `VITE_USE_MOCKS`; backend e2e inject synthetic seeded JWTs and mint through a `captureMinter` stub). Build ONE automated full-chain test that, against a hermetic Model-B stack, performs a **real Kratos login** (headless, pre-verified identity) → exchanges the session at `POST /v1/auth/session/token` for the `theo_session_*` JWT → drives the BFF memory data path with that JWT → the **real broker** mints a per-tenant key → **real themory** stores/returns the memory, and asserts (a) the real response the user would get, and (b) **tenant-A's real session cannot read tenant-B's memory** through the real chain. Upgrade the e2e harness to the full account-tenancy schema + Kratos so this is possible, add a CI stage that runs it, and add skip-guards so `go test ./...` stays clean. Measurable: the full-chain test passes `-race` against the live stack; cross-tenant isolation holds on the real path; the existing tenancy e2e (currently broken on the minimal e2e schema) pass; CI workflow mirrors the local harness.

## Baseline Context

theo-cloud control plane at `develop`. The e2e harness (`tests/e2e/run.sh` + `docker-compose.e2e.yaml`) brings up a hermetic 5-service stack (pg-cloud, pg-themory, mock-openai, themory, theo-cloud) but its pg-cloud schema is a minimal `theo_api_keys`-only init SQL — insufficient for the account-tenancy tables (users/accounts/tenants/subscriptions/projects), and it has NO Kratos. Empirically verified (spike, 2026-06-28): the stack boots healthy here; the engine migrations create the full schema but require DB user `theo` (migration 000023 owner check).

### Files that will be touched

| File | Role | Change |
|---|---|---|
| `theo-cloud/tests/e2e/docker-compose.e2e.yaml` | hermetic e2e stack (5 services) | pg-cloud → user/db `theo`; add `cloud-migrate` (engine migrations), `kratos`, `kratos-migrate`; theo-cloud gets `KRATOS_*` URLs |
| `theo-cloud/tests/e2e/sql/01-cloud-schema.sql` | minimal pg-cloud init | replace with extensions + kratos-DB bootstrap only (real schema comes from migrations) |
| `theo-cloud/tests/e2e/run.sh` | harness | realign `E2E_PG_CLOUD_DSN` to `theo`; export `E2E_KRATOS_PUBLIC_URL`/`E2E_KRATOS_ADMIN_URL` |
| `theo-cloud/tests/e2e/fullchain_e2e_test.go` (NEW) | the full-chain test + headless-login helper | real login → JWT → BFF memory → themory → assert + isolation |
| `theo-cloud/tests/e2e/memory_e2e_test.go` | existing (no skip-guard) | add `E2E_CLOUD_URL`/`E2E_THEMORY_URL` skip-guards |
| `theo-cloud/.github/workflows/test-e2e.yml` (NEW) | CI | first test stage: build binaries (with theo-contracts token) → `make e2e` |
| `theo-cloud/tests/e2e/README.md` (NEW or appended) | seam doc | what the full-chain covers vs what stays unit/mocked |

### Current callers / dependents

- Session exchange: `theo-cloud/internal/routes/session_token.go:19` `POST /v1/auth/session/token` → validates Kratos cookie via `GET {kratosInternal}/sessions/whoami` → `EnsureTenant` → issues JWT (account_id claim).
- Real chain (broker → themory): `theo-cloud/tests/e2e/tenant_isolation_e2e_test.go:32` + `memory_e2e_test.go:175` drive gateway→broker→themory; `seedAPIKey`/`ensureTenantAccount` seed users/accounts/tenants/theo_api_keys.
- Headless login recipe (bash, to port): `theo/infra/tests/e2e/dashboard-engine-proxy_test.sh:50-96`.
- Kratos dev config (reuse): `theo-cloud/dev/kratos/kratos.yml` (email-verification disabled), `dev/kratos/identity.schema.json`.
- Engine migrations (full schema): `theo/api/internal/db/migrations/` (000001..000044).

### Domain glossary

- **Full-chain** — real Kratos login → session JWT → BFF memory API → broker per-tenant mint → real themory → response.
- **captureMinter** — the M1/M3 e2e STUB minter that never reached real themory; M6 replaces it with the real broker on the real chain.
- **Pre-verified identity** — a Kratos identity created via admin API with `verifiable_addresses:[{verified:true}]` so login works without the email loop.
- **Model-B stack** — pg-cloud + pg-themory + mock-openai + themory + theo-cloud (+ kratos added by M6).
- **Session JWT** — `theo_session_*` from `/v1/auth/session/token`, carrying tenant_id + account_id (M3).

### Architecture boundaries affected

- Test/infra only — NO production code change. The change surface is the e2e harness (compose + run.sh), a new e2e test, a CI workflow, and a doc. The session-token handler, broker, and themory are exercised AS-IS.
- The **engine** (`theo`) is NOT in the theo-cloud stack (not even in dev compose) — the project-cap chain is out of scope (ADR-M6-3).

## Coverage Matrix

| # | Goal claim | Task(s) | Status |
|---|---|---|---|
| 1 | Hermetic e2e stack has the FULL account-tenancy schema (engine migrations) + Kratos | T1.1 | Planned |
| 2 | A real headless Kratos login → `/v1/auth/session/token` yields a `theo_session_*` JWT | T2.1 | Planned |
| 3 | The full chain (login → JWT → BFF memory write/read → real broker → real themory) returns the real response | T2.1 | Planned |
| 4 | Cross-tenant isolation holds on the REAL chain: tenant-A's real session cannot read tenant-B's memory (real broker, not captureMinter) | T2.2 | Planned |
| 5 | The existing tenancy e2e (broken on the minimal schema) pass on the upgraded stack | T1.1, T2.2 | Planned |
| 6 | CI runs the full-chain hermetically (workflow mirrors run.sh; theo-contracts token handled) | T3.1 | Planned |
| 7 | `go test ./...` with no infra SKIPs the full-stack e2e cleanly (skip-guards added) | T3.2 | Planned |
| 8 | Honest seam documentation (full-chain coverage vs unit/mocked) | T3.2 | Planned |

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `oryd/kratos` | v1.3.1 | docker image | dev-identical Kratos (present locally; pullable in CI) |
| `migrate/migrate` | v4.17.1 | docker image | applies the engine migrations (dev-identical) |
| `ankane/pgvector` / `postgres` | v0.5.1 / 16-alpine | docker image | pg-themory / pg-cloud (present/pullable) |
| Go stdlib `net/http`, `database/sql` | (toolchain) | Go | headless login + assertions, no new dep |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | M6 reuses dev images + the existing harness + stdlib; the headless-login is a port of an existing bash recipe | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Critical paths

- The headless-login helper + session exchange (T2.1) — if login is flaky, the whole chain is flaky; covered by a deterministic Kratos API flow (pre-verified identity, no email loop) + health-gated readiness.
- The cross-tenant isolation assertion on the real chain (T2.2) — the security-critical proof that was previously only stubbed.

## Tasks

### T1.1 — Upgrade the e2e stack to full schema + Kratos

#### Why this step

The e2e pg-cloud schema is a `theo_api_keys`-only subset; the account-tenancy tests (and the full-chain) need users/accounts/tenants/subscriptions/projects. The engine migrations are the drift-free source (dev uses them) but require DB user `theo`. Kratos is absent from the e2e compose. This task brings the e2e stack to dev parity (real migrations + Kratos), reusing the dev config verbatim (ADR-M6-1).

#### Files to edit

- `theo-cloud/tests/e2e/docker-compose.e2e.yaml` — pg-cloud user/password/db → `theo`; add `cloud-migrate` (mount `../../theo/api/internal/db/migrations`, run `up`), `kratos-migrate` + `kratos` (mount `dev/kratos`, DSN → pg-cloud kratos DB); theo-cloud gets `KRATOS_INTERNAL_URL`/`KRATOS_PUBLIC_URL` + `SESSION_TOKEN_SECRET`.
- `theo-cloud/tests/e2e/sql/01-cloud-schema.sql` — reduce to: create extensions (superuser) + the `kratos` database; drop the hand-maintained theo_api_keys block (migrations own it).
- `theo-cloud/tests/e2e/run.sh` — `E2E_PG_CLOUD_DSN` user/db → `theo`; export `E2E_KRATOS_PUBLIC_URL` (:14433) + `E2E_KRATOS_ADMIN_URL` (:14434).

#### TDD

The "test" for the harness is the existing tenancy e2e turning GREEN on the upgraded stack:
- Bring up the stack; assert `tenant_isolation_e2e_test.go` (Given two seeded tenants, When A reads B's memory, Then denied) now PASSES against the real schema (it currently FAILS with `relation "users" does not exist`).
- Assert `kratos` reports `/health/ready` and the admin API `POST /admin/identities` creates a pre-verified identity.

#### Concurrency tests

(none — single-threaded). Compose bring-up; the concurrency guarantees are in the data-plane code already proven elsewhere (broker singleflight, advisory locks).

#### Acceptance criteria

- `docker compose -f tests/e2e/docker-compose.e2e.yaml up --wait` reaches all-healthy including `kratos` and a completed `cloud-migrate` — verified by `compose ps` showing `healthy`/`completed` and `psql -d theo -c '\dt'` listing users/accounts/tenants/subscriptions/projects/theo_api_keys.
- `go test -tags e2e ./tests/e2e/ -run TestTenantIsolationE2E` exits 0 on the upgraded stack (was failing `relation "users" does not exist`) — verified by capturing the test exit code.
- `POST /admin/identities` with `verified:true` followed by a login + `POST /v1/auth/session/token` returns HTTP 200 with a non-empty token — verified by `TestFullChainE2E_RealLoginToMemory` passing its first assertion (a 401/502 would fail it).

### T2.1 — Headless real-login helper + the full-chain happy path

#### Why this step

The core deliverable: prove the REAL journey end-to-end with no mocks. Port the existing bash login recipe to a Go helper (provision a pre-verified Kratos identity → drive the Kratos public-API login flow with a cookie jar + CSRF → exchange the session cookie at `/v1/auth/session/token` for the JWT), then use the JWT to write+read a memory through the BFF and assert the real response (ADR-M6-2).

#### Files to edit

- `theo-cloud/tests/e2e/fullchain_e2e_test.go` (NEW) — `loginViaKratos(t, kratosPublic, kratosAdmin, email, password) (jwt string)` helper + `TestFullChainE2E_RealLoginToMemory`.

#### TDD

- `TestFullChainE2E_RealLoginToMemory` — Given a pre-verified Kratos identity provisioned via admin API, When the test performs a real headless login + `POST /v1/auth/session/token`, Then it receives a non-empty `theo_session_*` JWT whose claims include a tenant_id (assert the JWT exchange 200 + token shape). Then, using that JWT against the BFF memory API (`POST` a memory, `GET`/recall it), Then the real themory returns the stored memory (assert the round-trip content), proving login→JWT→BFF→broker→themory end-to-end with zero mocks.

#### Concurrency tests

(none — single-threaded). The login + round-trip is sequential; concurrent-login behavior is already covered by `account_m0` concurrent-signup tests.

#### Acceptance criteria

- `loginViaKratos` returns a non-empty `access_token` from a real Kratos session (no synthetic seed) — asserted by `len(jwt) > 0` after the `/sessions/whoami`-backed exchange (a 502/401 fails the test).
- The JWT drives a real BFF memory write+read whose recall response body contains the exact written content — asserted by `strings.Contains(recallBody, writtenText)`.
- `go test -tags e2e ./tests/e2e/ -run TestFullChainE2E` with `E2E_CLOUD_URL`/`E2E_KRATOS_PUBLIC_URL` unset prints `--- SKIP` and exits 0 — verified by capturing the run output.
- Running `TestFullChainE2E_RealLoginToMemory` twice in a row both exit 0 (teardown deletes each identity via `DELETE /admin/identities/{id}`; no duplicate-identity error on the second run) — verified by a double `go test` invocation.

### T2.2 — Cross-tenant isolation on the REAL chain

#### Why this step

The security-critical proof: two REAL logged-in users (two pre-verified identities → two tenants/accounts) — tenant-A's real session JWT cannot read tenant-B's memory, through the **real broker → real themory** (replacing the captureMinter stub the M1/M3 e2e used). This is the first time tenancy isolation is proven on the fully-real chain.

#### Files to edit

- `theo-cloud/tests/e2e/fullchain_e2e_test.go` — `TestFullChainE2E_CrossTenantIsolationRealChain`.

#### TDD

- `TestFullChainE2E_CrossTenantIsolationRealChain` — Given two pre-verified identities A and B (distinct accounts/tenants via EnsureTenant on first login), When each logs in for real and A writes a memory then B (with B's real JWT) attempts to read A's memory, Then B does NOT receive A's content (isolation holds on the real broker→themory path), AND A can read its own. Assert the negative (B's recall excludes A's memory) AND the positive (A recalls its own).

#### Concurrency tests

(none — single-threaded). Two sequential sessions; the broker's concurrent-mint safety is proven by `account_broker_m1` race tests.

#### Acceptance criteria

- B's real session cannot retrieve A's memory content (negative case asserts the SPECIFIC absence, not just a status) — asserted on B's recall body.
- A's real session retrieves A's own memory (positive boundary) — asserted on A's recall body.
- The path uses the real broker mint (no captureMinter) — verified by running against the live themory (the test has no stub).
- `go test -tags e2e ./tests/e2e/ -run TestFullChainE2E` passes `-race` on the live stack.

### T3.1 — CI stage: run the full-chain hermetically

#### Why this step

Today CI only builds/publishes images (`release-artifacts.yml`) — zero test gating. M6 adds the FIRST test stage so the full-chain (and the suite) actually gate merges (ADR-M6-4).

#### Files to edit

- `theo-cloud/.github/workflows/test-e2e.yml` (NEW) — on `pull_request` + `push: develop`: checkout, setup-go, configure the `theo-contracts` private-module token (`git config url.insteadOf` with `${{ secrets.GITHUB_TOKEN }}` or a PAT), `make e2e` (which builds host binaries + brings up the stack + runs the e2e + tears down), upload `docker compose logs` on failure.

#### TDD

- The workflow is validated by: `actionlint`/YAML-parse clean, and a documented local dry-run (`make e2e` green locally is the proxy oracle, since GitHub Actions executes on push). The workflow MUST set the contracts token step and the THEMORY_DIR/THEMORY_IMAGE env so the runner can build/pull themory.

#### Concurrency tests

(none — single-threaded). CI orchestration.

#### Acceptance criteria

- `test-e2e.yml` parses (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test-e2e.yml'))"` exits 0) and contains the trigger (`pull_request`), the contracts-token step (`url.insteadOf`), and the `make e2e` step — verified by the parse + a `grep` for those three tokens.
- `make e2e` exits 0 locally (the exact command CI runs) on the upgraded stack — verified by capturing the harness exit code.
- The workflow has a comment recording that the first CI execution happens on push (Actions cannot run from the dev box) — verified by `grep` of that comment in the workflow file.

### T3.2 — Skip-guards + seam documentation

#### Why this step

`memory_e2e_test.go`'s `TestMemoryE2E_*` FAIL loudly without infra (no skip-guard), so a plain `go test ./...` is red off-stack. Add guards so they SKIP cleanly; document honestly what the full-chain covers vs what stays unit/mocked (so future readers don't over-read coverage).

#### Files to edit

- `theo-cloud/tests/e2e/memory_e2e_test.go` — add `if os.Getenv("E2E_CLOUD_URL")=="" { t.Skip(...) }` style guards to the 5 no-guard tests.
- `theo-cloud/tests/e2e/README.md` (NEW or appended) — the seam: full-chain proves login→JWT→BFF→broker→themory→isolation; the engine project-cap is engine-proven (M5, ADR-M6-3); the Playwright UI suite stays mocked by design.

#### TDD

- `test_memory_e2e_skips_without_infra` (behavioral) — `go test ./tests/e2e/` with NO `e2e` build tag and NO env compiles+passes (the `e2e`-tagged files are excluded; the guard matters when the tag is on but infra is absent). Concretely: `go test -tags e2e ./tests/e2e/ -run TestMemoryE2E` with no env SKIPs (exit 0, `--- SKIP`), not FAILs.

#### Concurrency tests

(none — single-threaded).

#### Acceptance criteria

- `go test -tags e2e ./tests/e2e/ -run TestMemoryE2E` with no `E2E_*` env prints `--- SKIP` and exits 0 — verified by the run.
- `tests/e2e/README.md` states the full-chain coverage + the engine-cap-is-M5 note + the mocked-UI note — verified by grep.

## Failure scenarios

External-I/O touched by the tests: HTTP to Kratos + the BFF + themory; DB seeding. Resilience the harness must handle:

| Scenario | Expected behavior | Test/Handling |
|---|---|---|
| Stack not up (no `E2E_*` env) | Full-stack tests SKIP cleanly, not FAIL | T3.2 skip-guards |
| Kratos not ready when login runs | `docker compose --wait` gates on `/health/ready`; the test only runs post-health | T1.1 healthcheck + run.sh `--wait` |
| Kratos login flow returns non-200 (bad creds / CSRF) | The helper fails the test with the Kratos error body (not a hang) | T2.1 explicit status assertions |
| `/v1/auth/session/token` 502 (Kratos unreachable) / 401 (no session) | The test fails with the typed error surfaced (no silent pass) | T2.1 asserts 200 + non-empty token |
| themory cold / embedding slow | health-gated start_period (15s) + `--wait-timeout 240`; recall asserts content, not latency | T1.1 healthcheck |
| Leaked Kratos identities across re-runs | teardown deletes identities via admin API; seeds are idempotent (ON CONFLICT) | T2.1 cleanup |

## Drawbacks & Risks

| Risk / Drawback | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Realigning pg-cloud `theocloud`→`theo` breaks the existing memory e2e tests (DSN drift) | Medium | High | `E2E_PG_CLOUD_DSN` is the single source (run.sh) — update it + the compose together; memory tests seed `theo_api_keys` which the engine migrations also create; re-run the full e2e suite to confirm green before merge. |
| Headless Kratos login flakiness (CSRF/cookies/redirects) in CI | Medium | High | Use the pre-verified-identity + Kratos public-API flow (the bash recipe already proves it); health-gate readiness; deterministic identities; no email loop (dev kratos disables verification). |
| CI full-stack run is slow / flaky | Medium | Medium | Reuse the health-gated `--wait` harness; gate the heavy stage to PR/push (not every commit if needed); upload compose logs on failure for triage. |
| theo-contracts private module blocks `go build` in CI | Medium | High | Build host binaries on the runner with `${{ secrets.GITHUB_TOKEN }}` via `git config url.insteadOf` (the e2e copies static binaries into runtime images — no token needed in the image build). |
| The full-chain can't reach the engine project-cap (engine not in stack) | High (known) | Low | ADR-M6-3: cap is engine-proven (M5); the full-chain covers the memory journey. Documented, not hidden. |

## Prior Art

- **Headless login recipe:** `theo/infra/tests/e2e/dashboard-engine-proxy_test.sh` (the exact Kratos flow, ported to Go).
- **Pre-verified identity provisioning:** `theo/infra/scripts/local/seed-admin-usetheo-dev.sh:165` (admin API, `verified:true`).
- **The hermetic harness:** `theo-cloud/tests/e2e/run.sh` + `docker-compose.e2e.yaml` (extended, not replaced).
- **Real-chain isolation (stubbed today):** `theo-cloud/tests/e2e/tenant_isolation_e2e_test.go` (M6 makes it real-login-driven).
- **Dev full-schema + kratos infra (parity source):** `theo-cloud/docker-compose.dev.yaml` (cloud-migrate + kratos services).

## Unresolved Questions

(none — every decision is resolved at plan time)

## Test Plan

- **Harness (T1.1):** stack up --wait all-healthy; `\dt` shows full schema; `TestTenantIsolationE2E` green on the upgraded stack.
- **Full-chain (T2.1/T2.2):** `go test -tags e2e ./tests/e2e/ -run TestFullChainE2E -race` against the live stack — real login → JWT → BFF memory round-trip + cross-tenant isolation (negative + positive).
- **Hygiene (T3.2):** `go test -tags e2e ./tests/e2e/ -run TestMemoryE2E` with no env SKIPs cleanly.
- **CI (T3.1):** workflow YAML parses; `make e2e` green locally (the command CI runs).
- **Regression:** full `make e2e` suite green on the upgraded stack (existing memory + tenancy e2e).

## Global DoD

Each item names its verifier (oracle).

- [ ] Coverage Matrix 100% — verified by `plan-confidence` `coverage_pct == 100`.
- [ ] The e2e stack boots all-healthy with the FULL schema + Kratos — verified by `compose ps` (healthy + cloud-migrate completed) and `psql -d theo -c '\dt'` listing users/accounts/tenants/subscriptions/projects/theo_api_keys.
- [ ] A real headless Kratos login yields a `theo_session_*` JWT — verified by `TestFullChainE2E_RealLoginToMemory` asserting a non-empty `access_token` from `/v1/auth/session/token`.
- [ ] The full chain (login → JWT → BFF memory write/read → real themory) returns the written content — verified by the recall-body assertion in `TestFullChainE2E_RealLoginToMemory`.
- [ ] Cross-tenant isolation holds on the REAL chain — verified by `TestFullChainE2E_CrossTenantIsolationRealChain` asserting B excludes A's content AND A recalls its own.
- [ ] The previously-broken tenancy e2e pass on the upgraded stack — verified by `TestTenantIsolationE2E` + `TestAccountM0_*` exiting 0.
- [ ] `go test -tags e2e ./tests/e2e/ -run TestMemoryE2E` with no env SKIPs cleanly — verified by `--- SKIP` in the output.
- [ ] CI workflow `test-e2e.yml` parses and runs `make e2e` with the contracts-token step — verified by YAML parse + grep; `make e2e` green locally captured as the proxy oracle.
- [ ] `tests/e2e/README.md` documents the seam (full-chain vs engine-cap-M5 vs mocked-UI) — verified by grep.
- [ ] All full-chain + suite tests pass `-race` on the live stack — verified by the captured `go test -tags e2e -race` run.
- [ ] CHANGELOG `[Unreleased]` updated (Added: full-chain e2e + CI stage) — verified by grep.
- [ ] No production code changed (test/infra only) — verified by `git diff --name-only` touching only `tests/`, `.github/`, `dev`-config-reuse, docs, CHANGELOG.
