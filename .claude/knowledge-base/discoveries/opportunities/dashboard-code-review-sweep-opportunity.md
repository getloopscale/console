# Opportunity — dashboard code-review sweep (B-131..B-236)

- **Date measured:** 2026-08-11
- **Domain:** `frontend-dashboard`
- **Repo:** `theo-cloud/dashboard`
- **Mode:** `review` (re-measurement of an existing sweep's findings against current code)
- **Baseline on the day of measurement:** `npm test` 353 files / 2927 tests green; `npm run typecheck` clean; `npm run lint` clean (knip ratchet at 85/85 types).

## Why this re-measurement ran

The 2026-08-11 five-phase review registered 97 items (B-130..B-226) in one pass. Between
registration and today, four of them (B-130, B-138, B-160, B-161) were found to be **already
fixed in code while the registry still said `raw`** — the registry was behind the code. That
is a measured reason to distrust the remaining 93 blocks rather than plan against them
directly, so every one was re-opened against the current tree before any of it becomes work.

A second defect was found and fixed before measurement began: the sweep had registered seven
items under ids **B-162..B-168, which were already held by live items**. Duplicate ids make
the maintenance loop's SELECT phase ambiguous. The colliding blocks — never referenced by any
commit — were renumbered to **B-230..B-236** (commit `d32962f1`).

## Corner 1 — Evidence

Per-item verdicts. `STILL_TRUE` means the defect was re-opened at the pointer below and the
cited code was read today; `ALREADY_FIXED` means the current code disproves it.

### Batch: B-230..B-236, B-169..B-172

| Item | Verdict | Current pointer | Note |
|---|---|---|---|
| B-230 | STILL_TRUE | `src/pages/workspace/overview.tsx:198` | 3 blob-download sites confirmed by grep; copy-3 still drops both safety steps and `if (!res.ok) return;` at :196 swallows the failure |
| B-231 | STILL_TRUE | `src/lib/http/api.ts:380` | No token-generation counter exists; `refreshPromise` dedups the exchange but not the eager `accessToken = null` that precedes it |
| B-232 | STILL_TRUE | `src/pages/auth/kratos.ts:67-75` | `resp.status`/`resp.ok` never read; a 5xx body is returned as a `Flow` |
| B-233 | STILL_TRUE (2 handlers, not 3) | `src/pages/auth/recovery.tsx:240-244`, `:372-376` | Third site (`:329-335`) genuinely differs — the title overstates it |
| B-234 | STILL_TRUE | `src/lib/http/api.ts:93-95` | `AuthMessage` is compile-time only; a malformed inbound post throws, and any `{type:'logged-out'}` forces a token wipe |
| B-235 | STILL_TRUE | `src/lib/http/api.ts:292-311` | `null` means 5 distinct outcomes incl. a legitimate 204 |
| B-236 | STILL_TRUE | `src/components/dialogs/plan-limit-upgrade-modal.tsx:54` | Unvalidated 402 body reaches `.replace`; emitter at `api.ts:448-451` is unvalidated too |
| B-169 | PARTIAL — open-redirect FIXED, dead branch STILL_TRUE | `src/pages/auth/kratos.ts:42,46-53` | `safeNavigator.goTo` (B-138) closed the redirect half; the 3xx branch is still dead under `redirect: 'manual'` |
| B-170 | STILL_TRUE | `src/lib/auth/logout-cache-purge.ts:76-81` | Empty catch + discarded `Promise.all` result: zero signal when tenant cache survives logout |
| B-171 | STILL_TRUE | `src/hooks/use-api.ts:48` (and `:61`) | A successful 204 mapped to `null` is reported `error: true` |
| B-172 | STILL_TRUE (evidence quote stale) | `src/hooks/deploy/use-sse-stream.ts:242-247`, emitter `fetch-event-source.ts:151-152` | B-160 replaced readyState-inference with `StreamEndReason`, but that union carries no status, so every non-2xx still wipes the app-wide JWT |

### Batch: B-131..B-145

| Item | Verdict | Current pointer | Note |
|---|---|---|---|
| B-131 | STILL_TRUE | `nginx-security-headers.conf:34` | Header policy strictly narrower than `index.html:52` meta; `src/build/csp.test.ts` never reads the nginx file |
| B-132 | STILL_TRUE | `src/routes/settings-routes.tsx:51,89,106` | Verified against theo-cli: `billing status`, `notify`, `team delete` do not exist |
| B-133 | STILL_TRUE | `src/routes/profile-routes.tsx:32,49,66` | `login --rotate-credentials`, `session`, `account` do not exist in theo-cli |
| B-134 | STILL_TRUE | `src/pages/overview/overview.tsx:154` | `branch: 'main'` still passed verbatim into `<ProjectCard>` at :139 |
| B-135 | STILL_TRUE | `src/components/layout/team-switcher.tsx:127-139` | Sole caller `app-sidebar.tsx:142` passes no `onCreateTeam`, so the docs branch is always taken |
| B-136 | STILL_TRUE | `src/pages/settings/billing.tsx:368-377,388-394` | `formatPlanPrice` exists at `overview-kpi-strip.tsx:15` and is not reused here |
| B-137 | STILL_TRUE (partially remediated) | `src/pages/settings/webhooks.tsx:345-350` | `estadoDaLista` used by only 4 pages; webhooks, trust/violations, trust/overview, workspace/overview still have no error leg |
| B-139 | STILL_TRUE | `src/lib/auth/session.ts:165-168` | Failed Kratos logout falls through to `/login` indistinguishably from success |
| B-140 | STILL_TRUE | `src/hooks/use-auth.ts:16-20` | `sessionDefinitivelyExpired` is imported but never consulted before the `!s` redirect |
| B-141 | STILL_TRUE | `src/pages/auth/login.tsx:131-138` | `setNetworkError` exists but is never reached from the hydration path |
| B-142 | STILL_TRUE | `src/lib/http/api.ts:304` (and `:388`) | `lastExchangeStatus` exists at `:116` but is only read by `sessionDefinitivelyExpired()`; `retryGuard` refuses to retry any 4xx |
| B-143 | **ALREADY_FIXED** | `src/hooks/deploy/use-sse-stream.ts:187-197,201` | Closed by B-160 with a different remedy than the DoD proposed (reset on first message) |
| B-144 | **ALREADY_FIXED** | `src/hooks/deploy/use-sse-stream.ts:242-247` | Typed `reason` + clean `server-closed` exclusion; `clearToken()` no longer called on every error |
| B-145 | STILL_TRUE | `src/hooks/mutations/use-cancel-build.ts:9-12` | Same defect as B-168 — no `use-cancel-build.test.ts` exists |

### Batch: B-213..B-226

| Item | Verdict | Current pointer | Note |
|---|---|---|---|
| B-213 | STILL_TRUE | `src/pages/auth/kratos.ts:59` | Five unencoded call sites, not one: also `verification.tsx:67,101`, `register.tsx:105`, `login.tsx:108` |
| B-214 | STILL_TRUE | `src/lib/navigation/safe-redirect.ts:114` | File moved; shape grew — `typeof window !== 'undefined'` repeated 3x un-hoisted |
| B-215 | STILL_TRUE | `src/lib/telemetry/error-reporter.ts:21` | Three nested swallow layers; no failure counter, so a broken transport is invisible |
| B-216 | STILL_TRUE — **policy, not bug** | `src/pages/auth/error-mapper.ts:136` | The ungated log is mandated by ADR D2 and pinned by `error-mapper.test.ts:50`; closing it supersedes that ADR |
| B-217 | STILL_TRUE | `src/lib/telemetry/rum.ts:26` | `reportEvent` in the same file already has the sendBeacon/fetch fallback to reuse |
| B-218 | STILL_TRUE | `src/lib/http/api.ts:254,257` | DOM toast + bare `2000`; the event precedent is `api.ts:449` |
| B-219 | STILL_TRUE | `src/hooks/deploy/use-sse-stream.ts:25` | Contradicted by `fetch-event-source.ts:130` which sends `Authorization: Bearer` |
| B-220 | STILL_TRUE | `src/hooks/deploy/shared-event-source.ts:113` | Second subscriber's `opcoes` constructed then never read on the hit path |
| B-221 | STILL_TRUE | `src/hooks/deploy/use-sse-stream.ts:275` | Zero `useMemo`/`useCallback` in the file; `use-log-stream.ts:103` has the same shape |
| B-222 | STILL_TRUE | `src/hooks/deploy/use-deployment-stream.ts:178` | Elapsed time only advances when an SSE event re-triggers the memo |
| B-223 | STILL_TRUE | `src/lib/mocks/sse.ts:163`, called at `src/lib/mocks/index.ts:51` | Premise re-verified: no production path uses `new EventSource` since B-088 |
| B-224 | STILL_TRUE | `src/hooks/deploy/use-log-stream.ts:95` | Fallback branch never exercised — tests always supply `ts` |
| B-225 | STILL_TRUE | `src/hooks/projects/use-readiness-signals.ts:130` (memo spans 62-161) | 12 ternaries across 6 `buildSignal` calls; `signals.ts:61` has no `evaluate`/`thresholds` field |
| B-226 | STILL_TRUE | `promote-to-production-dialog.tsx:215`, `rollback-dialog.tsx:196` | Duplication wider than quoted; `formatRollbackError` is not even exported and has zero tests |

### Batch: B-146..B-159

| Item | Verdict | Current pointer | Note |
|---|---|---|---|
| B-146 | STILL_TRUE | `src/pages/promptly/components/projections.ts:77` | Two different predicates share the label; `catalogo.tsx:51-54` already names the no-label slice `No environment` |
| B-147 | STILL_TRUE | `src/pages/promptly/components/projections.ts:113` | **Reproduced by execution** — replaying the body in node threw `TypeError: ... reading 'localeCompare'` |
| B-148 | STILL_TRUE | `src/components/charts/category-bars.tsx:100` | Number cell prints raw `bar.value`; the bar uses the sanitising `barWidths` |
| B-149 | **ALREADY_FIXED** (1st bullet) | `src/pages/skills/overview.tsx:263` | Fixed by `6a358f31` (B-161). **2nd DoD bullet NOT done** — `porCategoria` at `:117` still reads `paginas`, not the `acervo` fallback the table uses at `:132` |
| B-150 | **ALREADY_FIXED** | `src/pages/trust/overview.tsx:97,217` | `coverageSettled` replaced the `!failed && !isLoading` shape |
| B-151 | **ALREADY_FIXED** | `src/pages/trust/overview.tsx:217` | Closed under B-227 with a regression test at `trust/overview.test.tsx:185-193` |
| B-152 | STILL_TRUE | `src/pages/skills/overview.test.tsx:193` | Ratchet (B-162) stops the shape spreading but the cited test still cannot fail; 11 call sites across 7 test files |
| B-153 | STILL_TRUE | `src/lib/http/config.ts:9,23` | Zero non-test readers; `api.ts:316` hardcodes `/engine`; `docker-entrypoint.sh:31,38` still validates it |
| B-154 | **ALREADY_FIXED** | `TESTING.md:172-182` | Rewritten to the sentinel-marker gate; the tautological grep survives only in the prose forbidding it |
| B-155 | **ALREADY_FIXED** | `DESIGN.md:313-322` | Blanket ban replaced by the enforceable `escapeXML: true` rule, matching `ansi.tsx:34` |
| B-156 | **ALREADY_FIXED** | `DESIGN.md:307-310` | Doc now records the `content-visibility` choice and the rejection of `@tanstack/react-virtual` |
| B-157 | **ALREADY_FIXED** | `DOGFOOD.md:17-20` | Both commands commented out and labelled as gaps |
| B-158 | STILL_TRUE (half fixed) | `DOGFOOD.md:176` | Quick-reference line updated; the acceptance-criteria line still asserts the stale 180 KB cap against the enforced 320 kB |
| B-159 | STILL_TRUE (1 of 4 claims) | `docs/architecture.md:53` | Two numbers refreshed; the "28 subfolders" claim is present-tense and wrong — measured today: **9** |

### Batch: B-167, B-168 (the pre-existing ids, not the renumbered ones)

**B-167 — PARTIAL CONFIRMED.** Real arithmetic: 8 `empty=` call sites + 1 non-`empty=` site; **5 correct, 4 remaining**. The `shipped_note` is stale in both directions (says "three remain", names four, one of which is already migrated).

Remaining, all with the error flag already available on the hook — no hook signature changes needed:

- `src/pages/projects/projects.tsx:364` — **two** absence assertions: the `empty=` search-no-match descriptor and `<EmptyProjectsHero />` at `:379` gated only on `!loading && projects.length === 0`, so a failed read renders the onboarding hero. `useProjects` returns `error` (`use-projects.ts:68,85`); `projects.tsx:276` does not destructure it.
- `src/pages/infra/environments.tsx:192` — `useEngineApi` returns `error` (`use-api.ts:73`); `:104` destructures only `{ data, loading }`.
- `src/pages/deploy/deployments.tsx:271` — `useDeploymentsListStream` returns `error` (`use-deployments-list-stream.ts:188`); `:160` drops it.
- `src/pages/settings/webhooks.tsx:347` — **not an `empty=` prop**, so invisible to an `empty=`-shaped sweep. Inline ternary in `DeliveriesSheet`; `query.isError` never read. Absent from the `shipped_note`'s list.

`guard_exists: no` — swept `scripts/`, the `lint` script and `eslint.config.js`; nothing references the helper.

> **The item's stated premise is false and the plan must not inherit it.** `list-state.ts:31-34` justifies a pure function by "`PageShell` has no `error`". The installed `@usetheo/ui@0.35.1` **does** declare `error?: { message; onRetry?; docsHref? }` with documented precedence `loading > error > empty`, the branch renders (`dist/index.js:5029`), and `lens/labeling-queue.tsx:183` already uses it. The helper stays defensible on its own merits (it substitutes the message in place and returns `undefined` when rows exist), but each remaining page should be decided `error=` vs `estadoDaLista` on its own, not by the false premise.

**B-168 — CONFIRMED, and the harness blocker is solved.** `use-cancel-build.ts:9-11` still omits the flag; all three siblings pass it.

The `attempt_log` blamed the test harness for three reverted attempts. The working precedent is **`src/hooks/projects/use-scale.test.tsx:89-108`** — same hook family, same assertion — **executed during this measurement: 1 file / 3 tests passed in 1.90s with zero unhandled-rejection noise.**

Both of the `attempt_log`'s guesses are unnecessary: no `mutations` block, no logger (TanStack v5 removed it), no `onError` binding. The actual fix is the **`act` boundary** — `await act(async () => { try { await result.current.mutateAsync(...) } catch (e) { caught = e } })`, then `await waitFor(() => expect(result.current.isError).toBe(true))` *after* the act block. A floating `.catch()` attaches a handler while React's flush happens outside the act scope, so the rejection escapes unhandled — which is exactly what was observed and misattributed.

Blast radius the plan must carry: `useCancelBuild` has no `onError`, so after the fix the rejection propagates to its callers. One grep for `useCancelBuild` in `src/`; the only known consumer is `src/pages/deploy/components/cancel-build-dialog.tsx:36`.

### Batch: B-185..B-198

| Item | Verdict | Current pointer | Note |
|---|---|---|---|
| B-185 | STILL_TRUE | `src/components/charts/category-bars.tsx:54` | No floor at all; `barWidths([3,9000]) -> [0.0333, 100]` |
| B-186 | STILL_TRUE | `src/components/charts/category-bars.tsx:82-84` | `grep thead\|columnheader src/components/charts/` returns nothing |
| B-187 | STILL_TRUE | `src/components/charts/category-bars.tsx:57-62` (consumed `:95`) | Zero `tone` hits in the test file; all four variants land inside the `aria-hidden` track |
| B-188 | STILL_TRUE (title overstates) | `src/pages/memory/overview.test.tsx:158-168` | The named test is floor-blind, but the primitive's own suite (`category-bars.test.tsx:49-53`) *would* fail on a restored floor — "no regression test" is too strong |
| B-189 | STILL_TRUE | `src/pages/skills/overview.test.tsx:188-193` | Mechanism verified: deleting the `isSuccess` guard leaves the assertion green. Same shape at `rag/overview.test.tsx:61-68`, `trust/overview.test.tsx:167-172` |
| B-190 | STILL_TRUE | `src/pages/trust/overview.test.tsx:53-58`, false comment `:123` | Fixture has no `policy`/`category`, so `enforcedPolicies` is empty; the comment claiming the policy IS enforced is measurably false |
| B-191 | STILL_TRUE | `src/lib/capability-overview.test.ts:76` | The exact hole the docblock narrates as closed is still open |
| B-192 | STILL_TRUE (user-visible half FIXED) | `src/pages/memory/overview.tsx:250-254`, `src/pages/rag/overview.tsx:193` | `window.location.href` is gone from all three — all now use `<Link>`. What remains is the triplicated component + two stale/false justifications (one cites a path that no longer exists) |
| B-193 | STILL_TRUE | `memory/webhooks.tsx:470,492` vs `settings/webhooks.tsx:436,458` | Byte-identical validation rule; signatures still diverge; no shared module created |
| B-194 | STILL_TRUE | `projects/components/kpi-strip-status.tsx:74-93`, `signal-grid.tsx:124-141` | Verbatim duplicate thresholds; `signal-grid.tsx:26` claims "canonical thresholds" while being the second implementation |
| B-195 | STILL_TRUE (**4** copies, not 6) | `infra/components/delete-secret-dialog.tsx:41,52` | Confirmed by grep: delete-secret, rotate-secret, bulk-delete-projects, delete-environment. UNKNOWN which two others the review counted. 29 files do import the canonical dialog |
| B-196 | STILL_TRUE (registration half FIXED) | `code-review-output/code-review.db` rows 828-835 | All 8 `src/build/*` paths ARE inventoried, but 7 are `inspection_status='pending'` and zero findings exist for the directory |
| B-197 | STILL_TRUE as precondition, NOT_A_DEFECT as stated | 43 of 353 test files | Re-scanned: **43** files (backlog said 37 of 376 — the ratio grew). Cited pointer `src/test/arvore-estavel.ts:1` does **not** resolve to the defect. Order-dependence stays UNKNOWN until a shuffled run — no `--sequence.shuffle` config exists |
| B-198 | UNKNOWN for the cited walker / STILL_TRUE for the class | `.claude/skills/code-quality/scripts/_shared.py:37` + `run_code_quality.py:138` | The blamed phase-1 walker is not locatable and appears to have been ad-hoc. The same any-path-segment `"build"` skip shape IS present in the in-repo tooling |

### Batch: B-199..B-212 (documentation drift — both sides re-measured)

| Item | Verdict | Pointer | Value measured **today** |
|---|---|---|---|
| B-199 | STILL_TRUE | `src/components/layout/app-sidebar.tsx:42-43` | The comment is the only `plan/tier/hobby` hit in the file; the real tier lookup is API-driven in `billing.tsx:98-101` |
| B-200 | STILL_TRUE (wrong in a *second* way now) | `docs/architecture.md:112` | Doc says 8 awaiting acceptance. Today: **6 proposed** (0002,0005-0009), **8 accepted** |
| B-201 | STILL_TRUE | `docs/architecture.md:16,123` | `system-design-output/` does not exist anywhere in the umbrella; only `code-review-output/final_report.md` (a different audit) |
| B-202 | **ALREADY_FIXED** (residue left) | `memory/exports.tsx:217`, `memory/playground.tsx:283` | All four duplicate exports gone. Both files now end with an **orphaned alias comment** describing an export that no longer exists |
| B-203 | STILL_TRUE (headline number wrong) | `src/lib/api/types.ts:172,457` | Re-counted per-name: **27 of 72** exported names in `types.ts` have zero importers — not 84. The "84" is repo-wide and UNKNOWN |
| B-204 | STILL_TRUE | `DESIGN.md:129-130,331-337` | `BuildStepList` **0 files**, `CanaryProgress` **0 files**, no onboarding route anywhere; `src/components/onboarding/` holds only `onboarding-panel.tsx` |
| B-205 | **ALREADY_FIXED** (2nd bullet open) | `DESIGN.md:699` | Path corrected and non-existence stated. §17.1-17.3 (`:701-728`) still has a "Captured via" column implying instrumentation that does not exist |
| B-206 | STILL_TRUE | `src/routes/settings-routes.tsx:26-38,43-55` | Both placeholders still shadow shipped screens (`app.tsx:167-168`). The `<Navigate>` fix the DoD proposes is **already applied to `/api-keys`** at `app.tsx:173` |
| B-207 | **ALREADY_FIXED** (DESIGN.md) / STILL_TRUE (DOGFOOD.md) | `DOGFOOD.md:151` | DESIGN.md removed the four dead links honestly; the same dead audit path survives one file over |
| B-208 | STILL_TRUE | `DESIGN.md:96-97` | `@usetheo/ui`: **198** real import statements (doc says 183). `@theokit/ui`: **7 files / 5 symbols** (doc says "3 files, 4 symbols") — understates reach by >2x |
| B-209 | STILL_TRUE | `DESIGN.md:142,482,508,679` | All four stale. `--motion-*` at `index.css:108-111` not 113-119; reduced-motion at `:181` not 122-136; `top-bar.tsx:64-67` is a `Select.Trigger` not a `<span>`; `src/pages/settings.tsx` **does not exist** and the "smoking gun" it cites was closed |
| B-210 | STILL_TRUE | `docs/adr/README.md:8,62` | Says `0001-…` to `0009-…`; disk has **0001..0014** and README's own table four lines later indexes all 14. The cited `docs/adr/adr-nomenclature.test.ts` has never existed (real path: `src/lib/adr-nomenclature.test.ts`) |
| B-211 | STILL_TRUE | `docs/padronizacao-ui-2026-08-09.md:10,54,217,230` | P2's done-criterion is already met (`ui/dialog.tsx` deleted). `app-modal.tsx` is **148** LOC (doc says 104); tree has **434** `.tsx` (doc says 423). No status header at all |
| B-212 | STILL_TRUE | `docs/adr/0002-...md:41-42`, `docs/architecture.md:67`, `eslint.config.js:222` | **Four** numbers for one allowlist: 32 / 18 / 18 / **15 actual entries**. The flagship example `src/app.tsx` is 226 LOC, not on the list, and no longer exceeds the budget |

### Batch: B-173..B-184

| Item | Verdict | Current pointer | Note |
|---|---|---|---|
| B-173 | STILL_TRUE (mechanism changed) | `src/hooks/deploy/use-sse-stream.ts:244` | `FetchEventSource` fires `onerror` at most **once per instance** (`fetch-event-source.ts:107-118`) and `:257` resets `failureCount` before each reopen, so the threshold of 3 is still unreachable. Worse: a lone `network-error` now returns at `:245` without reopening — **the stream dies permanently**. The comment at `:67-72` still describes the browser's native retry |
| B-174 | STILL_TRUE | `src/hooks/deploy/use-deploy-timeline.ts:176-180` | Byte-identical to the cited evidence — `foundActive` is written at `:187` and read only inside an empty-bodied `if` |
| B-175 | STILL_TRUE | `src/hooks/deploy/use-build-logs.ts:211-227` | The sibling initial-load effect at `:173-194` guards every write with `cancelled` + cleanup; the asymmetry is intact. No `AbortController` on either path |
| B-176 | STILL_TRUE (**backend half now measured**) | `src/hooks/projects/use-metrics-range.ts:70,72-74,77` | Resolved in the engine repo: `theo/api/internal/routes/metrics_proxy.go:114-120` reads only `signal`+`range`, and `buildPromQL:183` labels solely on `tenant_id`/`project` — **the endpoint has no env dimension at all**. The DoD's *delete-the-parameter* branch is the applicable one |
| B-177 | STILL_TRUE | `src/hooks/deploy/use-deployments-list-stream.ts:131` | Only call site `deployments.tsx:160-167` builds `filters` inline. Cost is re-run overhead, not a refetch storm — `refetchedFor` suppresses the invalidation |
| B-178 | STILL_TRUE (registrations) / NOT_A_DEFECT (mechanism) | `src/lib/mocks/handlers.ts:343,357,371,426` | The two unregistered paths are confirmed (`use-deployments-list-stream.ts:93`, `use-status-stream.ts:65`). But "reconnect forever" no longer holds — the stream **dies silently after one failure**, downstream of B-173. Same outcome, opposite mechanism |
| B-179 | STILL_TRUE | `src/hooks/deploy/use-sse-stream.ts:150-154` | The file has exactly one `useEffect`, keyed on `[path, eventTypesKey, maxEvents]`. Nothing is keyed on `paused`, so the buffer flushes only when the next event arrives. The existing test never unpauses |
| B-180 | STILL_TRUE | `src/hooks/deploy/use-build-logs.ts:203-206` | `historical` capped at 5000, `stream.lines` at `MAX_LOG_LINES` — the merged array can hold **10 000**. The cap is enforced on both inputs and on neither output |
| B-181 | STILL_TRUE | `src/hooks/deploy/use-deploy-timeline.ts:135,145` | Durable phase state re-derived every render from an evictable 60-event FIFO; an evicted `build.completed` silently reverts that phase to `pending`. The incremental `onEvent` pattern exists at `use-status-stream.ts` and is not used here |
| B-182 | STILL_TRUE (**tool-measured**) | `src/hooks/deploy/use-deploy-timeline.ts:138-217` | `lizard` → `CCN=31`, the only warning in the file. Ranked the whole `src` tree: 31 is still the maximum; next is 30 at `use-readiness-signals.ts`. "Highest in the codebase" holds |
| B-183 | STILL_TRUE | `memory/webhooks.tsx:46-55` vs `settings/webhooks.tsx:289-298` | Byte-identical `Delivery` interface; `memory/webhooks.tsx` still 555 lines; `WEBHOOK_CONTEXTS` still holds exactly two entries |
| B-184 | STILL_TRUE | `lens/sessions.tsx:58-60`, `usage-by-user.tsx:164-166`, `labeling-queue.tsx:88-90`, `traces.tsx:226-227`, `settings/audit.tsx:117` | **5 sites** for the arithmetic, **4** for the full Prev/Next block. `grep useOffsetPagination|OffsetPager|PagerControls` returns nothing |

## Corner 2 — Constraint relation

`unknown` — `rules/current-constraint.md` is `status = undeclared`, and this ecosystem does not
instrument flow. Per that file, `unknown` is the honest and complete answer; it is not debt.

## Corner 3 — Blast radius

Entirely within `theo-cloud/dashboard`. No item requires a change in `theo-contracts`, the Go
control plane, or any sibling repo, so no cross-repo ADR is owed.

Two items reach *outward for evidence* without changing anything outside the dashboard:

- **B-132 / B-133** were verified against `theo-cli`'s registered commands. The fix is in the
  dashboard (stop advertising commands that do not exist); `theo-cli` is untouched.
- **B-176** was resolved against `theo/api/internal/routes/metrics_proxy.go`. The measurement
  says the engine has no env dimension, so the dashboard deletes a parameter rather than the
  engine growing one.

Inside the dashboard the concentration is high and matters for ordering: `src/lib/http/api.ts`
carries 7 items and has 151 importers; `src/hooks/deploy/use-sse-stream.ts` carries 6;
`src/components/charts/category-bars.tsx` carries 5. Those three files are the natural slice
boundaries, and the http one must move first because `use-api.ts` (B-171) cannot be honestly
closed before the `T | null` contract (B-235) is discriminated.

## Corner 4 — Verification

Each item's own `dod` bullet stands. Beyond them, three cycle-level checks:

1. `npm test` stays green at ≥ 2927 tests, and every fix arrives with a test that **fails first**.
2. `npm run lint` and `npm run typecheck` stay clean; the knip type ratchet only descends.
3. Items whose current tests **pin the defective behaviour** must have those tests amended, and
   the amendment is visible in the diff: **B-170, B-172, B-173, B-176, B-216, B-233**. A fix that
   leaves them green is a fix that did not land.

## Verdict

`SHIPPABLE_WITH_CAVEATS`.

**Caveats carried into the plan, each an honest limit of this measurement:**

- **B-197** — order-dependence remains **UNKNOWN**. The precondition (43 of 353 files with
  module-level mutable state) was re-measured, but the shuffled run its own DoD prescribes was
  not executed. The item may not be a defect at all.
- **B-198** — the phase-1 walker it blames is **not locatable**; it appears to have been ad-hoc.
  The defect *class* is present in the in-repo tooling, which is a different (smaller) item.
- **B-203** — the headline "84" could not be reproduced. The reproducible number is **27 of 72**
  unimported names in `types.ts`.
- **B-195** — the review counted 6 re-implementations; **4** were found. Which two others it
  counted is UNKNOWN.
- **B-216** — not a bug. The ungated `console.error` is mandated by ADR D2 and pinned by a
  passing test, so closing it means superseding that ADR.
- **B-167** — the item's stated premise (`PageShell` has no `error` prop) is **false** for the
  installed `@usetheo/ui@0.35.1`. The plan must decide per page rather than inherit it.
