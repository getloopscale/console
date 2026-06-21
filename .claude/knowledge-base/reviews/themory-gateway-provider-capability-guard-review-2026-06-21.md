# Review: themory-gateway-provider-capability-guard (F1)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE (after fixes)
**Reviewers:** 2 focused agents (architecture+security · tests+cross-validation)
**Commits:** `56cee4b` (guard) + review fixes (this commit)

## Findings: 0 BLOCKER · 1 MAJOR (fixed) · MINOR (fixed)

- **F-1 (security, MAJOR — FIXED):** the guard fail-opened on a 404 from `/v1/openapi.json` (`do()` maps 404→ErrNotFound→BootWarn), so a provider so old it 404s the openapi doc would boot through. The realistic case (gateway v0.5.0 × provider v0.11.0 serving openapi-200 WITHOUT scopedForget) was already caught (→fatal). Fix: a 404 on the probe is reachable-but-provably-no-contract → now mapped to `ErrProviderCapabilityMissing` (fatal). 5xx/connection/parse stay transient (BootWarn). New test `404 on the openapi probe IS capability-missing`.
- **F-2 (error-handling, MAJOR — acknowledged, accepted):** `os.Exit(1)` skips deferred `db.Close()`. Accepted per repo precedent (other boot os.Exit calls do the same; listeners not started; OS reclaims the just-opened pool). Added a clarifying comment.
- **MINOR (tests — FIXED):** `THEMORY_SKIP_CAPABILITY_CHECK` config parse was untested → added `TestConfig_ParsesThemorySkipCapabilityCheck` (true + non-true default-false).
- INFO: `main` os.Exit switch glue is integration-untested by design (the testable policy is `ClassifyBootCapability`, fully unit-tested). Acceptable thin composition-root glue.

## Cross-validation
Plan ↔ impl faithful (T1.1 + T1.2, ADRs D1/D2/D3, Coverage Matrix complete). Helper shipped as a richer 3-state `ClassifyBootCapability` (improvement over the planned 2-bool `decideBootOnCapability`). Fixture `operationId:scopedForget` matches the runtime provider openapi (theo-memory `openapi-registration.ts:199`), the contract source-of-truth.

## Quality gates
`go build`/`go vet`/`gofmt` clean · `go test ./... -race` green.

## Handoff
READY_TO_MERGE. Closes followup F1 from `themory-gateway-forget-cutover`. Once merged + released, the deploy-ordering hazard is guarded at gateway boot.
