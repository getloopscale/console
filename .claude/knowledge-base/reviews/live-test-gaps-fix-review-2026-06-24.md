# Review: live-test-gaps-fix

**Date:** 2026-06-24
**Reviewers (spawned agents):** 3 (architecture, tests+cross-validation, domain-security)
**Commits:** bae97fe, c94fab6, 569b06d
**Findings:** 0 BLOCKER, 0 HIGH, 0 MEDIUM, 5 LOW (all absorbed), rest INFO
**Verdict:** READY_TO_MERGE

## Scope

Closes the 3 actionable theo-cloud gaps from the 2026-06-24 complete live test:
- **F-1** — gateway laundered TheMemory upstream 4xx into a misleading 502.
- **F-4** — dashboard Memory sub-nav stayed stale on click (raw startViewTransition).
- **LT-1** — concurrent migrate-on-boot race (themory + themory-mcp on one DB).

F-2 (skill codeLanguage ts/js enum) = working-as-designed per project-owner decision (F-1 makes the rejection an honest 422). F-3 (PaaS engine 502) = out of scope.

## LOW findings — all absorbed

| id | Finding | Resolution | Commit |
|---|---|---|---|
| SEC-STATUS-2 | F-1 was allow-by-default (fail-open on provider drift) | Inverted to FAIL-CLOSED consumer-fault allowlist `{400,413,422}`; all else → 502. +2 tests (unexpected-4xx→502, 413 passthrough) | 569b06d |
| SEC-LOGINJ-1 | raw upstream body logged verbatim (theoretical log injection) | `sanitizeForLog` strips CR/LF before logging | 569b06d |
| F-4-handleBack-untested | 2nd nav call site (Back) had no test | Added non-vacuous test (`getByRole('button',{name:/back to/i})` at /memory) | 569b06d |
| LT-1-mcp-skip-asymmetry | themory-mcp has no THEMEMORY_SKIP_MIGRATIONS | Clarified via comment (MCP path ignores the flag — adding it = no-op; race already closed by init container; true parity = theo-memory follow-up). NO dishonest no-op env added (Rule 3). | 569b06d |
| SCOPE-PLAN-DOC-DRIFT | plan D1 didn't reflect the 401/403/429 + allowlist carve-out | Plan D1 amended to the as-built fail-closed allowlist | 569b06d |

## Quality gates (final)

- `go build ./... && go vet ./...` → clean
- `go test ./tests/unit/... ./internal/... -count=1` → ok (all packages); 16 Upstream tests + meta-test (error-visibility 76.7%, threshold 60% unchanged)
- `cd dashboard && npm run test` → 143 files, 1005 passed, 8 skipped; `tsc --noEmit` clean
- `docker compose -f docker-compose.dev.yaml config -q` → valid
- LT-1 empirically verified: themory-migrate exit 0; themory-mcp boots without crash

## Cross-validation summary

All Coverage Matrix rows delivered + verified. F-1: 13 handlers use `writeUpstreamError` (only the helper retains the raw 502). F-4: both call sites RR-native + dead helper removed. LT-1: init container + serialized depends_on; e2e compose untouched. F-2: no enum widening in the diff. CHANGELOG: 3 accurate Fixed entries.

## Follow-ups (non-blocking)

- **theo-memory:** add `THEMEMORY_SKIP_MIGRATIONS` parity to `run-mcp-server` (true skip-flag symmetry; the race is already closed without it).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER/HIGH/MEDIUM; all 5 LOWs absorbed; all gates green.
