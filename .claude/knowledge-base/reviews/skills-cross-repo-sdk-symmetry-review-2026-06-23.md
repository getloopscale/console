# Review: skills-cross-repo-sdk-symmetry (M3)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, cross-validation, domain (security/api/tenancy)
**Findings:** BLOCKER 0, HIGH 0, MEDIUM 0, LOW 3, INFO 19
**Verdict:** READY_TO_MERGE

## Scope reviewed

theo-cloud commit `0cc3a56` (M3 — expose the cross-repo flat skills list on the SDK surface). One route line in `cmd/main.go` (`r.With(auth.RequireScope(db, "memory:read")).Get("/skills/all", memoryHandler.ListSkillsAll)`) reusing the EXISTING generic `MemoryHandler.ListSkillsAll` + a route-gating unit test + an e2e + CHANGELOG. No handler/client/themory change.

## BLOCKER / HIGH / MEDIUM

None.

## LOW

- **M3-SQLMOCK-007 (tests) — PARTIALLY FIXED:** the route tests discarded `mock.ExpectationsWereMet()` (inherited convention from `scope_middleware_test.go`). FIXED on the 403 path (deterministic — only the SELECT, no async race): now asserts it. The 200 path keeps the post-sleep discard (the fire-and-forget `last_used_at` UPDATE goroutine makes a hard assertion racy; the convention + the load-bearing status/reachability assertions keep it honest). Re-ran: 2/2 green.
- **M3-FLAKE-008 (tests) — ACCEPTED:** the 200 test uses a fixed `time.Sleep(50ms)` to drain the async UPDATE before the (discarded) `ExpectationsWereMet`. Moot because the result is discarded (no enforced assertion to flake); mirrors `scope_middleware_test.go`. Status/reachability assertions run synchronously before the sleep. No action.
- **ARCH-5 (architecture) — ACCEPTED (pre-existing):** the SDK `/v1/memory/*` surface has no published OpenAPI/route-inventory artifact to update; routes are registered imperatively in `cmd/main.go`. The new route is consistent with all 12 sibling routes (none in an inventory) — this commit introduces no NEW asymmetry. Pre-existing backlog item, not a blocker.

## Domain (security/tenancy) — all INFO

- **SEC-01:** cross-tenant isolation correct — `ListSkillsAll` reads the subject ONLY from `auth.GetUser(ctx).Subject` (server-derived from the Bearer key) and IGNORES `?subject` (anti-spoof); the route-gating test drives `?subject=attacker-supplied` and asserts the bare authed subject is used.
- **SEC-02:** `memory:read` is correct authorization, at parity with the per-repo `/skills`; the cross-repo list never widens beyond the caller's own subject (same rows, flattened).
- **SEC-03:** no IDOR/enumeration — the upstream prefix scan escapes LIKE metacharacters (`% _ \`) + the `:` delimiter + the upstream `subject.includes(':')` 400-guard prevent prefix-ambiguity attacks; `q`/`offset` are not tenant-escape vectors. e2e proves beta sees `"skills":[]` (no leak).
- **SEC-04:** the SDK route inherits the SAME isolation as the shipped BFF `/skills/all` + per-repo `/skills` — structural reuse of the identical handler + client, not a re-implementation.
- **SEC-05 (honest disclosure):** in the gateway master-key model all customers share one upstream workspace, so the `agent_id LIKE '{subject}:%'` prefix scan is the SOLE per-customer boundary — which is why the subject escaping + server-derived subject are load-bearing (both correct + tested). Suggestion (theo-memory, non-blocking): a store-layer unit test for `escapeLikeWildcards('a%_\\')` would harden the boundary against future refactors (the cross-repo GOAL already covers wildcard-escape behaviorally).

## Cross-validation — all INFO

Coverage Matrix 7/7 delivered. Invariants verified UNCHANGED via `git show 0cc3a56 --stat` + content diff: `internal/routes/memory.go` (handler), `internal/routes/dashboard_memory.go` (BFF) + its `cmd/main.go` mount (only line-shifted +5, content identical), per-repo `/v1/memory/skills`, and `internal/themory/client.go` — none modified. ADR D1 (reuse generic handler, route-only) + D2 (memory:read parity) match the code. CHANGELOG `Added` accurate. No claimed-done-but-missing, no divergence.

## Tests

- Route-gating unit (`tests/unit/memory_skills_all_route_test.go`): NON-VACUOUS — 403-without-scope (handler NOT reached: `lastSkillsAllSubject == ""`) + 200-with-scope (bare-subject through the real middleware, `?subject` ignored, per-row repoId). Mirrors `scope_middleware_test.go` sqlmock pattern; async UPDATE handled correctly on both paths.
- Existing handler tests cover bare-subject/401/502/empty-array (unchanged, green).
- e2e (`TestMemoryE2E_SkillsAllCrossRepo`): real-mux mount proof (would 404 if the route line were absent) + cross-customer isolation (same-tenant, different-subject — a stronger isolation proof). RAN GREEN against the live dev stack (gateway rebuilt with the route; tenant fixture seeded). Route verified live: `/v1/memory/skills/all` → 401 (mounted), not 404.

## Quality gates

- `go build ./...` clean · `go vet ./...` clean · `go test ./tests/unit/... ./internal/...` green.
- e2e `TestMemoryE2E_SkillsAllCrossRepo` PASS vs live gateway → live themory (cross-repo + isolation).

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER / 0 HIGH / 0 MEDIUM. 3 LOW (1 partially fixed inline, 2 pre-existing-convention/pre-existing-gap, accepted). One-route additive change confined to the composition root; no handler/client/themory change; BFF + per-repo routes byte-unchanged; tenant isolation correct + tested end-to-end.
