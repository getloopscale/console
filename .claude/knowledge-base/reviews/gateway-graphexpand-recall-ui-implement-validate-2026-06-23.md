# Implement Validation — gateway-graphexpand-recall-ui (EG-1)

**Date:** 2026-06-23
**Plan:** `.claude/knowledge-base/plans/gateway-graphexpand-recall-ui-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 89.2)
**Verdict:** PASS (with disclosed env caveats — see below)

## Gates

| Gate | Result |
|---|---|
| `go build ./...` | PASS — clean |
| `go vet ./internal/routes/... ./internal/themory/...` | PASS — clean |
| `go test ./...` (full suite) | PASS — ALL packages ok |
| T1.1 contract tests (`internal/themory/contract_test.go`) | PASS — graphExpand forwarded + omitted + empty{} + GOAL(hops,limit) |
| T1.2 handler tests (`internal/routes/memory_test.go`, NEW) | PASS — bad hops/limit → 400; passthrough; empty enables-default; nil unchanged |
| T2.1 dashboard tests (`dashboard/.../playground.test.tsx`) | PASS — 9/9 (toggle on sends graphExpand; default off omits) |
| Dashboard `playground.tsx` typecheck | PASS (my files clean) — see caveat |
| Dashboard `npm run lint` (changed files) | PASS — 0 warnings |
| `/code-quality` | FAIL_SOFT (auditor_unavailable_deadcode ONLY — env, 0 HARD) — see caveat |

## Tasks (TDD per task)

- **T1.1** `client.go`: `GraphExpand` type + `RecallOptions.GraphExpand` + `recallRequest.GraphExpand` (omitempty) + `Recall` forwards it. Contract tests assert the captured outbound `/v1/recall` body. GREEN.
- **T1.2** `memory.go`: inbound `recallRequest.GraphExpand` + boundary validation (hops 0..2, limit 0..100 — 0 = omitted/provider-default, EC-1) + passthrough. Handler tests (httptest + stub client via interface-embedding + `auth.WithUser`). GREEN.
- **T2.1** `playground.tsx`: "Graph expand" toggle + hops select; conditional `graphExpand` body field. Tests assert on/off body. GREEN.
- **T3.1** GOAL: contract capture proves `graphExpand:{hops:2,limit:10}` reaches the provider `/v1/recall` body. GREEN.

## Wiring triad

- **Caller:** dashboard `/v1/dashboard/memory/recall` (BFF, delegates to the SDK handler) → `MemoryHandler.Recall` → `themory.Client.Recall` → `POST /v1/recall` with `graphExpand`. The BFF + SDK share ONE handler (EC-3).
- **Integration test:** the contract capture GOAL (outbound body carries graphExpand). The TRUE end-to-end (a connected memory surfaces) is already proven by theo-memory v0.20.0's `rest-graph-aware-recall` GOAL vs real pgvector.
- **Runtime observability:** the recall result IS the observable (dashboard renders it); no new failure path beyond the boundary 400 (validated) + the existing 502 upstream path.

## Edge cases (from edge-case-plan, all absorbed)

- EC-1 (MUST FIX): hops/limit OPTIONAL — `graphExpand:{}` enables with provider defaults (NOT a 400). Implemented + tested.
- EC-2: empty `graphExpand{}` forwards as `{}` — contract + handler tests.
- EC-3: BFF shares the SDK handler — covered by the handler test (it IS the delegated function).
- EC-4 (DOCUMENT): gateway bounds mirror TheMemory's zod — accepted.

## Honest disclosure (Inquebrável Rule 3) — two NON-defect reds

1. **`/code-quality` FAIL_SOFT — `auditor_unavailable_deadcode` ONLY (0 HARD).** The Go `deadcode` CLI cannot run in this env (go1.26 project vs deadcode built with go1.25). NOT a code defect. Substantive dead-code/symbol-fab coverage via `go build` + `go vet` + full `go test` (all green) + every new symbol has a caller+test. See the audit md. (theo-cloud's prior themory plans had ZERO code-quality audits — config was bare/unwired.)
2. **Dashboard `tsc -b` whole-project red — pre-existing `overview.tsx` #119/#123 `'idle'` DeploymentStatus error.** NOT in this diff (git status confirms my 6-file changeset excludes overview.tsx); my `playground.tsx` + test typecheck clean.

Neither is an EG-1 defect. My code (Go + TS) passes build/vet/test/lint/my-file-tsc and all new tests.

## Notes

- ZERO new dependency; no new route; mirrors the `asOf` passthrough. Default OFF → recall byte-unchanged.
- Composes with theo-memory v0.20.0 (`graphExpand` REST) + EG-2/EG-3/EG-4 (the now-clean entity graph this recall expands over).
