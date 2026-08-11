---
slug: f2-sse-end-reason
items: B-160 (F2 family — findings 60,61,62,63,64,71,75)
date: 2026-08-11
---

# Plan — the transport reports WHY a stream ended; the hook decides what to do about it

## Goal

A stream that the server closes cleanly must not be treated as an authentication failure.

## Evidence (measured)

`fetch-event-source.ts:174` calls `falhar()` when the reader reports `done` — a CLEAN end — with a
comment saying it does so deliberately, so `useSSEStream` reconnects. `falhar()` sets
`readyState = CLOSED` (`:110`).

`use-sse-stream.ts:228` reads `es?.readyState === EVENTSOURCE_CLOSED` to mean *"the browser gave up
on an HTTP error, so the token is probably expired"* — semantics of the NATIVE EventSource, which
this transport replaced (B-088). Under the new transport that predicate is **always true**, so:

1. the early return at `:229` is dead — every stream end runs the token-expiry path;
2. `clearToken()` at `:234` nulls the **application-wide** JWT on every clean stream end;
3. `onopen` resets `reopenAttempts = 0` (`:191`), so the exponential backoff restarts from zero
   each cycle.

Net: a finished deploy left open in a tab reconnects and re-exchanges a token every ~500-1000 ms,
against the same exchange endpoint whose quota `api.ts:180` records as already blown once.

## ADR — the transport reports a reason, it does not decide policy

**Decision.** `falhar()` becomes `falhar(reason)` with a closed set of reasons, surfaced to the
consumer. `useSSEStream` branches on the reason instead of inferring cause from `readyState`.

| reason | raised at | policy |
|---|---|---|
| `server-closed` | reader `done` (`:174`) | reconnect, keep the token, backoff KEEPS growing |
| `http-error` | `!resp.ok` (`:150`) | token likely stale → `clearToken()` + reopen |
| `no-token` | `ensureSSEToken` empty (`:122`) | reopen; a token exchange is already implied |
| `network-error` | fetch/reader threw (`:144`, `:167`) | reconnect with backoff, keep the token |
| `aborted` | our own `close()` | do nothing |

**Rationale.** `readyState` is a state, not a cause, and the bug is precisely that one state now has
several causes. The transport is the only layer that knows which branch it took; making it say so is
information the consumer cannot reconstruct. This is the same separation the codebase already
applies elsewhere: the layer that observes reports, the layer that owns the decision decides.

**Alternative rejected.** Keeping `readyState` and adding a second flag for "was it clean" — that is
two sources of truth for one question, which is the shape of the defect being fixed.

## ADR — backoff resets on PROOF OF WORK, not on socket open

**Decision.** `reopenAttempts = 0` moves from `onopen` to the first message received.

**Rationale.** `onopen` proves the socket opened; it does not prove the stream is useful. In the
open→close→open cycle above, `onopen` fires every cycle and keeps the backoff at zero forever. A
delivered event is the first moment the connection has demonstrably done its job.

## Tasks

### T1 — reason on the transport (RED → GREEN)
- `test_clean_end_reports_server_closed`
- `test_non_2xx_reports_http_error`
- `test_our_own_close_reports_aborted_and_does_not_fire_onerror`

### T2 — policy by reason in the hook
- `test_a_clean_server_close_does_NOT_clear_the_application_token`
- `test_an_http_error_DOES_clear_the_token`
- `test_backoff_grows_across_consecutive_clean_closes` — the regression that proves the loop is gone

### T3 — backoff resets on first message, not on open
- `test_backoff_resets_only_after_a_message_arrives`

## Failure scenarios

| Scenario | Expected |
|---|---|
| deploy finishes, server closes the stream, tab left open | at most a few reconnects, delays growing; token untouched |
| session genuinely expired (401) | token cleared once, reopen, and the existing budget applies |
| user navigates away mid-stream | `aborted`; no reconnect, no error state |

## Drawbacks & risks

- A server that closes cleanly on every connect still produces a reconnect loop, now with growing
  delays rather than a fixed ~1 Hz. Bounded, not eliminated: eliminating it needs a server-side
  "stream complete" signal, which is out of this slice and stated rather than implied.
- `network-error` and `server-closed` are indistinguishable when the connection drops mid-body. Both
  map to the same policy, so the ambiguity has no behavioural consequence today.
