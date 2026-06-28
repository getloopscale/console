# Deps Audit: hermetic-project-cap

**Date:** 2026-06-28
**Mode:** plan-bound:hermetic-project-cap
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary

- Ecosystem: Go (engine `theo`, `api/go.mod`).
- **New dependencies introduced by this plan: 0.** M5 is an internal refactor that reuses the M4 advisory-lock pattern, the existing typed error (`pkg/errors`), and the existing prometheus metric. No manifest change.
- Existing deps touched (use-as-is): `github.com/jackc/pgx/v5` (advisory lock + tx; already the engine's pg driver), `github.com/prometheus/client_golang` (metric; already in tree).
- Vulnerabilities introduced: none (no new dep).

## Plan validation

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `jackc/pgx/v5` | Existing — use as-is | yes (current go.mod) | n/a (no version change) | n/a | OK |
| `prometheus/client_golang` | Existing — use as-is | yes | n/a | n/a | OK |
| (NEW) | New — to be introduced | n/a — section explicitly `(none)` with Rule 9 rationale ("internal refactor reusing M4's pattern; no new capability requires a dependency") | n/a | yes | OK |

## Notes

- Pre-existing engine advisory: a LOW-severity pgx CVE was noted during the M4 deps-audit (2026-06-28) — pre-existing, not introduced by M5, unchanged. No new exposure.
- Because the plan introduces no new dependency and no version bump, a full `osv-scanner`/`govulncheck` sweep is not a gate for this plan (the surface M5 adds is zero new third-party code). The existing engine vuln posture is unchanged by M5.

## Recommended next step

Proceed to `/plan-confidence hermetic-project-cap`.
