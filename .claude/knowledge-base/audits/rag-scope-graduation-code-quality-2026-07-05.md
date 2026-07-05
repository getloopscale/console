# Code Quality Audit: rag-scope-graduation (#168)

**Date:** 2026-07-05
**Verdict:** PASS
**Score cap:** 100

## Summary
Parity change (graduate `rag:*` to customer-issuable scopes). Delta = 2 code files + 2 test files.
- Go: `internal/routes/api_keys.go` (validScopes/reservedScopes) + NEW `api_keys_test.go` (hermetic, sqlmock).
- Dashboard: `api-keys.tsx` (ACTIVE_SCOPES/RESERVED_SCOPES) + `api-keys.test.tsx`.

## Gates
- `go test ./internal/routes ./cmd ./internal/auth` — ok · `go vet ./internal/routes` — clean · `go build ./...` — clean.
- dashboard `vitest run api-keys.test.tsx` — 7/7 green.
- `tsc`: api-keys.tsx clean. Pre-existing unrelated errors in `src/pages/lens/trace-detail.tsx` (codemirror deps not installed in this checkout — NOT caused by #168; confirmed my diff touches only api-keys.*).
- No new deps (reuses go-sqlmock v1.5.2). No broker/edge/main.go change.
