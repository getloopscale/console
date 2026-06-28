# Deps Audit: engine-project-cap-enforcement (M4)

**Date:** 2026-06-28
**Mode:** plan-bound:engine-project-cap-enforcement
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** (none)

## Summary

- Ecosystem: go (theo engine, `api/go.mod`)
- M4-introduced dependency changes: **0** (no new dep, no version bump — M4 mirrors the existing `pkg/enforcement` + `pgx` + `prometheus` infra).
- Vulnerabilities in declared deps: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW** (LOW is pre-existing, not M4's).
- Pre-existing stdlib/toolchain advisories: 18 (`stdlib @ 1.26.1`) — monorepo-wide, tracked separately (same as M0–M3).
- Auditor: osv-scanner ran (authoritative); govulncheck skipped (built with go1.25 vs project go1.26 toolchain mismatch).

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit | Rule 9 | Verdict |
|---|---|---|---|---|---|
| `github.com/jackc/pgx/v5` | Existing | yes (5.9.0) | **LOW CVE — see caveat** | n/a | OK (caveat) |
| `github.com/prometheus/client_golang` | Existing | yes | clean | n/a | OK |
| `github.com/DATA-DOG/go-sqlmock` | Existing | yes | clean | n/a | OK |

M4's `## Dependencies` section declares no NEW dependency; the Rule-9 alternatives column does not apply (nothing adopted).

## Caveat — LOW CVE on pgx (pre-existing, not introduced by M4)

`osv.dev/GO-2026-5004` (`GHSA-j88v-2chj-qfwx`) — **severity 2.3 (LOW)** — on `github.com/jackc/pgx/v5 @ 5.9.0`. Fix available: `5.9.1` / `5.9.2` / `5.10.0`.

- **Pre-existing**: pgx/v5 is used engine-wide (every DB path); M4 only USES it (the advisory lock) — it does not add or bump pgx.
- **Per the deps-audit golden rule**: a LOW CVE on a declared dep caps at `PASS_WITH_CAVEATS` (89) and does NOT block the cycle.
- **Recommendation (follow-up, not M4)**: bump `github.com/jackc/pgx/v5` to `5.9.2`+ in a dedicated monorepo-wide dependency-bump change (touches all engine DB code — the team's surface, out of M4's app-layer scope). Folding an engine-wide pgx bump into M4 would inflate the blast radius and contradict KISS/scope.

The 18 `stdlib @ 1.26.1` advisories are toolchain-level, monorepo-wide, and identical across M0–M3; resolved by a toolchain patch bump (its own change), not M4.

## Recommended next steps

1. Proceed to `/plan-confidence` — no CRITICAL/HIGH/MEDIUM CVE on any M4-declared dependency; the LOW pgx CVE is pre-existing and capped at PASS_WITH_CAVEATS.
2. Track the pgx LOW bump + the stdlib toolchain bump as monorepo-wide follow-ups (team backlog), not M4.
