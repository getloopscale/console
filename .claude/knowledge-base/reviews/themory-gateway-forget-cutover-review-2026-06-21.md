# Review: themory-gateway-forget-cutover

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Reviewers:** 3 focused agents (architecture+security · tests · cross-validation)
**Commits:** `01ca1d4` (cutover) + `6d2348c` (review fixes)

## Findings: 0 BLOCKER · 2 MAJOR (both addressed) · LOW/INFO

### MAJOR (addressed)
- **M1 — 404-collapse / silent-data-not-deleted hazard (security).** If the gateway runs against an OLD theo-memory (no DELETE route), the absent-route 404 → `ErrNotFound` → forget returns 404 while the memory is NOT deleted (GDPR dimension on `?hard`). The IDOR itself is confirmed CLOSED (faithful server-side pushdown; `user_id`-in-path = authenticated subject; not a relaxation). **Resolution:** deploy-gate stands for the `develop` merge; production deploy now REQUIRES a provider-capability guard (readiness probe OR pipeline smoke forget→204) — recorded in the plan Drawbacks + tracked as **followup F1**. Reviewers agreed this is a pre-prod item, not a develop-merge blocker.
- **M2 — missing `422 → *Error` assertion (tests).** Plan AC named it; was only structurally covered by the 503 branch. **Resolution:** added explicit `422 (non-UUID memId) maps to *Error` case (`6d2348c`).

### LOW / INFO
- Stale `POST /v1/forget` prose in contract-test header/comments — fixed (`6d2348c`).
- openapi `?hard` enum is `["true"]` only (gateway never sends `hard=false`) — correct by construction.

## Cross-validation
Plan ↔ impl matches line-by-line (T1.1 + T1.2, 6/6 coverage, ADRs D1-D3 honored). All callers/tests updated incl. the initially-missed `tests/unit/themory_client_test.go`. Provider-side route confirmed present in theo-memory `develop` (`app.delete('/v1/scopes/:type/:id/memories/:memId')`); verb/path/`?hard`/404/422 contract matches exactly.

## Quality gates
`go build ./...` OK · `go vet ./...` clean · `gofmt` clean · `go test ./... -race` green.

## Handoff
READY_TO_MERGE to `develop`. **Release is deploy-gated:** the theo-cloud release/deploy of this change MUST follow theo-memory v0.12.0 (PR #58) going live, AND should land the F1 provider-capability guard before production.
