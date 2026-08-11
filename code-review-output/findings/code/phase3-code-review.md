# Phase 3 — Code review findings

Target: `dashboard/` · 72 phase-3 findings · 251/822 files inspected (30.5%)

## Severity summary

| Severity | Count |
|---|---|
| high | 15 |
| medium | 40 |
| low | 16 |
| info | 1 |

## By category

| Category | Count |
|---|---|
| code | 25 |
| contract | 16 |
| error_handling | 11 |
| naming | 8 |
| concurrency | 6 |
| complexity | 4 |
| security | 2 |

## Findings by file

| Severity | File:line | Finding |
|---|---|---|
| high | `src/pages/infra/domains.tsx:189` | The loading/error/empty/data ladder is a copy-pasted convention, not a primitive: 6 pages omit the error leg and render an empty state on failure (#274 class, alive; silent-null-guard cannot see it) |
| high | `src/pages/auth/login.tsx:230` | Credentials POSTed to an unvalidated server-supplied URL (flow.ui.action) |
| high | `src/lib/auth/session.ts:163` | Logout silently proceeds to /login when the Kratos logout call fails — server session survives |
| high | `src/hooks/use-auth.ts:17` | getSession() null collapses transient token-exchange failures into a forced /login redirect |
| high | `src/pages/auth/login.tsx:136` | Login page swallows both flow-hydration failures — Sign in button becomes a no-op with zero feedback |
| high | `src/lib/http/api.ts:303` | cloudFetch fabricates ApiError(429) for failures that were not rate limits — and retryGuard then refuses to retry |
| high | `src/hooks/deploy/use-sse-stream.ts:192` | Exponential backoff defeated by reopenAttempts reset on onopen — open/close cycle reconnects every ~750ms forever |
| high | `src/hooks/deploy/use-sse-stream.ts:234` | Every SSE error clears the application-wide access token, not just the SSE credential |
| high | `src/hooks/mutations/use-cancel-build.ts:9` | useCancelBuild reports success when the cancel request fails — engineFetch resolves null instead of throwing |
| high | `src/pages/promptly/components/projections.ts:77` | Chart bar and KPI card share the label 'not promoted' for two different quantities |
| high | `src/pages/promptly/components/projections.ts:113` | localeCompare on an unvalidated label entry unmounts the whole /promptly overview |
| high | `src/components/charts/category-bars.tsx:100` | barWidths sanitises the value but the number cell prints the raw one — a 0%-wide bar beside a cell reading NaN |
| high | `src/pages/skills/overview.tsx:263` | The chart gate !error && !loading is not settled-success, so the chart asserts 'Nothing recorded' beside a fully populated table |
| high | `src/pages/trust/overview.tsx:204` | Same paused/idle blind spot on the one screen where an empty distribution is a compliance claim |
| high | `src/pages/trust/overview.tsx:213` | When only the validators query fails, every bar is painted amber 'unblocked' — asserting nothing is stopped precisely when the code knows it cannot tell |
| medium | `src/pages/workspace/overview.tsx:193` | Blob+anchor download implemented 3 times; the canonical helper declares itself the ONE source and the third copy reproduces the exact bug it documents |
| medium | `src/lib/http/api.ts:379` | Concurrent 401s each null the access token, re-triggering the token exchange the #324 fix exists to prevent |
| medium | `src/pages/auth/kratos.ts:72` | submitFlow discards the HTTP status entirely — a 5xx is indistinguishable from a validation response |
| medium | `src/pages/auth/recovery.tsx:240` | Error classification computed then thrown away — identical if/else branches in three recovery handlers |
| medium | `src/lib/http/api.ts:93` | BroadcastChannel message consumed without validating its shape |
| medium | `src/lib/http/api.ts:305` | cloudFetch's `T | null` collapses at least four distinct outcomes into one value |
| medium | `src/components/dialogs/plan-limit-upgrade-modal.tsx:55` | Unvalidated 402 response body crosses a window event into a render path that calls String.replace |
| medium | `src/pages/auth/kratos.ts:48` | initFlow's 3xx branch is unreachable under `redirect: 'manual'`, and would be an unguarded open redirect if it were |
| medium | `src/lib/auth/logout-cache-purge.ts:79` | Tenant-cache purge on logout fails silently — no signal that stale tenant data survived |
| medium | `src/hooks/use-api.ts:48` | useCloudApi reports `error: true` for a successful empty response |
| medium | `src/hooks/deploy/use-sse-stream.ts:234` | A non-2xx on any SSE stream wipes the app-wide JWT via clearToken() |
| medium | `src/hooks/deploy/use-sse-stream.ts:229` | TOKEN_REFRESH_THRESHOLD branch is unreachable with the fetch transport; its guard test asserts a state production cannot produce |
| medium | `src/hooks/deploy/use-deploy-timeline.ts:176` | Deploy-timeline 'cascade' loop is a no-op — the documented out-of-order defence does not exist |
| medium | `src/hooks/deploy/use-build-logs.ts:211` | useBuildLogs.refresh() writes state after unmount and never aborts — the sibling load path in the same file guards both |
| medium | `src/hooks/projects/use-metrics-range.ts:72` | useMetrics-range keys the cache by env but never sends env — a non-production env silently returns production metrics |
| medium | `src/hooks/deploy/use-deployments-list-stream.ts:131` | Refetch effect re-runs on every render — `filters` is an inline object literal at the only call site |
| medium | `src/lib/mocks/handlers.ts:343` | Two SSE endpoints have no mock registration — in mock mode they reconnect forever against a route that will never exist |
| medium | `src/hooks/deploy/use-sse-stream.ts:150` | Unpausing an SSE stream does not flush the buffered events — the UI stays stale until the next event arrives |
| medium | `src/hooks/deploy/use-build-logs.ts:203` | useBuildLogs can hold 2x MAX_LOG_LINES — the cap guard test only covers the pure function, not the merged output |
| medium | `src/hooks/deploy/use-deploy-timeline.ts:136` | Deploy timeline replays a FIFO-capped buffer to derive state — evicted events silently revert phases to 'pending' |
| medium | `src/hooks/deploy/use-deploy-timeline.ts:138` | useDeployTimeline reducer memo has measured CCN=31 — the highest in the codebase, in the reconnect-sensitive path |
| medium | `src/pages/memory/webhooks.tsx:34` | The webhooks CRUD is parameterized-by-context for 2 of its 3 mount points; /memory/webhooks is a 555-line independent third copy of the same component the map was built to serve |
| medium | `src/pages/lens/sessions.tsx:58` | Server-side offset pager copy-pasted across 5 pages in 2 domains (identical arithmetic + identical Prev/Next predicates); the copies have already drifted, one into Portuguese |
| medium | `src/components/charts/category-bars.tsx:54` | Removing the Math.max(2,…) floor fixed zero-as-sliver and introduced the inverse: a real non-zero count renders invisible |
| medium | `src/components/charts/category-bars.tsx:82` | The hand-rolled table has no thead and no column headers, a weaker accessible reading than the composite its docblock argues against |
| medium | `src/components/charts/category-bars.tsx:95` | The 4-variant tone API is entirely unasserted and sits inside an aria-hidden element while carrying enforcement meaning |
| medium | `src/pages/memory/overview.test.tsx:158` | The zero-sliver defect the CHANGELOG headlines as fixed has no regression test |
| medium | `src/pages/skills/overview.test.tsx:184` | The four 'a failed read draws no chart' tests assert only absence of a table role — which a chart rendered over a failure also produces |
| medium | `src/pages/trust/overview.test.tsx:39` | The CATALOGO fixture enforces nothing, so the muted/Blocked path is never exercised and the comment claiming it is enforced is false |
| medium | `src/lib/capability-overview.test.ts:76` | The rendered() guard still matches a JSX tag inside a comment or string — the hole its own docblock claims it closed |
| medium | `src/pages/memory/overview.tsx:234` | An English docblock was replaced with a Portuguese one, against the project's explicit English-artifacts rule |
| medium | `src/main.tsx:34` | pt-BR/English identifier mixing is a dated convention SHIFT, not drift: 4.5% -> 71.1% of new files in 2026-08 |
| medium | `src/pages/promptly/detail.tsx:421` | src/pages: 402 Portuguese declarations in 96 files, 59 of them production (pt/en mixing inside single expressions) |
| medium | `src/routes/memory-routes.tsx:23` | src/routes: highest pt density in the codebase — 9 of 10 production files export Portuguese-named symbols consumed by src/app.tsx |
| medium | `src/lib/auth/logout-cache-purge.ts:72` | src/lib: 122 Portuguese declarations in 31 files — including exported infrastructure such as purgarCachesDeDados() |
| medium | `src/hooks/lens/use-traces.ts:51` | src/hooks: 75 Portuguese declarations in 29 files — exported React hooks and types mix languages (useCriarDatasetDeRegressao, ChaveDeAtributo) |
| medium | `src/pages/memory/overview.tsx:255` | ExploreCard copy-pasted into 3 domain overviews and already DIVERGED: lens navigates via SPA <Link>, memory/rag still force a full page reload |
| medium | `src/pages/memory/webhooks.tsx:470` | AddWebhookDialog duplicated between memory and settings, including the webhook-URL validation rule — and settings already holds the generalised version |
| medium | `src/pages/projects/components/kpi-strip-status.tsx:74` | SLO tone thresholds (uptime 99.9/99.0, p95 500/1000ms, error rate 1/5) duplicated between two components rendered on the SAME page |
| medium | `src/pages/infra/components/delete-secret-dialog.tsx:41` | ConfirmDialog owns type-to-confirm (confirmationPhrase) and is used by 32 files, but 6 destructive dialogs re-implement the gate locally — and 5 of the 6 dropped the deliberate focus-Cancel safety behaviour |
| low | `src/pages/auth/kratos.ts:57` | Flow id from the URL interpolated into a request URL without encodeURIComponent |
| low | `src/pages/auth/safe-redirect.ts:57` | isSafeRedirectUrl has measured CC 14 for a single-predicate security guard |
| low | `src/lib/telemetry/error-reporter.ts:21` | reportError has measured CC 16 from three nested swallow layers |
| low | `src/pages/auth/error-mapper.ts:135` | mapKratosError console.errors on every call, including from a render path |
| low | `src/lib/telemetry/rum.ts:30` | Web Vitals reporter logs to console in production instead of beaconing |
| low | `src/lib/http/api.ts:256` | HTTP client builds a DOM toast and hardcodes a 2000 ms redirect delay |
| low | `src/hooks/deploy/use-sse-stream.ts:25` | Stale docblock claims the JWT travels in `?token=` — contradicted 140 lines below in the same file |
| low | `src/hooks/deploy/shared-event-source.ts:113` | SharedEventSource keys the registry on URL alone — a second subscriber's token and resume cursor are silently discarded |
| low | `src/hooks/deploy/use-sse-stream.ts:262` | useSSEStream returns a fresh object and a fresh clear() on every render, propagating identity churn to consumers |
| low | `src/hooks/deploy/use-deployment-stream.ts:177` | Date.now() inside useMemo freezes the running-build elapsed time between events |
| low | `src/lib/mocks/sse.ts:163` | installSSEMocks swaps window.EventSource, which no production code path has used since B-088 |
| low | `src/hooks/deploy/use-log-stream.ts:95` | Log lines without a timestamp get a new Date() on every memo recomputation |
| low | `src/hooks/projects/use-readiness-signals.ts:62` | useReadinessSignals memo has measured CCN=30 from eight inlined nested ternaries |
| low | `src/test/arvore-estavel.ts:66` | src/test + src/build: Portuguese is the dominant language of the test harness and build config (51 declarations, incl. filename arvore-estavel.ts) |
| low | `src/components/ui/modal-primitive.test.ts:76` | src/components: pt-BR confined to test files — production component code is 100% English (0 of 25 files) |
| low | `src/pages/deploy/components/promote-to-production-dialog.tsx:216` | Deploy error-message mapper duplicated between promote-to-production-dialog and rollback-dialog |
| info | `src/hooks/use-onboarding-state.ts:76` | no_error_handling_issues: the swallowed-error class is measurably absent outside the auth/HTTP slice |

---

## Detail

### [39] HIGH · code — The loading/error/empty/data ladder is a copy-pasted convention, not a primitive: 6 pages omit the error leg and render an empty state on failure (#274 class, alive; silent-null-guard cannot see it)

**Location:** `src/pages/infra/domains.tsx:189`

The dashboard has a canonical 4-branch list ladder repeated verbatim across domains (lens/sessions.tsx:185-212, rag/collections.tsx:128-138, memory/memories.tsx:232-249, settings/webhooks.tsx:218-233): isLoading -> skeleton, isError -> Alert, length===0 -> EmptyState, else -> DataTable. Because the ladder is copied rather than extracted, the ERROR LEG IS OPTIONAL - and in 6 sites it was simply not written. There, the failure path falls through to the empty state and the screen asserts absence from an outage: the exact #250/#259/#261/#274 class the team has already fixed four times.

What makes this the codebase dominant shape rather than six unrelated slips: the query layer IS guarded (src/lib/silent-null-guard.test.ts quantifies over every useQuery/useInfiniteQuery/useSuspenseQuery over cloudFetch/engineFetch and demands throwOnError). All six sites PASS that guard - they all pass { throwOnError: true }. The guard proves the queryFn rejects; nothing proves anyone renders the rejection. The rule is correct, declared and mechanised at one layer, and silently violated at the next.

Two of the six carry the misconception in prose, copied word for word: settings/team.tsx:54 and infra/domains.tsx:188 both state "Com throwOnError a falha sobe para o RouteBoundary". That is false. `throwOnError` there is the THIRD ARGUMENT OF cloudFetch/engineFetch (src/lib/http/api.ts:47), not TanStack useQuery option. TanStack `throwOnError` defaults to false for queries and src/lib/http/query-client.ts sets no override - so a rejected queryFn becomes `query.isError` and never reaches src/components/error/route-boundary.tsx. Grep confirms zero query-level throwOnError options in src/**. The developer believed the boundary handled it; the boundary is never reached; the empty state renders.

Instances (all with throwOnError, all with the error state never read):
  1. src/pages/infra/domains.tsx:189 query / :252 empty -> "No custom domains yet" on a 5xx
  2. src/pages/settings/team.tsx:55 query / :120 empty -> "No team members" on a 5xx
  3. src/pages/settings/audit.tsx:100 query / :153 empty -> "No audit entries" on a 5xx
  4. src/pages/settings/webhooks.tsx:328 query / :349 -> "No deliveries yet." on a 5xx
  5. src/pages/rag/graphrag.tsx:137 query / :362 -> "No communities at this level." on a 5xx
  6. src/pages/rag/wiki.tsx:94 query / :216 -> loading, then the browser renders over an empty pages array

Severity is heuristic and the pattern judgement is subjective; the runtime consequence is not - it is read directly off the TanStack default plus the absent branch. No test covers any of the six failure paths (src/pages/infra/domains.test.tsx only seeds success).

**Evidence**

```
CANONICAL (the ladder, written out by hand in 4+ domains):
src/pages/lens/sessions.tsx:185-192
        {query.isLoading ? (
          <ListSkeleton label="sessions" />
        ) : query.isError ? (
          <Alert intent="warning" title="Could not load sessions">
        ) : sessions.length === 0 ? (
          <EmptyState
src/pages/rag/collections.tsx:128-135  same four branches
src/pages/memory/memories.tsx:232-239 same four branches (error first)

DIVERGENT — error leg absent:
src/pages/infra/domains.tsx:186-194
  // ... e "nao consegui perguntar" — exatamente a classe que silent-null-guard fecha
  // (#274). Com throwOnError a falha sobe para o RouteBoundary da rota.   <-- FALSE
  const domainsQuery = useQuery({
    queryKey: queryKeys.domains.list(),
    queryFn: () => engineFetch<DomainsResponse>(`/api/v1/domains?limit=${LIST_SAFETY_CEILING}`, {}, { throwOnError: true }),
  });
  const data = domainsQuery.data ?? null;
  const loading = domainsQuery.isLoading;      <-- isError never read
  const domains = data?.domains ?? [];
src/pages/infra/domains.tsx:252-256
      empty={ !loading && filtered.length === 0 ? { title: ... : "No custom domains yet" } : undefined }

src/pages/settings/team.tsx:51-60 — identical shape, identical false RouteBoundary comment, :120 empty -> "No team members"
src/pages/settings/webhooks.tsx:343-349
          {query.isLoading ? (
            <p ...>Loading deliveries…</p>
          ) : deliveries.length === 0 ? (
            <p ... data-testid="deliveries-empty">No deliveries yet.</p>

PROOF the boundary claim is false:
src/lib/http/query-client.ts:38-49 — defaultOptions.queries has staleTime/gcTime/refetch/retry/retryDelay and NO throwOnError.
grep -rn "^\s*throwOnError" src --include=*.ts --include=*.tsx  ->  only src/hooks/promptly/promptly-api.ts:72, and that one is inside a cloudFetch() config arg too.
```

**Remediation**

Extract the ladder into ONE primitive instead of continuing to copy it - the error leg then cannot be forgotten because it is a required prop. Two options already present in the codebase:
(a) Use the design-system DataTable props that 11 pages already use: `loading` + `emptyState` (node_modules/@usetheo/ui .../data-table.d.ts: DataTableBaseProps has loading?: boolean and emptyState?: ReactNode), with the failed/empty distinction inside the EmptyState as src/pages/trust/guardrails.tsx:180-190 and src/pages/skills/versions.tsx:194-205 already do (`title={failed ? "No data — the read failed" : ...}`).
(b) Add a shared `<QueryState query={...} empty={...} error={...}>` in src/components taking loading/error/empty as REQUIRED slots.
Then fix the 6 sites, delete the two false RouteBoundary comments, and add the guard that closes the class the way silent-null-guard closed the query layer: for every read query variable in src/pages/**, either `<var>.isError`/`.error` is referenced or the file carries an explicit `// render-error-ok: <why>` marker. Without that guard the seventh site lands exactly as these six did — the file-local comments show the rule was known and still not applied.

### [40] HIGH · security — Credentials POSTed to an unvalidated server-supplied URL (flow.ui.action)

**Location:** `src/pages/auth/login.tsx:230` · **NFR:** security

submitPassword builds a DOM form whose action is taken verbatim from the Kratos flow response (`flow.ui.action`) and POSTs the user's identifier, password and CSRF token to it. No allowlist check is applied. OWASP A01/A08 (unvalidated redirect/forward + deserialisation of untrusted data): the destination of the user's password is decided entirely by a network response. The repository already owns the guard for exactly this class — `isSafeRedirectUrl` in src/pages/auth/safe-redirect.ts — and applies it at src/pages/auth/device-verify.tsx:75, whose comment states the doctrine verbatim ('a URL vinha de uma resposta do servidor e ia direto para window.location.href, sem checagem'). The same unvalidated pattern repeats at src/pages/auth/oidc-form.ts:22 (form.action = action), src/pages/auth/register.tsx:127 (form.action = flow.ui.action), src/pages/auth/recovery.tsx:352 (submitFlow(f.ui.action, ...) carrying the NEW password) and src/pages/auth/verification.tsx:81/114 (fetch(flowData.ui.action) with credentials:'include' and the user's email). A compromised, mis-configured or MITM'd identity host silently exfiltrates plaintext credentials; nothing in the client would notice.

--- CHIEF-REVIEWER ADDENDUM (mitigation analysis the finding omitted) ---
The agent did not account for CSP `form-action`, which materially bounds this. Both shipped policies constrain form submission targets: index.html:52 allows 'self' https://auth.usetheo.dev https://auth-dev.usetheo.dev https://accounts.google.com https://github.com; nginx-security-headers.conf:31 allows 'self' https://auth.usetheo.dev https://accounts.google.com https://github.com. Browsers enforce the intersection, so the effective allowlist in the container is 'self' + auth.usetheo.dev + accounts.google.com + github.com. An attacker who controls the Kratos flow response therefore CANNOT point the password POST at an arbitrary host of their choosing. What remains reachable, and why this stays high rather than dropping to medium: (1) the effective allowlist still contains two third-party origins (accounts.google.com, github.com) that are present for the OIDC redirect chain, not to receive a password — a plaintext credential POSTed to either leaves the trust boundary over the wire regardless of how the recipient responds; (2) 'self' is allowed, so the POST can be redirected to any path on the dashboard origin; (3) the mitigation is a defence the code does not know about — nothing in login.tsx references it, no test asserts it, and it is exactly the kind of implicit coupling that the phase-2 CSP finding shows is already drifting between two hand-maintained copies. If the CSP divergence recorded in that finding is ever resolved by relaxing rather than tightening, this becomes unbounded credential exfiltration with no second line of defence. The fix (call the guard the repo already owns) costs one line and removes the dependency on CSP entirely.

**Evidence**

```
const form = document.createElement('form');
      form.method = 'POST';
      form.action = flow.ui.action;
      for (const [k, v] of [
        ['csrf_token', csrfNode?.attributes.value || ''],
        ['method', 'password'],
        ['identifier', email],
        ['password', password],
      ]) {
```

**Remediation**

Gate every credential/flow destination through an allowlist before use: `if (!isSafeRedirectUrl(flow.ui.action)) { setNetworkError(true); return; }` (fail-closed, same shape as device-verify.tsx:75). Apply identically in oidc-form.ts, register.tsx, recovery.tsx (submitFlow) and verification.tsx. Consider moving the check inside a single `postFlowForm(action, fields)` helper so no future call site can skip it.

### [41] HIGH · error_handling — Logout silently proceeds to /login when the Kratos logout call fails — server session survives

**Location:** `src/lib/auth/session.ts:163` · **NFR:** security

`logout()` clears the local JWT, purges caches and then calls Kratos `/self-service/logout/browser`. Both failure paths are silent: a rejected fetch is caught with an empty body, and an `!resp.ok` (or a 200 without `logout_url`) simply falls through. In every case the function ends at `window.location.href = '/login'`, so the user is shown the login screen and believes they signed out while the `ory_kratos_session` cookie is still valid on the server. Because the cookie survives, the next `exchangeSessionToken()` mints a fresh JWT — i.e. the next visitor on that browser can be silently re-authenticated as the previous user. Violates rules/error-handling.md § 2 ('NEVER swallow exceptions', 'return explicit errors, not magic values') and § 5 ('catch { } — swallowed; nobody learns what happened'). No telemetry is emitted, so the failure leaves no forensic trace at all.

**Evidence**

```
if (resp.ok) {
      const data = await resp.json();
      if (data.logout_url) {
        window.location.href = data.logout_url;
        return;
      }
    }
  } catch {
    // Fallback
  }
  window.location.href = '/login';
```

**Remediation**

Distinguish the outcomes: on a failed/incomplete Kratos logout, do not navigate to /login as if it succeeded. Report the error (reportEvent/reportError), and either retry once, or surface a blocking 'We could not fully sign you out — close this browser' state. At minimum log the status and body so the silent-session-survival case is diagnosable in production.

### [42] HIGH · error_handling — getSession() null collapses transient token-exchange failures into a forced /login redirect

**Location:** `src/hooks/use-auth.ts:17`

`useRequireAuth` treats a null `getSession()` as 'not authenticated' and navigates to /login. But `getSession()` (src/lib/auth/session.ts:91-101) returns null whenever `exchangeSessionToken()` returns false — which src/lib/http/api.ts:188 sets for 429, 500, 502 and network rejection just as much as for 401. The whole #324 defence built into api.ts (`sessionDefinitivelyExpired()`) exists precisely to stop a transient exchange failure from redirecting: the redirect reloads the page, resets the refresh dedup and re-fires the exchange, feeding the quota problem with a VALID Kratos session. That guard is applied 48 lines lower (use-auth.ts:65) — but it can never fire, because the branch it protects is only reached when `getSession()` already succeeded, which implies `hasValidToken()` is true. So the guarded path is effectively dead and the unguarded path at line 17 is the one that runs.

**Evidence**

```
const s = await getSession();
      if (!s) {
        navigate('/login', { replace: true });
        setChecked(true);
        return;
      }
```

**Remediation**

Have `getSession()` return a discriminated result (`{kind:'session'} | {kind:'expired'} | {kind:'unavailable', status}`) instead of `Session | null`, or make `useRequireAuth` consult `sessionDefinitivelyExpired()` before redirecting: `if (!s) { if (sessionDefinitivelyExpired()) navigate('/login'); else setChecked(true) /* render a retry surface */; return; }`. Add a regression test that a 429 from /v1/auth/session/token does NOT navigate to /login.

### [43] HIGH · error_handling — Login page swallows both flow-hydration failures — Sign in button becomes a no-op with zero feedback

**Location:** `src/pages/auth/login.tsx:136`

Flow hydration has two attempts and a terminal `.catch(() => {})`. When Kratos is unreachable or returns non-2xx for both attempts, `flow` stays null, `loading` was already set false by the session effect, and the form renders normally. `submitPassword` opens with `if (!flow) return;` (line 217) and `submitOIDC` with `if (!flow) { ...startLogin() }` — so clicking 'Sign in' does literally nothing, `networkError` is never set, and no error banner exists for this state. The user sees a working-looking login form that silently refuses to log them in. Violates rules/error-handling.md § 3 ('FAIL clear', 'FAIL loud'). The identical pattern is in src/pages/auth/register.tsx:112 and :119 (`.catch(() => {})` on both flow fetches).

**Evidence**

```
hydrate().catch(() => {
      // Last-resort fallback: try once more without flow param.
      hydrateFresh()
        .then((fresh) => {
          if (fresh) setFlow(fresh);
        })
        .catch(() => {});
    });
