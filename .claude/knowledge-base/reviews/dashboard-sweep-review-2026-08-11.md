# Review — dashboard code-review sweep (B-131..B-236)

- **Date:** 2026-08-11
- **Scope:** 16 commits since `1.0.0` (`6c618990..HEAD`) — 81 files, +5704 / −724
- **Reviewers:** three independent agents (architecture/SOLID, test quality, cross-validation)
- **Verdict:** `READY_TO_MERGE_WITH_FOLLOWUPS`

## Why this verdict and not `READY_TO_MERGE`

No BLOCKER survived. But the reviewers raised **six HIGH findings**, and two of them were defects
this cycle *created* while claiming to fix others. Those two are closed. The rest are registered
followups, per `cycle-review § Verdicts` — a caveat nobody owns is a defect with better manners.

## HIGH — closed in this cycle

| # | Finding | Closed by |
|---|---|---|
| 1 | The CLI-honesty guard scanned only `src/routes` + `app.tsx` and only the JSX-attribute form, so **`theo account delete` kept shipping** in a copyable block on the profile screen — one of the six commands the guard's own docblock says does not exist | Widened to all of `src/` and any `theo <command>` mention; found `theo skills publish` too. Both removed |
| 2 | Removing the commands left `"Use the CLI below to do this today"` rendering on five placeholders with no block below | Copy is now conditional on a command being present |
| 3 | **B-167 had a ninth site** (`memory/webhooks.tsx`, two absence claims by inline ternary) found *after* the item was marked shipped; the guard was structurally blind to it because it skipped any file without `empty={` | Both sites fixed; guard now matches the assertion in any form |
| 4 | `safeNavigator.goTo` returns a refusal that `redirectToLogin` discarded, so the notice inferred it by racing a timer against its own unmount — in a background tab it showed "did not work" over a pending redirect | Refusal is now an event; the component infers nothing |
| 5 | The `redirecting` latch stayed closed on a refusal, permanently disabling login redirect for that tab | Latch reopens on refusal |
| 6 | `useEngineApi`'s half of B-171 had no assertion that could fail (the mock rejects regardless of the flag) | **NOT closed — see followups** |

## HIGH / MEDIUM — registered followups (not closed)

These are real and are **not** being called done. Each is registered so it is owned.

| Finding | Where |
|---|---|
| `useEngineApi` has no argument assertion; reverting its `throwOnError` leaves both tests green | `src/hooks/use-api.test.tsx:111-131` |
| The B-234 wiring block in `api.test.ts` is inert — both cases pass against the unfixed handler; nothing observes the thrown error or the untouched token | `src/lib/http/api.test.ts:610-655` |
| `docs-claims.test.ts`'s three "DETECTA" self-tests never invoke `conferirAfirmacoes`/`conferirCaminhos`; they re-implement the regex inline | `src/lib/docs-claims.test.ts:309,324,357` |
| `list-state.test.ts`'s self-test re-implements the predicate instead of calling it | `src/lib/list-state.test.ts` |
| No behavioural test renders the four fixed pages with a **failed** read | `deployments/environments/projects/webhooks` tests |
| `use-log-stream`'s B-224 change (the two `ev.receivedAt` lines) has no test — every fixture supplies a `ts` | `src/hooks/deploy/use-log-stream.ts:84,98` |
| `sse-registration.test.ts` is the one new ratchet with no self-test | `src/lib/mocks/sse-registration.test.ts` |
| B-134's assertion only checks the ABSENCE of `main`, never the presence of the em-dash | `src/pages/overview/overview.test.tsx` |
| `buscaSemResultado` was extracted to be testable and was not tested | `src/pages/projects/empty-states.ts` |
| B-219's DoD named a sibling claim in `api.ts` (`ensureSSEToken`'s docblock still says the JWT goes in the query string) — still false | `src/lib/http/api.ts` |
| B-173's DoD required rewriting the `use-sse-stream` header comments; they still describe the browser's native retry and the deleted threshold | `src/hooks/deploy/use-sse-stream.ts:16-21` |
| `credentialIsSuspect`/`shouldReopen` live in the *reporting* module whose own header says it reports and the consumer decides | `src/hooks/deploy/stream-end-reason.ts` |
| `colecaoDescrita` is a domain-free pagination helper living in a skills-KPI module; the literal expression it replaced still sits in `catalog.tsx` | `src/pages/skills/` |
| `valueHeader` was added to `CategoryBars` and no call site passes it | `src/components/charts/category-bars.tsx` |
| **This cycle grew B-128** (Portuguese identifiers) with ~9 new ones and did not record it | `BACKLOG.md` B-128 |
| The `## B-167` block carries **two** `shipped_note:` keys; the stale one contradicts the status | `BACKLOG.md` |
| `list-state` guard is now a ratchet frozen at **23** screens that assert absence without an error signal — all pre-existing | `src/lib/list-state.test.ts` |

## What the reviewers confirmed

B-142, B-145/B-168, B-146, B-147, B-148, B-149, B-171 (`useCloudApi` half), B-172, B-178, B-179,
B-185, B-187, B-188, B-206, B-218, B-220, B-221, B-222, B-223, B-224, B-231, B-234 (the validator
itself), B-236 and B-134 all check out against the code. The eight `killed` items are correctly
killed and not falsely shipped. **No inverse drift** — no item left open whose defect was actually
closed.

Layering is clean: `components/charts/category-bars.tsx` has zero imports; no new `lib/ → pages/`
edge; `lib/webhooks/delivery.ts` satisfies the two-domain residence rule.

## The honest reading

The review found that **I reproduced, twice, the exact defect class this sweep exists to remove**:
a guard that reports green by not looking, and a fix that left its own instruction pointing at
nothing. Both are closed. That they existed is the argument for the review phase, not against it —
and the followups above are named rather than absorbed, because an unowned caveat is how the
registry got behind the code in the first place.
