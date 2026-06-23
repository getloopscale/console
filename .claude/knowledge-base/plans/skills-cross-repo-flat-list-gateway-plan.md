---
slug: skills-cross-repo-flat-list-gateway
milestone_id: SkillsCrossRepoFlatListGateway
created_at: 2026-06-23
goal: Surface the themory v0.21.0 cross-repo skills listing through the theo-cloud gateway (themory client + BFF route GET /v1/dashboard/memory/skills/all) and the dashboard Skills tab (flat list by default + repo column + search + offset pagination), so the Skills tab lists ALL of a subject's skills across every repo without requiring a typed repoId, measured by a Go contract test (subject-scoped flat list, repo column, pagination passthrough) + a dashboard test (default flat render + repo column + delete uses per-row repoId) both GREEN.
---

# Plan: skills-cross-repo-flat-list-gateway

> theo-cloud follow-up to the shipped themory `skills-cross-repo-flat-list` (v0.21.0). It surfaces the new provider endpoint `GET /v1/scopes/skill/:subject/all` through the gateway + dashboard so the Skills tab finally lists-always (the UX gap surfaced in the 2026-06-23 live-test). **Deploy-gated on themory v0.21.0** (the provider endpoint must be deployed before the gateway calls it — mirrors the gateway-forget cutover deploy-gate precedent).

## Goal

> "Surface the themory v0.21.0 cross-repo skills listing through the gateway (`themory.Client.ListSkillsAll` + BFF `GET /v1/dashboard/memory/skills/all`) and the dashboard Skills tab (flat list by default, repo column, `q` search, offset pagination), measured by a Go test (`memory_test.go`: subject-scoped flat list returns rows with `repoId` + `total`/`truncated`; namespacing passes the bare subject, NOT `{subject}:{repoId}`) + a dashboard test (`skills.test.tsx`: default render lists across repos with a Repo column; delete uses the row's `repoId`) both GREEN."

## Context

themory v0.21.0 shipped `GET /v1/scopes/skill/:subject/all` (tenant-safe `agent_id` prefix scan; each row carries `repoId`; offset pagination + `q`). The dashboard Skills tab still shows an empty state requiring a typed repoId — the only data tab that lists nothing by default. This plan consumes the new provider endpoint end-to-end. The gateway already namespaces per-repo skills as `{subject}:{repoId}` and calls themory with a MASTER key; for the flat list it passes the **bare authenticated subject** as the `:subject` path segment (themory prefix-scans `{subject}:%`), so isolation is preserved by the same subject boundary the per-repo path uses. Honors Princípio 3 (auditable; the BFF mints a short-lived key per request, same as the per-repo path).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | Why it exists today | Invariants to preserve |
|---|---|---|
| `internal/themory/client.go` | themory HTTP client; `ListSkills(repoID)` (`:559`) → `GET /v1/scopes/skill/{repoID}/skills`; `Skill`/`SkillsResult` structs (`:262`/`:277`); transport-only (caller namespaces, SRP) | `ListSkills`/`AddSkill`/`ForgetSkill` UNCHANGED; new `ListSkillsAll` is a sibling; reuse the `do()` transport + url.PathEscape (EC-2) |
| `internal/routes/memory.go` | `MemoryHandler.ListSkills` (`:402`) namespaces `{subject}:{repoId}` (D3) then calls the client; `namespaceRepo` (`:125`) | `ListSkills` UNCHANGED; new `ListSkillsAll` passes the BARE subject (no repoId namespacing — the provider prefix-scans); reuse `auth.GetUser` + `writeJSON`/`writeError` |
| `internal/routes/dashboard_memory.go` | `DashboardMemoryHandler.ListSkills` (`:149`) mints a key then delegates | new `ListSkillsAll` mirrors it (mint → delegate); existing handlers UNCHANGED |
| `cmd/main.go` | dashboard memory route block (`:497-516`); `r.Get("/skills", ...)` (`:507`) | register `r.Get("/skills/all", dashboardMemoryHandler.ListSkillsAll)` (literal `all` — distinct from `/skills` and `/skills/{skillID}`); existing routes UNCHANGED |
| `dashboard/src/pages/memory/skills.tsx` | Skills tab: repoId-gated fetch + empty state + DataTable + delete | rewrite to default flat list (no repoId gate) + Repo column + `q` search + offset pagination; delete uses `row.repoId`; KEEP the D2 guardrail (delete-only curation, no editor) |
| `internal/routes/memory_test.go` (existing) | Go handler tests | add `ListSkillsAll` test |
| `internal/themory/contract_test.go` (existing) | themory client contract tests | add `ListSkillsAll` transport test |
| `dashboard/src/pages/memory/skills.test.tsx` (existing) | dashboard Skills tests | rewrite for the flat list |

### Current callers / dependents

