---
slug: themory-gateway-provider-capability-guard
created_at: 2026-06-21
goal: Fail the gateway boot when the configured TheMemory provider does not advertise the scoped-forget DELETE route, closing the deploy-ordering silent-not-deleted hazard.
---

# Plan: Gateway provider-capability boot guard (F1)

> **Version 1.0** — Followup F1 from `themory-gateway-forget-cutover` `/review` (security MAJOR): the cutover made `Forget` issue `DELETE /v1/scopes/user/{id}/memories/{id}`; against an OLD provider (no such route) the 404 collapses into `ErrNotFound`, so a forget appears to succeed-as-not-found while the memory is NOT deleted (GDPR dimension on `?hard`). This adds a BOOT-TIME capability assertion: the gateway fetches the provider's `/v1/openapi.json` once at startup and **fails boot** if the provider is reachable but does NOT advertise the scoped-forget DELETE. A transient unreachable provider at boot is NOT fatal (WARN + proceed — the existing per-request error path covers it).

## Goal

> "Prevent a deploy-ordering mistake (gateway ahead of TheMemory v0.12.0) from silently not-deleting memories, measured by the unit test `provider-capability-guard`: boot ASSERTION returns nil when the stub provider's `/v1/openapi.json` advertises a `delete` op `operationId: scopedForget`, returns `ErrProviderCapabilityMissing` when it does not, and returns a (non-fatal) transport error when the provider is unreachable — and `main` exits non-zero ONLY on `ErrProviderCapabilityMissing`."

## Context

`themory-gateway-forget-cutover` (theo-cloud v0.5.0) shipped the cutover; its `/review` security agent raised the 404-collapse hazard as MAJOR and named F1 (provider-capability guard) as a required pre-production hardening. Project-owner decision (2026-06-21 AskUserQuestion): guard shape = **boot-time assertion**; fail behavior = **fail the whole boot** when the provider is reachable but lacks the route.

The provider serves an OpenAPI 3.1 doc at `GET /v1/openapi.json` (auth-exempt; theo-memory `app.ts:181`), which the gateway already treats as the contract source. The scoped-forget route is registered there as `delete` on `/v1/scopes/{type}/{id}/memories/{memId}` with `operationId: scopedForget` (theo-memory `openapi-registration.ts:199-213`). Matching by `operationId` is resilient to path-template formatting differences.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists today | Invariants to preserve |
|---|---|---|---|
| `internal/themory/client.go` | ~595 | TheMemory HTTP client; `do()` (auth + status mapping); `Forget` now DELETE (v0.5.0) | additive: a read-only capability method; existing methods unchanged |
| `cmd/main.go` | ~838 | composition root; constructs `themory.NewClient` at `:200` when `THEMORY_BASE_URL` set; `/health` (DB-only) at `:299`; fatal pattern = `logger.Error(...)` + `os.Exit(1)` | additive: a boot-time assertion right after client construction; existing wiring unchanged |
| `internal/config/config.go` | ~? | config struct; `ThemoryBaseURL`/`ThemoryAPIKey` (`:96-102`) | additive: optional `ThemorySkipCapabilityCheck bool` (env escape hatch) |
| `internal/themory/contract_test.go` OR `tests/unit/themory_client_test.go` | — | client tests against httptest stubs | additive: capability-check tests |

### Current callers / dependents
- `themory.NewClient` is constructed once in `cmd/main.go:200` (guarded by `THEMORY_BASE_URL` non-empty). The new assertion is called there, before `/v1/memory/*` routes are wired.
- No existing code fetches `/v1/openapi.json`; this is a new, read-only provider call.

## ADRs

- **D1 — match by `operationId: scopedForget`, not by path string.** The provider's generated path key is `/v1/scopes/{type}/{id}/memories/{memId}`; matching the operationId on any `delete` operation is resilient to `{memId}` vs `:memId` / future path tweaks. Rejected: exact path-string match (brittle to formatting).
- **D2 — fail boot ONLY on reachable-but-missing; WARN on unreachable.** A reachable provider advertising an openapi WITHOUT the route is an unambiguous deploy-ordering bug → `os.Exit(1)`. A transport error (provider down/unreachable at boot) is transient and must NOT permanently block the gateway from starting — log WARN and proceed (the per-request `do()` error path already handles a down provider). Rejected: fail boot on ANY error (a provider blip would prevent gateway startup — cascading outage). Per owner: the "fail boot" choice is scoped to the reachable-but-missing case.
- **D3 — env escape hatch `THEMORY_SKIP_CAPABILITY_CHECK=true`.** Because "fail boot" is aggressive, an operator needs a documented override (e.g. provider openapi shape changes unexpectedly, emergency rollback). Default false. Rejected: no override — too risky for a hard boot-fail gate.

## Phase 1 — boot capability guard

### T1.1 — `themory.Client` capability assertion

#### Files to edit
```
internal/themory/contract_test.go (or tests/unit/themory_client_test.go) — RED: AssertScopedForgetSupported nil / ErrProviderCapabilityMissing / transport-error cases (httptest stub serving /v1/openapi.json)
internal/themory/client.go — AssertScopedForgetSupported(ctx) error: GET /v1/openapi.json, parse paths, nil if a `delete` op has operationId "scopedForget"; ErrProviderCapabilityMissing if reachable+absent; wrapped transport error otherwise. Export ErrProviderCapabilityMissing + IsProviderCapabilityMissing.
```

