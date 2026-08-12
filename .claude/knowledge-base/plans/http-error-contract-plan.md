---
slug: http-error-contract
items: B-142, B-171, B-231, B-235
date: 2026-08-11
source_opportunity: .claude/knowledge-base/discoveries/opportunities/dashboard-code-review-sweep-opportunity.md
---

# Plan — the HTTP client stops inventing a status it never received, and stops reporting a success as a failure

## Goal

`cloudFetch`'s default contract resolves `T | null`, and `null` currently means five different
things: a transient auth failure, an expired session, any non-2xx, a network rejection, and a
**successful** 204. One consumer (`useCloudApi`) turns that single value into a boolean `error`,
so a successful empty response is reported to the screen as a failed read. On the opt-in path the
client throws `ApiError(429)` for failures that were never rate limits — and the query client
then refuses to retry them, because 429 is a 4xx.

After this slice: a thrown error carries the status that actually happened; `useCloudApi` derives
`error` from the error channel rather than from a value; and a burst of concurrent 401s stops
destroying the token the refresh just minted.

## Baseline Context

| File | LoC | Role |
|---|---|---|
| `dashboard/src/lib/http/api.ts` | 457 | The client. **151 importers** — the highest-reach file in this repo |
| `dashboard/src/hooks/use-api.ts` | 63 | `useCloudApi` / `useEngineApi`, thin TanStack wrappers |
| `dashboard/src/lib/http/query-client.ts` | ~60 | `retryGuard` — refuses to retry any 4xx |

**Production consumers of the two hooks (13, verified by grep):** `overview/capability-grid.tsx`,
`settings/billing.tsx`, `settings/team.tsx`, `infra/components/create-environment-sheet.tsx`,
`infra/environments.tsx`, `overview/platform-signals.tsx`,
`infra/components/add-domain-sheet.tsx`, `hooks/overview/use-overview-kpis.ts`,
`infra/domains.tsx`, `hooks/use-onboarding-state.ts`, `hooks/mutations/use-environments.ts`,
`hooks/infra/use-domain-status-polling.ts`, `lib/api/query-keys.ts`.

**There is no `src/hooks/use-api.test.ts`.** The 14 test files that reference `useCloudApi` all
mock the hook rather than exercise it, so nothing today pins its contract.

**Git sha at plan time:** `2adaa707`. **Baseline:** 353 files / 2950 tests green, typecheck and
lint clean.

