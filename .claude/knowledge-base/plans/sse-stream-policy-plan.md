---
slug: sse-stream-policy
items: B-172, B-173, B-178, B-179, B-219
date: 2026-08-11
source_opportunity: .claude/knowledge-base/discoveries/opportunities/dashboard-code-review-sweep-opportunity.md
---

# Plan — a stream that hiccups reconnects, and only a credential failure touches the credential

## Goal

Five items in one 40-line region of `use-sse-stream.ts`. The severe one is not in the item titles:
**a lone network error leaves the stream permanently dead** — B-160 fixed the "clean end wipes the
JWT" defect and, in the same edit, turned a transient failure into a dead end. Beside it: every
non-2xx still wipes the application-wide JWT because the reason carries no status; a refresh
threshold is unreachable; unpausing does not flush; and a docblock describes a transport that was
replaced.

## Baseline Context

| File | LoC | Role |
|---|---|---|
| `dashboard/src/hooks/deploy/use-sse-stream.ts` | 288 | The consumer. One `useEffect` (`:114`), keyed `[path, eventTypesKey, maxEvents]` |
| `dashboard/src/hooks/deploy/fetch-event-source.ts` | 225 | The transport. `falhar()` at `:107`; `abrir()` at `:120` |
| `dashboard/src/hooks/deploy/stream-end-reason.ts` | 37 | `StreamEndReason` — a **bare string union with no status field** |
| `dashboard/src/lib/mocks/handlers.ts` | — | Four `registerSSE` calls at `:343, :357, :371, :426` |

**Git sha:** `9da19735`. **Baseline:** 358 files / 3001 tests green; typecheck + lint clean.

**Glossary.** *Clean end* — the reader reported `done`; the server finished the body.
*Fatal* — the transport gave up. *Reopen* — the consumer's own manual reconnect with backoff;
the fetch transport has no native retry, unlike the `EventSource` it replaced.

## Evidence (measured 2026-08-11)

- **B-173 (and the severe half nobody titled).** `FetchEventSource` fires `onerror` **at most once
  per instance** — every `falhar()` call site returns immediately (`fetch-event-source.ts:107-118`)
  and `falhar` itself short-circuits on `this.fechado`. `use-sse-stream.ts:257` then resets
  `failureCount = 0` before each reopen. So `failureCount >= TOKEN_REFRESH_THRESHOLD` (3) at `:244`
  is **unreachable**. Worse: for `reason === 'network-error'`, `credencialSuspeita` is false and
  `fimLimpo` is false, so `:245` returns — **no reopen is scheduled and the stream is dead until
  the component remounts.** The comment at `:67-72` still describes the browser's native retry,
  which this transport does not have.
- **B-172.** `use-sse-stream.ts:242-247` treats `'http-error'` as credential-suspect and calls
  `clearToken()` — the **application-wide** JWT. The emitter (`fetch-event-source.ts:151-152`) is
  `if (!resposta.ok || !resposta.body) this.falhar('http-error')`, collapsing 404, 500, 503 and 401
  into one token. `StreamEndReason` (`stream-end-reason.ts:16-26`) has no status field, so the
  consumer cannot discriminate. The existing test (`use-sse-stream.test.tsx:228`) says "Um 401" in
  its comment but its mock's `triggerFatalError()` carries no status — it passes identically for a
  404.
- **B-178.** `handlers.ts` registers four SSE paths; `use-deployments-list-stream.ts:93`
  (`/projects/{name}/builds/stream`) and `use-status-stream.ts:65` (`/projects/{name}/signals/stream`)
  are consumed and **not registered**. The item says they "reconnect forever"; that is no longer
  true and the correction matters — the unregistered branch (`mocks/sse.ts:92-99`) dispatches a
  bare `Event('error')` with no `reason`, which defaults to `'network-error'` and hits the dead-end
  return above. **Same outcome, opposite mechanism, and downstream of B-173.**
- **B-179.** `use-sse-stream.ts:150-154` writes state only when not paused. The file has exactly
  one `useEffect`, keyed on `[path, eventTypesKey, maxEvents]` — nothing is keyed on `paused`, so
  the buffer flushes only when the next event arrives. The existing test (`:180`) rerenders to
  `paused: true` and never unpauses.
