# Review — edge-rag-hermetic-e2e (M18, ROADMAP-edge-integration) [KEYSTONE]

**Date:** 2026-07-02
**Slug:** edge-rag-hermetic-e2e · **milestone_id:** M18 · **Repos:** theo-cloud (native) + theo-rag (Dockerfile fix)
**Commits:** theo-cloud `6cf3eea` · theo-rag `b03aeba` + `<dockerignore>`
**Verdict:** **READY_TO_MERGE**

## The proof (make e2e-edge — green, 5/5)

The hermetic edge e2e ran GREEN through the REAL Traefik edge + REAL ForwardAuth + a REAL theo-rag container:

```
--- PASS: TestEdgeForwardAuthTenantIsolationE2E   (memory — no regression)
--- PASS: TestEdgeForwardAuth_NoKey_DeniedAtEdge   (memory — no regression)
--- PASS: TestEdgeForwardAuthRagTenantIsolationE2E (rag — cross-tenant isolation)
--- PASS: TestEdgeForwardAuthRag_PerVerbWall       (rag — minted rag:read → 403 write)
--- PASS: TestEdgeForwardAuthRag_FailClosed        (rag — no-key edge/direct 401 + minted≠customer)
ok  github.com/usetheodev/theo-cloud/tests/e2e   edge e2e PASSED ✔
```

## Specialist agents (2, parallel)

| Agent | Verdict | Findings |
|---|---|---|
| security + architecture (adversarial, false-pass hunt) | **SECURITY_CLEAN** — genuine invariant-#6 proof | 1 MEDIUM (**fixed**), 2 LOW, 1 INFO |
| cross-validation | **CLEAN** — 6/6 DoD, 7/7 assertions, 5/5 static gates | 2 INFO |

## Security — the e2e is a GENUINE proof (not a false-pass)

The #1 keystone risk (a "passing" e2e that doesn't route through ForwardAuth) is structurally impossible:

- **Isolation:** `ragListCollectionNames` hard-fails on any non-200, so Alice's "absent" is a REAL workspace-scoped 200 list; a no-isolation bug makes A *see* B's collection → FAIL. Bob's `201` requires ForwardAuth to actually mint a valid key (the raw customer key alone 401s at the service). The three assertions are mutually reinforcing.
- **Per-verb wall:** the edge required scope is `rag:read` (`cmd/main.go:68`), so the read-only consumer PASSES the edge; the broker mints a `rag:read`-only key (`intersectScopes`); the 403 is provably from theo-rag's M11 `requireScopeOnPrincipal('rag:write')` — not the edge.
- **Fail-closed (3 independent denials):** no-key@edge → ForwardAuth 401 + no Authorization on the deny; no-key direct → M13 `THEORAG_REQUIRE_CREDENTIAL=true` 401; raw customer-key direct → 401 (the key is seeded in the CLOUD DB, never in theo-rag → the raw key resolves null). Combined with the isolation `201`, a real minted≠customer + Del-then-set proof.
- **Hermetic:** container upstream `http://rag:8080` (not host.docker.internal); mock-openai; no secret/real-network. `rag-migrate` (`ON_ERROR_STOP=1` + `service_completed_successfully`) applies the schema before `rag` boots — no half-migrated silent boot.
- **Dockerfile fix (`b03aeba`):** correct + secure — tsx devDeps→deps (required for `--prod`), copies api+core SOURCE (theo-rag's no-build tsx model), non-root `USER node`, healthcheck preserved, no secret baked. Container boots + `/v1/healthz` 200 (proven).

### Finding resolved in-cycle

| Sev | Finding | Resolution |
|---|---|---|
| **MEDIUM** | no `.dockerignore` — a stray `.env`/`node_modules` in packages/{api,core} would bake into the real theo-rag image (secret-leak + bloat) via the wholesale COPY | **FIXED** — added `theo-rag/.dockerignore` excluding `**/.env*`, `**/node_modules`, `.git`, tests, dogfood, dist, knowledge-base, .claude. Container still boots. |
| LOW | `EXPOSE 8787` vs the e2e `PORT=8080` | Accepted — EXPOSE documents the api's OWN default (8787); the e2e intentionally overrides to 8080. Documentation-only, harmless. |
| LOW | rag tests `t.Skip` on unset DSN (a dropped env under EDGE would silently retire the proof) | Accepted — consistent with the memory tests' off-stack-skip pattern; `make e2e-edge` always exports all envs (proven 5/5, not skipped). Noted for a future EDGE-detected `t.Fatal` tightening. |

## Cross-validation — 6/6 DoD; 5/5 static gates

| # | DoD item | Evidence |
|---|---|---|
| 1 | rag container + pg + seed; edge overlay depends_on rag | `docker-compose.edge.e2e.yaml` (pg-rag + rag-migrate + rag + traefik depends_on rag) |
| 2 | theo-rag built from a pinned source ref (M11-M13), not GHCR :develop | `run.sh` builds `theo-rag-e2e -f $THEORAG_DIR/packages/api/Dockerfile` from the sibling; no GHCR pull |
| 3 | dynamic.e2e rag-edge + forward-auth-rag + rag-rewrite → http://rag:8080 | `dynamic.e2e.yml` (rag-edge 92, forward-rag address, rag-rewrite, rag service) |
| 4 | rag case: 7 assertions | `edge_rag_forward_auth_e2e_test.go` (all 7 mapped: isolation write/A-absent/B-found, per-verb 403, no-key edge 401, direct 401, customer-key direct 401) |
| 5 | make e2e-edge green, hermetic | 5/5 PASS; container upstreams + mock-openai, no secrets/real-network |
| 6 | theo-cloud CHANGELOG; /review READY_TO_MERGE | both CHANGELOGs; this report |

**Static gates:** `docker compose config -q` **0** · `go vet -tags=e2e` **0** · `bash -n run.sh` **0** · `yaml.safe_load(dynamic.e2e)` **0** · image `theo-rag-e2e:latest` built. **Memory e2e unchanged** (rag additions EDGE-gated + additive; the 2 memory tests still PASS).

**Necessary deviation (INFO):** pg-rag uses `ankane/pgvector:v0.5.1` (not the plan's `postgres:17-alpine`) — theo-rag's 0000 migration needs the pgvector `vector` type + HNSW index. Correct + necessary.

## Hygiene

All commits on `develop`, none on `main`, no Co-Authored-By, no real secrets (e2e bootstrap tokens + `dummy-key-for-mock` + deterministic test bearers are fixtures), no concurrent-work contamination.

## Verdict

**READY_TO_MERGE** — the KEYSTONE is proven: rag cross-tenant isolation + the per-verb wall + fail-closed hold END-TO-END through the real edge, in a hermetic stack, and the design makes a false-pass impossible (both agents independently confirmed the three fail-closed denials can only pass with real ForwardAuth + real M13 + the real Del-then-set). The blocking theo-rag Dockerfile defect (never booted) was fixed as a prerequisite; the review MEDIUM (`.dockerignore`) was fixed in-cycle. Invariant #6 is now automatically proven — the caveat M15/M16/M17 deferred is closed. Next in the roadmap: M19 (dogfood live) / M20 (register the capability + close the loop).
