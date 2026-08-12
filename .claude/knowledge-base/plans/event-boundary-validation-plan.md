---
slug: event-boundary-validation
items: B-218, B-234, B-236
date: 2026-08-11
source_opportunity: .claude/knowledge-base/discoveries/opportunities/dashboard-code-review-sweep-opportunity.md
---

# Plan — data crossing a browser event boundary is validated, and the HTTP client stops building DOM

## Goal

Three places where the dashboard treats a **compile-time TypeScript type as a runtime guarantee**
across a boundary TypeScript cannot see: a `BroadcastChannel` message from another tab, and a
`CustomEvent` detail built from an unvalidated HTTP body. A malformed message throws inside a
handler; a well-formed-but-wrong one forces a token wipe. In the same file, the client builds a
DOM node and hardcodes a 2000 ms delay — presentation decided inside the transport.

## Baseline Context

| File | Role |
|---|---|
| `dashboard/src/lib/http/api.ts` (498 LoC, at the 500 budget) | `installAuthChannel` (`:102-124`), `maybeEmitPaymentRequired` (end of file), `redirectToLogin` (`~:255`) |
| `dashboard/src/components/dialogs/plan-limit-upgrade-modal.tsx` | Consumes the `theo:plan-limit` event; `PlanLimitDetail` at `:31-37` |
| `dashboard/src/lib/http/api.test.ts` | 29 tests; `:24` asserts the JWT is never SENT over the channel |

**`api.ts` is at 498 of its 500-line budget.** Anything added must be paid for, which is a
constraint on the design and is why ADR-1 puts the validator in its own module.

**Git sha:** `3f548ee7`. **Baseline:** 354 files / 2962 tests green; typecheck + lint clean.

## Evidence (measured 2026-08-11)

- **B-234** — `api.ts:106-108`: `ch.onmessage = (event: MessageEvent<AuthMessage>) => { const msg =
  event.data; if (msg.type === 'logged-out')`. `AuthMessage` is a **compile-time type only**. A
  same-origin sender posting `null` or `undefined` makes `msg.type` throw a `TypeError` inside the
  handler; any object carrying `{type:'logged-out'}` forces `accessToken = null` +
  `redirectToLogin('expired')` (`:110-112`). `api.test.ts:24` asserts the JWT is never *sent*;
  nothing tests a malformed *inbound* message.
- **B-236** — `maybeEmitPaymentRequired` does `const body = await resp.clone().json();
  window.dispatchEvent(new CustomEvent('theo:plan-limit', { detail: body }))` — the body is
  dispatched unexamined. `plan-limit-upgrade-modal.tsx:54` then does
  `(detail?.current_plan ?? 'Free').replace(/^\w/, …)`. A 402 body of `{"current_plan": 42}`
  reaches `.replace` and throws inside a React event handler. `PlanLimitDetail` (`:31-37`) is a
  compile-time type that guarantees nothing. The existing test covers `detail: null` only.
- **B-218** — `api.ts` `redirectToLogin` builds a `div`, sets 13 CSS declarations via `cssText`,
  appends it to `document.body`, and calls `setTimeout(…, 2000)`. The DoD's cited precedent is
  real and in the same file: `maybeEmitPaymentRequired` dispatches a `CustomEvent` for exactly
  this shape.

## ADRs

### ADR-1 — one validator module at the event boundary, not three inline guards

**Decision.** A new `src/lib/http/event-payloads.ts` exporting narrow type-guards:
`isLoggedOutMessage(v): v is AuthMessage` and `readPlanLimitDetail(v): PlanLimitDetail | null`.
Both `api.ts` call sites and the modal consume them.

**Rationale.** The two defects are one shape: a TS interface treated as a runtime contract across a
boundary the compiler does not cross. Fixing them with two inline `typeof` ladders would leave the
shape free to reappear at the third boundary, and `api.ts` has no room for the ladders anyway
(498/500). A named module makes the boundary explicit and testable without a browser.

**Alternatives considered.**
1. *Inline guards at each site* — no new file, but duplicates the knowledge and pushes `api.ts`
   over its budget. Rejected.
2. *Add `zod`* — the repo has no runtime-schema dependency today; two object shapes with four
   fields do not justify one (parsimony ladder rung 4→2: `typeof` is stdlib and sufficient).
   Rejected.
3. *Validate only in the modal (B-236)* — leaves the emitter free to dispatch garbage to any
   future listener. The boundary is where the data ARRIVES, so that is where it is checked
   (`rules/error-handling.md` § 2). Rejected.

### ADR-2 — the transport announces; a component decides what the user sees

**Decision.** `redirectToLogin` dispatches `theo:session-expired` (detail: `{ reason }`) and
navigates. The visible notice and its timing move to a component mounted at the app root.

**Rationale.** An HTTP client that builds DOM cannot be tested without a document, cannot be
restyled without editing the transport, and hardcodes a product decision (2000 ms) in a layer that
has no standing to make it. The precedent is in the same file and already proven by the 402 modal.

**Alternatives considered.**
1. *Keep the toast, extract the 2000 to a named constant* — fixes the magic number and leaves the
   layering violation. Rejected: the item is about both.
2. *Delete the notice entirely and redirect immediately* — a session ending with no explanation is
   worse for the user than an ugly toast. Rejected.

**Honest limit.** The redirect must still happen even if no component is listening — e.g. a
session expiring on a route rendered outside the provider tree. So the navigation stays in
`api.ts` and only the *notice* moves. The delay becomes a named constant consumed by the
component; the transport no longer waits on presentation.

