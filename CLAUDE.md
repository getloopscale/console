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

## Provenance

Extracted at M4 (`theo-cloud/.claude/knowledge-base/plans/m4-extract-theo-cloud-plan.md`),
history preserved via `git filter-repo`. Governance minimal at M4; fuller per-repo CI +
release discipline at M5. The theo-contracts `replace` is local-only until the M5 version pin.