**Glossary.** *Exchange* — `POST /v1/auth/session/token`, which trades the Kratos cookie for a
JWT. *Terminal vs transient* — `sessionDefinitivelyExpired()` (`api.ts:159`) reads
`lastExchangeStatus === 401`; every other failure is transient by construction (#324).

## Evidence (measured 2026-08-11)

- **B-142** — `api.ts:304` and `:388`: `throw new ApiError(429, undefined, 'Too many requests…')`
  on the transient-auth path. `lastExchangeStatus` already holds the real status (`:116`, written
  at `:190`/`:193`) and is read only by `sessionDefinitivelyExpired()`. So a 500, a 502 or a
  network rejection all surface as a fabricated 429 — and `retryGuard`
  (`query-client.ts:29-35`) returns `false` for any 4xx, so the query is **never retried**. The
  one failure class that most deserves a retry is the one guaranteed not to get one.
- **B-235** — `api.ts:292-311`; `null` returned at `:306, :309, :378, :390, :398, :406, :414,
  :424`. `parseOkBody` (`:346-348`) also returns `null` for a **successful** 204/205.
- **B-171** — `use-api.ts:48`: `error: enabled && (query.isError || (query.isFetched &&
  query.data === null))`. `queryFn` at `:42` passes no `throwOnError`, so every failure resolves
  `null` — and so does a successful 204. The in-code `silent-null-ok` marker at `:41` documents
  the coupling to B-235 without resolving it.
- **B-231** — `api.ts:380`: on 401 the handler sets `accessToken = null` and then awaits
  `ensureToken()`. `refreshPromise` (`:64`, `:174`) dedups the **exchange**, not the eager
  invalidation that precedes it. `grep -n "generation" src/lib/http/api.ts` returns nothing.
  With N concurrent 401s: A nulls the token and starts the exchange; the exchange completes and
  sets a fresh token; B then nulls **that fresh token** and starts a second exchange — against the
  endpoint whose quota `api.ts:180` records as already blown once.

## ADRs

### ADR-1 — the thrown error carries the status that happened, never a stand-in

**Decision.** Replace both fabricated `ApiError(429, …)` with an error built from
`lastExchangeStatus`: the real status when there was a response, `0` when the exchange was
rejected by the network (a value `ApiError`'s own docblock at `:24` already defines as "network
failure").

**Rationale.** The fabrication is not a cosmetic lie — it changes behaviour, because `retryGuard`
keys on the status. A 502 from the auth service ("Try again", per its own message) is presented as
a 429 and then treated as a permanent client error. Carrying the truth makes the retry policy
correct without touching the retry policy.

**Alternatives considered.**
1. *Keep 429 and special-case it in `retryGuard`* — makes 429 retryable for every caller,
   including genuine rate limits where retrying is exactly wrong. Rejected.
2. *A dedicated `AuthUnavailableError` subclass* — a second error type for callers to learn, when
   the existing one already carries a status field built for this. Rejected (YAGNI, rung 1).
3. *Throw the status but keep the "Too many requests" copy* — a message that contradicts its own
   status is worse than either alone. Rejected.

**Cost.** A caller matching on `status === 429` to show rate-limit copy would stop matching on
this path. Measured: `grep -rn "429" src --include=*.ts --include=*.tsx` outside tests hits only
`api.ts` itself, so no caller does.

### ADR-2 — `useCloudApi` derives `error` from the error channel, not from a value

**Decision.** Both hooks pass `{ throwOnError: true }` and return `error: query.isError`.

**Rationale.** B-171 is unfixable while `null` is the only signal, because a successful 204 and a
500 produce the identical value — that is B-235 restated at the hook. TanStack already has an
error channel; the hook was declining to use it and then reconstructing a worse version from the
data. Opting in is what makes `null` mean one thing again *at this altitude* without rewriting the
default contract underneath 151 importers.

**Alternatives considered.**
1. *Change `cloudFetch`'s default to a discriminated result* — the correct end state, and a
   breaking change across 151 importers in a slice about four items. Rejected as scope; recorded
   under Unresolved Questions.
2. *Keep the default and have the hook inspect a side-channel* (e.g. read `lastExchangeStatus`)
   — a second source of truth for one request's outcome, racing with every other in-flight
   request. Rejected.
3. *Leave B-171 and only fix B-235* — leaves the measured user-visible defect in place.

**Behaviour this changes, deliberately.** With `throwOnError`, a 5xx now throws, so `retryGuard`
retries it once before surfacing; previously it resolved `null` and was never retried. That is an
improvement, and it is the reason ADR-1 must land in the same slice — retrying a *fabricated* 429
would never have happened.

**Blast radius.** `data` stays `T | null` for every caller (`query.data ?? null` is `null` when the
query errored), so the only field whose value changes is `error`, and it changes only in the
direction of being right: it stops being `true` for a successful empty body.

### ADR-3 — invalidate the token only if it is still the token you used

**Decision.** A module-level `tokenGeneration` counter, incremented on every successful exchange
and on `clearToken()`. `fetchWithAuth` captures the generation it sent a request with; on 401 it
clears `accessToken` **only** if the generation has not moved.

**Rationale.** The existing `refreshPromise` dedup is correct and insufficient: it makes N
concurrent 401s share one exchange, but each of them still nulls the token independently, and a
null that lands *after* the shared exchange succeeded destroys a valid credential and provokes a
second exchange. A generation counter is the standard compare-and-swap shape for exactly this, and
it needs no lock because JavaScript is single-threaded between awaits.

**Alternatives considered.**
1. *Serialise all 401 handling behind one promise* — turns independent requests into a queue and
   would stall unrelated traffic. Rejected.
2. *Compare the token string instead of a counter* — works, but ties the check to a secret's value
   and reads as a credential comparison in a stack trace or a log. Rejected.
3. *Do nothing; the dedup is "good enough"* — the measurement shows the second exchange happening
   against an endpoint with a recorded quota incident. Rejected.

## Coverage Matrix

| Goal claim | Item | Task |
|---|---|---|
| a thrown error carries the status that actually happened | B-142 | T1 |
| `useCloudApi` derives error from the error channel | B-171 | T2 |
| a successful empty response is not reported as a failure | B-171, B-235 | T2 |
| the ambiguity of `null` is documented where it is load-bearing | B-235 | T3 |
| concurrent 401s stop destroying the fresh token | B-231 | T4 |

## Dependencies

No new dependency. Parsimony ladder stopped at **rung 4** — `ApiError`, `lastExchangeStatus`,
`refreshPromise` and TanStack's error channel all already exist; every task reuses one of them
rather than adding a mechanism.

## Tasks

### T1 — the transient-auth error carries the real status (B-142)

**Why this step.** It must precede T2: T2 makes 5xx retryable, and retrying an error mislabelled
429 would never fire.

**TDD.**
```
test_a_5xx_from_the_exchange_is_not_reported_as_a_rate_limit
  Arrange: exchange responds 502; cloudFetch called with { throwOnError: true }
  Act/Assert: rejects with ApiError whose status is 502, not 429
  RED because: api.ts:304 throws a literal 429

test_a_network_rejection_from_the_exchange_surfaces_as_status_0
  Arrange: exchange rejects (no response)
  Assert: ApiError.status === 0   (the value ApiError's docblock already defines for this)

test_the_retry_guard_retries_that_5xx
  Assert: retryGuard(0, new ApiError(502)) === true
  (guards the behaviour B-142's fabrication was silently disabling)
```

**Acceptance criteria.** Neither `api.ts:304` nor `:388` contains a literal `429`. The message no
longer says "Too many requests" on a path that was not one.

### T2 — the hooks read the error channel (B-171, B-235 at the hook)

**Why this step.** This is the user-visible half: a successful empty read currently paints an
error state.

**TDD.** New file `src/hooks/use-api.test.tsx` — the hook has **no test today**.
```
test_a_successful_204_is_not_reported_as_an_error
  Arrange: cloudFetch resolves null (the 204 path)
  Assert: result.error === false and result.data === null
  RED because: (isFetched && data === null) is true

test_a_500_is_reported_as_an_error
  Arrange: cloudFetch rejects ApiError(500)
  Assert: result.error === true

test_a_disabled_query_reports_neither_loading_nor_error
```

**Acceptance criteria.** `error: query.isError` in both hooks; the `silent-null-ok` marker at
`:41`/`:55` is removed or rewritten, because the condition it documents no longer holds. All 13
production consumers still compile and their tests pass.

### T3 — the `null` contract is documented where it is load-bearing (B-235)

**Why this step.** The default contract is **not** being changed in this slice (see ADR-2 and
Unresolved Questions). Leaving it undocumented after measuring it is how the next reader
rediscovers it.

**Acceptance criteria.** `cloudFetch`'s docblock enumerates the five outcomes `null` collapses,
names `{ throwOnError: true }` as the discriminating opt-in, and points at the open question. No
test — this task changes no behaviour, and asserting on a comment is the inert-test shape this
sweep is about.

### T4 — a stale 401 does not destroy a fresh token (B-231)

**Why this step.** The failure it prevents is a self-feeding loop against an endpoint with a
recorded quota incident.

**TDD.**
```
test_a_401_that_arrives_after_a_refresh_does_not_null_the_new_token
  Arrange: two concurrent requests; both get 401; the exchange succeeds once
  Assert: exchangeSessionToken (the fetch to /v1/auth/session/token) is called ONCE
  RED because: the second 401 nulls the fresh token and triggers a second exchange

test_a_401_on_the_current_generation_still_refreshes
  (the guard must not disable the mechanism it protects)
```

**Acceptance criteria.** `tokenGeneration` increments on successful exchange and on
`clearToken()`; `fetchWithAuth` compares before invalidating.

## Wiring triad

| Pillar | How |
|---|---|
| Caller | Every change is inside `api.ts` (151 importers) and `use-api.ts` (13 production consumers). No new module. |
| Integration test | T2 exercises the hook through `renderHook` with a real `QueryClient`, not a mock of itself. T4 asserts on the number of real exchange calls. |
| Runtime metric | **Deliberately none.** These are corrections to how an existing outcome is *classified*; no new runtime behaviour exists to watch. Recorded so the omission is a decision. |

## Failure scenarios

External I/O is the subject of this slice, so these are tasks rather than a separate list: exchange
5xx and exchange network-rejection (T1), data-path 5xx (T2), concurrent 401 (T4). Two are
**deliberately not covered** and named here instead of silently skipped:

- **Exchange returns 401 (terminal).** Unchanged by this slice — `sessionDefinitivelyExpired()`
  still routes it to the redirect, and `api.ts:395-402` still throws `ApiError(401)` under
  `throwOnError`. Existing tests cover it.
- **A 402 on the data path.** Belongs to the sibling slice (B-236); this one does not touch
  `maybeEmitPaymentRequired`.

## Concurrency tests

**Required and present.** T4 is a concurrency test in the sense that matters here: two requests
in flight across an `await` boundary, where the interleaving is what produces the defect. It is
driven deterministically by controlling when each mocked `fetch` resolves, not by timing. No
mutex or worker is involved — the race is between continuations on one thread, which is exactly
why a generation counter and not a lock is the right instrument (ADR-3).

## Drawbacks & Risks

1. **T2 changes when a 5xx retries.** Previously never; now once, per `retryGuard`. Screens will
   surface a server error ~1-2 s later than before. Judged an improvement, stated so it is not
   discovered as a surprise.
2. **T2 touches a hook with 13 production consumers and no test of its own.** Mitigated by writing
   that test first — the RED in T2 is the first assertion this hook has ever had.
3. **T4 adds module-level mutable state to a file that already has four pieces of it**
   (`accessToken`, `tokenExpiresAt`, `refreshPromise`, `lastExchangeStatus`). A fifth is more to
   reason about. The alternative was a lock, which is worse.
4. **B-235 is not fully closed by this slice**, only documented and mitigated at the hook. Stated
   plainly rather than marking the item shipped on a partial fix — see Unresolved Questions.
5. **`error: query.isError` drops the `isFetched` term.** A caller reading `error` before the
   first fetch settles now sees `false` where it previously saw `false` too (data is `undefined`,
   not `null`, before the first fetch) — verified, no change.

## Unresolved Questions

1. **Should `cloudFetch`'s default become a discriminated result?** It is the correct end state and
   it is a breaking change across 151 importers. **Not decided here.** B-235 stays `triaged` with
   its scope narrowed to that question rather than being closed by this slice.
2. **Should `retryGuard` retry a genuine 429 after `Retry-After`?** Out of scope; no measurement
   says it is a problem today.

## Prior Art

- **In-repo, #324** (`api.ts:142-160`) — the decision to store the *status* rather than a
  judgement, because collapsing every error into one boolean produced a self-feeding redirect
  loop. T1 applies that same lesson one layer out: the same collapse was happening again in the
  thrown error.
- **In-repo, F-api-1** (`api.ts:395-402`) — the precedent that under `throwOnError` an auth expiry
  surfaces as a typed `ApiError` so a mutation rejects rather than resolving `null` into
  `onSuccess`. T2 extends the same reasoning from mutations to queries.
- **TanStack Query v5** — `isError` as the authoritative failure channel; the docs' own retry
  recommendation is what `retryGuard` already implements.

## Test Plan

| Level | What |
|---|---|
| Unit | `retryGuard` over `ApiError(502)` / `ApiError(404)` / `ApiError(0)` |
| Integration | `cloudFetch` against a mocked `fetch`: exchange 502, exchange network-reject, data 500, data 204 |
| Integration | `useCloudApi` / `useEngineApi` via `renderHook` + real `QueryClient` (new file) |
| Concurrency | two in-flight 401s → exactly one exchange |
| Regression | full suite ≥ 2950 tests green |

## Definition of done (all must hold)

- [ ] No literal `429` is thrown by `api.ts`; the status carried is the one observed
- [ ] `retryGuard` retries an exchange 5xx (asserted)
- [ ] `useCloudApi` / `useEngineApi` return `error: query.isError`
- [ ] A successful 204 reports `error: false`
- [ ] `src/hooks/use-api.test.tsx` exists and exercises the hook rather than mocking it
- [ ] Two concurrent 401s produce exactly one exchange
- [ ] `cloudFetch`'s docblock enumerates what `null` collapses; B-235 stays open with narrowed scope
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green
- [ ] `CHANGELOG.md` `[Unreleased]` updated
