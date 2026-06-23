# Review: skills-cross-repo-flat-list-gateway

**Date:** 2026-06-23
**Reviewers (spawned agents):** 3 (architecture+wiring, tests+cross-validation, security+tenancy)
**Findings:** BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 3, INFO: 4
**Verdict:** READY_TO_MERGE

## Scope reviewed

HEAD on `develop`: `feat(dashboard): Skills tab lists all skills across repos (cross-repo flat list)`. theo-cloud follow-up consuming themory v0.21.0 `GET /v1/scopes/skill/:subject/all`.

## BLOCKER / HIGH

_None._

## Security verdict (tenancy agent)

Tenant-isolation boundary SOUND on all 5 critical checks:
1. Subject comes ONLY from `auth.GetUser(r.Context()).Subject` — no `subject`/`tenant` query/header/body read. A request cannot redirect to another tenant's skills.
2. Route `GET /skills/all` is inside the `requireJWT` group (cmd/main.go) + handler defense-in-depth `user==nil → 401`.
3. Minted BFF key discarded immediately (`_, err := MintOrFetch`); upstream uses master key; no secret in logs/response.
4. Bare-subject + provider `{subject}:%` prefix-scan correctly isolates; strict-prefix/wildcard concerns are handled provider-side (themory v0.21.0, already reviewed); the gateway introduces no new collision surface.
5. Delete (curation) namespaces a forged `repoId` under the caller's OWN subject (`namespaceRepo(user.Subject, repoId)`) → no cross-tenant delete.

## LOW findings

### F-1 — bare-subject test didn't pin "query ?subject ignored" — FIXED inline
- Found by: security. The test asserted bare-subject passthrough but (unlike sibling List/Entities tests) didn't inject a competing `?subject=attacker`. Handler was correct; the test now injects `?subject=attacker-supplied` and asserts the authed subject wins. Re-run GREEN.

### F7 / F-2 — SDK-surface asymmetry (flat list only on BFF, not the programmatic `/v1/memory` surface)
- Found by: architecture + security. Per-repo `ListSkills` is on both surfaces; the flat list is BFF-only. This is **in-scope-by-plan** (the plan scopes the BFF + dashboard consumer only; "Dashboard SkillsPage — the ONLY consumer"). Tracking-only follow-up if a programmatic cross-repo list is later wanted.

## INFO findings

- Test file placement diverged from the plan's named files (client tests in new `skills_all_test.go` reusing `captureServer`; handler/BFF tests in `tests/unit/`). Co-located + conventional; cosmetic.
- Route collision: none (literal `all` GET vs `/skills` GET vs `/skills/{skillID}` DELETE — verified, including the theoretical DELETE-`all` case which is unreachable from the dashboard).

## Cross-validation summary

- Coverage Matrix 12/12 delivered.
- Additivity VERIFIED against `git diff`: per-repo `ListSkills`/`AddSkill`/`ForgetSkill` (client + handlers + routes) byte-unchanged; interface widened additively; only `/skills/all` added under the same `requireJWT` group.
- ADRs D1 (bare subject), D2 (literal `all` route, no collision), D3 (flat default + per-row-repoId delete) all match code.

## Quality gates summary

- `go build ./...` + `go vet ./...` clean; `go test ./... -race` GREEN (client 4 + handler 4 + BFF 1 SkillsAll tests).
- Dashboard `skills.test.tsx` 7/7 GREEN; `eslint skills.tsx` clean.
- **Live re-verify (T3.1) PASS:** themory dev image rebuilt to v0.21.0; gateway recompiled with the new route; dashboard Skills tab (logged in as dev@theo.local) lists 3 skills across repo-alpha/repo-beta with a Repo column, search, pagination — browser-confirmed (screenshot `/tmp/skills-flat-list-live.png`). themory v0.21.0 `/all` endpoint returned `total 3` with correct repoIds.

## Honest disclosure (Rule 3)

The full dashboard `npm run test` is NOT globally green: **16 pre-existing failures across 6 UNRELATED files** (logs / SSE / time-range-picker / runtime-logs / mocks / smoke). Confirmed by the test agent: (a) none import skills, (b) none were touched by this feature commit, (c) they fail at the parent commit (pre-existing). They are a standing red-suite debt in the logs/SSE area, OUT OF SCOPE for this feature and NOT a blocker for it; the skills feature itself is fully green. Recommend filing a separate issue for the logs/SSE suite.

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. F-1 fixed inline; F7/F-2 (SDK asymmetry) in-scope-by-plan tracking-only; pre-existing unrelated dashboard failures disclosed + out of scope. Deploy-gated on themory v0.21.0 (deployed).