- `themory.Client.ListSkills` (`client.go:559`) — called by `MemoryHandler.ListSkills`; UNCHANGED. New `ListSkillsAll` is a sibling.
- `DashboardMemoryHandler.ListSkills` (`dashboard_memory.go:149`) — mounted at `GET /v1/dashboard/memory/skills` (`main.go:507`). New `ListSkillsAll` mounted at `/skills/all`.
- Dashboard `SkillsPage` (`skills.tsx`) — the ONLY consumer of the BFF skills routes. Rewritten.
- **Cross-repo dependency:** themory must expose `GET /v1/scopes/skill/:subject/all` (shipped v0.21.0). The dev stack themory image MUST be rebuilt to v0.21.0 before the live re-verify.

### Domain glossary

- **subject** — `auth.GetUser(r.Context()).Subject`; the authenticated customer. For the flat list it is passed verbatim as the provider `:subject`.
- **flat list** — all of a subject's skills across every repo, each with a `repoId` (provider strips the `{subject}:` prefix).
- **mint** — the BFF vault issues a short-lived themory key per request (`mintOrFail`), then the key is discarded (security invariant).

## Prior Art & Related Work

- **Internal:** `dashboard-phase2b-skills-browse` (the per-repo skills browse this extends), `themory-graph-gateway-dashboard` + `episodes-gateway-dashboard` (the BFF proxy + dashboard tab pattern this mirrors), `dashboard memories.tsx` (offset-pagination + URL-state pattern reused). themory `skills-cross-repo-flat-list` (v0.21.0) is the provider contract.
- **Deploy-gate precedent:** `themory-gateway-forget-cutover-plan.md` (ship provider first, gate the gateway consumer on the provider version).

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | The gateway calls `/skills/all` before themory v0.21.0 is deployed → 404 from the provider. | High | Deploy-gate: this gateway change ships ONLY after themory v0.21.0 is deployed. The dev live re-verify rebuilds the themory image to v0.21.0 first. Provider 404 surfaces as a 502 `MEMORY_UPSTREAM_UNAVAILABLE` (existing handler error path), never a crash. | impl |
| 2 | Dashboard delete must still work in the flat list (no single repoId in scope). | Medium | Each row carries `repoId`; the delete mutation uses `row.repoId` for the `?repoId=` param (the per-repo forget BFF route is unchanged). Covered by the dashboard test. | impl |
| 3 | Deep `offset` paging on a large subject is an O(N) provider scan (themory SEC-1 follow-up). | Low | Out of scope here (provider-side perf follow-up). The gateway caps `limit` and forwards `offset` unchanged. | follow-up |

## Unresolved Questions

(none — the provider contract is fixed by themory v0.21.0; the BFF mirrors the per-repo skills proxy; the dashboard mirrors the memories offset-pagination pattern.)

## Failure scenarios

External I/O: the themory HTTP client.

- **Provider 404/5xx on `/skills/all`** (e.g. themory < v0.21.0 OR transient) — reproduced in the Go test with a stub provider returning 404/500. Expected: `MemoryHandler.ListSkillsAll` maps the upstream error to a 502 `MEMORY_UPSTREAM_UNAVAILABLE` (existing pattern), never a partial/empty 200 masking the failure.

## ADRs

### D1 — Pass the BARE subject to the provider (no repoId namespacing)

`ListSkillsAll` passes `user.Subject` as the provider `:subject` path segment, NOT `{subject}:{repoId}`.

- **Why:** the provider's `/all` endpoint prefix-scans `agent_id LIKE '{subject}:%'`. The per-repo path namespaces `{subject}:{repoId}` for an EXACT match; the flat path needs only the subject (the provider derives each `repoId`). Cites themory `skills-cross-repo-flat-list` ADR D1/D2.
- **Rejected alternative:** namespace `{subject}:` client-side and hit the per-repo route per repo. Rejected: requires knowing the repo list upfront (the exact gap this closes) + N round-trips.

### D2 — New BFF route `GET /v1/dashboard/memory/skills/all` (literal `all`)

- **Why:** mirrors the provider's route shape + the existing `/skills` proxy; the literal `all` segment avoids collision with `/skills` (GET) and `/skills/{skillID}` (DELETE). Per-request mint (`mintOrFail`) identical to the per-repo path.
- **Rejected alternative:** overload `GET /skills` with an optional `repoId` (flat when absent). Rejected: muddies the existing contract + its tests; a distinct route is clearer + additive.

### D3 — Dashboard: flat list by default, delete uses per-row repoId

- **Why:** the Skills tab defaults to the flat cross-repo list (no repoId gate); a Repo column + `q` search + offset pagination mirror the memories tab. The per-row `repoId` drives the delete mutation, so curation still works without a single in-scope repo. Keeps the D2 guardrail (delete-only; no code editor).
- **Rejected alternative:** keep the repoId input as the primary control + add a "list all" button. Rejected: contradicts the "list-always" goal; the flat list IS the default.

