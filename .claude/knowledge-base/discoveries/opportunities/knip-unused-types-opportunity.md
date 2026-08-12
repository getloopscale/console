# Opportunity: 56 of the 79 types just need their `export` removed; the other 23 are a different finding

**Item:** B-245
**Repo:** theo-cloud/dashboard
**Mode:** review
**Date:** 2026-08-12
**Baseline:** `1b025a8c`

## Context

`dashboard/scripts/check-knip-ratchet.mjs:34` freezes at 79 the number of exported types with no
importer. The item asks that each type "either gains an importer, or stops being exported".

The ratchet's own docstring states the cost precisely and it is worth repeating, because it
decides what a fix has to achieve: a dead exported type does not reach the bundle and breaks
nothing at runtime. **The cost is reading.** `src/lib/api/types.ts` is 861 lines, most of it
describing payloads nobody consumes, so whoever looks for an endpoint's contract reads twice what
they need and cannot tell which half is live.

## Corner 1 — Evidence

`npx knip --no-progress` on 2026-08-12 reports **79** unused exported types — exactly the ceiling.
Each was then classified by whether its own file references it anywhere beyond its declaration:

```
79 total
56  referenced INSIDE its own file   -> the `export` is the only thing that is unused
23  referenced NOWHERE at all        -> dead by any measure
```

### The 56 are a one-word change each

They are used by their own module and exported for no reason anyone acted on. Dropping `export`
removes them from the count, changes no behaviour, and `tsc` proves the claim: if any of them did
have an importer, compilation fails immediately.

### The 23 are not the same problem, and the names say so

```
TeamSwitchInput  ProjectCreateInput  BuildCreateInput  EnvironmentCreateInput
DomainCreateInput  SecretSetInput  TeamMemberInput  TeamMemberRoleUpdate
PreviewCreateInput  LogStreamEvent  SSEEvent  DeployTimelineAggregatorDegradedPayload  …
```

Nine of them are **request payloads for write operations**, and the dashboard performs those
writes. Measured:

```
dashboard/src/pages/projects/components/create-project-sheet.tsx:37   method: 'POST'
dashboard/src/pages/projects/project-connect.tsx:267                  method: 'POST'
dashboard/src/hooks/projects/use-scale.ts:34                          body: JSON.stringify(input)
```

`grep -rn "ProjectCreateInput" dashboard/src/hooks/projects` returns nothing. So the project IS
created, and the type describing what a creation request looks like is not used at the place that
sends one. The bodies are assembled inline and untyped.

That reframes the finding. These are not leftovers — they are **the request half of the API
contract, written down and then bypassed**. Deleting them would remove the only description of
those payloads; leaving them exported keeps a description nobody can trust, because nothing
checks it against what is actually sent.

### The constraint that forces a decision

`dashboard/tsconfig.json:15` sets `noUnusedLocals: true`. So for the 23, dropping `export` is not
available: an unexported type referenced nowhere is a compile error. Each one must be **deleted**
or **used**.

## Corner 2 — Constraint Relation

<!-- UNKNOWN: `.claude/rules/current-constraint.md` is `status = undeclared` and flow is not
     instrumented here. A confident answer would be assertion, not measurement. -->

`unknown` — no constraint is declared.

## Corner 3 — Blast Radius

Confined to `theo-cloud/dashboard`, and for the 56 it is confined further: removing a keyword from
a declaration that nothing outside the file references. `tsc` is a total check over that claim —
there is no dynamic path by which a TypeScript type escapes compilation.

The 23 reach wider only if the second option is taken: typing a request body touches the call
site, and a type that turns out to disagree with what is actually sent would surface as a
compile error. That is the point of doing it, and it is also why it is not free.

No other repository is reachable. No ADR is required by
`discover-opportunity-golden-rule.md § 3`.

## Corner 4 — Verification

| The item's DoD | What the measurement says |
|---|---|
| "a populacao desce e o teto acompanha" | Reachable to 23 mechanically, and to 0 only by deciding the second question. |
| "cada tipo ou ganha importador, ou deixa de ser exportado" | Exactly right, and it is the 23 that make it a real choice rather than a formality. |

How we will know: `npx knip --no-progress` reports the new number, the ceiling matches it, `tsc
--noEmit` is clean, and the dashboard suite is unchanged at 3228.

## Recommendation

1. **Drop `export` from the 56.** Mechanical, `tsc`-verified, no behaviour change. 79 → 23.
2. **Do NOT bulk-delete the 23.** Split them: a payload type whose write call site exists should be
   WIRED to that call site — it costs one annotation, and it converts documentation nobody checks
   into a contract the compiler enforces. A type describing an endpoint the dashboard does not
   call is genuinely dead and can go.
3. **Register whatever remains after that split as its own item.** "The dashboard sends untyped
   bodies to write endpoints whose payload types it already has" is a finding about the data
   access layer, adjacent to B-244, and it is larger than a ratchet.

Deliberately NOT in scope: rewriting `types.ts`'s structure. The 861 lines are the symptom the
ratchet names, but the fix for reading cost is removing what is dead, not reorganising what is
live.

## Verdict

`SHIPPABLE` — every pointer resolves, the mode contract is satisfied, all four corners populated.
