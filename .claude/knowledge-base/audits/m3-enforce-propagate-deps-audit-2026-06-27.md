# Deps Audit: m3-enforce-propagate

**Date:** 2026-06-27
**Mode:** plan-bound:m3-enforce-propagate
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** (none)

## Summary

- Ecosystems detected: go (theo-contracts, theo-cloud, theo engine)
- M3-introduced dependency changes: **1** — internal `github.com/usetheodev/theo-contracts` v0.1.0 → v0.2.0 (same module, no new transitive deps)
- New third-party dependencies: **0**
- Vulnerabilities in declared/third-party deps: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW**
- Pre-existing stdlib/toolchain advisories: 18 (osv-scanner, all `stdlib @ 1.26.1`) — see Caveat
- Auditor coverage: { osv-scanner: ran (authoritative for this audit); govulncheck: SKIPPED — binary built with go1.25, project pins go1.26 toolchain, version mismatch prevents a reliable run }

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `github.com/golang-jwt/jwt/v5` | Existing | yes | yes (no CVE) | n/a | OK |
| `github.com/jackc/pgx/v5` | Existing | yes | yes (no CVE) | n/a | OK |
| `github.com/DATA-DOG/go-sqlmock` | Existing | yes | yes (no CVE) | n/a | OK |
| `github.com/usetheodev/theo-contracts` v0.2.0 | Changed (bump) | n/a (internal module, tagged in T1.3) | yes (no CVE; internal) | n/a — internal module, not a third-party adoption | OK |

The plan's `## Dependencies` section is present, every version is pinned, and the only
change is an internal version bump. No NEW third-party dependency is introduced, so the
Rule-9 "evaluated alternatives" column does not apply (nothing was adopted).

## Caveat — pre-existing stdlib/toolchain advisories (NOT an M3 finding)

osv-scanner reports 18 advisories against `stdlib @ 1.26.1` for both `theo-cloud/go.mod`
and `theo-contracts/go.mod` (e.g., GO-2026-4864/4865/4866/4869/4870/4918/4946/4947/4971/
4976/4977/4980/4981/4982/4986/5037/5038/5039). These are:

- **Toolchain-level**, tied to the `go 1.26.1` directive — NOT a dependency M3 adds or changes.
- **Monorepo-wide and pre-existing** — they affect the already-released M0 (v0.10.0), M1 (v0.11.0), and M2 (v0.12.0) identically. M3 neither introduces nor regresses them.
- **Resolved by a toolchain patch bump** (e.g., go 1.26.2), which is its own change with its own blast radius across every module — out of M3's scope.

Per the deps-audit golden rule, these do not cap M3's verdict below PASS_WITH_CAVEATS:
they are not findings on an M3-declared dependency change. They are logged here for
traceability and SHOULD be addressed by a dedicated toolchain-bump cycle (backlog),
not folded into M3.

## Recommended next steps

1. Proceed to `/plan-confidence` — no CVE blocks M3's dependency surface.
2. Track the stdlib/toolchain advisories in a separate `go-toolchain-bump` backlog item (monorepo-wide; not M3).