- **B-219.** `use-sse-stream.ts:25`: *"SSE cannot set custom headers, so the JWT travels in
  `?token=`."* Contradicted by `fetch-event-source.ts:130`, which sends
  `Authorization: Bearer …`, and by `shared-event-source.ts:127-130`, which documents the B-088
  swap.

## ADRs

### ADR-1 — the reason carries the status; the policy reads it

**Decision.** `StreamEndReason` becomes a discriminated object: `{ kind: 'http-error'; status:
number }` alongside the statusless kinds. `clearToken()` is called only for **401 and 403**.

**Rationale.** B-160 already established that the transport reports and the consumer decides. It
stopped one level short: the transport reports *that* it was an HTTP error, not *which*, so the
consumer's decision is forced to be "any non-2xx means the credential" — which is how a 503 from
an overloaded log service wipes the JWT of every open screen. The status is known at
`fetch-event-source.ts:151` and thrown away one line later.

**Alternatives considered.**
1. *Keep the string union and add a sibling `lastStatus` field on the transport* — a second
   channel the consumer must remember to read, racing with the next failure. Rejected.
2. *Never call `clearToken()` from a stream* — safest, and it deletes the recovery B-014 added for
   a real expiry. Rejected: the mechanism is right; its trigger is too broad.
3. *Scope the wipe to the stream credential only* — correct in principle, and there is no separate
   stream credential today (`ensureSSEToken` returns the app token). Recorded as an open question
   rather than half-built.

### ADR-2 — every non-clean end schedules a reopen; the threshold goes

**Decision.** Delete `TOKEN_REFRESH_THRESHOLD` and the `failureCount` accumulator. Every end that
is not `aborted` schedules a reopen with the existing backoff. Credential suspicion becomes a
property of the reason alone (401/403/no-token), not of a count.

**Rationale.** The counter is unreachable, and the code that makes it unreachable is correct — a
fetch transport instance fails once and is replaced. Keeping a dead accumulator while a real
failure mode (transient network) has no reopen path is the inversion this item is about. Backoff
already handles repetition; `reopenAttempts` is the counter that actually accumulates, and it
survives.

**Alternatives considered.**
1. *Make `failureCount` persist across reopens* — resurrects the threshold, and the threshold's
   own purpose (detect a persistent 401) is better served by reading the status directly under
   ADR-1. Rejected as redundant.
2. *Reopen only on `network-error`, keep the rest* — leaves `http-error` on a 503 without a reopen,
   which is the same dead end one status over. Rejected.

### ADR-3 — unpausing flushes what arrived while paused

**Decision.** A second `useEffect` keyed on `paused` that syncs state from the buffer on the
paused→false transition.

**Rationale.** `paused` freezes updates without disconnecting — that is its documented purpose. A
consumer that unpauses and sees stale data until the next event has been given a freeze it cannot
undo, which is worse than no pause. The buffer already holds everything; only the sync is missing.

## Coverage Matrix

| Goal claim | Item | Task |
|---|---|---|
| a transient failure reconnects instead of dying | B-173 (severe half) | T2 |
| only a credential failure touches the credential | B-172 | T1 |
| the unreachable threshold is gone | B-173 | T2 |
| a mock-mode stream is not silently dead | B-178 | T3 |
| unpausing shows what arrived | B-179 | T4 |
| the docblock describes the transport in use | B-219 | T5 |

## Dependencies

No new dependency. Parsimony ladder: **rung 6** — the change is to types and control flow already
present.

## Tasks

### T1 — the reason carries the status (B-172)

**Why this step.** T2 rewrites the same branch; doing T1 first means that branch is rewritten once.

**TDD** (`stream-end-reason.test.ts`, `use-sse-stream.test.tsx`):
```
test_an_http_error_carries_the_status_it_observed
test_a_503_does_NOT_clear_the_application_token
  RED because: credencialSuspeita is true for any 'http-error'
test_a_401_DOES_clear_it        (the mechanism must survive)
test_a_403_DOES_clear_it
```
**Amendment required:** `use-sse-stream.test.tsx:228` currently passes for a 404 while its comment
claims 401. It must be given a status and split.

### T2 — every non-clean end reopens (B-173)

