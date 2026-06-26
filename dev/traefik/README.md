# Traefik dev edge

The single dev edge (M8 slice-3a). Routes everything on `:8090`:

| Router | Rule | Upstream | Priority |
|---|---|---|---|
| `memory-edge` | `PathPrefix(/v1/memory)` | `themory:8080` (via ForwardAuth + rewrite) | 100 |
| `bff` | `/v1`, `/engine`, `/health` | `theo-cloud:13002` | 10 |
| `kratos` | `/self-service`, `/sessions`, `/.well-known/ory` | `kratos:4433` | rule-length |
| `dashboard-spa` | `PathPrefix(/)` (catch-all) | `dashboard` (nginx static) | 1 |

`traefik.yml` = static config (entrypoint `:8090`, file provider, **tracing OFF** — ADR D4). `dynamic.yml` = routers/middlewares/services + the `internal-tls` serversTransport scaffold.

## TLS on the internal hop (ADR D4)

Dev runs the edge→backend hops over **plain HTTP** on the private compose network so
`up` stays one command (no per-developer cert provisioning). The `internal-tls`
serversTransport is **defined but not referenced** in dev.

**Prod overlay** (not in this dev config): wire the authz/BFF hop to TLS by

```yaml
http:
  services:
    theo-cloud-bff:
      loadBalancer:
        servers:
          - url: "https://theo-cloud:13002"   # was http:// in dev
        serversTransport: internal-tls          # references the scaffold
  serversTransports:
    internal-tls:
      serverName: "theo-cloud.internal"
      rootCAs: [ "/etc/traefik/certs/ca.pem" ]
      certificates:                              # client certs → mTLS (prod only)
        - certFile: "/etc/traefik/certs/edge.crt"
          keyFile:  "/etc/traefik/certs/edge.key"
      insecureSkipVerify: false
```

A config drift-guard (`tests/config/traefik_config_test.go`) asserts the scaffold
exists AND that dev never references it (so mTLS is never accidentally forced in dev).