```

**Remediation**

Replace the terminal empty catch with `setNetworkError(true)` (the banner already exists at line 330) and, in the non-throwing branches, treat `hydrateFresh()` returning null the same way — today `if (fresh) setFlow(fresh)` drops a null silently too. Add a test: both hydration fetches reject -> the network-error Alert renders and the submit button is disabled.

### [44] HIGH · contract — cloudFetch fabricates ApiError(429) for failures that were not rate limits — and retryGuard then refuses to retry

**Location:** `src/lib/http/api.ts:303`

When the token exchange fails for a non-401 reason (network rejection, 500 INTERNAL_ERROR, 502 AUTH_SERVICE_UNAVAILABLE, or a real 429), the opted-in error path invents `new ApiError(429, undefined, 'Too many requests. Try again in a moment.')`. The real status is available — api.ts stores it in `lastExchangeStatus` — and is discarded in favour of a literal. Two concrete consequences: (1) the user is told 'Too many requests' when the actual fault was the network or a 502, which is a false diagnosis in the UI; (2) src/lib/http/query-client.ts:31 (`retryGuard`) treats any 4xx as non-retryable, so a network failure disguised as 429 is never retried — the exact opposite of the intended behaviour for a transient fault, and it defeats the `retryDelay` backoff configured right below it. Same fabrication repeats at src/lib/http/api.ts:387. Violates rules/error-handling.md § 2 ('errors are explicit and typed', 'return explicit errors, not magic values').

**Evidence**

```
if (!sessionDefinitivelyExpired()) {
      if (cfg.throwOnError === true) {
        throw new ApiError(429, undefined, 'Too many requests. Try again in a moment.');
      }
      return null;
    }
