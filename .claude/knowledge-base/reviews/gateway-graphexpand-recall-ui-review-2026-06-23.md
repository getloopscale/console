# Review: gateway-graphexpand-recall-ui (EG-1)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring+cross-validation, domain(api-design/gateway-proxy/security)
**Findings:** 0 BLOCKER, 0 HIGH, 2 MEDIUM, 3 LOW (+INFO) — all closed inline
**Verdict:** READY_TO_MERGE

## Summary

EG-1 forwards theo-memory v0.20.0's `graphExpand` recall option through the gateway (client + boundary-validated handler) + a dashboard Playground toggle. All 4 agents converged READY: architecture (thin-proxy preserved, additive, type in the right layer, one handler covers SDK+BFF), tests (non-vacuous; EC-1 empty-`{}` tested at both client + handler layers), wiring+cross-validation (full chain traced dashboard→BFF→handler→client→/v1/recall with zero drop; all zero-change + disclosure claims git-verified), domain (boundary 400 correct, DoS-bounded, no scope leak, response schema unchanged). 2 MEDIUM + 3 LOW closed inline.

## Findings closed inline (`79b83e2`)

### F-test-1 / F-xval-1 (MEDIUM, convergent): OpenAPI spec didn't document graphExpand
- The contract test's `validateRequest` step was a no-op for `graphExpand` because `openapi/themory.yaml` `/v1/recall` omitted it (the `strings.Contains` body assertions were still load-bearing, so the GOAL was not vacuous — but the spec drifted vs the `asOf` precedent which IS documented).
- **Fix:** added `graphExpand` (`hops` enum [1,2], `limit` 1..100) to the `/v1/recall` request schema. The spec now documents the field the client sends; validateRequest is meaningful.

### F-dom-1 (MEDIUM): `limit:0` accepted by the gateway but TheMemory's zod is `limit.min(1)`
- Safe TODAY only because `GraphExpand.Limit int` + `omitempty` drops a 0 from the wire. A future refactor to `*int` (as `Threshold *float64` does in the same struct) WITHOUT preserving the 0=omit semantics would forward `limit:0` → provider 422 → laundered 502, defeating ADR D2.
- **Fix:** added a load-bearing comment on `GraphExpand` documenting the omitempty invariant + a contract test (`Recall drops limit:0`) that fails RED if a refactor ever forwards `limit:0`.

### F-arch-6 / F-dom-2 (LOW, convergent): error message vs accepted range
- The 400 messages said "must be 1 or 2" / "between 1 and 100" while `0` (omitted/enable-default) is accepted.
- **Fix:** reworded to "(omit for the provider default)".

### F-test-2 (LOW): negative-hops branch untested
- The `Hops < 0` guard was only reachable via an explicit negative literal; no test exercised it.
- **Fix:** added `TestRecall_GraphExpandNegativeHops_400` (`hops:-1` → 400).

## Findings accepted (no change)

- **F-dom-6 (INFO):** the gateway is more lenient than TheMemory's `.strict()` on unknown inner keys (plain `json.Decode` drops them) — but it forwards a sanitized subset, so NO 422-laundering. Handler-wide `DisallowUnknownFields` is out of scope. Accepted.
- **F-dom-3/4/5/7, F-arch-1..5/7, F-wire-1/2, F-xval-2..4 (INFO):** thin-proxy, DoS-bounded, no scope leak, response schema unchanged, default-OFF, all zero-change claims verified. No action.

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 client forwards graphExpand | fully |
| T1.2 handler parse + boundary-validate | fully |
| T2.1 dashboard toggle | fully |
| T3.1 GOAL contract capture | fully |

ADRs D1 (passthrough), D2 (boundary 400), D3 (default-OFF) all conform. ZERO new dependency, no new route, one new exported symbol (`GraphExpand`) — git-verified. Full chain (dashboard → BFF → shared handler → client → /v1/recall) traced with zero drop.

## Quality gates (post-fix)

- `go build ./...` clean; `go vet ./internal/{routes,themory}` clean; `go test ./...` ALL PASS.
- Gateway tests: contract (forward/omit/empty{}/GOAL/limit:0-invariant) + handler (bad hops 3 / negative hops -1 / bad limit / passthrough / empty-enable / nil-unchanged) all green.
- Dashboard: `playground.test.tsx` 9/9; `playground.tsx` tsc + lint clean on changed files.
- `/code-quality`: FAIL_SOFT (`auditor_unavailable_deadcode` ONLY — go1.26-vs-deadcode toolchain env mismatch; 0 HARD findings). Substantive dead-code/symbol-fab coverage via go build+vet+full test (see audit md).

## Pre-existing / env (NOT introduced; disclosed per Inquebrável Rule 3)

1. `/code-quality` deadcode auditor env-unavailable (go1.26 toolchain) — tooling gap, not a defect; compensated by go build/vet/test.
2. Dashboard `tsc -b` whole-project red on pre-existing `overview.tsx` #119/#123 `'idle'` status — NOT in this diff (git-verified); my playground files typecheck clean.

## Spawned agents (audit trail)

architecture (a7ded247), tests (af6cfc3f), wiring+cross-validation (af53b738), domain (ae1b23de).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER/HIGH; 2 MEDIUM + 3 LOW closed inline at `79b83e2`; remaining INFO accepted. The two env/pre-existing reds (deadcode auditor, overview.tsx tsc) are disclosed and are NOT EG-1 defects. Proceed to `/release` (minor bump → the dashboard graphExpand toggle is a new user-facing capability + a new gateway field).