#### TDD
```
RED: AssertScopedForgetSupported_nil_when_route_advertised — stub /v1/openapi.json with paths.{...}.delete.operationId=scopedForget → nil.
RED: AssertScopedForgetSupported_missing_when_absent — stub openapi WITHOUT the delete op → ErrProviderCapabilityMissing (IsProviderCapabilityMissing true).
RED: AssertScopedForgetSupported_transport_error_when_unreachable — closed server / 503 → non-nil, NOT ErrProviderCapabilityMissing.
GREEN: implement.
VERIFY: go test ./internal/themory/... -race
```

#### Concurrency tests
```
(none — single boot-time HTTP GET; no shared mutable state).
```

#### Acceptance Criteria
- [ ] nil when the provider advertises `delete` op `operationId: scopedForget`.
- [ ] `ErrProviderCapabilityMissing` (distinguishable via `IsProviderCapabilityMissing`) when reachable + route absent.
- [ ] transport/unreachable → a different (non-capability) error.

#### DoD
- [ ] `go test ./internal/themory/... -race` green; `go vet` clean.

### T1.2 — wire the boot guard into `cmd/main.go`

#### Files to edit
```
internal/config/config.go — add ThemorySkipCapabilityCheck (env THEMORY_SKIP_CAPABILITY_CHECK, default false).
cmd/main.go — after themory.NewClient (:200), unless skip: call AssertScopedForgetSupported(ctx with timeout); on ErrProviderCapabilityMissing → logger.Error + os.Exit(1); on transport error → logger.Warn + proceed; nil → logger.Info + proceed.
tests/unit/... — boot-decision unit test: a small testable helper `decideBootOnCapability(err) (fatal bool)` so the exit policy is unit-tested without spawning main.
```

#### Why this step
The assertion only protects if it actually gates boot. Extracting `decideBootOnCapability(err) bool` keeps the os.Exit policy unit-testable (fatal ONLY on ErrProviderCapabilityMissing) without running `main`.

#### TDD
```
RED: decideBootOnCapability(ErrProviderCapabilityMissing) == true (fatal); (transport error) == false; (nil) == false.
GREEN: implement helper + wire in main; add config field.
VERIFY: go test ./... -race
```

#### Acceptance Criteria
- [ ] `decideBootOnCapability` fatal ONLY on `ErrProviderCapabilityMissing`.
- [ ] Guard runs only when `THEMORY_BASE_URL` set AND `THEMORY_SKIP_CAPABILITY_CHECK` != true.
- [ ] A bounded context timeout on the boot GET (no indefinite hang at startup).

#### DoD
- [ ] `go test ./... -race` green; `go vet`/`gofmt` clean; CHANGELOG updated.

## Coverage Matrix

| Goal element | Task |
|---|---|
| nil when route advertised | T1.1 |
| ErrProviderCapabilityMissing when absent | T1.1 |
| transport error non-fatal | T1.1 + T1.2 |
| main exits non-zero ONLY on capability-missing | T1.2 |
| escape hatch + base-url gating + timeout | T1.2 |

## Failure scenarios (external theo-data I/O)

- **Provider reachable, openapi 200 lacks route:** `ErrProviderCapabilityMissing` → boot fatal (the protected case).
- **Provider reachable, openapi probe 404 (predates the contract doc):** `ErrProviderCapabilityMissing` → boot fatal. A 404 is reachable-but-provably-no-contract, NOT a transient blip (F-1 from `/review`).
- **Provider unreachable / 5xx at boot:** transport error → WARN + proceed (transient; not fatal — a 5xx is a server-side blip, retried on next boot).
- **Boot GET hangs:** bounded `context.WithTimeout` → transport error → WARN + proceed.
- **Malformed openapi JSON:** parse error → treat as transport-class (WARN + proceed), NOT capability-missing (we cannot prove absence from unparseable doc — fail-open here is safer than blocking boot on a parser quirk; logged loudly).

## Drawbacks & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| "Fail boot" is aggressive — a false-negative capability detection would block a legitimate deploy | MEDIUM | Match by `operationId` (robust); `THEMORY_SKIP_CAPABILITY_CHECK` escape hatch; malformed-openapi fails OPEN (WARN, not fatal). |
| Adds a boot-time dependency on the provider being parseable | LOW | Only fatal on reachable-AND-parseable-AND-route-absent; every other path proceeds. |

## Unresolved Questions

- **(none — every decision resolved at plan time via the 2026-06-21 owner AskUserQuestion: boot-time assertion + fail-boot-on-reachable-missing.)**

## Prior Art & Related Work

- Parent: `themory-gateway-forget-cutover` plan + review (the F1 source).
- Provider contract: theo-memory `openapi-registration.ts:199` (`operationId: scopedForget`), served at `/v1/openapi.json` (`app.ts:181`).
- In-repo: `do()` is the existing GET helper; `service_signer.go:51` shows the readiness-probe fatal pattern precedent.

## Global Definition of Done

- [ ] `go test ./... -race` green; `go vet`/`gofmt` clean.
- [ ] Boot fails (exit non-zero) ONLY when provider reachable + route absent; WARN+proceed otherwise; escape hatch honored.
- [ ] CHANGELOG updated; deploy-gate followup F1 marked closed in the cutover plan/memory.
- [ ] Plan archived after `/review` READY_TO_MERGE + merge.
