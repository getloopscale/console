# Review: rag-scope-graduation (theo-cloud #168)

**Date:** 2026-07-05
**Reviewers:** 2 parallel agents — security/anti-escalation, cross-validation+test-quality
**Findings:** 11 total (BLOCKER: 0, HIGH: 0, LOW: 5, INFO: 6)
**Verdict:** READY_TO_MERGE

Both agents returned READY. The genuine LOW items were remediated in commit `test(#168): review remediation`.

## Consolidated matrix (post-remediation)

| Sev | Finding | Source | Disposition |
|---|---|---|---|
| LOW | SEC-168-05 / F3 — rag:admin non-issuability proven only at map level, not through the handler gate (the crux of #168) | both | **FIXED** — added handler-level negative case `rag:admin → 400 UNKNOWN_SCOPE` |
| LOW | F5 — unauth case asserted only 401, not the AUTH_REQUIRED body | cross-val | **FIXED** — added `AUTH_REQUIRED` body assertion |
| LOW | F1 — plan prose said 201; CreateKey returns 200 (pre-existing handler behavior) | cross-val | **FIXED** — plan corrected 201→200 (doc-only) |
| LOW | F2 — RED-first not git-evidenced (test+code bundled in one commit) | cross-val | **ACCEPTED** — RED was demonstrably run (failing output captured before each GREEN); not retro-fixable without history rewrite (forbidden). Noted for future slices. |
| INFO | SEC-168-06 / F4 — deliberate rag:admin-vs-memory/observability:admin asymmetry | both | **DOCUMENTED** — code + dashboard comments explain why (broker-held vs customer-facing admin) |
| INFO | SEC-01..04 — anti-escalation correct, scope-set 1:1 with broker, least-privilege intersect untouched, D5 preserved | security | positive confirmations |

## Security posture (the crux)

**rag:admin escalation PREVENTED with defense-in-depth (both agents confirmed):**
1. **Gate:** rag:admin ∈ NEITHER `validScopes` NOR `reservedScopes` NOR the dashboard → `CreateKey` returns **400 UNKNOWN_SCOPE** (now asserted by the `rejected_rag_admin` handler test).
2. **Broker intersect:** the forward-auth-rag broker's supported set is exactly `[rag:read,rag:write,rag:delete]` (`cmd/main.go:66-67`); `intersectScopes` strips anything outside it, so a minted per-tenant key can never carry rag:admin.

Activated set `{rag:read,rag:write,rag:delete}` is 1:1 with the broker mint set + theo-rag per-verb enforcement — no over/under-grant. D5 (subject/tenant from `auth.GetUser`, never body) preserved. No broker/edge/`cmd/main.go` change (parity-only).

## Quality gates (post-remediation)

- `go test ./internal/routes ./cmd ./internal/auth` — green (9+1 subtests in the new scope test, all pass incl. `rejected_rag_admin`, `unauthenticated`).
- `go vet ./internal/routes` — clean · `go build ./...` — clean.
- dashboard `vitest run api-keys.test.tsx` — 7/7 green; `api-keys.tsx` tsc-clean (unrelated pre-existing lens/trace-detail.tsx codemirror-dep errors, not touched by #168).
- `/code-quality` — PASS.

## Cross-validation

Plan tasks: 2 (T1.1 backend, T2.1 dashboard) · fully implemented: 2 · partial: 0 · missing: 0 · diverged: 0. Parity-only claim verified (git log shows no #168 commit touched the broker/edge/main.go). No new deps (reuses go-sqlmock v1.5.2).

## Handoff decision

**READY_TO_MERGE.** Zero BLOCKER/HIGH; the anti-escalation LOW + the AUTH_REQUIRED + the plan doc-drift are all remediated. rag:admin exclusion is now proven behaviorally at the gate.
