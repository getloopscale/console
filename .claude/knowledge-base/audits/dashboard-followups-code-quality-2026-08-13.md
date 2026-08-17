# Code Quality Audit: dashboard-followups

**Date:** 2026-08-13
**Mode:** plan-bound
**Verdict:** FAIL_SOFT
**Score cap:** 70
**Hard caps triggered:** soft_cap_go

## Summary

- Languages audited: go, typescript
- Languages skipped: _none_
- Total findings: 23 (0 HARD, 21 SOFT_CAP, 0 SOFT_FLOOR, 2 INFO)

## Findings by detector

### D1 — Dead code
| File | Symbol | Severity | Message |
|---|---|---|---|
| `internal/billing/cost_aggregator.go` | `CostAggregator.WithClock @ internal/billing/cost_aggregator.go:74:26` | SOFT_CAP | Unreachable Go symbol 'CostAggregator.WithClock' at internal/billing/cost_aggregator.go:74:26 [allowlisted] |
| `internal/config/config.go` | `Secret.String @ internal/config/config.go:19:17` | SOFT_CAP | Unreachable Go symbol 'Secret.String' at internal/config/config.go:19:17 [allowlisted] |
| `internal/config/config.go` | `Secret.GoString @ internal/config/config.go:20:17` | SOFT_CAP | Unreachable Go symbol 'Secret.GoString' at internal/config/config.go:20:17 [allowlisted] |
| `internal/config/config.go` | `Secret.MarshalJSON @ internal/config/config.go:21:17` | SOFT_CAP | Unreachable Go symbol 'Secret.MarshalJSON' at internal/config/config.go:21:17 [allowlisted] |
| `internal/config/config.go` | `Secret.MarshalText @ internal/config/config.go:22:17` | SOFT_CAP | Unreachable Go symbol 'Secret.MarshalText' at internal/config/config.go:22:17 [allowlisted] |
| `internal/metrics/metrics.go` | `StorageBytesWrittenValue @ internal/metrics/metrics.go:211:6` | SOFT_CAP | Unreachable Go symbol 'StorageBytesWrittenValue' at internal/metrics/metrics.go:211:6 [allowlisted] |
| `internal/metrics/metrics.go` | `ObjectsDeletedValue @ internal/metrics/metrics.go:227:6` | SOFT_CAP | Unreachable Go symbol 'ObjectsDeletedValue' at internal/metrics/metrics.go:227:6 [allowlisted] |
| `internal/metrics/metrics.go` | `ServiceVersionInfoValue @ internal/metrics/metrics.go:270:6` | SOFT_CAP | Unreachable Go symbol 'ServiceVersionInfoValue' at internal/metrics/metrics.go:270:6 [allowlisted] |
| `internal/metrics/metrics.go` | `ServiceVersionProbeValue @ internal/metrics/metrics.go:293:6` | SOFT_CAP | Unreachable Go symbol 'ServiceVersionProbeValue' at internal/metrics/metrics.go:293:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncTokenExchange @ internal/metrics/metrics.go:306:6` | SOFT_CAP | Unreachable Go symbol 'IncTokenExchange' at internal/metrics/metrics.go:306:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncDeviceFlow @ internal/metrics/metrics.go:315:6` | SOFT_CAP | Unreachable Go symbol 'IncDeviceFlow' at internal/metrics/metrics.go:315:6 [allowlisted] |
| `internal/metrics/metrics.go` | `ObserveTenantProvisioning @ internal/metrics/metrics.go:332:6` | SOFT_CAP | Unreachable Go symbol 'ObserveTenantProvisioning' at internal/metrics/metrics.go:332:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncAuthRejection @ internal/metrics/metrics.go:342:6` | SOFT_CAP | Unreachable Go symbol 'IncAuthRejection' at internal/metrics/metrics.go:342:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncWebhook @ internal/metrics/metrics.go:360:6` | SOFT_CAP | Unreachable Go symbol 'IncWebhook' at internal/metrics/metrics.go:360:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncCheckout @ internal/metrics/metrics.go:369:6` | SOFT_CAP | Unreachable Go symbol 'IncCheckout' at internal/metrics/metrics.go:369:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncUsageDrift @ internal/metrics/metrics.go:378:6` | SOFT_CAP | Unreachable Go symbol 'IncUsageDrift' at internal/metrics/metrics.go:378:6 [allowlisted] |
| `internal/metrics/metrics.go` | `IncSubscriptionFallback @ internal/metrics/metrics.go:383:6` | SOFT_CAP | Unreachable Go symbol 'IncSubscriptionFallback' at internal/metrics/metrics.go:383:6 [allowlisted] |
| `internal/metrics/metrics.go` | `ObserveHTTPRequest @ internal/metrics/metrics.go:401:6` | SOFT_CAP | Unreachable Go symbol 'ObserveHTTPRequest' at internal/metrics/metrics.go:401:6 [allowlisted] |
| `internal/routes/integrations_github.go` | `GitHubIntegrationsHandler.WithInsecureCookieForTests @ internal/routes/integrations_github.go:57:37` | SOFT_CAP | Unreachable Go symbol 'GitHubIntegrationsHandler.WithInsecureCookieForTests' at internal/routes/integrations_github.go:57:37 [allowlisted] |
| `internal/routes/memory_exports.go` | `MemoryExportsHandler.WaitForWorkers @ internal/routes/memory_exports.go:254:32` | SOFT_CAP | Unreachable Go symbol 'MemoryExportsHandler.WaitForWorkers' at internal/routes/memory_exports.go:254:32 [allowlisted] |
| `internal/routes/rag_connectors_oauth.go` | `RagConnectorsOAuthHandler.WithInsecureCookieForTests @ internal/routes/rag_connectors_oauth.go:114:37` | SOFT_CAP | Unreachable Go symbol 'RagConnectorsOAuthHandler.WithInsecureCookieForTests' at internal/routes/rag_connectors_oauth.go:114:37 [allowlisted] |

### D2 — Symbol fabrication
_No findings._

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

### D5 — architecture

| File | Symbol | Severity | Message |
|---|---|---|---|
| `.` | `go-arch-lint` | INFO | no architecture rules declared (go-arch-lint config not found: .go-arch-lint.yml). D5 skipped — a rule the repo did not declare is not a rule Squad may enforce. |
| `.` | `dependency-cruiser` | INFO | no architecture rules declared (dependency-cruiser config not found: a package.json script running `depcruise`). D5 skipped — a rule the repo did not declare is not a rule Squad may enforce. |

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
