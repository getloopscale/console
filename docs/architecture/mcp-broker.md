---
type: Architecture
title: loop-console as the MCP Model B broker
description: How loop-console authorizes MCP traffic by validating a consumer credential and minting a least-privilege per-tenant downstream key.
resource: https://github.com/getloopscale/loop-console/blob/main/internal/routes/mcp_resolve.go
tags: [mcp, authorization, broker, tenancy, gateway]
generated: { by: claude-opus-5/okf-export, at: 2026-08-05 }
status: stable
sources:
  - id: repo-history
    resource: docs/mcp-model-b-broker.md
    title: MCP Model B broker, at its pre-bundle path in this repository
    last_modified: 2026-06-30
---

# loop-console as the MCP Model B broker

loop-console is the **Model B authorization broker** for MCP traffic fronted by the
LoopScale MCP Gateway. This doc explains loop-console's role in the integrated MCP path so the
team can run + reason about it.

## The endpoint

`POST /internal/authz/mcp-resolve` (`internal/routes/mcp_resolve.go`,
`AuthzMCPResolvePath = "/internal/authz/mcp-resolve"`).

- **Input:** the consumer's `theo_live_*` credential + an `X-Theo-Capability` header
  (e.g. `memory`).
- **What it does:** validates the credential, checks tenant/account ownership of the
  capability, and **mints a least-privilege per-tenant downstream key**, returning the
  principal `{tenant_id, downstream_key, scopes}`.
- **Fail-closed:** a cross-account credential or a failed ownership check is rejected; the
  gateway maps any broker outage (5xx / transport error) to a 503 (never tells a valid key
  it is invalid) and 401/403/empty-principal to a deny.

## Where it runs in the integrated path

```
consumer ──theo_live_*──▶ edge /mcp/* ──▶ LoopScale MCP Gateway
                                              │  POST /internal/authz/mcp-resolve
                                              ▼
                                          loop-console  ── mints per-tenant key ──▶ gateway injects downstream
```

- In the **loopscale-workspace** local stack, loop-console runs as the `loop-console` **compose
  service** (GHCR `:develop` image, or `make up-local` to build from this repo). The
  `mcp-resolve` endpoint ships in the published image since **loop-console v0.15.0** — pull a
  recent `:develop` (or build local) so the gateway's broker calls resolve.
- The gateway points at it via `LOOPSCALE_MCP_BROKER_URL=http://loop-console:13002` (compose DNS).
- The gateway's own per-tenant tool allowlist (from the returned `scopes`) is
  defense-in-depth on top of loopmem's bearer check.

## Running loop-console standalone (outside the workspace)

`make dev-up` brings loop-console's own dev stack up (apps + real LLM) — used for end-user
validation of loop-console itself. For the **integrated MCP path**, prefer the
loopscale-workspace umbrella (`make up`), which wires loop-console + loopmem + the Gateway
together; see `../../loopscale-workspace/README.md` § Integrated MCP path and
`../../loopmcp/docs/local-compose.md`.

## Related

- Gateway broker resolver: `loopmcp` `internal/auth` (`BrokerResolver`) — calls this endpoint.
- Edge wiring + runbook: `loopscale-workspace/dev/traefik/dynamic.yml`, `loopmcp/docs/local-compose.md`.

- Scoped-key model this broker mints against:
  [`governance/dashboard`](/governance/dashboard.md) invariant 4 (unified `theo_live_*` key with scopes).
