# Review — dashboard-rag-bff (M17, ROADMAP-edge-integration)

**Date:** 2026-07-02
**Slug:** dashboard-rag-bff · **milestone_id:** M17 · **Repos:** theo-cloud (native) + theo-rag
**Commits:** theo-cloud `cca9612` + `<review-fix>` · theo-rag `7652d26`
**Verdict:** **READY_TO_MERGE**

## Specialist agents (2, parallel)

| Agent | Verdict | Findings |
|---|---|---|
| security + architecture (adversarial) | **SECURITY_CLEAN** (no BLOCKER/HIGH/MEDIUM) | 1 LOW (**fixed**), 1 INFO |
| cross-validation + test-quality | **CLEAN** (4/4 DoD, 4/4 gates exit 0) | 1 MEDIUM (**fixed**), 1 LOW (fixed), 1 INFO |

Both agents flagged the SAME real gap: the SHIPPED least-privilege keyResolver was tested only by a mirrored copy. **Fixed in-cycle** — extracted + tested on the real code path.

## Security — every invariant confirmed (adversarial)

1. **Read-only BFF (roadmap risk 1):** `mountRagDashboard` registers GET-only; `TestRagDashboard_ReadOnlyRouteSet` walks the actual routes (`chi.Walk`) and fails the build on any mutating verb (real teeth). Double-guard: the minted key is `rag:read`-only.
2. **Cross-tenant read isolation (no override path):** the resolver reads the tenant from `auth.GetUser(ctx).TenantID` ONLY; handlers forward only `limit/offset/since` downstream — a browser-supplied `?workspace=B` is ignored; upstream theo-rag scopes by the minted key's workspace. Broker errors on empty tenant.
3. **Fail-closed (triple-layered):** no JWT tenant → 401 before touching the client (`_NoTenant_401_FailsClosed`, `listCalls==0`); resolver error → no request (`TestRagDataClient_KeyResolverError_FailsClosed`); non-2xx → typed error, bearer never in an error/log string.
4. **Analytics scope loosening SAFE:** analytics aggregates ONLY the caller's own workspace (`getPrincipal(c).workspaceId`; `workspace_id==tenant_id` — no cross-tenant read); `/v1/members` + `/v1/api_keys` STAYED admin-role-gated (grep-confirmed, no collateral change); the completeness scanner now REQUIRES analytics to carry a scope guard (un-gating fails the build).
5. **Least-privilege alignment with theo-memory:** rag mints `["rag:read"]` (stricter than the memory BFF's full-scope mint); analytics-at-rag:read matches theo-memory's `memory:read`-gated metrics (`app.ts:368`).
6. **Secret hygiene + M12 pin:** no bearer echoed; the dashboard requests scopes only (never a role) — the M12 "minted keys are always member" pin is intact.

## Cross-validation — 4/4 DoD; 4/4 gates exit 0

| # | DoD item | Evidence |
|---|---|---|
| 1 | `/v1/dashboard/rag/*` read-only (rag:read only, no write path) | theo-cloud `mountRagDashboard` (GET-only) + `newRagDashboardKeyResolver` (`["rag:read"]`) + `rag_dashboard.go` (GET handlers) |
| 2 | Go test: no mutating verb + cross-tenant read isolation | `TestRagDashboard_ReadOnlyRouteSet` (chi.Walk) + `TestNewRagDashboardKeyResolver_CrossTenantIsolation`/`_MintsReadOnly`/`_FailsClosed` (shipped resolver) |
| 3 | collections list + M5 analytics via the minted per-tenant key | theo-rag `analytics.ts` (rag:read) + theo-cloud `data_client.go` (proxy w/ per-tenant Bearer) + `rag_dashboard.go` handlers |
| 4 | theo-cloud CHANGELOG; /review READY_TO_MERGE | both CHANGELOGs; this report |

**Gates:** theo-cloud `go test ./...` **exit 0** + `go vet` clean · theo-rag `vitest` **770 passed** + `tsc` **0** + `eslint` 0 errors.

**Test-teeth:** read-only route-set (chi.Walk — fails on a POST); the SHIPPED keyResolver now tested directly (least-privilege `rag:read` + JWT-tenant + cross-tenant + fail-closed — a regression to full-scope/param-derived mint fails the build); data-client proxy-bearer + fail-closed-before-call + non-2xx; analytics rag:read-reachable + workspace-scoped + negative (rag:write-only → 403); contract tests correctly re-split (members/api_keys stay admin; analytics moves to scope axis; completeness negative-control re-pointed to `/v1/members`, not weakened).

### Finding resolved in-cycle

| Sev | Finding | Resolution |
|---|---|---|
| **MEDIUM** (xval) / **LOW** (sec) | the shipped least-privilege keyResolver was tested only via a mirrored copy — a regression to full-scope mint on the real path would pass all gates | **FIXED** — extracted `newRagDashboardKeyResolver(minter)` (ISP interface) + 3 tests driving the REAL closure (`_MintsReadOnly`, `_CrossTenantIsolation`, `_FailsClosed`); the mirror was removed. |
| INFO | posture change: any workspace member with rag:read (not just admins) now sees aggregate analytics | Accepted/documented — consistent with existing rag:read data routes; `query_events` is privacy-first (no raw query text); noted in the handler doc + CHANGELOG. |

## Hygiene

All commits on `develop`, none on `main`, no Co-Authored-By, no secrets (test fixtures only), no concurrent-work contamination.

## Honest caveat (accepted, not a gap)

The live dashboard render (browser + JWT session + the full stack) is a team-QA concern; the automated proof is the Go route-set + shipped-resolver isolation tests + the theo-rag scope test. There is no live-stack requirement in M17's DoD (unlike M18's hermetic edge e2e).

## Verdict

**READY_TO_MERGE** — the read-only BFF closes the roadmap risk-1 (no write path — GET-only route set + rag:read-only mint), isolates tenants (JWT-derived tenant, no param override), is fail-closed, and the analytics scope alignment is safe (own-workspace read) + matches the theo-memory precedent the user mandated. Both agents CLEAN; the MEDIUM (untested shipped resolver) was fixed in-cycle. Next in the roadmap: M18 (hermetic ForwardAuth e2e — the KEYSTONE proof) or M19/M20.
