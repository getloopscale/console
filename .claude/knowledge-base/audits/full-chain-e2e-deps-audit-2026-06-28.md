# Deps Audit: full-chain-e2e

**Date:** 2026-06-28
**Mode:** plan-bound:full-chain-e2e
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary

- **New dependencies introduced: 0.** M6 is a test/infra milestone that reuses the existing hermetic harness + dev images + Go stdlib; the headless login is a port of an existing bash recipe.
- Docker images reused (all present locally / publicly pullable): `oryd/kratos:v1.3.1`, `migrate/migrate:v4.17.1`, `ankane/pgvector:v0.5.1`, `postgres:16-alpine`, `themory-e2e:latest` (built from the in-tree theo-memory source). These are the SAME images the dev stack already runs — no new supply-chain surface.
- Go: no new module. The full-chain test uses `net/http`, `database/sql`, `encoding/json` (stdlib) + the existing e2e seeding helpers.
- CI: `oryd/kratos`/`migrate`/postgres images are pulled by docker compose at runtime; no new GitHub Action marketplace dependency beyond `actions/checkout` + `actions/setup-go` (first-party, widely used).

## Plan validation

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `oryd/kratos:v1.3.1` | Existing (image) | dev-identical | pinned tag; same as dev | n/a | OK |
| `migrate/migrate:v4.17.1` | Existing (image) | dev-identical | pinned | n/a | OK |
| `ankane/pgvector` / `postgres` | Existing (image) | e2e-identical | pinned | n/a | OK |
| Go stdlib | Existing | toolchain | n/a | n/a | OK |
| (NEW) | New | `(none)` with Rule 9 rationale | n/a | yes | OK |

## Notes

- No new third-party Go code; no manifest change → no `osv-scanner`/`govulncheck` delta to gate.
- The images are version-pinned (no `:latest` for the external images except the locally-built `themory-e2e`, which is built from in-tree source, not pulled).

## Recommended next step

Proceed to `/plan-confidence full-chain-e2e` (done — SHIPPABLE 98.4).