```

**Remediation**

Expose the recorded exchange status (`lastExchangeStatus`) and throw `new ApiError(lastExchangeStatus ?? 0, undefined, 'session token exchange failed')`, so status 0 = network, 429 = rate limit, 5xx = upstream. Then `retryGuard` retries 0/5xx and short-circuits real 4xx, as its own docstring intends.

### [62] HIGH · concurrency — Exponential backoff defeated by reopenAttempts reset on onopen — open/close cycle reconnects every ~750ms forever

**Location:** `src/hooks/deploy/use-sse-stream.ts:192` · **NFR:** concurrency

useSSEStream resets the backoff counter inside onopen (`reopenAttempts = 0`), so the backoff only grows for failures that never reach an open connection. The fetch transport turns a NORMAL end-of-stream into an error: fetch-event-source.ts:174 calls `this.falhar()` when the response body ends ('O servidor encerrou'), and falhar() sets readyState=CLOSED then fires onerror. The resulting cycle is: connect -> onopen (reopenAttempts=0) -> server ends stream -> onerror -> reopen scheduled with tentativa=0 -> delay = 500ms + rand(500ms). That repeats indefinitely. MAX_REOPEN_DELAY_MS=30s is unreachable for this failure mode because every attempt succeeds in opening before failing. There is no circuit breaker and no attempt ceiling, violating the fail-fast/recover doctrine (rules/error-handling.md Section 3 item 6: 'retry/fallback/circuit breaker only where justified'; Unbreakable Rule 8 anti-pattern 'infinite retry without backoff or circuit breaker'). Reachability: use-deploy-timeline.ts:126 and use-deployment-stream.ts:74 never set `path` to null when the deploy/build reaches a terminal state (unlike use-build-logs.ts:197 which does), so a user left on a finished deploy's timeline holds a stream the server has every reason to close. Each cycle also re-runs the clearToken()+token-exchange path (see the sibling finding on line 234). I did not observe the loop against the live backend; the client-side mechanism is unconditional and readable from the code.

**Evidence**

```
es.onopen = () => {
  if (cancelled) return;
  failureCount = 0;
  // Conexao boa: zera o backoff para que a proxima falha recomece curta.
  reopenAttempts = 0;
...
const tentativa = reopenAttempts;
reopenAttempts += 1;
const base = Math.min(1000 * 2 ** tentativa, MAX_REOPEN_DELAY_MS);
const delay = base / 2 + Math.random() * (base / 2);
```

**Remediation**

Two changes, both small. (1) Only reset the backoff after the connection has been stable for a while, not at onopen: record `openedAt` in onopen and reset `reopenAttempts` in onerror only when `Date.now() - openedAt > STABLE_CONNECTION_MS` (e.g. 30s). (2) Add a circuit breaker: after N consecutive reopens (e.g. 8) stop reopening, leave `error=true` so the UI can show a 'reconnect' affordance, and require an explicit user action or a path change to restart. Separately, consider distinguishing a clean end-of-stream from a transport failure in FetchEventSource (a distinct `onended` path) so a completed build does not look like a fault.

### [63] HIGH · error_handling — Every SSE error clears the application-wide access token, not just the SSE credential

**Location:** `src/hooks/deploy/use-sse-stream.ts:234` · **NFR:** security

On any stream error the hook calls `clearToken()`. That function (lib/http/api.ts:263) nulls `accessToken`, `tokenExpiresAt` and `lastIdentity` — the single token used by every `cloudFetch`/`engineFetch` call in the app, not a stream-scoped credential. So a transient stream fault, or a normal end-of-stream (fetch-event-source.ts:174 fires onerror when the server closes the body), invalidates the auth state of every other in-flight and future request, forcing a fresh POST /sessions/exchange. The comment at line 231 justifies this as 'EC-3: token provavelmente expirado', but the code has no evidence the failure was a 401: FetchEventSource collapses every failure path (no token, fetch rejection, non-2xx, read error, clean end-of-stream) into the same `falhar()` with no status. Combined with the defeated backoff (sibling finding, line 192) this produces roughly one token exchange per second per open stream — the same exchange that api.ts:180-190 documents as having a quota that a self-feeding loop already blew once (#324). Treating every error identically is the anti-pattern named in rules/error-handling.md Section 5.

**Evidence**

```
// EC-3: token provavelmente expirado. Limpa o JWT em cache para que o
// proximo ensureSSEToken() force uma troca nova, e reabre explicitamente
// — a reconexao nativa do browser reusaria a URL com o token velho.
clearToken();
es?.close();
```

**Remediation**

Make the failure typed instead of guessing. Have FetchEventSource carry the HTTP status (and a 'stream ended cleanly' marker) on the error event it dispatches, and call `clearToken()` only for status 401/403. For every other failure reconnect with the existing token. If a stream-scoped credential is wanted, expose a `clearSSEToken()` that does not touch the shared `accessToken` used by the REST layer.

### [65] HIGH · error_handling — useCancelBuild reports success when the cancel request fails — engineFetch resolves null instead of throwing

**Location:** `src/hooks/mutations/use-cancel-build.ts:9`

`engineFetch` returns `Promise<T | null>` and resolves to `null` on a failed request unless `{ throwOnError: true }` is passed (lib/http/api.ts:290-313). useCancelBuild omits it, so a 4xx/5xx on POST /builds/{id}/cancel resolves the mutation successfully: `onSuccess` runs, the caches are invalidated, and the UI reports a cancellation that never happened while the build keeps running. The same directory proves the correct shape: usePromote (use-promote.ts:45), useRollback (use-rollback.ts:33) and usePromoteEnvironment (mutations/use-environments.ts:118) all pass `throwOnError: true` with a comment explaining exactly this failure mode ('um `if` esquecido virava uma promocao que falhou em silencio'). useCreateEnvironment (use-environments.ts:66) and useDeleteEnvironment (use-environments.ts:41) have the same gap — a failed delete renders as a successful one. This is the magic-return-value anti-pattern in rules/error-handling.md Section 2 ('Return explicit errors, not magic values ... to signal failure') and the documented #274 silent-null family.

**Evidence**

```
mutationFn: (buildId: string) =>
  engineFetch(`/api/v1/builds/${encodeURIComponent(buildId)}/cancel`, {
    method: 'POST',
  }),
onSuccess: (_data, buildId) => {
```

**Remediation**

Add `{ throwOnError: true }` as the third argument to the engineFetch calls in useCancelBuild, useCreateEnvironment and useDeleteEnvironment so a non-2xx rejects and reaches `mutation.error`, matching usePromote/useRollback. Then confirm each calling dialog renders the error branch. A regression test per hook: mock engineFetch rejecting with ApiError(409) and assert `onSuccess` did not run.

### [83] HIGH · code — Chart bar and KPI card share the label 'not promoted' for two different quantities

**Location:** `src/pages/promptly/components/projections.ts:77`

resumoCatalogo.naoPromovidos counts latest revisions whose label serves nothing (=2 on the file's own CATALOGO fixture); promptsPorAmbiente's SEM_AMBIENTE bucket counts prompts with zero labels (=1). MetricCard renders 2 at overview.tsx:126 and the bar renders 1 at overview.tsx:163, under the same words, one above the other. The domain already distinguishes them — catalogo.tsx:46-55 has separate not-promoted and no-environment filters — and the bar borrowed the first name for the second's data. projections.ts:100 claims the opposite outcome.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Executed against the file's own fixture: naoPromovidos=2 vs SEM_AMBIENTE=1. Both values locked in by passing tests (overview.test.tsx:63 /^Not promoted2$/ and /not promoted\s*1/).
```

**Remediation**

Rename the bar's bucket to 'No environment' to match catalogo.tsx's existing vocabulary. Why: two numbers under one name on the same screen is read as one number that disagrees with itself.

### [84] HIGH · error_handling — localeCompare on an unvalidated label entry unmounts the whole /promptly overview

**Location:** `src/pages/promptly/components/projections.ts:113`

a.label.localeCompare(b.label) throws when a label entry lacks `label`. Order-dependent: a malformed row first survives (String.localeCompare(undefined) is legal), second or later throws. catalogRows (projections.ts:188-195) validates that `labels` is an array and filters `tags` to strings but never validates a label entry — with a comment right there noting the service is known to emit [null]. The sibling projection guards exactly this at trust-series.ts:165 (typeof v?.policy === 'string').

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Executed: promptsPorAmbiente([{labels:[{label:'prod',version:1}]},{labels:[{version:1}]}]) throws TypeError: Cannot read properties of undefined (reading 'localeCompare').
```

**Remediation**

Filter label entries to those with a string `label` before sorting, mirroring trust-series.ts:165. Why: an unhandled throw in a projection takes the entire page down, and the code already documents that the upstream emits malformed entries.

### [85] HIGH · contract — barWidths sanitises the value but the number cell prints the raw one — a 0%-wide bar beside a cell reading NaN

**Location:** `src/components/charts/category-bars.tsx:100`

value is typed number, but every caller feeds it from an unvalidated cloudFetch<T> cast (rag confidence, memory metrics), and memory passes valueFormatter={(v)=>v.toLocaleString()} so a missing field prints NaN on screen. The bar says 'nothing' while the number says something else — and NaN on screen is the exact output the existing test at memory/overview.test.tsx:103 ('not a single NaN in the rendered output') was written to prevent.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Rendered: bars=[{label:'nan',value:NaN},{label:'str',value:'12'}] produces style="width: 0%" beside <td>NaN</td> and <td>12</td>.
```

**Remediation**

Sanitise once and render the sanitised value in both the bar and the cell. Why: the primitive already knows the value is unusable — printing it anyway contradicts its own guard.

### [86] HIGH · contract — The chart gate !error && !loading is not settled-success, so the chart asserts 'Nothing recorded' beside a fully populated table

**Location:** `src/pages/skills/overview.tsx:263`

Two reachable paths. (a) First settled render: loading and error are both false but `paginas` is still [] because the effect at overview.tsx:124-130 runs after paint, so catalogByCategory([]) returns [] and the chart prints the affirmative empty sentence with KPIs at 0/0/0/0 — while the DataTable below already shows every row via the `acervo = paginas.length > 0 ? paginas : pagina` fallback at line 132 that the chart and KPIs lack. (b) Offline mount: TanStack v5 defines isLoading = isPending && isFetching, so at fetchStatus 'paused' both flags are false and the gate opens on data === undefined. Three of five adopters get this right (rag isSuccess && data != null, promptly isSuccess, memory metricsQuery.isSuccess); this page's own comment cites memory/overview.tsx:124 as its precedent while using a weaker condition.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
overview.tsx:263 gate is `!query.error && !query.loading`; memory/overview.tsx:124 (cited by this file as precedent) uses metricsQuery.isSuccess.
```

**Remediation**

Gate on isSuccess && data != null, and feed the chart the same `acervo` fallback the table uses. Why: an affirmative 'nothing recorded' is a claim, and it must not be made from an unsettled read.

### [87] HIGH · contract — Same paused/idle blind spot on the one screen where an empty distribution is a compliance claim

**Location:** `src/pages/trust/overview.tsx:204`

isLoading is violationsQuery.loading || validatorsQuery.loading (line 87), both derived from isPending && isFetching. Offline at mount means fetchStatus 'paused', both false, `failed` false, data undefined — the gate opens. coverageGap(undefined, undefined) returns [], the chart prints 'Nothing recorded in this window.', KPIs render 0/0/0/0 and the headline computes 'No violation recorded.' That is a compliance screen affirmatively stating nothing got through when nothing was read — verbatim the failure the comment at lines 182-183 says the gate prevents.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
overview.tsx:87 `const isLoading = violationsQuery.loading || validatorsQuery.loading`; gate at :204 is `!failed && !isLoading`.
```

**Remediation**

Gate on settled success of both queries. Why: on a trust surface, 'no violations' and 'not read' must never render identically.

### [88] HIGH · contract — When only the validators query fails, every bar is painted amber 'unblocked' — asserting nothing is stopped precisely when the code knows it cannot tell

**Location:** `src/pages/trust/overview.tsx:213`

`failed` tracks violationsQuery.error alone (line 88); a guardrail-catalog 500 sets catalogBlind (line 90) but leaves the gate open. coverageGap then receives validators === undefined, builds an empty enforcedPolicies set, marks every row enforced:false, and `tone: c.enforced ? 'muted' : 'warning'` paints all bars amber. The page's own comment at line 89 says the operator 'precisa saber que a coluna bloqueado está cega' and the table below carries that caveat; the chart — now the most scannable element on the screen — carries none. The tone vocabulary has no value for 'coverage unknown', so the false branch was reused for it.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
overview.tsx:88 `failed` from violationsQuery.error only; :90 catalogBlind; :213 tone: c.enforced ? 'muted' : 'warning'.
```

**Remediation**

Add a third tone for unknown coverage, or suppress the chart when catalogBlind. Why: reusing 'not enforced' to mean 'could not determine' turns a read failure into a false all-clear.

### [38] MEDIUM · code — Blob+anchor download implemented 3 times; the canonical helper declares itself the ONE source and the third copy reproduces the exact bug it documents

**Location:** `src/pages/workspace/overview.tsx:193`

src/lib/export/download.ts:1-8 declares itself canonical in prose: "The canonical Blob + anchor.click pattern, ONE source reused by every exporter (audit, logs, traces - DRY / Rule 9)", and documents the edge case that motivated it (EC - SAFARI/FIREFOX REVOKE TIMING). Two other copies exist and neither delegates to it.

(a) src/pages/deploy/export/log-download.ts:24-40 is a byte-for-byte reimplementation of the same body (Blob -> createObjectURL -> createElement(a) -> appendChild -> click -> setTimeout revoke 1000ms), carrying its OWN copy of the same EC-4 docblock. It is correct today, but it is a second definition of one behaviour: it could be `triggerDownload(`runtime-logs-${iso}.log`, text, "text/plain")` with only formatLineForExport left local. The canonical helper even claims to have been extracted FROM it, which means the extraction landed and the original was never migrated.

(b) src/pages/workspace/overview.tsx:193-203 is a third copy that DROPS the two safety steps the canonical exists to encode: no `document.body.appendChild(a)` and `URL.revokeObjectURL(blobURL)` synchronously after `a.click()` instead of the deferred revoke. That is precisely the failure both docblocks describe ("revoking the object URL immediately after click() can abort the download before Safari finishes streaming"). It also silently swallows a failed fetch (`if (!res.ok) return;`) with no user-visible error, which is a second divergence from the rest of the codebase norm.

This is the codebase dominant defect shape from phase 2: a correct declared rule, a divergent second copy, and NO mechanical guard. The repo already knows how to close this class - lens-alert-guard.test.ts and kpi-primitive-unification.test.ts each quantify over `src/**` for exactly this kind of re-divergence - but no guard covers `document.createElement("a")`. Pattern judgement is heuristic; the Safari/Firefox consequence is asserted by the two docblocks rather than measured in this review.

**Evidence**

```
src/lib/export/download.ts:12-25 (canonical)
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Defer revoke so Safari + Firefox can finish streaming the download.
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

src/pages/deploy/export/log-download.ts:29-39 (copy 2, identical shape + duplicated EC-4 docblock)
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `runtime-logs-${new Date().toISOString()}.log`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

src/pages/workspace/overview.tsx:197-202 (copy 3, safety steps dropped)
    const blobURL = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = blobURL;
    a.download = file.path.split("/").pop() ?? file.path;
    a.click();
    URL.revokeObjectURL(blobURL);

grep -rn "createElement(.a.)" src --include=*.ts --include=*.tsx | grep -v .test. -> exactly these 3 sites.
```

**Remediation**

1) Widen triggerDownload to accept `BlobPart | Blob` (or add a sibling `triggerBlobDownload(filename, blob)`) so a binary presigned download can use it. 2) Make workspace/overview.tsx onDownload call it, and surface the !res.ok path as an Alert instead of returning silently. 3) Make log-download.ts delegate: keep formatLineForExport, replace the body with triggerDownload(...). 4) Add a guard test in src/lib in the shape of lens-alert-guard.test.ts: no file outside src/lib/export/download.ts may reference document.createElement("a") together with URL.createObjectURL. Without step 4 the fourth copy lands the same way the third did.

### [45] MEDIUM · concurrency — Concurrent 401s each null the access token, re-triggering the token exchange the #324 fix exists to prevent

**Location:** `src/lib/http/api.ts:379` · **NFR:** concurrency

`fetchWithAuth` handles a 401 by unconditionally setting the module-global `accessToken = null` before awaiting `ensureToken()`. `exchangeSessionToken()` dedups only while `refreshPromise` is non-null, and clears it in `finally`. With N requests in flight under an expired token, request 1 refreshes successfully and installs a fresh token; request 2's 401 handler then runs, wipes that fresh token (line 379), finds `hasValidToken()` false and — with `refreshPromise` already back to null — issues a SECOND exchange against /v1/auth/session/token. A burst of concurrent queries therefore produces a burst of token exchanges, which is precisely the quota-exhaustion loop documented in the comment 8 lines below ('o redirect recarrega a pagina e realimenta o problema'). Shared mutable module state (`accessToken`, `tokenExpiresAt`, `refreshPromise`) is mutated from concurrent async paths without any generation/epoch check.

**Evidence**

```
if (resp.status === 401) {
      if (!redirectOnAuthFailure) return null;
      // Token expired — try refresh once
      accessToken = null;
      const newToken = await ensureToken();
```

**Remediation**

Capture the token generation before the request (`const gen = tokenGeneration`) and only invalidate when it has not advanced: `if (gen === tokenGeneration) { accessToken = null; tokenGeneration++; }`. Alternatively drop the eager null and let `ensureToken()` decide, since it already dedups — the explicit null is what defeats the dedup. Add a concurrency test: 3 parallel cloudFetch calls receiving 401 must produce exactly ONE POST to /v1/auth/session/token.

### [46] MEDIUM · error_handling — submitFlow discards the HTTP status entirely — a 5xx is indistinguishable from a validation response

**Location:** `src/pages/auth/kratos.ts:72`

`submitFlow` returns `resp.json()` without ever consulting `resp.ok` or `resp.status`. Kratos returns the flow with `ui.messages` for 4xx validation, but for a 502/504 (proxy HTML) or a 500 the body is not JSON, so `resp.json()` rejects with a `SyntaxError` — not a typed error carrying the status. This is what makes the caller-side classifier unreachable: src/pages/auth/recovery.tsx:208 `is5xxOrNetwork` looks for `/\b5\d\d\b/` in `err.message` and for `err instanceof TypeError`, neither of which a `SyntaxError: Unexpected token '<'` satisfies. So every server-side 5xx during recovery is classified as a client validation error. `getFlow` (line 60) throws a bare `Error` string that also loses the status. Violates rules/error-handling.md § 2 ('errors are explicit and typed').

**Evidence**

```
export async function submitFlow(action: string, method: string, body: Record<string, string>): Promise<Flow> {
  const resp = await fetch(action, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return resp.json();
}
```

**Remediation**

Introduce a typed error (reuse `ApiError` from lib/http/api.ts) and throw it on non-2xx with the status attached, tolerating a non-JSON body: `if (!resp.ok && resp.status >= 500) throw new ApiError(resp.status, await resp.text().catch(() => undefined));`. Then have recovery.tsx classify on `err instanceof ApiError && err.status >= 500` instead of regexing a message.

### [47] MEDIUM · error_handling — Error classification computed then thrown away — identical if/else branches in three recovery handlers

**Location:** `src/pages/auth/recovery.tsx:240`

`is5xxOrNetwork(err)` is called and its result used to choose between two branches that set the SAME message. The classification is dead: the function runs, allocates, and its answer changes nothing. It repeats verbatim at src/pages/auth/recovery.tsx:372 (handlePasswordSubmit). The reader is told a distinction is being made when it is not, and the underlying cause (`err`) is never logged, never reported, never surfaced — so a 502 during password reset is indistinguishable from a client bug in production. Violates rules/error-handling.md § 2 ('Distinguish recoverable from unrecoverable') and § 5 ('Treating every error the same').

**Evidence**

```
} catch (err) {
      setLastSubmit(() => handleEmailSubmit);
      if (is5xxOrNetwork(err)) {
        setErrorMessage(SERVICE_UNAVAILABLE_MESSAGE);
      } else {
        setErrorMessage(SERVICE_UNAVAILABLE_MESSAGE);
      }
    } finally {
```

**Remediation**

Either collapse to a single `setErrorMessage(SERVICE_UNAVAILABLE_MESSAGE)` and delete `is5xxOrNetwork` (honest), or give the two branches genuinely different copy (transient 'try again in a minute' vs 'check your input'). Either way, report the raw `err` to telemetry so the 5xx is visible in production.

### [48] MEDIUM · contract — BroadcastChannel message consumed without validating its shape

**Location:** `src/lib/http/api.ts:93` · **NFR:** security

The cross-tab handler dereferences `event.data.type` with no check that `event.data` is an object. BroadcastChannel is a trust boundary: any same-origin script (including an injected one, another SPA on the same origin, or a future sender that posts a different schema) can post `null`, a string, or a number, and `msg.type` then throws a TypeError inside an event handler with no surrounding try/catch — an unhandled error outside React's boundary. The handler is also security-relevant: it clears the token and redirects the page, so a malformed or hostile message is a cheap same-origin denial of service on every open tab. The module's own type (`type AuthMessage = { type: 'logged-out' }`) is compile-time only and erased at runtime.

**Evidence**

```
ch.onmessage = (event: MessageEvent<AuthMessage>) => {
      const msg = event.data;
      if (msg.type === 'logged-out') {
```

**Remediation**

Validate before dereferencing: `const msg = event.data; if (typeof msg !== 'object' || msg === null || (msg as {type?:unknown}).type !== 'logged-out') return;`. Consider also ignoring messages when this tab has no token, so a spurious message cannot bounce an unauthenticated tab.

### [49] MEDIUM · contract — cloudFetch's `T | null` collapses at least four distinct outcomes into one value

**Location:** `src/lib/http/api.ts:305`

On the default (non-throwOnError) path a resolved `null` means, indistinguishably: (a) the session token could not be obtained for a transient reason — line 305; (b) the session definitively expired and a redirect was fired — line 308; (c) the server answered non-2xx, any status — lines 405 and 413; (d) the request succeeded with 204/205 No Content — src/lib/http/api.ts:346 via parseOkBody. A caller receiving null cannot tell 'no data' from 'you were logged out' from 'the API is down'. The repo already documents the downstream damage of (c) in src/lib/silent-null-guard.test.ts (issues #250, #259, #261: 62 queries rendering an empty state where the truth was 'I could not ask'), but that guard only quantifies over `useQuery` call sites — the contract itself is unchanged, and (d) is not covered at all: a legitimately empty 204 is reported by src/hooks/use-api.ts:48 as `error: true`. Violates rules/error-handling.md § 2 ('Return explicit errors, not magic values').

**Evidence**

```
if (cfg.throwOnError === true) {
        throw new ApiError(429, undefined, 'Too many requests. Try again in a moment.');
      }
      return null;
    }
    redirectToLogin('expired');
    return null;
```

**Remediation**

Make `throwOnError` the default for new call sites and migrate the legacy ones, or return a discriminated result (`{ok:true,data:T} | {ok:false,kind:'empty'|'expired'|'transient'|'http',status:number}`). At minimum stop reusing `null` for the 204 case — return a distinct sentinel or `undefined` so 'no content' and 'failure' are separable.

### [50] MEDIUM · contract — Unvalidated 402 response body crosses a window event into a render path that calls String.replace

**Location:** `src/components/dialogs/plan-limit-upgrade-modal.tsx:55` · **NFR:** security

src/lib/http/api.ts:447 parses the 402 body with `resp.clone().json()` and dispatches it verbatim as `CustomEvent('theo:plan-limit', { detail: body })`. The listener casts `e as CustomEvent<PlanLimitDetail | null>` — a compile-time assertion over network JSON with no runtime validation — and then calls `.replace()` on `detail.current_plan`. If the server (or anything else on the origin, since `window` events are not authenticated) supplies `current_plan` as a number, array or object, `.replace is not a function` throws during render and the whole route falls to the error boundary. `detail.message` is likewise rendered verbatim as the modal description, so the copy shown to the user is fully server-controlled. Violates the trust-boundary rule in rules/architecture.md § 2 / rules/error-handling.md § 2 ('Validate inputs at the system boundary').

**Evidence**

```
const resourceLabel = detail?.resource ?? 'this resource';
  const currentPlan = (detail?.current_plan ?? 'Free').replace(/^\w/, (c) =>
    c.toUpperCase(),
  );
```

**Remediation**

Validate at the emitter (api.ts maybeEmitPaymentRequired) before dispatching, or narrow in the handler: accept the event only when `typeof detail === 'object' && detail !== null`, and coerce each field with `typeof x === 'string' ? x : undefined`. A tiny schema check (zod or a hand-rolled `parsePlanLimitDetail`) keeps the modal from being a render-crash vector.

### [51] MEDIUM · error_handling — initFlow's 3xx branch is unreachable under `redirect: 'manual'`, and would be an unguarded open redirect if it were

**Location:** `src/pages/auth/kratos.ts:48` · **NFR:** security

The fetch is issued with `redirect: 'manual'`, which per the Fetch standard yields an opaque-redirect filtered response: `type: 'opaqueredirect'`, `status: 0`, and an EMPTY header list. So on the 303 the comment anticipates, `resp.status === 200` is false, `resp.status >= 300 && < 400` is false, and `resp.headers.get('Location')` would be null anyway — control falls straight to `throw new Error('Failed to start ...')`. Two defects follow: the documented redirect-following behaviour never happens (recovery.tsx:181 and :305 depend on initFlow succeeding), and the branch that IS written assigns a raw server-supplied `Location` header to `window.location.href` with no allowlist — the exact class `isSafeRedirectUrl` was written for and is applied at device-verify.tsx:75. Separately, the success path returns `{} as Flow`, a type-system lie: any caller reading `flow.ui.nodes` on that object gets a TypeError.

**Evidence**

```
if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get('Location');
    if (location) {
      window.location.href = location;
      return {} as Flow; // redirect will happen
    }
  }
```

**Remediation**

Use `redirect: 'follow'` (as login.tsx:91 already does) and drop the manual branch, or keep 'manual' and stop pretending to read the Location. If any redirect target is ever followed, gate it: `if (!isSafeRedirectUrl(location)) throw new Error(...)`. Replace `{} as Flow` with a discriminated return so callers cannot dereference a fake flow.

### [52] MEDIUM · error_handling — Tenant-cache purge on logout fails silently — no signal that stale tenant data survived

**Location:** `src/lib/auth/logout-cache-purge.ts:79` · **NFR:** security

`purgarCachesDeDados` is the control that stops a previous tenant's `/api/v1/*` responses being served to the next user from the service-worker cache (the module's own docblock states the exposure: 'a resposta de quem saiu ficava no disco'). Both failure modes are swallowed without a trace: each individual `caches.delete(n).catch(() => false)` and the outer `catch { }`. The design decision not to throw is correct and well argued (an exception here would block the logout). What is missing is observability: when the purge fails, the security control has silently not run, and there is no counter, log or telemetry event anywhere to say so. rules/error-handling.md § 3 step 5 requires 'LOG with context' even where recovery is the right response.

**Evidence**

```
await Promise.all(
      nomes.filter(guardaDado).map((n) => caches.delete(n).catch(() => false)),
    );
  } catch {
    // Storage bloqueado ou API indisponível. O logout segue.
  }
```

**Remediation**

Keep the never-throw contract but emit a signal: collect the per-cache results and `reportEvent`/`console.warn` with the names that failed, e.g. `if (falhas.length) reportEvent('logout.cache_purge_failed', { caches: falhas })`. Returning `{purged: string[], failed: string[]}` instead of `void` would also let `logout()` decide (e.g. warn the user on a shared machine).

### [53] MEDIUM · contract — useCloudApi reports `error: true` for a successful empty response

**Location:** `src/hooks/use-api.ts:48`

The hook derives its error flag from `query.data === null`. But `cloudFetch` resolves null for a successful 204/205 No Content (src/lib/http/api.ts:346) exactly as it does for an HTTP failure, so an endpoint that legitimately returns no content renders as an error state. The inverse gap is acknowledged in the `silent-null-ok` marker on line 41 (screens frequently do not read `error` at all), but the marker only excuses the failure-to-error mapping, not the success-to-error one. `useEngineApi` (line 61) carries the identical expression.

**Evidence**

```
error: enabled && (query.isError || (query.isFetched && query.data === null)),
```

**Remediation**

Fix the contract at the source (see the cloudFetch `T | null` finding) so 'no content' and 'failure' are different values; until then, pass `{ throwOnError: true }` in the queryFn so real failures reach `query.isError` and drop the `data === null` clause.

### [60] MEDIUM · concurrency — A non-2xx on any SSE stream wipes the app-wide JWT via clearToken()

**Location:** `src/hooks/deploy/use-sse-stream.ts:234` · **NFR:** concurrency

The SSE error handler calls `clearToken()` — the module-global token used by every cloudFetch/engineFetch in the app (~151 importers) — whenever the browser closed the connection. Per the transport's own contract (src/hooks/deploy/fetch-event-source.ts docblock: 'Numa resposta nao-2xx o readyState vai para CLOSED antes de onerror disparar'), CLOSED is reached for ANY non-2xx, not just 401. So a 404 on a mistyped stream path, or a 500 from the stream handler, invalidates the shared session token for the whole dashboard: every in-flight and subsequent request then takes the 401-refresh path and forces a new /v1/auth/session/token exchange. Combined with the backoff loop on lines 239-247, a persistently broken stream endpoint becomes a periodic global token-invalidation source — the same quota-exhaustion shape the #324 comments in lib/http/api.ts were written to stop. The comment on line 231 assumes the cause is an expired token ('token provavelmente expirado'), but the code never checks the status to confirm it.

**Evidence**

```
const fechadoPeloBrowser = es?.readyState === EVENTSOURCE_CLOSED;
        if (!fechadoPeloBrowser && failureCount < TOKEN_REFRESH_THRESHOLD) return;

        // EC-3: token provavelmente expirado. Limpa o JWT em cache para que o
        // proximo ensureSSEToken() force uma troca nova, e reabre explicitamente
        clearToken();
        es?.close();
```

**Remediation**

Have FetchEventSource surface the HTTP status on the error event and only call `clearToken()` for 401/403. For every other status, reopen with the existing token under backoff. If the status cannot be surfaced, prefer a stream-scoped invalidation (drop this hook's cached token) over clearing the app-wide one.

### [64] MEDIUM · code — TOKEN_REFRESH_THRESHOLD branch is unreachable with the fetch transport; its guard test asserts a state production cannot produce

**Location:** `src/hooks/deploy/use-sse-stream.ts:229` · **NFR:** concurrency

The header comment (lines 66-72) and the constant TOKEN_REFRESH_THRESHOLD=3 describe a two-path policy: reopen immediately when the connection is CLOSED, wait for three failures when it is CONNECTING because 'o browser ja esta retentando sozinho'. Since B-088 replaced the transport, no path can reach onerror with a non-CLOSED readyState: FetchEventSource.falhar() sets `readyState = CLOSED` before firing onerror (fetch-event-source.ts:110), and it is the only place onerror is raised. SharedEventSource's readyState getter forwards `entrada.real.readyState`. Therefore `fechadoPeloBrowser` is always true, and `failureCount`, `TOKEN_REFRESH_THRESHOLD` and the early return at line 229 are dead. Nothing 'retenta sozinho' anymore — that behaviour belonged to the native EventSource. The guard test that pins this policy, use-sse-stream.test.tsx:234 ('test_erro_NAO_fatal_isolado_nao_reabre_deixa_o_browser_retentar_B014'), passes only because its fake exposes `triggerError()` leaving readyState=0 — a state the real transport never emits. The test therefore certifies a branch that cannot run, which is what let the always-clearToken() behaviour (sibling finding, line 234) become invisible.

**Evidence**

```
const fechadoPeloBrowser = es?.readyState === EVENTSOURCE_CLOSED;
if (!fechadoPeloBrowser && failureCount < TOKEN_REFRESH_THRESHOLD) return;
```

**Remediation**

Delete `failureCount`, `TOKEN_REFRESH_THRESHOLD` and the line-229 guard, and rewrite the lines 66-72 / 216-227 comments so they describe the fetch transport instead of the browser's native retry. Replace the removed test with one that drives a real FetchEventSource against a mocked non-2xx `fetch` and asserts the token path, so the assertion is about behaviour the transport can actually produce.

### [66] MEDIUM · code — Deploy-timeline 'cascade' loop is a no-op — the documented out-of-order defence does not exist

**Location:** `src/hooks/deploy/use-deploy-timeline.ts:176`

The block comments a defence against out-of-order arrival on reconnect ('Phases BEFORE a completed one inherit completed too (defensive vs out-of-order arrival on reconnect)') and then implements nothing. The first `if` has an empty body with a comment saying so; the second only sets the local `foundActive`, which is never read after the loop and never leaves the block. The loop can be deleted with zero behavioural change, and the documented invariant — earlier phases inherit a later phase's completion — is simply not enforced. Because SSE delivery order is not guaranteed across a reconnect + server replay, a timeline can legitimately render 'build: pending' next to 'live: completed'. The comment being confidently wrong is the worse half: a reader auditing reconnect behaviour will believe the case is handled.

**Evidence**

```
let foundActive = false;
for (const cell of phases) {
  if (foundActive && cell.status === 'pending') {
    // Already pending — no-op (keeps initial state).
  }
  if (
    cell.status === 'in_progress' ||
    cell.status === 'degraded' ||
    cell.status === 'failed' ||
    cell.status === 'canceled'
  ) {
    foundActive = true;
  }
}
```

**Remediation**

Decide which invariant is wanted and implement or delete. If the cascade is wanted: walk PHASE_ORDER in reverse, and once a phase with status 'completed' (or any terminal status) is seen, force every earlier phase still 'pending' to 'completed'. Add a unit test feeding events out of order (live.completed before build.completed) and asserting the earlier phases are not left pending. If it is not wanted, delete the loop and the comment.

### [67] MEDIUM · concurrency — useBuildLogs.refresh() writes state after unmount and never aborts — the sibling load path in the same file guards both

**Location:** `src/hooks/deploy/use-build-logs.ts:211` · **NFR:** concurrency

`refresh` awaits engineFetch and then calls `aplicarSnapshot(data)` / `setHistoricalError(...)` with no cancellation guard and no AbortSignal. If the user clicks Refresh on a large build (the request is `?limit=5000`) and navigates away, the response is still parsed and applied to an unmounted component, and the network work is not cancelled. The initial-load effect twelve lines above does this correctly — it closes over a `cancelled` flag, checks it in both .then and .catch, and flips it in the effect cleanup — so the discipline exists in the file and only the user-driven path is missing it. `refreshInFlight` is a ref, so it is also never cleared on unmount, though the ref dies with the component. This is the same class of divergence the file's own header docblock describes for B-016 ('eram dois setHistorical distintos ... e o segundo esqueceu').

**Evidence**

```
const refresh = useCallback(async () => {
    if (!buildId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setHistoricalError(null);
    try {
      const data = await engineFetch<BackendLogsResponse>(
        `/api/v1/builds/${encodeURIComponent(buildId)}/logs?limit=${MAX_LOG_LINES}`,
      );
      aplicarSnapshot(data);
```

**Remediation**

Hold a mount flag in a ref (`const montado = useRef(true)` with `useEffect(() => () => { montado.current = false }, [])`) and gate every setState in `refresh` on it, or better, hoist an AbortController ref that both the initial effect and `refresh` share, abort it in the effect cleanup, and pass its signal to engineFetch. Add a test that unmounts while the refresh promise is pending and asserts no state write occurs.

### [68] MEDIUM · contract — useMetrics-range keys the cache by env but never sends env — a non-production env silently returns production metrics

**Location:** `src/hooks/projects/use-metrics-range.ts:72`

`resolvedEnv` is computed from the `env` argument and included in the React Query `queryKey` (line 77), but the request path built at line 72 carries only `range` and `signal`. The consequence is not a cache collision but the opposite and worse: two different envs get two distinct cache entries that both hold the SAME server response. A caller asking for a preview environment's histogram receives production numbers, with no error and no visible clue — the queryKey makes it look scoped. The hook's own docblock states the endpoint contract as `GET /api/v1/projects/{name}/metrics?range=7d&signal=uptime_24h`, which does not mention env at all, so either the parameter is meaningless and should be removed from the signature, or the endpoint accepts it and the caller silently loses the filter.

**Evidence**

```
const resolvedEnv = env ?? 'production';

  const path = `/api/v1/projects/${encodeURIComponent(
    projectName ?? '',
  )}/metrics?range=${encodeURIComponent(range)}&signal=${encodeURIComponent(signal)}`;
```

**Remediation**

Confirm against the backend handler whether /metrics accepts an env parameter. If it does, append `&env=${encodeURIComponent(resolvedEnv)}` to the path so the key and the request agree. If it does not, delete the `env` parameter from the hook signature and from the queryKey rather than leaving a filter that looks applied and is not.

### [69] MEDIUM · code — Refetch effect re-runs on every render — `filters` is an inline object literal at the only call site

**Location:** `src/hooks/deploy/use-deployments-list-stream.ts:131` · **NFR:** performance

The effect's dependency array includes `filters`, which the sole production caller (pages/deploy/deployments.tsx:159-165) constructs inline with spread operators, so it is a fresh object identity on every render of the deployments page. The effect therefore runs on every render rather than when the filters actually change, rebuilding `new Set(initial.builds.map(...))` and walking the entire SSE buffer (maxEvents=200) each time. It does not misbehave — `refetchedFor` prevents a refetch storm and the body is idempotent — but the dependency is decorative rather than functional, and the cost is paid on every keystroke-driven re-render of a page whose whole point is a live-updating list. `initial.builds` is also a dependency the effect only reads to build a membership set.

**Evidence**

```
}, [stream.events, projectName, filters, initial.builds, queryClient]);
```

**Remediation**

Depend on a serialized key rather than the object identity: `const filtersKey = JSON.stringify(filters ?? {})` (or destructure `filters?.status`, `filters?.env`, `filters?.limit` into three scalar deps) and use that in the array, reading `filters` through a ref inside the effect. Alternatively memoize the object at the call site with useMemo keyed on statusFilter/envFilter/pageLimit.

### [70] MEDIUM · concurrency — Two SSE endpoints have no mock registration — in mock mode they reconnect forever against a route that will never exist

**Location:** `src/lib/mocks/handlers.ts:343` · **NFR:** concurrency

registerLogStreamHandlers registers exactly four SSE patterns: builds/{id}/logs/stream, projects/{name}/logs/stream, builds/{id}/stream and deploys/{id}/timeline. Two production streams are missing: `/api/v1/projects/{name}/builds/stream` (use-deployments-list-stream.ts:93, the deployments list) and `/api/v1/projects/{name}/signals/stream` (use-status-stream.ts:65). The `projects/{name}/logs/stream` pattern cannot cover the first because the compiled parameter regex is `([^/?]+)`, which does not span a slash. With VITE_USE_MOCKS=true the transport is MockEventSource (mocks/index.ts:80); an unmatched URL takes the branch at mocks/sse.ts:92 which sets readyState=CLOSED and fires onerror. useSSEStream reads CLOSED, calls clearToken(), and reopens — and because the failure never reaches onopen the backoff does grow here, but there is no ceiling on attempts, so the mock session retries that route for as long as the page is open. Consequence for anyone developing or E2E-testing the deployments list offline: a permanent error state plus a background reconnect loop, with no diagnostic naming the missing registration.

**Evidence**

```
registerSSE('/api/v1/builds/{id}/logs/stream', (es) => {
...
  registerSSE('/api/v1/projects/{name}/logs/stream', (es) => {
...
  registerSSE('/api/v1/builds/{id}/stream', (es) => {
...
  registerSSE('/api/v1/deploys/{id}/timeline', (es) => {
```

**Remediation**

Register the two missing patterns with emitters that mirror the real event names — build.started / build.succeeded / build.failed for projects/{name}/builds/stream, and the named `signal.changed` frame for projects/{name}/signals/stream. Add a test in mocks/sse.test.ts that walks every path literal used by a useSSEStream caller and asserts a registration matches it, so the next stream added without a mock fails the suite instead of failing silently at runtime.

### [71] MEDIUM · contract — Unpausing an SSE stream does not flush the buffered events — the UI stays stale until the next event arrives

**Location:** `src/hooks/deploy/use-sse-stream.ts:150`

While `paused` is true, `push` keeps appending to `bufferRef` but skips every setState, so `events`, `lastEventID` and `droppedCount` freeze. Nothing re-publishes the buffer when `paused` flips back to false: `pausedRef.current` is updated during render, `paused` is deliberately absent from the effect's dependency array (line 260), and the only writer of `setEvents` is `push`, which runs on event arrival. So after unpausing, the consumer keeps rendering the pre-pause snapshot until the server happens to send another frame — indefinitely on a quiet or already-finished stream. The documented contract is 'Freeze updates without closing the connection' (line 46) and use-log-stream.ts:18 restates it as 'paused freezes setLines without closing the connection'; both imply the frozen updates are resumed, not discarded. The runtime-logs page exposes this directly through a Pause control (pages/deploy/runtime-logs.tsx:36).

**Evidence**

```
if (!pausedRef.current) {
        setEvents([...bufferRef.current]);
        setLastEventID(lastIDRef.current);
        setDroppedCount(droppedRef.current);
      }
```

**Remediation**

Add an effect keyed on `paused` that flushes on the falling edge: `useEffect(() => { if (!paused) { setEvents([...bufferRef.current]); setLastEventID(lastIDRef.current); setDroppedCount(droppedRef.current); } }, [paused])`. Add a test that pauses, emits two events, unpauses without emitting again, and asserts both events are visible.

### [72] MEDIUM · contract — useBuildLogs can hold 2x MAX_LOG_LINES — the cap guard test only covers the pure function, not the merged output

**Location:** `src/hooks/deploy/use-build-logs.ts:203` · **NFR:** performance

Two independent caps are applied: `capLogLines` bounds the REST snapshot at MAX_LOG_LINES=5000 (line 163) and useSSEStream's FIFO bounds the live buffer at maxLines=5000 (use-log-stream.ts:69). The value the consumer actually renders is their concatenation, which is bounded at 10000, not 5000. use-log-stream.ts:18 states the contract as 'lines cap at maxLines (default 5000) FIFO'. The guard test named in the review scope, use-log-stream.cap.test.ts, exercises `capLogLines` in isolation across seven cases and never renders the hook, so the merged path it was written to protect (per its own docblock: the LogViewer 'que materializa uma linha de DOM por linha de log') is untested. On a long build the tab therefore holds and can render twice the intended ceiling.

**Evidence**

```
const lines = useMemo<LogLine[]>(
    () => [...historical, ...stream.lines],
    [historical, stream.lines],
  );
```

**Remediation**

Apply the shared rule at the join: `() => capLogLines([...historical, ...stream.lines])`, so the ceiling is enforced once on the value the consumer sees. Extend use-log-stream.cap.test.ts with a case that renders useBuildLogs with a 5000-line snapshot plus live events and asserts `lines.length <= MAX_LOG_LINES`.

### [73] MEDIUM · concurrency — Deploy timeline replays a FIFO-capped buffer to derive state — evicted events silently revert phases to 'pending'

**Location:** `src/hooks/deploy/use-deploy-timeline.ts:136` · **NFR:** concurrency

The reducer at line 138 rebuilds the whole PhaseState map from scratch on every render by replaying `stream.events`, which useSSEStream caps FIFO at maxEvents=60. State is therefore only as durable as the tail of the buffer: any event dropped by the cap is not merely missed, it is un-applied, and the phase it advanced falls back to the 'pending' initial value from initialPhases(). This exact failure mode is already documented as a LIVE bug for the sibling hook — use-deployments-list-stream.ts:12-19 records a sponsor seeing 'Running' on builds that had been SUCCEEDED for minutes because 'o servidor pode retransmitir build.started{X} cujo build.succeeded{X} ja foi despejado do cap' — and that hook carries an explicit TERMINAL_STATUSES absorbing guard as the fix. The timeline hook has no equivalent. 60 is comfortable for the ~10 events of a clean deploy, but the buffer is also fed by SharedEventSource's replay to late subscribers (REPLAY_MAX=1000, shared-event-source.ts:60) and by server retransmission from Last-Event-ID on every reconnect — and reconnects are frequent per the backoff finding on line 192. I did not reproduce an overflow; the mechanism and the precedent are both in the repository.

**Evidence**

```
const stream = useSSEStream(path, {
    eventTypes: TIMELINE_EVENT_TYPES,
    initialLastEventID: options.initialLastEventID ?? null,
    paused: options.paused,
    // Canonical 5 phases × 6 statuses + degraded events + cushion.
    maxEvents: 60,
  });
```

**Remediation**

Stop deriving durable state from an evictable buffer. Accumulate phases incrementally in a ref-backed reducer driven by `onEvent` (the pattern use-status-stream.ts:61 already uses and documents) so an evicted event cannot un-apply a transition. Failing that, add an absorbing guard mirroring TERMINAL_STATUSES: never let a replayed event move a phase from a terminal status ('completed'/'failed'/'canceled') back to 'pending' or 'in_progress'. Add a test that overflows the cap and asserts earlier completed phases stay completed.

### [79] MEDIUM · complexity — useDeployTimeline reducer memo has measured CCN=31 — the highest in the codebase, in the reconnect-sensitive path

**Location:** `src/hooks/deploy/use-deploy-timeline.ts:138` · **CC:** 31.0

lizard measures the anonymous useMemo callback at CCN=31 over NLOC=65, against a codebase where 90% of functions sit at CCN<=5 and well past the McCabe threshold of 10 at which branch coverage stops being practically attainable. The function does five distinct jobs in one scope: seed the phase map, classify and apply each event, run the (currently no-op) cascade, pick currentPhase through a three-tier fallback, and derive the overall status. That matters more here than raw score would suggest because this is the code that has to be right when events arrive out of order or partially — the same function that carries the dead cascade block (see the finding at line 176) and the FIFO-replay fragility (line 136). Two defects already hide inside it, which is the practical argument the metric is making.

**Evidence**

```
return useMemo(() => {
    const phases = initialPhases();
    const byPhase = new Map<Phase, PhaseState>();
```

**Remediation**

Extract the event application into a pure module-level reducer `applyTimelineEvent(state, event): TimelineState` (mirroring use-status-stream.reducer.ts, which was split out for exactly this reason and is unit-tested without React), and extract `pickCurrentPhase(phases)` alongside the existing `deriveOverall`. The memo then becomes a fold plus two calls, each testable on its own, and the out-of-order cases become expressible as reducer tests.

### [81] MEDIUM · code — The webhooks CRUD is parameterized-by-context for 2 of its 3 mount points; /memory/webhooks is a 555-line independent third copy of the same component the map was built to serve

**Location:** `src/pages/memory/webhooks.tsx:34`

src/pages/settings/webhooks.tsx:69-76 declares the rule in its own docblock: "M86 - the SAME webhooks CRUD is mounted in two contexts (Settings and Observability). Only the COPY differs, so the component is parameterized by `context` rather than duplicated (reuse-first)." The mechanism is a clean Strategy/context map - `WEBHOOK_CONTEXTS: Record<WebhookContext, WebhookContextCopy>` (:86-105) holding description / dialogDescription / deleteNoun / events / deliveryNotice per context, consumed by `WorkspaceWebhooksPage({ context })` (:109-110).

There are THREE webhook routes, not two. src/routes/settings-routes.tsx:73 and src/routes/observability-routes.tsx:59 both mount WorkspaceWebhooksPage; src/routes/memory-routes.tsx:31 mounts a completely separate 555-line `WebhooksPage` from src/pages/memory/webhooks.tsx. The third context was never added to the map - it was written again.

What is duplicated is not "similar-looking domain code" (the 13 subtrees are parallel by design); it is the SAME artifacts, character for character:
  - `interface Webhook` - identical 5 fields (settings:42-48 vs memory:34-40)
  - `interface Delivery` - identical 8 fields including the identical 5-member status union (settings:289-298 vs memory:46-55)
  - `interface ListResult` - identical (settings:54-56 vs memory:42-44)
  - `function deliveryStatusVariant` - same name, same signature, same 5-arm mapping (settings:300-314 vs memory:67-82)
  - `AddWebhookDialog` - identical state, identical reset/handleClose/submit, identical `submitDisabled` boolean expression, identical AppModal shape (settings:436-... vs memory:470-...)
  - `DeliveriesSheet` - same concept, same query shape, differing only in base path (settings:319-... vs memory:310-...)
The genuine differences are two: the base path (`/v1/settings/webhooks` vs `/v1/dashboard/memory/webhooks`) and two extra capabilities on the memory side (delivery replay + a RecentDeliveriesBadge). Both are exactly what a third entry in WEBHOOK_CONTEXTS plus a `basePath` and a `capabilities` field would express - the map already carries per-context booleans (`deliveryNotice: null` for observability).

The cost is not aesthetic. `deliveryStatusVariant` is the webhook-delivery status vocabulary written twice; changing how a `failed` delivery is badged requires finding both, and nothing tells you the second exists. The same is true of the Delivery contract: the backend adds a status, one page renders it and the other falls through its `default:` arm. Pattern judgement is heuristic - a reviewer could reasonably argue memory webhooks is a distinct product surface - but the duplicated declarations are measured, not inferred.

Extracting is permitted by the enforced residence rule (src/lib/residence-rule.test.ts): a shared artifact needs 2+ consuming domains, and settings + memory + observability is three.

**Evidence**

```
THE DECLARED RULE — src/pages/settings/webhooks.tsx:69-76
 * M86 — the SAME webhooks CRUD is mounted in two contexts (Settings and Observability). Only the
 * COPY differs, so the component is parameterized by `context` rather than duplicated (reuse-first).
src/pages/settings/webhooks.tsx:86-105
const WEBHOOK_CONTEXTS: Record<WebhookContext, WebhookContextCopy> = {
  settings: { description: ..., events: AVAILABLE_EVENTS, deliveryNotice: {...} },
  observability: { description: ..., events: [{ id: "alert.threshold_breached", ... }], deliveryNotice: null },
};

THE THIRD MOUNT — src/routes/memory-routes.tsx:31
<Route path="/memory/webhooks" element={<Boundaried path="/memory/webhooks"><WebhooksPage /></Boundaried>} />
(vs settings-routes.tsx:73 <WorkspaceWebhooksPage /> and observability-routes.tsx:59 <WorkspaceWebhooksPage context="observability" />)

IDENTICAL DECLARATIONS —
src/pages/settings/webhooks.tsx:289-298        src/pages/memory/webhooks.tsx:46-55
interface Delivery {                          interface Delivery {
  id: string;                                   id: string;
  event_type: string;                           event_type: string;
  status: "pending" | "delivering" |            status: "pending" | "delivering" |
    "delivered" | "failed" | "dead_letter";       "delivered" | "failed" | "dead_letter";
  attempt_count: number;                        attempt_count: number;
  last_response_status?: number;                last_response_status?: number;
  last_error_message?: string;                  last_error_message?: string;
  created_at: string;                           created_at: string;
  completed_at?: string;                        completed_at?: string;
}                                             }

src/pages/settings/webhooks.tsx:300-314 / src/pages/memory/webhooks.tsx:67-82 — same name, same signature, same mapping:
function deliveryStatusVariant(s: Delivery["status"]): "default" | "success" | "warning" | "destructive"
  delivered -> success ; pending|delivering -> warning ; dead_letter -> destructive ; failed -> default

AddWebhookDialog — the identical predicate in both files:
  const submitDisabled = submitting || !/^https?:\/\//i.test(url) || label.trim() === "" || selected.size === 0;

wc -l -> settings/webhooks.tsx 521, memory/webhooks.tsx 555.
```

**Remediation**

Add `memory` as a third entry in WEBHOOK_CONTEXTS rather than a third file. The map needs two new fields the existing two contexts already imply: `basePath` (`/v1/settings/webhooks` | `/v1/dashboard/memory/webhooks`) and a capability flag for replay (observability/settings pass false, memory true) - the same shape as the existing `deliveryNotice: null` opt-out. Then delete src/pages/memory/webhooks.tsx and point src/routes/memory-routes.tsx:31 + src/app-routes-lazy.ts:82 at WorkspaceWebhooksPage context="memory". If the two surfaces are judged genuinely separate products, the minimum is still to lift `interface Webhook` / `interface Delivery` / `deliveryStatusVariant` into one shared module - they are one contract, and the residence rule permits it at 2+ consuming domains.

### [82] MEDIUM · code — Server-side offset pager copy-pasted across 5 pages in 2 domains (identical arithmetic + identical Prev/Next predicates); the copies have already drifted, one into Portuguese

**Location:** `src/pages/lens/sessions.tsx:58`

Five list screens implement the same server-side offset pagination independently. This is not the parallel-by-design shape of the 13 domain subtrees: the arithmetic is character-identical, the disabled predicates are character-identical, and the JSX is the same three elements in the same order.

Sites (arithmetic / pager JSX):
  src/pages/lens/sessions.tsx:58-60 / 215-225
  src/pages/lens/traces.tsx:226-227 / 424-433
  src/pages/lens/usage-by-user.tsx:164-166 / 470-479
  src/pages/lens/labeling-queue.tsx:87-90 / 194-205
  src/pages/settings/audit.tsx:115 / 304-329

The copying was conscious and written down instead of extracted. src/pages/settings/audit.tsx:57 says "Teto por pagina. Espelha SESSIONS_PAGE_SIZE (pages/lens/sessions.tsx:42)" and :68-69 says "Segue o padrao ja em uso em pages/lens/sessions.tsx:54-60 — mesmo PAGE_SIZE explicito, mesmo calculo de pageCount, mesma UI de navegacao." src/pages/lens/sessions.tsx:214 says "server-side pager (mirrors the M70 labeling-queue)". Three authors each recorded that they were reproducing an existing implementation; none of the three had a primitive to reach for.

The drift is already measurable, which is what makes this worth a finding rather than a style note:
  - src/pages/lens/usage-by-user.tsx:462 renders `Mostrando ${firstShown}–${lastShown} de ${total}` while its four siblings render `Showing … of …`. That is a Portuguese string on an English product surface, and src/lib/i18n-guard.test.ts is GREEN over it: the guard reads the syntax tree, and this template head is "Mostrando" (no accent, not in the marker word list) while the only other literal chunk is " de " which the length<=2 filter drops. The guard file declares this exact blind spot at src/test/i18n-guard.ts:62-64 ("`${n} itens` passaria"). A single shared pager component would carry this string once.
  - The count line is in three different shapes: `Showing A–B of N` (sessions:209, labeling-queue:195, traces:407), `Mostrando A–B de N` (usage-by-user:462), and `Page P of C · N records` (audit:308).
  - The pager visibility predicate differs: `pageCount > 1` (sessions, traces, usage-by-user, audit) vs `total > 0` (labeling-queue).
  - labeling-queue.tsx:95-97 carries a clamp effect (`if (query.data && !query.isFetching && page > pageCount) setPage(pageCount)`) that stops a filter change from stranding the user on a page that no longer exists. The other four do not have it. That is a behaviour fix that landed in one copy.

The design-system DataTable `pagination` prop does NOT solve this - it is client-side over an already-fetched array, and these five are server-side offset reads. The missing primitive is app-level: a `useOffsetPagination(total, pageSize)` hook returning { page, setPage, offset, pageCount, firstShown, lastShown } plus one `<OffsetPager>` component. Extraction is permitted by src/lib/residence-rule.test.ts - lens and settings are 2 consuming domains, and the rule requires 2+.

Pattern judgement is heuristic; the repetition and the four listed divergences are measured.

**Evidence**

```
IDENTICAL ARITHMETIC (only the PAGE_SIZE identifier differs):
src/pages/lens/sessions.tsx:58-60
  const pageCount = Math.max(1, Math.ceil(total / SESSIONS_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * SESSIONS_PAGE_SIZE + 1;
  const lastShown = Math.min(page * SESSIONS_PAGE_SIZE, total);
src/pages/lens/usage-by-user.tsx:164-166
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);
src/pages/lens/labeling-queue.tsx:88-90
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);
src/pages/settings/audit.tsx:115
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
src/pages/lens/traces.tsx:226-227
  const pageCount = Math.max(1, Math.ceil(total / TRACES_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * TRACES_PAGE_SIZE + 1;

IDENTICAL PREDICATES + JSX:
src/pages/lens/sessions.tsx:217-223
  <Button variant="ghost" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
  <span className="tabular-nums" data-testid="sessions-pager">{`Page ${page} / ${pageCount}`}</span>
  <Button variant="ghost" size="sm" disabled={page >= pageCount || query.isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
src/pages/lens/labeling-queue.tsx:197-203 — same three lines, data-testid absent
src/pages/settings/audit.tsx:311-326 — same two predicates, reformatted multi-line

THE AUTHORS RECORDED THE COPY:
src/pages/settings/audit.tsx:57   /** Teto por pagina. Espelha SESSIONS_PAGE_SIZE (pages/lens/sessions.tsx:42). */
src/pages/settings/audit.tsx:68-69 // Segue o padrao ja em uso em `pages/lens/sessions.tsx:54-60` — mesmo
                                   // PAGE_SIZE explicito, mesmo calculo de pageCount, mesma UI de navegacao.
src/pages/lens/sessions.tsx:214    {/* M81 — server-side pager (mirrors the M70 labeling-queue). */}

THE DRIFT:
src/pages/lens/usage-by-user.tsx:462   {`Mostrando ${firstShown}–${lastShown} de ${total}`}
src/pages/lens/sessions.tsx:209        {`Showing ${firstShown}–${lastShown} of ${total}`}
src/pages/lens/labeling-queue.tsx:195  {`Showing ${firstShown}–${lastShown} of ${total}`}
src/pages/settings/audit.tsx:308       Page {page} of {pageCount} · {total} records
src/pages/lens/labeling-queue.tsx:95-97 (clamp present in ONE copy only)
  useEffect(() => {
    if (query.data && !query.isFetching && page > pageCount) setPage(pageCount);
  }, [page, pageCount, query.data, query.isFetching]);
```

**Remediation**

Extract two artifacts and migrate the five sites: (1) `useOffsetPagination({ total, pageSize })` returning { page, setPage, offset, pageCount, firstShown, lastShown } and owning the labeling-queue clamp effect so every consumer inherits the fix; (2) `<OffsetPager page pageCount total firstShown lastShown busy onChange />` owning the Prev/Next buttons and the single English count string. Both belong in a shared location (residence rule satisfied: lens + settings). Migrating usage-by-user.tsx removes the Portuguese string as a side effect. Separately, consider whether src/test/i18n-guard.ts should register a template head even when no chunk carries an accent — "Mostrando" is a marker word the list happens to omit; adding `mostrando|mostrar|pagina de` closes this instance but the length<=2 filter on " de " remains the structural hole.

### [89] MEDIUM · code — Removing the Math.max(2,…) floor fixed zero-as-sliver and introduced the inverse: a real non-zero count renders invisible

**Location:** `src/components/charts/category-bars.tsx:54`

barWidths([3, 9000]) yields [0.0333, 100] — 0.1px on a 300px track, nothing painted. Memory's 'Activity today' shares one scale across its two bars, so 3 writes against 9000 retrievals reads to the operator as 'no writes today'; the old code drew ~6px. Neither the unit test (value 0 only) nor the page test (row text only) constrains geometry in either direction.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Measured: barWidths([3, 9000]) -> [0.0333, 100].
```

**Remediation**

Apply the floor to non-zero values only: v > 0 ? Math.max(min, pct) : 0. Why: it keeps both truths — zero draws nothing, and a real count is never invisible.

### [90] MEDIUM · code — The hand-rolled table has no thead and no column headers, a weaker accessible reading than the composite its docblock argues against

**Location:** `src/components/charts/category-bars.tsx:82`

Rendered outerHTML: <table><caption class=sr-only>…</caption><tbody><tr><th scope=row>ok</th><td class=w-full><div aria-hidden=true>…</div></td><td>10</td></tr>. In screen-reader table-navigation mode each row announces the label, then column 2 as blank (its only child is aria-hidden), then a bare number with no column header saying what it is — on memory, '1,284' with no unit. The docblock at lines 17-24 justifies the primitive on the grounds that the accessible reading is the primary one rather than a parallel copy, but TrendChart's companion table is built from the design system's Table/Table.Header with a real thead.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Measured outerHTML shows <tbody> with no <thead> and a td whose only child is aria-hidden.
```

**Remediation**

Add a thead with column headers, or reuse the design system's Table as TrendChart does. Why: the primitive's stated justification is accessibility, and it is currently less accessible than what it replaces.

### [91] MEDIUM · contract — The 4-variant tone API is entirely unasserted and sits inside an aria-hidden element while carrying enforcement meaning

**Location:** `src/components/charts/category-bars.tsx:95`

Replacing ${TONE[bar.tone ?? 'default']} with ${TONE.default} leaves category-bars + trust + promptly + rag at 36/36 passed; grep for tone/emerald/amber/muted across every test file referencing CategoryBars returns nothing. So an inverted trust mapping ships undetected. At runtime the coloured fill sits inside the aria-hidden=true track, so a screen-reader user on /trust hears 'credential_leak 40' with no hint it is unblocked — WCAG 1.4.1, colour alone — while skills/overview.tsx:158 states the house rule ('TEXTO, nunca só cor (WCAG 1.4.1)').

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Measured: TONE collapsed to default, 36/36 tests still pass; no test file references the tone vocabulary.
```

**Remediation**

Assert the tone mapping, and convey enforcement in text as the house rule already requires. Why: a semantic channel that is both untested and invisible to assistive tech carries meaning nobody can verify.

### [92] MEDIUM · code — The zero-sliver defect the CHANGELOG headlines as fixed has no regression test

**Location:** `src/pages/memory/overview.test.tsx:158`

Reintroducing the old floor exactly (category-bars.tsx:54 -> v === 0 ? 2 : (v/max)*100) leaves vitest run category-bars.test.tsx memory/overview.test.tsx at 18/18 passed. barWidths is exercised with [90,5,5], [0,0], [], [7], [10,-3,NaN,Inf] — never a genuine 0 paired with a positive max, which is the whole defect. The test asserts a row exists and never inspects a bar width. CHANGELOG.md:6 ships the claim with zero regression coverage, against rules/testing.md § 3 ('Every bug fix starts with a failing regression test').

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Measured: old floor restored, 18/18 pass.
```

**Remediation**

Add a case asserting width === 0 for a genuine zero beside a positive max. Why: rules/testing.md § 3 makes the failing-test-first order mandatory for a bug fix.

### [93] MEDIUM · code — The four 'a failed read draws no chart' tests assert only absence of a table role — which a chart rendered over a failure also produces

**Location:** `src/pages/skills/overview.test.tsx:184`

Deleting the {!query.error && !query.loading ? … : null} guard around the skills chart entirely, leaving the Card and its <h2>By category</h2> rendering over the error state, leaves all 10 tests passing. CategoryBars returns a <p> and no table whenever bars.length === 0 (category-bars.tsx:74-76), and each page derives empty bars on a failed read, so queryByRole('table') is null either way. Same shape at promptly/overview.test.tsx:232, trust/overview.test.tsx:156, rag/overview.test.tsx:68. B-129's DoD bullet 'no chart is rendered over a failed or unsettled read' is unprotected.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Measured: guard deleted, 10/10 still pass.
```

**Remediation**

Assert absence of the chart heading, not absence of a table role. Why: the current assertion is satisfied by both the intended and the defective rendering, so it cannot fail.

### [94] MEDIUM · code — The CATALOGO fixture enforces nothing, so the muted/Blocked path is never exercised and the comment claiming it is enforced is false

**Location:** `src/pages/trust/overview.test.tsx:39`

The fixture validator is {source:'platform', name:'credential-mask', kind:'rule', directions:['input','output']} — neither policy nor category. coverageGap (trust-series.ts:162-169) maps it to '', so enforcedPolicies.has('credential_leak') is false, kpis.blocked === 0 and kpis.unenforced === 1. The comment at overview.test.tsx:107 — 'that policy IS enforced by the catalogue fixture' — is therefore wrong, and the chart test at line 148 only ever exercises the amber branch. Inverting enforcedPolicies.has would turn the entire trust screen green while all 10 trust tests stay green.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Verified: CATALOGO.validators[0] has no policy and no category key; coverageGap resolves it to ''.
```

**Remediation**

Give the fixture a validator that actually enforces a policy present in the violations fixture, and correct the comment. Why: a test whose fixture cannot reach the branch it names proves nothing about that branch.

### [95] MEDIUM · code — The rendered() guard still matches a JSX tag inside a comment or string — the hole its own docblock claims it closed

**Location:** `src/lib/capability-overview.test.ts:76`

Executed against five inputs: {/* <CategoryBars /> */} -> true, // TODO: put a <CategoryBars/> back -> true, /* removed the <CategoryBars /> */ -> true, const s = "<CategoryBars />" -> true, real render -> true. The docblock at lines 60-71 records that the substring version let a COMMENT satisfy the check so 'the screen passed a chart check while rendering no chart', and memory/overview.tsx:234 is a live tombstone comment of exactly that genre. The guard also cannot see the property its failure message demands ('render it only on settled success'), which is how the four settled-success findings stayed green.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
Executed the literal regex against five inputs; comment and string-literal forms both return true.
```

**Remediation**

Strip comments and string literals before matching, or assert on the rendered output instead of the source. Why: a guard that its own docblock says was strengthened, and was not, is worse than none.

### [96] MEDIUM · naming — An English docblock was replaced with a Portuguese one, against the project's explicit English-artifacts rule

**Location:** `src/pages/memory/overview.tsx:234`

The project rule states that everything written into the projects is English — code, identifiers, comments, docstrings, documentation, commit messages — and that Portuguese found while working on a file should be translated rather than left. The aggravated case is here: the deleted block was English ('One labeled proportional bar (pure CSS, brand primary)…') and its replacement is Portuguese, in a file whose other added lines (135-160) are English. New Portuguese identifiers in the same commit: promptsPorAmbiente, linhas, ambientes, chaves, SEM_AMBIENTE (projections.ts:77-103), porAmbiente (promptly/overview.tsx:61), porCategoria (skills/overview.tsx:117, directly under an English comment). Same at memory/overview.test.tsx:147 (renderComMetricas). The commit demonstrably knows the rule — it translated 'Tentar novamente' to 'Try again' in the same diff.

PROVENANCE: external /code-review max (B-129 capability-overviews commit scope) — evidence VERIFIED BY EXECUTION by that reviewer, not by static reading. Imported into the phase-3 record by chief-reviewer with provenance preserved.

**Evidence**

```
memory/overview.tsx:234 — English docblock replaced by Portuguese; projections.ts:77-103 new Portuguese identifiers; same-diff translation of 'Tentar novamente' proves the rule was known.
```

**Remediation**

Translate the new identifiers and comments. Why: the codebase applied the rule in the same commit, so the divergence is inconsistency rather than an unknown convention.

### [97] MEDIUM · naming — pt-BR/English identifier mixing is a dated convention SHIFT, not drift: 4.5% -> 71.1% of new files in 2026-08

**Location:** `src/main.tsx:34`

MEASUREMENT (AST-based, TypeScript compiler over all 775 .ts/.tsx under src/; declaration nodes only, so string literals and JSX text are excluded).

Portuguese IDENTIFIERS: 677 declarations across 185 of 775 files (23.9% of files; 677/16,985 = 4.0% of all declarations).
Portuguese COMMENT blocks: 3,897 blocks across 404 of 775 files (52.1% of files).

THE MIXING IS STRATIFIED BY TIME, SHARPLY — binned by each file's git creation date (git log --diff-filter=A --follow, 775/775 files resolved, 0 unmatched):
  2026-04:  24 files,   1 with pt identifiers =  4.2%
  2026-06: 295 files,  11 with pt identifiers =  3.7%
  2026-07: 231 files,  13 with pt identifiers =  5.6%
  2026-08: 225 files, 160 with pt identifiers = 71.1%
Apr-Jul combined: 25/550 = 4.5%. August: 160/225 = 71.1%. A 16x step change, not a gradient.

COMMENTS follow a DIFFERENT curve — pt comments are long-standing, not new:
  2026-04: 66.7% | 2026-06: 34.2% | 2026-07: 29.4% | 2026-08: 97.3%
So pt COMMENTS are an established repo convention that intensified; pt IDENTIFIERS are a NEW behaviour that began in 2026-08.

IT IS DELIBERATE AND SELF-DOCUMENTED, NOT ACCIDENTAL. src/test/i18n-guard.ts:10 states 'Este repositorio **comenta em portugues por convencao**', and lines 27-30 extend this to names: 'nomes em portugues sao uma convencao deste repositorio - a mesma dos comentarios.' A three-legged AST guard (src/lib/i18n-guard.test.ts) additionally proves ZERO Portuguese reaches the USER INTERFACE, and deliberately does NOT flag comments. The user-facing layer is clean and machine-enforced; the divergence is strictly internal.

WHY IT IS STILL FILED: the project's stated convention (memory: 'All project artifacts in English - code, comments, identifiers, docs and commits') is contradicted. A local convention recorded only inside a test helper cannot override a global one, and the 16x August step means the two halves of the codebase now read differently. src/main.tsx is the sharpest witness: comments at L13-33 are English, L34-47 Portuguese, and L97 mixes both mid-sentence.

**Evidence**

```
src/main.tsx:29-33 (English, June-era):
// Mock infrastructure - gated by VITE_USE_MOCKS=true via dynamic import so
// Vite tree-shakes the entire mock layer (~27 KB) out of production builds.

src/main.tsx:34-38 (Portuguese, August-era, SAME comment block):
// A instalacao e AGUARDADA antes do render. Ela era `.then(...)` solto, e o
// `createRoot().render()` logo abaixo e sincrono - entao as primeiras queries
// disparavam ANTES do interceptador existir e escapavam para a rede.

src/main.tsx:97 (both languages in ONE sentence):
//                                    Theme crash nao derruba queries

src/main.tsx:48:
const prontoParaRenderizar =
```

**Remediation**

Decide and record the convention ONCE, in a place that outranks a test helper (CLAUDE.md or an ADR), then make it enforceable:
(a) If English is the standard: rename the 677 pt declarations. Highest-value first — src/routes (9/10 production files, exported symbols crossing into src/app.tsx) then src/lib and src/hooks. The existing AST guard in src/test/i18n-guard.ts is 90% of the machinery: extend varrerInterface to walk declaration nodes and assert names match /^[A-Za-z0-9_$]+$/ against an English lexicon, seeded with the current 185 files as a shrink-only allowlist (the same 'only shrinks' pattern already used by src/lib/adr-nomenclature.test.ts:77).
(b) If pt-BR internals are genuinely intended: promote that from i18n-guard.ts's docblock into CLAUDE.md as an explicit exception, and normalise the ~4.5% English-era holdouts so the codebase is internally consistent in one direction.
What must not persist is the current state, where both are true at once and the answer depends on which month a file was created.

### [98] MEDIUM · naming — src/pages: 402 Portuguese declarations in 96 files, 59 of them production (pt/en mixing inside single expressions)

**Location:** `src/pages/promptly/detail.tsx:421`

LAYER MEASUREMENT — src/pages (485 files: 270 production, 215 test).
  Files with pt identifiers:    96 (59 production, 37 test) = 19.8% of layer
  Files with pt comment blocks: 228 (141 production, 87 test) = 47.0% of layer
  pt declarations: 402 of 10,824 total declarations in the layer (3.7%)

This is the largest layer and the one where mixing is most visible per-line rather than per-file: single expressions carry both languages, so a reader switches language mid-identifier rather than mid-file. Concentrated in the promptly, lens and skills subtrees.

Bob Martin, Clean Code ch.2 ('Use Intention-Revealing Names' / 'Avoid Disinformation'): the cost is not the language itself but the absence of a single lexicon — a reader cannot predict whether the concept 'row' will appear as `row`, `linha` or `dependentesLinhas`, which defeats both search and autocomplete.

**Evidence**

```
src/pages/promptly/detail.tsx:421 — both languages inside ONE JSX prop list:
      <PainelDeAbas usoPorRevisao={usoPorRevisao} labels={labels} dependentesLinhas={dependentesLinhas} dependentes={dependentes} abaAtiva={abaAtiva} prompt={prompt} promptName={promptName} promptContent={promptContent} latestVersion={latestVersion} compoe={compoe} ponteiros={ponteiros} />

src/pages/lens/alerts.tsx:160 — pt name, en parameter:
function janelaEmDias(windowSeconds: number): number {

src/pages/lens/alerts.tsx:269-270:
  const razaoDoServico = ((create.error ?? toggle.error ?? remove.error) as ApiError | null)?.body;
  const mensagemDoServico =

src/pages/skills/catalog.tsx:56:
    const primeira = tokenAtual === undefined;
```

**Remediation**

Rename per the convention settled in the headline finding. Prioritise identifiers that cross a module boundary (exported types, component props such as `PainelDeAbas`'s `usoPorRevisao` / `abaAtiva` / `dependentesLinhas`) over function-local names — a local `primeira` costs one reader one line, an exported prop name costs every call site. No behavioural change; rename-symbol refactor covered by the existing suite.

### [99] MEDIUM · naming — src/routes: highest pt density in the codebase — 9 of 10 production files export Portuguese-named symbols consumed by src/app.tsx

**Location:** `src/routes/memory-routes.tsx:23`

LAYER MEASUREMENT — src/routes (12 files: 10 production, 2 test).
  Files with pt identifiers:    11 (9 production, 2 test) = 91.7% of layer  <-- highest density measured
  Files with pt comment blocks: 12 (10 production, 2 test) = 100% of layer
  pt declarations: 14 of 38 total declarations in the layer (36.8%)

This layer matters out of proportion to its size. Every one of these is an EXPORTED symbol that crosses into src/app.tsx, so the Portuguese is not contained — it appears in the application's top-level composition root, which is the first file a newcomer opens. The naming is also perfectly systematic (`rotasDe` + English domain name), which makes it cheap to rename mechanically and cheap to guard afterwards.

Note the hybrid shape: `rotasDeObservability`, `rotasDeProjects`, `rotasDeSettings` are half Portuguese, half English inside a single identifier.

**Evidence**

```
src/routes/memory-routes.tsx:23:
export const rotasDeMemory = (

The full set of exported route symbols (all production files in the layer):
  src/routes/memory-routes.tsx:23         rotasDeMemory
  src/routes/observability-routes.tsx:30  rotasDeObservability
  src/routes/profile-routes.tsx:17        rotasDeProfile
  src/routes/projects-routes.tsx:63       rotasDeProjects
  src/routes/promptly-routes.tsx:39       rotasDePromptly
  src/routes/rag-routes.tsx:21            rotasDeRag
  src/routes/settings-routes.tsx:19       rotasDeSettings
  src/routes/skills-routes.tsx:20         rotasDeSkills

Consumed in src/app.tsx:10-15 and rendered at :156/:178/:203/:212:
import { rotasDeProjects } from '@/routes/projects-routes';
import { rotasDeTrust } from '@/routes/trust-routes';
import { rotasDeMemory } from '@/routes/memory-routes';
```

**Remediation**

Start the rename here — it is the best effort-to-value ratio in the codebase: 8 exported symbols, one mechanical pattern (`rotasDeX` -> `xRoutes`, e.g. `rotasDeMemory` -> `memoryRoutes`), a single importer (src/app.tsx), and full coverage from src/routes/subtree-wiring.test.tsx which asks react-router itself whether every subtree still resolves. Doing this layer first also removes the Portuguese from the composition root, where it is most visible.

### [100] MEDIUM · naming — src/lib: 122 Portuguese declarations in 31 files — including exported infrastructure such as purgarCachesDeDados()

**Location:** `src/lib/auth/logout-cache-purge.ts:72`

LAYER MEASUREMENT — src/lib (68 files: 28 production, 40 test).
  Files with pt identifiers:    31 (9 production, 22 test) = 45.6% of layer
  Files with pt comment blocks: 49 (21 production, 28 test) = 72.1% of layer
  pt declarations: 122 of 2,247 total declarations in the layer (5.4%)

src/lib is the shared-infrastructure layer — auth, http, mocks, theme, telemetry — so its exported names are the vocabulary every other layer must speak. A Portuguese export here propagates to every importer, unlike a Portuguese local inside a page component.

The pt weight in this layer sits mostly in tests (22 of 31 files), which are the architectural guard tests (data-access-layer.test.ts, adr-nomenclature.test.ts, parent-barrel-import.test.ts) whose assertion messages are long Portuguese prose.

**Evidence**

```
src/lib/auth/logout-cache-purge.ts:72 — exported, pt verb + pt noun:
export async function purgarCachesDeDados(): Promise<void> {

src/lib/mocks/lens-handlers.ts:50-51:
/** As regras criadas na sessao - escopo de CARGA DA PAGINA, como o cursor de `/connect`. */
const regrasDeAlerta: Record<string, unknown>[] = [];

src/lib/theme/theo-theme.ts — exports TEMA_THEO, consumed at src/main.tsx:5 and src/test/render.tsx:44:
import { TEMA_THEO } from '@/lib/theme/theo-theme';
```

**Remediation**

Rename exported symbols first (`purgarCachesDeDados` -> `purgeDataCaches`, `TEMA_THEO` -> `THEO_THEME`); module-local names such as `regrasDeAlerta` inside a mock handler are lower priority because they never appear in an importer. Test-internal prose can be left to the convention decision in the headline finding — it is read only by whoever is already debugging that test.

### [101] MEDIUM · naming — src/hooks: 75 Portuguese declarations in 29 files — exported React hooks and types mix languages (useCriarDatasetDeRegressao, ChaveDeAtributo)

**Location:** `src/hooks/lens/use-traces.ts:51`

LAYER MEASUREMENT — src/hooks (134 files: 82 production, 52 test).
  Files with pt identifiers:    29 (18 production, 11 test) = 21.6% of layer
  Files with pt comment blocks: 81 (52 production, 29 test) = 60.4% of layer
  pt declarations: 75 of 2,897 total declarations in the layer (2.6%)

The notable shape here is the `use` + Portuguese-verb hybrid: React's ecosystem convention fixes the `use` prefix in English, so the remainder of the name is where the language switch lands, producing identifiers that are English-prefixed and Portuguese-bodied. Exported types (`ChaveDeAtributo`, `EntradasDaFSM`) carry the same shape into every consumer's type annotations.

**Evidence**

```
src/hooks/lens/use-traces.ts:51 — exported hook, en prefix + pt body + en callback param:
export function useCriarDatasetDeRegressao(onCriado: (datasetId: string) => void) {

src/hooks/lens/traces-api.ts:56 — exported interface, pt name + en members:
export interface ChaveDeAtributo {
  key: string;
  count: number;

src/hooks/deploy/fetch-event-source.ts:195:
    for (const linha of bruto.split('\n')) {

src/hooks/projects/use-project-connection.ts:8:
  type EntradasDaFSM,
```

**Remediation**

Rename exported hooks and types (`useCriarDatasetDeRegressao` -> `useCreateRegressionDataset`, `ChaveDeAtributo` -> `AttributeKey`, `EntradasDaFSM` -> `FsmInputs`). These appear in consumers' import statements and type positions, so they are the ones that tax readers who never open this layer. Loop-locals such as `linha` are cosmetic by comparison.

### [104] MEDIUM · code — ExploreCard copy-pasted into 3 domain overviews and already DIVERGED: lens navigates via SPA <Link>, memory/rag still force a full page reload

**Location:** `src/pages/memory/overview.tsx:255`

The same presentational component `ExploreCard` (identical props: icon/title/description/href, identical Card > Card.Body > Icon > h3 > p markup) is declared three times:
  src/pages/lens/overview.tsx:253
  src/pages/memory/overview.tsx:255
  src/pages/rag/overview.tsx:193

This is NOT the benign parallel-structure-across-domains case: the three copies are the SAME generic card with no domain-specific logic whatsoever.

THE COPIES HAVE ALREADY DIVERGED, AND THE DIVERGENCE IS USER-VISIBLE. The lens copy was fixed to use a router `<Link>` and carries a comment recording why ('not `window.location.href` (which forced a full reload)'). The memory and rag copies still call `window.location.href = href`, so clicking an Explore card on the Memory or RAG overview performs a full document reload — discarding the SPA router state, the React Query cache and the auth channel — while the identical control on the Lens overview does not. This is precisely the failure DRY predicts: a fix applied to one copy of duplicated knowledge and not the others.

The copies have also diverged in typing: lens declares `icon: LucideIcon`, rag declares `icon: typeof Boxes`.

Two of the three copies carry a comment justifying the duplication under the Rule of 3, and that justification is now factually stale — there are three, and memory's claim that 'no other dashboard surface currently shows Explore cards in this exact shape' is contradicted by the other two files. rag/overview.tsx:192 also cites `pages/memory.tsx`, a path that no longer exists (the file is src/pages/memory/overview.tsx).

**Evidence**

```
src/pages/lens/overview.tsx:251-262 (FIXED copy):
/** Single Explore card - icon + title + 1-line description + a destination link.
 * Uses a router `<Link>` (SPA nav) - not `window.location.href` (which forced a full reload). */
function ExploreCard({ icon: Icon, title, description, href }: ExploreCardProps) {
        <Button asChild variant="ghost" size="sm">
          <Link to={href}>Open -></Link>

src/pages/memory/overview.tsx:249-262 (UNFIXED copy, stale justification):
/**
 * Single Explore card. Renders an icon + title + 1-line description + a
 * destination button. Kept inline here (NOT extracted to a shared component)
 * because no other dashboard surface currently shows Explore cards in this
 * exact shape - Rule of 3 / YAGNI.
 */
        <Button variant="ghost" size="sm" onClick={() => (window.location.href = href)}>

src/pages/rag/overview.tsx:191-200 (UNFIXED copy, stale path reference):
/** Single Explore card - icon + title + 1-line description + a destination button.
 * Kept inline (mirrors `pages/memory.tsx`'s ExploreCard - Rule of 3 / YAGNI). */
        <Button variant="ghost" size="sm" onClick={() => (window.location.href = href)}>
```

**Remediation**

Fix the defect first, then remove its cause. (1) Immediately change memory/overview.tsx:262 and rag/overview.tsx:200 to the `<Button asChild><Link to={href}>` form already proven in lens/overview.tsx:260-262 — this is a user-visible navigation bug, independent of any refactor. (2) Extract the single component to src/components/ui/explore-card.tsx (the Rule of 3 threshold the comments themselves invoke is now met at exactly 3) with `icon: LucideIcon`, and delete the three local declarations. (3) Delete the two stale justification comments rather than porting them, and note that rag/overview.tsx:192's reference to `pages/memory.tsx` is already a dangling path.

### [105] MEDIUM · code — AddWebhookDialog duplicated between memory and settings, including the webhook-URL validation rule — and settings already holds the generalised version

**Location:** `src/pages/memory/webhooks.tsx:470`

`AddWebhookDialog` exists twice with near-identical bodies:
  src/pages/memory/webhooks.tsx:470
  src/pages/settings/webhooks.tsx:436

Duplicated across both: the local state triple (url/label/selected), `reset`, `handleClose`, `submit`, and — the part that makes this a DRY violation of KNOWLEDGE rather than of layout — the validation predicate, character for character:
  submitting || !/^https?:\/\//i.test(url) || label.trim() === '' || selected.size === 0

'What makes a webhook registration valid' is one business rule living in two files. If the rule changes (require https only, enforce a max label length, allow zero events), one copy will be updated and the other will silently keep the old contract — the same class of divergence already realised in the ExploreCard finding.

The refactor is unusually cheap because it is already half-done: the settings copy has been PARAMETERISED (it accepts `description` and `events` props and guards with `events[0]?.id ?? ''`), while the memory copy still hardcodes `AVAILABLE_EVENTS[0].id` and a memory-specific description string. The settings version is strictly the more general of the two and can absorb the memory call site as-is.

**Evidence**

```
src/pages/memory/webhooks.tsx:486-492:
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    onSubmit({ url, label: label.trim(), events: Array.from(selected) });
  };
  const submitDisabled = submitting || !/^https?:\/\//i.test(url) || label.trim() === '' || selected.size === 0;

src/pages/settings/webhooks.tsx:452-458 — identical logic, already generalised signature:
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    onSubmit({ url, label: label.trim(), events: Array.from(selected) });
  };
  const submitDisabled = submitting || !/^https?:\/\//i.test(url) || label.trim() === '' || selected.size === 0;

The signatures, showing settings is the superset:
  memory:470   function AddWebhookDialog({ open, onClose, submitting, onSubmit }: AddWebhookDialogProps)
  settings:436 function AddWebhookDialog({ open, onClose, submitting, onSubmit, description, events }: AddWebhookDialogProps)
```

**Remediation**

Promote the settings/webhooks.tsx version verbatim to a shared module (e.g. src/components/dialogs/add-webhook-dialog.tsx), have both pages import it, and pass memory's `AVAILABLE_EVENTS` and its description string as the `events` / `description` props it already accepts. Extract the validation predicate into one named exported function (e.g. `isWebhookSubmittable`) so the URL rule has a single home and a single test. Hunt & Thomas, DRY: every piece of knowledge needs one unambiguous representation.

### [106] MEDIUM · code — SLO tone thresholds (uptime 99.9/99.0, p95 500/1000ms, error rate 1/5) duplicated between two components rendered on the SAME page

**Location:** `src/pages/projects/components/kpi-strip-status.tsx:74`

`KPIStripStatus` and `SignalGrid` both map the same four project-health metrics to the same success/warning/destructive tones, using the same unnamed numeric thresholds, in two files:

  metric       kpi-strip-status.tsx   signal-grid.tsx    thresholds
  uptime_24h   :74-79                 :124-129           >=99.9 success, >=99.0 warning, else destructive
  p95_latency  :88-93                 :136-141           >=1000 destructive, >=500 warning, else success
  error_rate   :81-86                 :148-152           >=5 destructive, >=1 warning, else success
  replicas     :108                   :113-117           ===0 destructive, else success

Both components are rendered TOGETHER on the same screen — src/pages/projects/project-status.tsx:265 (<KPIStripStatus .../>) and :275 (<SignalGrid .../>). The user therefore sees the same metric twice, coloured by two independent implementations of one rule. If an SLO is retuned in one file only, the KPI card and the pill for the SAME signal will disagree on the same screen — a self-contradiction the user can observe directly.

These numbers are genuine business thresholds, not self-evident constants: 99.9 and 500ms encode an SLO decision, unlike the 60/3600/86400/1024 conversions elsewhere in the codebase which need no name. signal-grid.tsx:26 already calls them 'canonical thresholds' — a single source of truth the code does not actually have.

**Evidence**

```
src/pages/projects/components/kpi-strip-status.tsx:74-93:
function uptimeTone(uptime: number | null | undefined): Tone {
  if (typeof uptime !== 'number' || !Number.isFinite(uptime)) return 'muted';
  if (uptime >= 99.9) return 'success';
  if (uptime >= 99.0) return 'warning';
  return 'destructive';
}
function p95Tone(latencyMs: number | null | undefined): Tone {
  if (latencyMs >= 1000) return 'destructive';
  if (latencyMs >= 500) return 'warning';

src/pages/projects/components/signal-grid.tsx:124-141 — same numbers, second implementation:
    tone: (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'muted';
      if (v >= 99.9) return 'success';
      if (v >= 99.0) return 'warning';
      return 'destructive';
    },
      if (v >= 1000) return 'destructive';
      if (v >= 500) return 'warning';

src/pages/projects/components/signal-grid.tsx:26 — asserts a canonicality that does not exist:
 * Color-by-state: per-signal tone based on canonical thresholds (uptime,

src/pages/projects/project-status.tsx:265 and :275 — both rendered on one page:
          <KPIStripStatus
          <SignalGrid signals={signals} onDrillDown={handleDrillDown} />
```

**Remediation**

Create one module (e.g. src/pages/projects/components/signal-tone.ts) exporting named constants and the tone functions — `UPTIME_SLO_TARGET = 99.9`, `UPTIME_SLO_WARNING = 99.0`, `P95_LATENCY_CRITICAL_MS = 1000`, `P95_LATENCY_WARNING_MS = 500`, `ERROR_RATE_CRITICAL_PCT = 5`, `ERROR_RATE_WARNING_PCT = 1` — and have both components import `uptimeTone`/`p95Tone`/`errorRateTone` from it. The named constants also make the SLO reviewable by someone who does not read TSX, and make signal-grid.tsx:26's 'canonical thresholds' claim true.

### [108] MEDIUM · code — ConfirmDialog owns type-to-confirm (confirmationPhrase) and is used by 32 files, but 6 destructive dialogs re-implement the gate locally — and 5 of the 6 dropped the deliberate focus-Cancel safety behaviour

**Location:** `src/pages/infra/components/delete-secret-dialog.tsx:41`

src/components/dialogs/confirm-dialog.tsx is the declared canonical destructive-confirmation ("Canonical destructive-action confirmation dialog", :3). Its contract already includes the phrase gate - `confirmationPhrase?: string` (:30) with the input, the exact-match predicate, Enter-to-submit, the busy state, an error Alert on a rejected onConfirm, and a documented safety decision: "Focuses Cancel on open (deliberate — never the destructive button)" (:34-35, implemented :57-63). 32 page files consume it.

Six destructive dialogs implement the same phrase gate by hand instead:
  src/pages/infra/components/delete-environment-dialog.tsx:73-78 (env name)
  src/pages/infra/components/delete-secret-dialog.tsx:41-52 (secret name)
  src/pages/infra/components/rotate-secret-dialog.tsx:42-55 (secret name)
  src/pages/deploy/components/rollback-dialog.tsx:25,52 ("rollback production")
  src/pages/deploy/components/promote-to-production-dialog.tsx:29,67 ("promote to production")
  src/pages/projects/components/bulk-delete-projects-dialog.tsx:41-48 ("delete N projects")
Each re-declares the same three things: a `useState` for the typed text, an equality predicate against a phrase, and a `disabled={!matches || pending}` on the destructive button. All six already render inside AppModal, so what is being avoided is not the modal - it is only ConfirmDialog\u0027s prop surface.

One of the six justifies itself with a rationale that is no longer true. delete-environment-dialog.tsx:43-44: "Replaces the v1.0 ConfirmDialog which had no type-to-confirm + no cascade warning." ConfirmDialog has had `confirmationPhrase` since; the file explains its existence by an absence that has been filled. That is the stale-rationale shape the team itself named and refused elsewhere - src/components/ui/app-modal.tsx:18-22 re-measured its own Rule-9 justification and rewrote it rather than let it stand ("Leaving the old rationale in place would have been a Rule-9 justification that stopped being true").

The copies have already drifted on the one behaviour ConfirmDialog documents as deliberate. Only delete-environment-dialog.tsx:75,92 reproduces the focus-Cancel-on-open (`setTimeout(() => cancelRef.current?.focus(), 0)`). The other five do not:
  - delete-secret-dialog.tsx:125, rotate-secret-dialog.tsx:125, rollback-dialog.tsx:166 and promote-to-production-dialog.tsx:196 put `autoFocus` on the CONFIRM INPUT instead.
  - bulk-delete-projects-dialog.tsx:43 declares `const cancelRef = useRef<HTMLButtonElement | null>(null)` and passes it at :91 but NEVER focuses it - the ref is dead. Someone copied the shape of the safety behaviour without the effect that makes it work, which reads as present in review and is absent at runtime.
The result is that "which element is focused when a destructive confirmation opens" has three different answers across the product, and the reason the canonical picked Cancel (WCAG 2.2 AA, per delete-environment-dialog.tsx:50-51) is stated in exactly one of them.

Pattern judgement is heuristic. Two of the six have a real extra requirement - bulk-delete needs partial-failure reporting, rollback has a second `ack` checkbox - but neither is beyond ConfirmDialog\u0027s contract: it keeps the dialog open and renders the thrown Error message (:75-95), which is precisely the partial-failure path bulk-delete hand-rolls.

**Evidence**

```
CANONICAL — src/components/dialogs/confirm-dialog.tsx:30,34-35,50-63
  confirmationPhrase?: string;
  /** ConfirmDialog — centered confirmation modal. Focuses Cancel on open (deliberate — never
   *  the destructive button). `confirmationPhrase` gates confirm behind exact type-to-confirm. */
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) { setTyped(""); setErro(null);
      const t = setTimeout(() => cancelRef.current?.focus(), 0);   // Focus Cancel on open, not the destructive action.
  const phraseOk = !phraseRequired || typed === confirmationPhrase;

RE-IMPLEMENTED (same three declarations, six times):
src/pages/infra/components/delete-secret-dialog.tsx:41,52,100
  const [confirmInput, setConfirmInput] = useState("");
  const canDelete = secret !== null && confirmInput === secret.name;
  disabled={!canDelete || submitting}
src/pages/infra/components/rotate-secret-dialog.tsx:42,55,104
  const [confirmInput, setConfirmInput] = useState("");
  const canRotate = secret !== null && confirmInput === secret.name && newValue.length > 0;
  disabled={!canRotate || submitting}
src/pages/projects/components/bulk-delete-projects-dialog.tsx:41,47-48
  const [confirmText, setConfirmText] = useState("");
  const phrase = confirmPhrase(projectNames.length);
  const matches = confirmText === phrase;
src/pages/infra/components/delete-environment-dialog.tsx:73,78
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText === envName;
src/pages/deploy/components/rollback-dialog.tsx:25,52,145
  const CONFIRMATION_PHRASE = "rollback production";
  if (requiresPhrase && phrase !== CONFIRMATION_PHRASE) { setError(...) }
  disabled={(requiresPhrase && phrase !== CONFIRMATION_PHRASE) || (!isProd && !ack)}
src/pages/deploy/components/promote-to-production-dialog.tsx:29,67,175
  const CONFIRMATION_PHRASE = "promote to production";
  if (phrase !== CONFIRMATION_PHRASE) { setError(...) }
  disabled={phrase !== CONFIRMATION_PHRASE}

THE STALE RATIONALE — src/pages/infra/components/delete-environment-dialog.tsx:43-44
 * Replaces the v1.0 ConfirmDialog which had no type-to-confirm + no cascade
 * warning.                                   <-- ConfirmDialog:30 has confirmationPhrase today

THE DRIFT — focus on open:
  delete-environment-dialog.tsx:75,92,140  cancelRef + setTimeout(...focus(), 0) + ref=      [matches canonical]
  delete-secret-dialog.tsx:125             autoFocus on the confirm Input                    [diverged]
  rotate-secret-dialog.tsx:125             autoFocus on the confirm Input                    [diverged]
  rollback-dialog.tsx:166                  autoFocus on the confirm Input                    [diverged]
  promote-to-production-dialog.tsx:196     autoFocus on the confirm Input                    [diverged]
  bulk-delete-projects-dialog.tsx:43,91    cancelRef declared and passed, NEVER focused      [dead ref]
grep -c "cancelRef|\\.focus()" -> delete-environment 3, the other four bespoke dialogs 0.
```

**Remediation**

Migrate the six to `<ConfirmDialog confirmationPhrase={...} intent="destructive" onConfirm={...} />`, keeping only the genuinely extra body content as children (cascade warning, the rollback `ack` checkbox, the new-value field for rotate). For bulk delete, throw an Error carrying the partial-failure message from onConfirm — ConfirmDialog:88-95 already keeps the dialog open and renders it. Where a dialog truly cannot migrate, delete the stale rationale at delete-environment-dialog.tsx:43-44 and state the real reason. Then add a guard in the shape of src/components/ui/modal-primitive.test.ts, which already proves this repo knows how to close the class: a production file that renders a destructive-intent Button gated by an equality against a typed string must import ConfirmDialog, or carry an explicit marker naming why not. Without it, the seventh bespoke confirmation lands with whatever focus behaviour its author happens to pick.

### [54] LOW · security — Flow id from the URL interpolated into a request URL without encodeURIComponent

**Location:** `src/pages/auth/kratos.ts:57` · **NFR:** security

`flowId` originates from the browser query string (`searchParams.get('flow')`) and is concatenated straight into the request URL. A value containing `&` or `#` splits or truncates the query, letting an attacker-crafted link change the parameters the dashboard sends to the identity service (parameter pollution). Same untreated interpolation at src/pages/auth/login.tsx:107, src/pages/auth/verification.tsx:101 and :64, and src/pages/auth/recovery.tsx:283 (where the id is first pulled out of a server-supplied redirect URL with `/[?&]flow=([^&\s]+)/`, which admits quotes and `#`). Impact is limited because the destination host is fixed and Kratos rejects unknown flow ids, so this is hardening rather than an exploitable hole today.

**Evidence**

```
const resp = await fetch(`${ACCOUNTS_URL}/self-service/${flowType}/flows?id=${flowId}`, {
    credentials: 'include',
  });
```

**Remediation**

Build the URL with URLSearchParams or wrap the value: `?id=${encodeURIComponent(flowId)}`. Apply at all five call sites; a single `flowUrl(flowType, id)` helper in kratos.ts would remove the possibility of missing one.

### [55] LOW · complexity — isSafeRedirectUrl has measured CC 14 for a single-predicate security guard

**Location:** `src/pages/auth/safe-redirect.ts:57` · **CC:** 14.0 · **NFR:** security

lizard reports CCN=14 for `isSafeRedirectUrl` (25 NLOC, the only function in the file). McCabe complexity on a boolean security predicate matters more than on ordinary code: 14 independent paths is 14 opportunities for a bypass, and only some are exercised by the unit tests (the docblock records that the relative-path path was missed by the unit suite and only caught by an e2e). The logic itself reads correct — I could not construct a bypass (`javascript:`, `//evil.com`, `https://allowed@evil.com`, backslash and userinfo variants all resolve to a rejected origin) — but the branch count is driven by repeated `typeof window !== 'undefined'` guards (lines 84, 91, 99) interleaved with the protocol and origin decisions.

**Evidence**

```
if (url.protocol !== 'https:' && typeof window !== 'undefined') {
    if (window.location.origin !== url.origin) {
      return false;
    }
  }
  if (typeof window !== 'undefined' && url.origin === window.location.origin) {
    return true;
  }
```

**Remediation**

Hoist the environment check once (`const origin = typeof window === 'undefined' ? null : window.location.origin;`) and express the rule as a flat sequence of guard clauses over `origin` — same behaviour, roughly half the branches, and every path visible in one screen. Add table-driven tests over the bypass corpus (javascript:, data:, //host, \\host, userinfo@, uppercase host, port variants) so the branch count is matched by test coverage.

### [56] LOW · complexity — reportError has measured CC 16 from three nested swallow layers

**Location:** `src/lib/telemetry/error-reporter.ts:21` · **CC:** 16.0

lizard reports CCN=16 for `reportError` (34 NLOC), driven by two nested try/catch blocks, a DEV branch, a sendBeacon/fetch fallback chain and four `??` fallbacks. The never-throw invariant that motivates the nesting is legitimate and documented, but the current shape means a genuine bug inside the payload construction is indistinguishable from a blocked transport — both end in a silent swallow, and the reporter cannot report on itself.

**Evidence**

```
export function reportError(error: Error, info: ErrorInfo): void {
  try {
    if (errorsThisSession >= MAX_ERRORS_PER_SESSION) return;
    errorsThisSession++;
```

**Remediation**

Extract `buildPayload(error, info)` and `dispatch(body)` so each has one reason to fail, keep the single outer try/catch on the composed call, and increment an in-memory `reporterFailures` counter in the outer catch so a systematically broken reporter is at least visible to the next successful beacon.

### [57] LOW · code — mapKratosError console.errors on every call, including from a render path

**Location:** `src/pages/auth/error-mapper.ts:135`

`mapKratosError` is documented as a pure table lookup (ADR D1) but opens with an unconditional `console.error` of the raw payload, not gated by `import.meta.env.DEV`. src/pages/auth/login.tsx:341 calls it inside JSX during render, so every re-render of the login page while the enumeration banner is showing writes another console.error — for a case that is not an error at all (`account_enumeration_mitigation` is expected copy). The table also contains non-error outcomes (`browser_location_change_required`, `session_already_available`) that are logged at error level. Side effects in a function declared pure violate the SRP framing of its own ADR, and unconditional error logging in production is the noise that makes real errors hard to find.

**Evidence**

```
export function mapKratosError(input: KratosErrorInput | null | undefined): KratosErrorMapped {
  console.error('[auth.error-mapper]', input);
```

**Remediation**

Gate the log (`if (import.meta.env.DEV) console.debug(...)`) or move it to the call site that actually handles the error, keeping the mapper pure. If operator debuggability in production is the goal (ADR D2), route it through `reportEvent` rather than console.error so it is collectable rather than merely printed.

### [58] LOW · code — Web Vitals reporter logs to console in production instead of beaconing

**Location:** `src/lib/telemetry/rum.ts:30` · **NFR:** performance

`initWebVitals` selects `reportInProd` when `import.meta.env.DEV` is false, but `reportInProd` just delegates to `reportInDev`, which unconditionally `console.log`s every LCP/INP/CLS sample. The module header claims 'prod mode = future POST to /v1/telemetry/web-vitals'; in reality production users get console output and the telemetry endpoint is never called, so the ADR D8 claim of 'ship the RUM reporter day-1' is not met by the running code.

**Evidence**

```
function reportInProd(metric: Metric): void {
  // Prod: POST to telemetry endpoint when backend ships /v1/telemetry/web-vitals
  // For now: same as dev (console). Future:
  //   navigator.sendBeacon('/v1/telemetry/web-vitals', JSON.stringify(metric))
  reportInDev(metric);
}
```

**Remediation**

Either implement the beacon (the sibling `reportEvent` in the same file already has the sendBeacon/fetch fallback to reuse) or make `reportInProd` a no-op and drop the misleading header claim. Silent console noise in production is the worst of the three options.

### [59] LOW · code — HTTP client builds a DOM toast and hardcodes a 2000 ms redirect delay

**Location:** `src/lib/http/api.ts:256`

`redirectToLogin` — inside the single outbound HTTP module, imported by ~151 files — creates a div, writes an inline style string and schedules `window.location.href` behind a bare `2000`. Two problems: SRP (the API client owns presentation, so the session-expiry notice cannot be themed, tested through the design system, or made accessible — it has no role="alert" and screen readers will not announce it), and the unnamed literal 2000, which is the user-visible dwell time of the only notice they get before losing their page. `redirecting` is also a module-global latch that is never reset, so the module is single-use per page load by design but nothing documents that.

**Evidence**

```
toast.style.cssText = 'position:fixed;top:16px;right:16px;background:#1a1a1a;color:white;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    toast.textContent = 'Session expired. Redirecting to login...';
    document.body.appendChild(toast);
    setTimeout(() => { window.location.href = `/login${params}`; }, 2000);
```

**Remediation**

Name the constant (`const SESSION_EXPIRY_NOTICE_MS = 2_000;`) and move the notice out of the HTTP layer: dispatch a `theo:session-expired` window event (the 402 interceptor 12 lines below already uses exactly this pattern) and let a top-level component render it through the design system with role="alert".

### [61] LOW · contract — Stale docblock claims the JWT travels in `?token=` — contradicted 140 lines below in the same file

**Location:** `src/hooks/deploy/use-sse-stream.ts:25` · **NFR:** security

The module header still documents the pre-B-088 design ('Auth: SSE cannot set custom headers, so the JWT travels in `?token=`'). The production code no longer does this: line 175 builds `${API_URL}${path}` with no query credential, and the token is handed to SharedEventSource -> FetchEventSource, which sets `Authorization: Bearer` (src/hooks/deploy/fetch-event-source.ts:128). I verified the fix holds: the repo-wide guard src/hooks/sse-token-in-url.test.ts has an EMPTY allowlist and no production file matches the credential-in-URL patterns. The defect is documentation about a security control, and it is the worst kind: a reader auditing 'where does the JWT go?' finds an authoritative-sounding claim that the token is in the URL, contradicted only by a comment 140 lines further down. It also invites the next stream author to copy a pattern that ADR-0009 removed — exactly the propagation sse-token-in-url.test.ts exists to stop.

**Evidence**

```
* Auth: SSE cannot set custom headers, so the JWT travels in `?token=`.
 * That matches the BFF pattern in use-log-stream (T6.0 of the older
 * backend-frontend integration plan).
```

**Remediation**

Replace the paragraph with the current contract: 'Auth: the JWT goes in the Authorization header — the transport is fetch + ReadableStream (fetch-event-source.ts), not EventSource. See ADR-0009 / B-088.' Also revisit the sibling claim at src/hooks/projects/use-status-stream.ts:21 which references the same retired pattern.

### [74] LOW · contract — SharedEventSource keys the registry on URL alone — a second subscriber's token and resume cursor are silently discarded

**Location:** `src/hooks/deploy/shared-event-source.ts:113`

The constructor looks the URL up in the module registry and, on a hit, joins the existing entry and returns before `abrirNova` is ever consulted. The `opcoes` it was handed — `token` and `lastEventId` — are stored on the instance and never used again. Two consumers of the same URL that disagree about the resume point therefore both receive the FIRST subscriber's cursor, with no warning. That is reachable: DeployTimelineHero (pages/deploy/components/deploy-timeline-hero.tsx:79) and BuildTimelineLive (pages/deploy/components/build-timeline-live.tsx:98) each pass their own `initialLastEventID` prop into useDeploymentStream, and the connection-budget test documents that they resolve to the same URL in the normal case. The same applies to the token after a refresh: a joiner with a fresh JWT inherits a connection opened with the older one. The docblock (lines 27-37) carefully explains replay and error eviction as 'as duas regras que nao sao obvias' but does not mention that per-subscriber options are dropped.

**Evidence**

```
const existente = registro.get(url);
    if (existente) {
      this.entrada = existente;
      existente.handles.add(this);
      // O consumidor ainda vai atribuir `onmessage`/`addEventListener` DEPOIS
      // do construtor. Entregar o replay agora chegaria antes dos handlers
      // existirem — por isso ele sai numa microtask.
      queueMicrotask(() => this.recuperarAtraso());
      return;
    }
```

**Remediation**

Include the resume cursor in the registry key (`${url}|${lastEventId ?? ''}`) so subscribers that disagree get their own connection, or — cheaper and probably right here — document the rule explicitly and normalize at the caller: since the entry's replay buffer already delivers everything the connection has seen, a joiner's cursor is genuinely redundant, so state that in the docblock and drop `lastEventId` from the joining path deliberately rather than by omission.

### [75] LOW · contract — useSSEStream returns a fresh object and a fresh clear() on every render, propagating identity churn to consumers

**Location:** `src/hooks/deploy/use-sse-stream.ts:262`

The hook returns an object literal with an inline arrow for `clear`, neither memoized. Every render of a consumer produces a new `stream` reference and a new `stream.clear` reference. useLogStream does the same (use-log-stream.ts:103), and the churn then lands in a dependency array: use-build-logs.ts:232 declares `const clear = useCallback(..., [stream])`, so the memoization there is unconditionally defeated and the `clear` handed to logs-tab.tsx is new on every render. Nothing breaks today because no consumer puts `clear` in an effect dependency array, but the hook publishes `clear` as part of its public result type and a caller doing so would get an effect that re-runs forever. The sibling hooks in this slice do memoize their results (use-status-stream.ts:81, use-deployment-stream.ts:84), so the inconsistency is internal.

**Evidence**

```
return {
    events,
    connected,
    error,
    lastEventID,
    droppedCount,
    clear: () => {
      bufferRef.current = [];
      droppedRef.current = 0;
      setEvents([]);
      setDroppedCount(0);
    },
  };
```

**Remediation**

Wrap `clear` in useCallback with an empty dependency array (it only touches refs and setters, all stable) and wrap the returned object in useMemo keyed on the five values it exposes. Do the same at use-log-stream.ts:103, then `[stream]` in use-build-logs.ts:232 becomes a real dependency.

### [76] LOW · code — Date.now() inside useMemo freezes the running-build elapsed time between events

**Location:** `src/hooks/deploy/use-deployment-stream.ts:177`

For a build in `running` state, totalDurationSeconds is computed as `Date.now() - first.started_at` inside a useMemo whose dependencies are `[stream.events, stream.connected, stream.lastEventID]`. The clock is therefore only sampled when an event arrives: between two step events (tens of seconds on a real build, minutes on install/build steps) the elapsed time the UI shows does not advance, and it jumps on the next event. It also makes the memo impure — the same inputs produce different outputs — which means the value silently depends on when React chose to recompute rather than on the data. The comment above it states the intent plainly ('running => now - first.started_at'), so the freeze is an implementation artifact, not the design.

**Evidence**

```
} else if (status === 'running') {
        const first = steps[0];
        if (first?.started_at) {
          totalDurationSeconds =
            (Date.now() - new Date(first.started_at).getTime()) / 1000;
        }
      }
```

**Remediation**

Return the anchor instead of the derived elapsed value — expose `startedAt` and let the presentation layer tick with its own interval or a `useElapsed(startedAt)` hook — or keep the field and drive it from a 1s interval so the memo is pure with respect to a clock value passed in as a dependency.

### [77] LOW · code — installSSEMocks swaps window.EventSource, which no production code path has used since B-088

**Location:** `src/lib/mocks/sse.ts:163`

installSSEMocks replaces `window.EventSource` with MockEventSource. Since the transport moved to fetch, nothing in src constructs a `new EventSource(...)` — a grep over non-test sources finds the identifier only inside this file's own comments. The real seam is installSharedEventSourceTransport (mocks/index.ts:78), added afterwards, which injects MockEventSource through `__setTransporte`; that function's docblock documents the whole episode. installAllMocks now calls both (index.ts:51-52), and the first is inert. The residue is not harmless documentation-wise: sse.ts:11 still tells the reader that 'LogViewer does new EventSource(...)', which is how someone debugging mock mode would look in the wrong place.

**Evidence**

```
export function installSSEMocks(): void {
  if (!isSSEMockingEnabled()) return;
  if (typeof window === 'undefined') return;
  if (originalEventSource !== null) return; // already installed
  originalEventSource = (window as unknown as { EventSource: typeof EventSource })
    .EventSource;
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
}
```

**Remediation**

Remove installSSEMocks / uninstallSSEMocks and their call in installAllMocks, keeping MockEventSource and registerSSE (both still used through __setTransporte), and update the file header at lines 8-14 to describe the transport-injection path. If the global swap is retained for third-party code, say so in the docblock and name the consumer.

### [78] LOW · code — Log lines without a timestamp get a new Date() on every memo recomputation

**Location:** `src/hooks/deploy/use-log-stream.ts:95`

The mapping memo synthesizes `new Date().toISOString()` as the fallback timestamp for any frame that carries neither `ts` nor `timestamp`, and for the non-JSON string fallback at line 84. Because the memo re-runs whenever `stream.events` changes — that is, on every incoming frame — the synthesized timestamps of ALL previously-received untimestamped lines are recomputed, so a line rendered at 10:00:00 displays 10:00:05 five seconds later, and the array is fully rebuilt each time. Rendering a wrong-but-plausible timestamp on a log line is worse than rendering none, because an operator correlating logs with an incident has no way to tell the value was invented.

**Evidence**

```
return {
        ts: raw.ts ?? raw.timestamp ?? new Date().toISOString(),
        level: raw.level ?? 'info',
        msg: raw.msg ?? raw.line ?? '',
```

**Remediation**

Stamp the arrival time once, at ingestion, rather than at projection: capture it in useSSEStream's `push` (which runs exactly once per event) or leave `ts` undefined and let the viewer render a placeholder for lines the server did not timestamp. Either way the value stops changing under the reader.

### [80] LOW · complexity — useReadinessSignals memo has measured CCN=30 from eight inlined nested ternaries

**Location:** `src/hooks/projects/use-readiness-signals.ts:62` · **CC:** 30.0

lizard measures the anonymous useMemo callback at CCN=30 over NLOC=66. Unlike the timeline reducer this one is repetitive rather than tangled: the score comes almost entirely from eight signal entries each built from a two- or three-level nested ternary over an `unknown` guard plus a threshold. The tristate rule it encodes (unknown excluded from both numerator and denominator) is genuinely subtle product logic and is documented at length, but it is expressed as data-shaped code — every signal repeats the same `xUnknown ? 'unknown' : <threshold> ? 'pass' : 'fail'` skeleton — which is what makes the branch count explode while the actual decision variety is small. Filed low rather than medium because the repetition is uniform and the pure part (computeScore) is already extracted and directly tested via __test_computeScore.

**Evidence**

```
logs_healthy: buildSignal(
        'logs_healthy',
        statusUnknown
          ? 'unknown'
          : (status.status?.traffic_5xx_pct_1h ?? 0) < 0.01
            ? 'pass'
            : (status.status?.traffic_5xx_pct_1h ?? 0) < 0.05
              ? 'warn'
              : 'fail',
      ),
```

**Remediation**

Make the signal definitions data. Extend the SIGNALS table in signals.ts with an `evaluate(inputs): ReadinessStatus` per signal (or a declarative `{ unknownWhen, thresholds }` descriptor) and reduce the memo to a map over SIGNALS. CCN then lives in eight one-branch functions instead of one 30-branch closure, and each threshold becomes independently testable.

### [102] LOW · naming — src/test + src/build: Portuguese is the dominant language of the test harness and build config (51 declarations, incl. filename arvore-estavel.ts)

**Location:** `src/test/arvore-estavel.ts:66`

LAYER MEASUREMENT — src/test (11 files, all harness) and src/build (8 files: 3 production, 5 test).
  src/test:  6/11 files with pt identifiers (54.5%), 7/11 with pt comments (63.6%), 35 pt declarations of 104 (33.7%)
  src/build: 4/8 files with pt identifiers (50.0%), 5/8 with pt comments (62.5%), 16 pt declarations of 90 (17.8%)

Severity is LOW rather than MEDIUM for a deliberate reason: this layer is read by whoever is already debugging the suite or the bundler, never by a consumer of the application, and src/test/i18n-guard.ts:88 explicitly excludes `src/test` from the interface-language guard on exactly that reasoning ('as mensagens de la vao para o console de quem desenvolve, nao para a tela de quem usa o produto').

The one signal worth noting above the identifier level: Portuguese has reached FILENAMES here (arvore-estavel.ts, arvore-estavel.test.ts, arvore-estavel.global.ts, manifesto-de-rotas.ts), which a rename-symbol refactor will not catch and which appear in vitest config paths and stack traces.

**Evidence**

```
src/test/arvore-estavel.ts:66 — exported comparator with pt name and pt params:
export function comparar(antes: Assinatura, depois: Assinatura): Mudanca {

src/test/arvore-estavel.test.ts:2 — the pt FILENAME crossing an import:
import { comparar, houveMudanca, relatorio, type Assinatura } from './arvore-estavel';

src/test/manifesto-de-rotas.ts:35:
export function arquivosDoManifestoDeRotas(): string[] {

src/build/sw-runtime-caching.ts:24 — pt type name, en members, shapes the service-worker config:
export interface RegraDeCache {

src/build/manual-chunks.ts:56:
const NOMES_EXATOS = [
```

**Remediation**

Lowest priority of the language findings — defer until the headline convention is settled. If English is chosen, rename the FILES too (arvore-estavel -> stable-tree, manifesto-de-rotas -> route-manifest) and update vitest.config.ts globalSetup paths; a symbol rename alone leaves Portuguese in every stack trace and test-report path. src/build/sw-runtime-caching.ts's `RegraDeCache` is the one item here that shapes a production artifact (the generated service worker) and is worth pulling forward.

### [103] LOW · naming — src/components: pt-BR confined to test files — production component code is 100% English (0 of 25 files)

**Location:** `src/components/ui/modal-primitive.test.ts:76`

LAYER MEASUREMENT — src/components (49 files: 25 production, 24 test).
  Files with pt identifiers:    5 (0 production, 5 test) = 10.2% of layer
  Files with pt comment blocks: 18 (10 production, 8 test) = 36.7% of layer
  pt declarations: 10 of 580 total declarations in the layer (1.7%) — ALL in test files

Filed as a LOW counter-example rather than a defect, because it is the cleanest layer measured and it materially informs the remediation of the headline finding: ZERO Portuguese identifiers in the 25 production component files. The shared-UI layer already satisfies the English convention.

The residue is (a) Portuguese `describe`/`it` prose in 5 test files and (b) Portuguese explanatory comments in 10 production files. Neither reaches an identifier.

**Evidence**

```
src/components/ui/modal-primitive.test.ts:76 — pt test prose, no pt identifier:
describe('primitivo de modal unico', () => {

src/components/layout/app-sidebar.test.tsx:113:
  it('M26 - uma rota /skills abre o submenu skills, e nao a raiz', () => {

src/components/ui/list-truncation-notice.tsx:36 — pt comment above English production code:
      {/* O numero, e nao so "ha mais": ver 100 e saber que sao 100 de mais-de-100 e acionavel;
```

**Remediation**

No production rename required in this layer. Use it as the reference point when settling the headline convention: src/components demonstrates the codebase can hold a consistent English identifier surface while retaining the long explanatory Portuguese comments the repo values, which is evidence that the two decisions (comment language, identifier language) can be taken independently.

### [107] LOW · code — Deploy error-message mapper duplicated between promote-to-production-dialog and rollback-dialog

**Location:** `src/pages/deploy/components/promote-to-production-dialog.tsx:216`

The same helper — mapping an HTTP status plus a `{ message?, code?, error? }` body to a user-facing sentence — is implemented twice with an identical signature and identical extraction logic:
  src/pages/deploy/components/promote-to-production-dialog.tsx:216
  src/pages/deploy/components/rollback-dialog.tsx:197

Both destructure `body?.code ?? ''` and `body?.message ?? body?.error ?? ''`, both branch on `NO_ACTIVE_RELEASE` with the same case-insensitive prose fallback, and both handle `status >= 500` (:251 and :230 respectively).

The knowledge duplicated is the SHAPE OF THE BACKEND ERROR CONTRACT — which field carries the code, which carries the human message, and what the fallback order is. That contract is owned by the API, not by either dialog, so a change to it must currently be found in two places. Severity is LOW rather than MEDIUM because the two copies have not yet diverged and both dialogs sit in one directory, so the blast radius is small today.

**Evidence**

```
src/pages/deploy/components/promote-to-production-dialog.tsx:216-222:
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const code = body?.code ?? '';
  const detail = body?.message ?? body?.error ?? '';
  if (code === 'NO_ACTIVE_RELEASE' || /no active release/i.test(detail)) {

src/pages/deploy/components/rollback-dialog.tsx:197-204 — same six lines:
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const code = body?.code ?? '';
  const detail = body?.message ?? body?.error ?? '';
  if (code === 'NO_ACTIVE_RELEASE' || /no active release/i.test(detail)) {
```

**Remediation**

Extract one `deployErrorMessage(status, body)` into a sibling module (e.g. src/pages/deploy/components/deploy-error-message.ts) and import it from both dialogs, keeping any dialog-specific wording as a parameter. This puts the backend error-envelope shape in one place, so a change to the API contract is a one-file edit with one test.

### [37] INFO · error_handling — no_error_handling_issues: the swallowed-error class is measurably absent outside the auth/HTTP slice

**Location:** `src/hooks/use-onboarding-state.ts:76`

A grep census over all 416 production files (tests, mocks and vendor excluded) for the Unbreakable-Rule-8 anti-patterns found: ZERO empty catch blocks, ZERO `: any` or `as any` annotations (all 5 regex hits are the English word any inside prose comments), ZERO @ts-ignore and ZERO @ts-expect-error. The 20 comment-only catch bodies across 16 files were each opened and judged; every one outside the auth/HTTP slice is a deliberate, documented degradation of an optional browser capability, which is the legitimate case for absorbing an exception rather than a violation of it. Verified individually: use-doc-theme.ts:31, tag-color.ts:53 and use-onboarding-state.ts:76 absorb localStorage failure and say so (private mode / quota), each keeping the in-memory value authoritative for the session; clipboard.ts:22 falls through to a documented execCommand fallback and clipboard.ts:39 converts the failure into an explicit ok=false return rather than a silent success; use-first-deploy-trigger.ts:41 states the degradation and its bounded consequence; redeploy-dialog.tsx:50 absorbs locally BECAUSE useMutation surfaces the same error through redeploy.error, which the UI renders. This is recorded as an explicit measured all-clear so the final report cannot be read as having skipped the dimension the doctrine calls the most dangerous. Scope limit stated honestly: the auth and HTTP files (register.tsx:110, register.tsx:119, login.tsx:136, session.ts, logout-cache-purge.ts, error-reporter.ts:55, rum.ts:135, recovery.tsx, verification.tsx, device-success.tsx) were assigned to the dedicated I/O reviewer and are NOT covered by this all-clear.

**Evidence**

```
src/hooks/use-onboarding-state.ts:76-79 — } catch { / // Quota exceeded or storage disabled — in-memory only is acceptable / // fallback; user can still navigate, just wont survive reload. / }  ||  src/lib/export/clipboard.ts:38-41 — ok = document.execCommand(copy); / } catch { / ok = false; / }  ||  src/components/dialogs/redeploy-dialog.tsx:50-52 — } catch { / // useMutation surfaces the error in redeploy.error; UI renders below. / }  ||  census counts: empty catch 0, any 0, ts-ignore 0 over 416 files.
```

**Remediation**

No action. Recorded to make the negative result auditable — a dimension checked and found clean is evidence, and omitting it would let the report imply it was never examined.