## Coverage Matrix

| Goal claim | Item | Task |
|---|---|---|
| a malformed cross-tab message does not throw or force a logout | B-234 | T1 |
| an unvalidated 402 body cannot reach a render path | B-236 | T2 |
| the HTTP client stops building DOM and hardcoding a delay | B-218 | T3 |

## Dependencies

No new dependency (see ADR-1 alternative 2). Parsimony ladder stopped at **rung 2** — `typeof`
and `Object.hasOwn` are stdlib.

## Tasks

### T1 — the cross-tab channel validates what it receives (B-234)

**Why this step.** It is the one that can throw inside a handler with no `catch` around it, and
the one whose false-positive path performs a destructive action (token wipe + redirect).

**TDD** (`src/lib/http/event-payloads.test.ts` + `api.test.ts`):
```
test_a_null_message_is_not_a_logout       -> isLoggedOutMessage(null) === false
test_an_undefined_message_is_not_a_logout
test_a_string_message_is_not_a_logout
test_a_message_with_a_wrong_type_is_not_a_logout -> {type:'hello'} false
test_the_real_message_is_recognised       -> {type:'logged-out'} true
test_a_malformed_broadcast_does_not_clear_the_token_or_redirect  (integration, api.test.ts)
  RED because: `msg.type` throws on null; any {type:'logged-out'} triggers the wipe
```

### T2 — the 402 body is read, not forwarded (B-236)

**Why this step.** The unvalidated value crosses a window event and lands in `String.replace`.

**TDD:**
```
test_a_non_string_plan_is_dropped   -> readPlanLimitDetail({current_plan: 42}) has no current_plan
test_a_null_body_reads_as_null
test_a_valid_body_survives_intact
test_the_modal_renders_the_fallback_for_a_non_string_plan  (render test)
  RED because: `(detail?.current_plan ?? 'Free').replace` throws on 42
```

**Acceptance criteria.** The emitter dispatches only a validated detail; the modal keeps its own
fallback (defence in depth — a second listener could be added tomorrow).

### T3 — the client announces, a component shows (B-218)

**TDD:**
```
test_the_client_dispatches_a_session_expired_event_instead_of_building_a_div
  Assert: after an expiry, document.body contains no injected toast AND the event fired
test_the_notice_component_renders_on_that_event
test_the_delay_is_a_named_constant_consumed_by_the_component   (no literal 2000 in api.ts)
```

## Wiring triad

| Pillar | How |
|---|---|
| Caller | T1/T2 wire into `api.ts`'s existing handlers. T3's new component is mounted in the app root — the task is not done until it is, or it is an orphan module. |
| Integration test | T1 and T3 assert through `api.ts` against a real `BroadcastChannel`/`window`; T2 asserts through the rendered modal. |
| Runtime metric | **Deliberately none for T1/T2** — they reject input that should not arrive; a counter would measure an attack or a bug, and neither has a consumer today. Recorded as a decision. |

## Failure scenarios

This slice IS the failure-scenario work for these boundaries: malformed inbound message (T1),
malformed 402 body (T2), non-JSON 402 body (already handled — `maybeEmitPaymentRequired` catches
and dispatches `detail: null`; T2 must not regress it). **Not covered:** a hostile same-origin
sender is out of scope — same-origin already implies XSS, and this slice does not claim to defend
against it. It defends against a *malformed* message, which is the measured case.

## Concurrency tests

**(none — single-threaded.)** `BroadcastChannel` delivery is a task on the same event loop; no
shared mutable state is introduced beyond what `api.ts` already holds.

## Drawbacks & Risks

1. **T3 moves user-visible behaviour.** If the component is not mounted, the user loses the notice
   and only sees the redirect. Mitigated by mounting it in the same commit and asserting it.
2. **`api.ts` is at 498/500 lines.** T1-T3 must be net-negative there. This is a genuine
   constraint on the design, and it is the reason for ADR-1 rather than an afterthought.
3. **T2 could over-narrow.** If a real 402 body carries a field the validator drops, the modal
   loses copy it used to show. Mitigated by keeping the validator permissive about *extra* fields
   and strict only about the ones it reads.

## Unresolved Questions

1. **Should other `window` events in the codebase get the same treatment?** Not surveyed. Two are
   measured; a sweep is a separate item, not a silent expansion of this one.

## Prior Art

- **In-repo:** `maybeEmitPaymentRequired` (`api.ts`) is the precedent ADR-2 copies — the transport
  announcing and a component deciding, already proven by the plan-limit modal.
- **In-repo:** `rules/error-handling.md § 2` — "validate inputs **at the system boundary**; past
  the boundary, data is trusted". A `BroadcastChannel` message and an HTTP body are both boundary
  inputs; both were being trusted at the boundary instead of validated there.
- **In-repo:** `projections.ts § ambientesServidos` (B-147, shipped in this same cycle) is the same
  lesson at a different boundary and the reason the validator is a named function, not a ladder.

## Definition of done (all must hold)

- [ ] `isLoggedOutMessage` rejects `null`, `undefined`, a string, and a wrong `type`
- [ ] A malformed broadcast neither throws nor clears the token
- [ ] `readPlanLimitDetail` drops a non-string `current_plan`; the modal renders its fallback
- [ ] `api.ts` contains no `document.createElement` and no literal `2000`
- [ ] The session-expiry notice component is mounted at the app root and asserted
- [ ] `api.ts` is still within its 500-line budget
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green
- [ ] `CHANGELOG.md` `[Unreleased]` updated