**TDD:**
```
test_a_network_error_schedules_a_reopen
  RED because: `:245` returns without scheduling — the stream is dead
test_a_503_schedules_a_reopen_without_clearing_the_token
test_an_abort_schedules_nothing
test_the_backoff_still_grows_across_reopens
```
**Acceptance criteria.** `TOKEN_REFRESH_THRESHOLD` and `failureCount` are gone; the stale comment
at `:67-72` describing the browser's native retry goes with them.

### T3 — the two unregistered SSE paths (B-178)

**TDD:** a guard test asserting **every** `registerSSE`-consumed path in `src/hooks/**` has a
registration — not two hand-added entries, or the third will be added unregistered.

### T4 — unpausing flushes (B-179)

```
test_unpausing_shows_events_that_arrived_while_paused
  RED because: nothing is keyed on `paused`
test_pausing_still_freezes
```

### T5 — the docblock describes the transport that exists (B-219)

No test: asserting on a comment is the inert shape this sweep is about. The claim is instead made
false-proof by T1/T2, which put the auth mechanism under test.

## Wiring triad

| Pillar | How |
|---|---|
| Caller | All changes are in modules consumed by `use-log-stream`, `use-deploy-timeline`, `use-deployments-list-stream`, `use-status-stream`. No new module. |
| Integration test | T1-T4 drive the real `useSSEStream` against a controllable transport, not a mock of the hook. |
| Runtime metric | **A real gap, named.** A stream that dies silently is exactly what an operator cannot see, and this slice fixes one such death without adding a way to observe the next. Recorded as an open question rather than claimed. |

## Failure scenarios

This slice IS the failure-scenario work: non-2xx by status class (T1), network rejection (T2),
clean end (existing, must not regress), abort (T2), unregistered mock path (T3). **Not covered:** a
server that accepts the connection and then stalls without sending bytes — no timeout exists on the
reader today, and adding one is a separate item, not a silent expansion.

## Concurrency tests

**Required and present.** T2's reopen path is a timer-driven loop across `await` boundaries; the
tests drive it with fake timers and assert the backoff grows rather than sleeping on wall clock.
No shared mutable state beyond the effect's closure.

## Drawbacks & Risks

1. **Widening `StreamEndReason` is a breaking type change** for `fetch-event-source.ts`,
   `shared-event-source.ts`, `use-sse-stream.ts` and the mocks. All are in this repo and in this
   slice; `tsc` finds every site.
2. **T2 makes streams reconnect where they previously stopped.** A permanently-500 endpoint now
   retries with backoff instead of dying once. That is the intent, and `MAX_REOPEN_DELAY_MS`
   (30 s) bounds it — but it is more traffic than today against a broken server.
3. **T3's guard may flag paths that are intentionally unmocked.** It needs an opt-out, and the
   opt-out must name a reason or it becomes a place to hide.
4. **The existing test at `:228` pins the defective behaviour** and will go red. That redness is
   correct.

## Unresolved Questions

1. **Should the stream have its own credential, scoped and short-lived?** `ensureSSEToken` returns
   the app token, so "clear the stream credential" and "clear everything" are the same action
   today. Out of scope; the right fix for ADR-1's alternative 3.
2. **Should a dead stream be observable?** See the wiring-triad note. No metric exists; adding one
   needs a consumer.

## Prior Art

- **In-repo, B-160** (`f2-sse-end-reason-plan.md`) — established that the transport reports a
  reason and the consumer decides policy. This slice finishes the sentence: a reason without the
  status is still not enough for the consumer to decide correctly.
- **In-repo, B-014** — the token-recovery path this slice narrows rather than removes.
- **In-repo, `use-status-stream.ts`** — the incremental `onEvent` pattern, cited by B-181 in the
  sibling slice.

## Definition of done (all must hold)

- [ ] `StreamEndReason` carries the observed status for an HTTP failure
- [ ] `clearToken()` fires for 401/403 and for `no-token`, and for nothing else
- [ ] A 503 reopens without touching the credential
- [ ] A network error reopens
- [ ] `TOKEN_REFRESH_THRESHOLD` and `failureCount` no longer exist
- [ ] Every SSE path consumed in `src/hooks/**` has a mock registration, enforced by a guard
- [ ] Unpausing flushes the buffer
- [ ] The `use-sse-stream` docblock describes the fetch transport, not `?token=`
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green
- [ ] `CHANGELOG.md` `[Unreleased]` updated