## Dependency Graph

```
Phase 1 (gateway Go): T1.1 client.ListSkillsAll ─→ T1.2 handler.ListSkillsAll + BFF route + main.go mount
Phase 2 (dashboard):  T2.1 Skills tab flat list (depends on the BFF route shape from Phase 1)
Phase 3 (integration validation): T3.1 go test ./... -race + dashboard vitest + lint + live re-verify (themory v0.21.0 image)
```

## Phases

### Phase 1 — Gateway (Go): client + handler + BFF route

#### T1.1 — `themory.Client.ListSkillsAll` + `SkillWithRepo`/`SkillsAllResult`

##### Why this step
Add the transport method hitting `GET /v1/scopes/skill/{subject}/all` with `limit`/`offset`/`q`/`includeSuperseded` query params, decoding `{skills:[{...,repoId}], total, truncated}`.

Reasoning chain: per ADR D1 the subject is passed bare (url.PathEscaped, EC-2); the method is transport-only (SRP, mirrors `ListSkills`). New structs `SkillWithRepo` (Skill + `RepoID`) + `SkillsAllResult`.

##### Files to edit
- `internal/themory/client.go` — `ListSkillsAll(ctx, subject, opts)` + `SkillWithRepo` + `SkillsAllResult` + `SkillsAllOptions`.
- `internal/themory/contract_test.go` — transport test.

##### Deep file dependency analysis
Reuses `c.do()` (same transport as `ListSkills`). `Skill` struct reused as the embedded base of `SkillWithRepo`. No change to existing methods.

##### TDD
- RED `TestListSkillsAll_buildsSubjectAllPathWithQueryParams` — stub server asserts path `/v1/scopes/skill/{subject}/all` + query `limit/offset/q`; returns a flat payload; assert decoded `RepoID`/`Total`/`Truncated`.
- RED `TestListSkillsAll_upstream404_returnsError` — stub 404 → method returns error (handler maps to 502).
- GREEN: implement.

##### Concurrency tests
(none — single-threaded HTTP call.)

##### Acceptance criteria
- `go test ./internal/themory/... -race` GREEN; path + query asserted; nil-skills coalesced to `[]`.

##### Definition of done
- `go test ./internal/themory/... -race` GREEN; `go vet ./internal/themory/...` clean.

#### T1.2 — `MemoryHandler.ListSkillsAll` + `DashboardMemoryHandler.ListSkillsAll` + route mount

##### Why this step
Expose the flat list over the BFF: resolve the authenticated subject, parse `limit`/`offset`/`q`/`includeSuperseded`, call the client with the BARE subject, return the result. Mint a key in the BFF wrapper.

Reasoning chain: per ADR D1 the subject is `user.Subject` verbatim (no namespacing); per ADR D2 the route is `/skills/all`. Mirrors the per-repo `ListSkills` mint→delegate exactly.

##### Files to edit
- `internal/routes/memory.go` — `MemoryHandler.ListSkillsAll` (auth guard, query parse, client call, upstream-error → 502).
- `internal/routes/dashboard_memory.go` — `DashboardMemoryHandler.ListSkillsAll` (mint → delegate).
- `cmd/main.go` — `r.Get("/skills/all", dashboardMemoryHandler.ListSkillsAll)` in the dashboard memory route block.
- `internal/routes/memory_test.go` — handler test.

##### Deep file dependency analysis
`auth.GetUser` + `writeJSON`/`writeError` reused. Route mount: `/skills/all` GET is unambiguous vs `/skills` GET (literal) and `/skills/{skillID}` DELETE (different method).

##### TDD
- RED `TestListSkillsAll_passesBareSubjectNotNamespaced` — fake client records the subject arg; assert it equals `user.Subject` (NOT `{subject}:...`).
- RED `TestListSkillsAll_upstreamError_maps502` — fake client errors → 502 `MEMORY_UPSTREAM_UNAVAILABLE`.
- RED `TestListSkillsAll_unauthenticated_401`.
- GREEN: implement + mount.

##### Concurrency tests
(none — single-threaded request handler.)

##### Acceptance criteria
- `go test ./internal/routes/... -race` GREEN; subject passed bare; 502 on upstream error; 401 unauth; route reaches the handler.

##### Definition of done
- `go test ./... -race` GREEN; `go build ./...` clean; `go vet ./...` clean.

### Phase 2 — Dashboard: Skills tab flat list

#### T2.1 — Skills tab: flat list default + Repo column + search + pagination

##### Why this step
Rewrite `SkillsPage` to fetch `GET /v1/dashboard/memory/skills/all?limit=&offset=&q=` by default (no repoId gate), render a DataTable with a Repo column + the existing columns, a search box (`q`), offset pagination (mirror memories), and a delete that uses `row.repoId`.

