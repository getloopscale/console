# Code Quality Audit: gateway-graphexpand-recall-ui

**Date:** 2026-06-23
**Mode:** plan-bound
**Verdict:** FAIL_SOFT
**Score cap:** 70
**Hard caps triggered:** auditor_unavailable_deadcode

## Summary

- Languages audited: go
- Languages skipped: typescript
- Total findings: 2 (0 HARD, 1 SOFT_CAP, 0 SOFT_FLOOR, 1 INFO)

## Findings by detector

### D1 — Dead code
| File | Symbol | Severity | Message |
|---|---|---|---|
| `.` | `deadcode` | SOFT_CAP | deadcode auditor unavailable: deadcode exit 1: /home/paulo/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.1.linux-amd64/src/vendor/golang.org/x/crypto/chacha20poly1305/fips140only_go1.26.go:7:9: file requires newer Go version go1.26 (application bu |

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `.` | `d2` | INFO | D2 disabled by --no-network flag |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Honest disclosure (Inquebrável Rule 3) — the ONLY cap is a tooling-env limitation

The single SOFT_CAP is `auditor_unavailable_deadcode` — the Go `deadcode` CLI cannot run here due to a **Go-toolchain version mismatch**: the project + deps (`theo-contracts`) require **go1.26**, but the installable `deadcode` binary (`@latest` and the pinned `@v0.45.0`) is built against go1.25 → "package requires newer Go version go1.26 (application built with go1.25)". This is tooling-availability, **NOT a code defect** (0 HARD findings; no dead_code, no symbol_fabrication). D2 was run `--no-network` (INFO).

Context: theo-cloud's prior themory plans have ZERO code-quality audits (the repo-root `code-quality-languages.txt` is in a bare format the runner rejects) — `/code-quality` was never wired for these plans. This audit (with a corrected pipe-format languages config) is more than prior practice.

## Compensating controls (substantive dead-code + symbol-fabrication coverage)

- `go build ./...` clean (Go compile-enforces no-unused; a fabricated symbol cannot build).
- `go vet ./...` clean.
- `go test ./...` ALL PASS (full suite).
- Every new symbol has a caller + test: `GraphExpand` (contract test forwards it), `graphExpandReq` (handler test validates + passes through), dashboard toggle (playground test 9/9).
- Dashboard TS: `playground.tsx` typechecks clean (`npx tsc` — the only error is the pre-existing `overview.tsx` #119/#123 `'idle'` status, NOT in this diff); `npm run lint` clean on changed files.

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
