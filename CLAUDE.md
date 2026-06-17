# theo-cloud

The standalone repository for the commercial cloud-API (Go) + dashboard (React/TSX),
extracted from the `theo` monorepo at M4 of the decomposition roadmap. A **leaf** of
the decomposition graph: nothing in the engine imports it; it consumes
`github.com/usetheodev/theo-contracts` (jwt/serviceauth/plan) and talks to the engine
+ theo-data over HTTP.

## Layout

| Path | What |
|---|---|
| `cmd/` | cloud-API entrypoint (`main.go`) |
| `internal/` | cloud-API packages (auth, billing, metering, themory proxy, routes, …) |
| `dashboard/` | React 19 + Vite + TSX SPA (`@theo/dashboard`) |
| `openapi/themory.yaml` | cloud↔theo-data contract (M1.4) |

## Build / test

```bash
go build ./... && go test ./... -race          # cloud-API
cd dashboard && npm ci && npm run build && npm test   # dashboard
```

## Seams (HTTP, no Go coupling)

- **cloud↔engine** — opaque `/engine/*` proxy via `EngineAPIURL`, authenticated with
  Ed25519 service-auth (`theo-contracts/serviceauth`). Covered by `internal/auth/service_signer_test.go`.
- **cloud↔theo-data** — themory HTTP client; contract = `openapi/themory.yaml`, tested by
  `internal/themory/contract_test.go`.

## Invariants

- Imports nothing engine-internal (`go list -deps` shows zero `usetheo/theo/pkg/*`).
- The dashboard is the closed-source commercial differentiator.

## Dashboard governance

The dashboard's active mandates — Memory Section invariants, the 20 dashboard-journey
plans, the sponsor priority chain, and the dashboard-specific common mistakes — live in
[`docs/dashboard-governance.md`](docs/dashboard-governance.md). They were migrated here
from the engine's `theo/CLAUDE.md` at M5 (the dashboard code lives in this repo, so its
governance does too). Read it before editing any `dashboard/src/pages/` route.

## Provenance

Extracted at M4 (`theo-cloud/.claude/knowledge-base/plans/m4-extract-theo-cloud-plan.md`),
history preserved via `git filter-repo`. Governance minimal at M4; fuller per-repo CI +
release discipline at M5. The theo-contracts `replace` is local-only until the M5 version pin.

## Durable enforcement (M5)

Dependency direction (theo-cloud imports only theo-contracts, never engine `pkg/*`) is
enforced by the engine's `theo-ops quality acyclic-graph` gate. The seams (cloud↔engine
serviceauth, cloud↔theo-data themory) run in the cross-repo matrix
`task quality:contract:cross-repo` (`theo/docs/cross-repo-contract-matrix.md`). The
theo-contracts `replace => ../theo-contracts` cuts over to a pinned version per
`theo/docs/version-pin-cutover-runbook.md` (owner-gated). J-19 runtime-logs dashboard
debt (named-event log handling) is the first follow-up — see CHANGELOG § Notes.