Reasoning chain: per ADR D3 the flat list is the default; the URL-state + offset pagination mirrors `memories.tsx`. Keeps the D2 curation guardrail.

##### Files to edit
- `dashboard/src/pages/memory/skills.tsx` — rewrite.
- `dashboard/src/pages/memory/skills.test.tsx` — rewrite tests.

##### Deep file dependency analysis
Reuses `DataTable`, `Input`, `ConfirmDialog`, `useSearchParams`, `cloudFetch` (same imports). The BFF response shape `{skills:[{...,repoId}], total, truncated}` from Phase 1.

##### TDD
- RED `lists skills across repos by default with a Repo column` — mock `cloudFetch` returns 2 skills with distinct `repoId`; assert both render + the repoId values appear.
- RED `delete uses the row's repoId` — assert the DELETE call URL carries `repoId=<row.repoId>`.
- RED `search updates the q query param` + `pagination advances offset`.
- GREEN: implement.

##### Concurrency tests
(none — UI.)

##### Acceptance criteria
- `vitest run skills.test.tsx` GREEN; default render lists across repos; Repo column present; delete uses per-row repoId; search/pagination wired. `eslint .` clean for the file.

##### Definition of done
- `npm run test` (dashboard) GREEN; `npm run lint` (dashboard) clean.

### Phase 3 — Integration Validation

#### T3.1 — Full suites + live re-verify against themory v0.21.0

##### Why this step
Prove the whole chain: Go tests + dashboard tests + lint + a live re-verify where the dev stack themory image is rebuilt to v0.21.0 and the dashboard Skills tab lists across repos in the browser.

##### Files to edit
- (none — validation only.)

##### TDD
- `go test ./... -race` GREEN; `dashboard: npm run test` GREEN.

##### Failure-scenario validation
- Provider-404 path covered at the Go unit layer (stub 404 → 502).

##### Acceptance criteria
- `go test ./... -race` + `go build ./...` + `go vet ./...` GREEN; dashboard `npm run test` + `npm run lint` GREEN. Live re-verify: rebuild `themory-e2e:latest` to v0.21.0, recreate themory containers, dashboard Skills tab (logged in as dev) lists skills across repos with a Repo column (browser-confirmed). CHANGELOG updated.

##### Definition of done
- All commands GREEN; live browser re-verify PASS; CHANGELOG entry; no change to per-repo skills routes/handlers.

## Coverage Matrix

| # | Requirement / decision | Detail | Task |
|---|---|---|---|
| 1 | themory client cross-repo method | `ListSkillsAll(subject, opts)` → `/v1/scopes/skill/{subject}/all` | T1.1 |
| 2 | per-row repoId + total/truncated decoded | `SkillWithRepo` + `SkillsAllResult` | T1.1 |
| 3 | BFF route + mint | `GET /v1/dashboard/memory/skills/all` → mint → delegate | T1.2 |
| 4 | bare-subject passthrough (ADR D1, isolation) | handler passes `user.Subject`, NOT `{subject}:{repoId}` | T1.2 |
| 5 | upstream error → 502 (Failure scenarios) | 404/5xx maps to `MEMORY_UPSTREAM_UNAVAILABLE` | T1.2 |
| 6 | route no-collision (ADR D2) | literal `all` vs `/skills` + `/skills/{skillID}` | T1.2 |
| 7 | dashboard flat list default + Repo column (ADR D3) | no repoId gate; Repo column rendered | T2.1 |
| 8 | search (`q`) + offset pagination | mirror memories tab | T2.1 |
| 9 | delete uses per-row repoId (Drawback #2) | DELETE carries `repoId=row.repoId` | T2.1 |
| 10 | D2 curation guardrail kept | delete-only; no code editor | T2.1 |
| 11 | deploy-gate on themory v0.21.0 (Drawback #1) | live re-verify rebuilds the v0.21.0 image first | T3.1 |
| 12 | additivity | per-repo routes/handlers/client methods unchanged | T1.1, T1.2, T2.1 |

## Global Definition of Done

- [ ] All tasks' DoD satisfied.
- [ ] `go test ./... -race` + `go build ./...` + `go vet ./...` GREEN.
- [ ] Dashboard `npm run test` + `npm run lint` GREEN.
- [ ] No change to the per-repo skills routes/handlers/client methods.
- [ ] Live re-verify: themory dev image rebuilt to v0.21.0; dashboard Skills tab lists across repos in the browser.
- [ ] `CHANGELOG.md [Unreleased]` updated (Added: cross-repo skills listing in the dashboard).
- [ ] `/review`-equivalent: 0 BLOCKER / 0 HIGH before merge.
- [ ] Deploy-gated on themory v0.21.0 (disclosed in the release notes).
- [ ] Plan archived after PR merge.
