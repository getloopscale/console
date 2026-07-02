# Review — edge-rag-broker (M14, ROADMAP-edge-integration)

**Date:** 2026-07-02
**Slug:** edge-rag-broker · **milestone_id:** M14 · **Repo:** theo-cloud (Go, native)
**Diff:** `704053d..HEAD` (4 commits: T1.1/T2.1, T3.1, T4.1, review-fix)
**Verdict:** **READY_TO_MERGE**

## Specialist agents (4, parallel)

| Agent | Verdict | Findings |
|---|---|---|
| security + architecture (adversarial) | **SECURITY_CLEAN** | 1 LOW (inherited), 2 INFO |
| test-auditor | TESTS_GAPS → **RESOLVED** | 2 MEDIUM (fixed), 1 LOW, 1 INFO |
| wiring + cross-validation | rate-limited → **manual cross-check CLEAN** | (see below) |
| parsimony + changelog + git | PARSIMONY_CLEAN | 1 INFO |

No BLOCKER, no HIGH. The two MEDIUMs (test completeness) were fixed in-cycle.

## Security review — every invariant confirmed by the adversarial agent

- **Control/data-plane split (CWE-441):** the platform key (`rag:platform-admin`) is confined to `AdminClient.platformKey`; the `Broker` struct holds NO platform key (only the `minter` DIP interface); `client.go` is correctly absent (no Go data path — the edge proxies). Structurally airtight.
- **Fail-closed:** every path traced — empty tenant / empty intersect / mint error / missing `raw_key` → `("", error)`, no cache write, no master fallback. The handler 503s on mint failure; no DENY path sets an Authorization header.
- **Least privilege:** `intersectScopes(want, allowed)` mints only the granted subset; a stray `rag:platform-admin` on a consumer key is filtered out (not in `allowed`).
- **EC-1 response adaptation:** parses theo-rag's nested `{key:{id,scopes},raw_key}` → `MintResult{Secret:raw_key}`; the `raw_key == "" → error` guard fails closed on a malformed body.
- **Path:** `/v1/admin/keys` (theo-rag's `/v1`-prefixed M12 endpoint — NOT promptly's native `/admin/keys`). No secret logged (rag package emits no logs; platform key only in the Authorization header).

## Findings (post-fix)

| Sev | Finding | Resolution |
|---|---|---|
| ~~MEDIUM~~ (test) | refuse-to-start (T4.1) promised but not unit-tested (inline `os.Exit(1)` untestable) | **FIXED** — extracted `buildRagForwardAuth(cfg, resolve, authorize, logger) (*handler, error)`; `main` calls it + `os.Exit(1)` on error; unit tests assert nil-when-unset + handler-when-configured. The operator-facing boot failure (base-url without admin-key) is also covered by the config.Validate test. |
| ~~MEDIUM~~ (test) | `TestLoad_RagFields` promised but missing (an `envOr` key typo would pass struct-only Validate tests) | **FIXED** — `t.Setenv`-based test asserts `Load()` reads `RAG_BASE_URL` + `RAG_PLATFORM_ADMIN_KEY` into the fields. |
| LOW (security) | `forward_auth.go` logs the mint error, whose body could echo the upstream body (≤4KB) | Accepted / inherited — identical in themory/promptly; theo-rag returns no-secret error envelopes on non-2xx; not M14-specific. |
| LOW (test) | `TestBroker_ReturnsMintedSecret_NotPlatformKey` leans on the structural argument (stub controls the secret) | Accepted — the structural split (Broker has no platform-key field) is the real guarantee; the test asserts pass-through + distinctness. |
| INFO | the `minter` DIP interface is triplicated (themory/promptly/rag) — intentional Rule-9 self-contained copy, not business-logic duplication; `admin_client.go`'s 404/`*Error` lifecycle is defensive (POST-only caller) but reachable + tested. | Noted. |

## Wiring + cross-validation (manual — the agent was rate-limited)

- **Route mounted:** `cmd/main.go:530-531` — `r.Get/r.Post(routes.AuthzForwardRagPath, ragForwardAuthHandler.ServeHTTP)` (`/internal/authz/forward-rag`).
- **No orphan exports:** `rag.NewAdminClient`, `rag.NewBroker` called in main; `buildRagForwardAuth` (4 refs).
- **Shared collaborators reused (EC-2):** the rag handler uses the SAME `auth.ResolveAPIKey` + `auth.AccountOwnsTenant` as themory/promptly — no rag-specific resolver invented.
- **Correct path:** `/v1/admin/keys` (theo-rag), verified. No `interface{}`/reflection hacks.
- **6/6 DoD items** map to code: admin_client (MintKey, structural split) · broker (KeyForTenantScoped + intersect + fail-closed) · config (RAG_BASE_URL/RAG_PLATFORM_ADMIN_KEY + prod validate) · main wiring + refuse-to-start · `go test`/`go vet` green · CHANGELOG.

## Parsimony

Zero new Go module (`singleflight` + `golang-lru` already present); `broker.go` verbatim-identical to themory (only package + error-prefix); `admin_client.go` copy + the ONE justified response adaptation + `raw_key` guard; `client.go` correctly omitted (YAGNI); no speculative abstraction. **No concurrent-work contamination** — the 3 feat commits contain only M14 files; the untracked theo-lens/release/theo-memory artifacts stayed untracked. gofmt clean.

## Gates (final)

- `go build ./...` — **OK** · `go vet ./...` — **clean** · `gofmt -l` — clean
- `go test ./...` — **17 packages ok, 0 FAIL**
- `go test -race ./internal/rag/...` — **green** (singleflight coalescing proven under -race)
- theo-cloud `run_validation.py edge-rag-broker` — **exit 0** (code_quality PASS)
- git: commits on `develop`, none on `main`, no Co-Authored-By, no secrets.

## Verdict

**READY_TO_MERGE** — the adversarial security review confirmed the confused-deputy is closed (structural split + least privilege + fail-closed, no master fallback); the two test-completeness MEDIUMs (refuse-to-start unit test, env-load test) were fixed in-cycle; wiring is reachable + reuses the shared collaborators. This is the first theo-cloud-native edge milestone (M14); next is M15 (edge/Traefik wiring — theo-workspace).

> Tooling note surfaced to the human: theo-cloud's `discover-plan-confidence` scorer emits a false `INVALID` for ANY plan (`_parse_thresholds` splits on `|` while `discover-plan-thresholds.txt` uses `=` → bands parse to `{}` → verdict fallback). The M14 discovery plan scored 100/100, zero hard caps, 4/4 corners — structurally SHIPPABLE; the verdict token is a parser false-negative. The blueprint scorer (`discover-confidence`) and `plan-confidence` are unaffected (both returned real verdicts). Not fixed here (shared cycle tooling — needs an owner decision).
