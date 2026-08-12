# Opportunity: five of the seven screens are not defects, they are the guard's vocabulary again

**Item:** B-243
**Repo:** theo-cloud/dashboard
**Mode:** review
**Date:** 2026-08-12
**Baseline:** `49ff8aa3`

## Context

`src/lib/list-state.test.ts` freezes at 7 the number of page files that assert absence ("nothing
here") without consulting an error signal. The item asks for the population to reach 0.

B-238 already corrected this ratchet once, moving it from 23 to 7 — and its own note records why:
*"a catraca estava contando o vocabulário do guarda, não o defeito"*. This opportunity measures
whether the remaining 7 are defects or the same thing one layer down.

## Corner 1 — Evidence

Measured 2026-08-12 by running the guard's own two predicates (`afirmaAusencia`, `consultaErro`,
`dashboard/src/lib/list-state.test.ts:78` and `:100`) over `src/pages/**/*.tsx`. The 7 it names are exactly
the 7 the item lists. Then each was opened.

### Two are genuine defects

**`dashboard/src/pages/memory/scope-switcher.tsx:138`**

```tsx
const sessions = useSessionsQuery();
const empty = (sessions.data?.sessions ?? []).length === 0;
emptyLabel={empty ? 'No sessions recorded yet' : 'Select a session…'}
```

The query is built with `throwOnError: true` (`:36`), so `sessions.error` exists and is
meaningful. The component never reads it: a failed read yields `undefined`, `?? []` turns it into
an empty list, and the picker states as fact that the user has recorded no sessions.

**`dashboard/src/pages/projects/project-detail.tsx:317`**

```tsx
const { builds } = useDeployments(name);
...
{recentBuilds.length === 0 ? ( … ) : ( … )}
```

`useDeployments` returns `{ builds, total, loading, error, refetch }`
(`dashboard/src/hooks/projects/use-deployments.ts:21-26`). The page destructures `builds` alone and drops
`error` on the floor.

### Two already do exactly what the item asks — and the guard cannot see it

**`dashboard/src/pages/overview/status.tsx:46`**

```tsx
if (!data) {
  return <Card><Card.Body><p role="alert">Could not read service status.</p></Card.Body></Card>;
}
```

It distinguishes correctly, with an ARIA alert, and the comment above it names the failure mode.
The guard misses it by one verb:

```
consultaErro matches /read failed|failed to load|Could not load|setError\(/i
the file says       "Could not read service status"
```

`Could not load` ≠ `Could not read`. Verified: the predicate returns `false` against this file.

**`dashboard/src/pages/promptly/tabs/producao.tsx:174`**

Defends the distinction **twice** — a `nao-lido` state on the usage table, and an Alert driven by
the `dependentesIlegiveis` prop — and the comment at `:120-131` explains why the third place (the
"see the calls" invitation) is suppressed when the read failed. The guard recognises none of
`ilegiveis`, `nao-lido`, or the Alert.

### Three cannot satisfy the check, because they never read anything

| File | The list | Where it comes from |
|---|---|---|
| `dashboard/src/pages/promptly/tabs/config.tsx:109` | `variaveis` | `readonly variaveis: readonly string[]` — a **prop** (`:22`) |
| `dashboard/src/pages/promptly/revision-columns.tsx:169` | `ponteiros` | a **prop** (`:20`) |
| `dashboard/src/pages/rag/components/kb-editor.tsx:220` | `slash.items` | `useState<SlashState \| null>` (`:53`) — the slash-command menu, filtered in the editor |

No request is made in any of them. `variaveis` is parsed from the prompt body; `slash.items` is a
local menu. Asking a presentational component to consult an error is asking it to invent one, and
the guard's own docstring already concedes the shape of this limit: *"a checagem é por ARQUIVO"*.

### The count that matters

```
7 flagged  =  2 genuine defects
            + 2 screens that already comply, unseen by the guard's vocabulary
            + 3 components with nothing to read
```

## Corner 2 — Constraint Relation

<!-- UNKNOWN: `.claude/rules/current-constraint.md` is `status = undeclared`, and flow is not
     instrumented in this ecosystem. A confident answer here would be assertion, not measurement. -->

`unknown` — no constraint is declared.

## Corner 3 — Blast Radius

Contained in `theo-cloud/dashboard`. Two page files change behaviour; one test file changes its
predicates and its ceiling. No shared component, no hook signature, no API contract is touched —
`useDeployments` and `useSessionsQuery` already expose the error, so consuming it adds no
parameter and breaks no caller.

The guard's predicate change has a wider read: it decides what every future page is measured
against. That is contained in one file and one number, and the file carries self-tests
(`:143-166`) that fail if a predicate stops discriminating.

No repository beyond this one is reachable from the change, so no ADR is required by
`discover-opportunity-golden-rule.md § 3`.

## Corner 4 — Verification

| The item's DoD | What the measurement says |
|---|---|
| "as 7 telas distinguem 'não há nada' de 'não consegui ler'" | Wrong for 5 of them. Two already distinguish; three have nothing to distinguish. Only 2 are defects. |
| "o teto chega a 0" | Reachable — but only if the guard stops counting screens that comply and components that cannot. |
| "a decisão sobre a checagem por bloco está tomada e registrada" | Still open, and now sharper: the per-file limit is not the binding one. The binding one is per-FILE-KIND — a page that reads versus a component that receives. |

How we will know: the two defects each get a test that fails on the current state (a failing read
shows "could not read", not "nothing here"); the guard recognises compliance it currently misses;
the ceiling reaches the true count and the self-tests still pass.

## Recommendation

1. **Fix the two real defects** — `scope-switcher.tsx` and `project-detail.tsx` — TDD, failing
   test first.
2. **Widen `consultaErro` to the compliance it misses** (`Could not read`, `ilegivel`/`ilegiveis`,
   `nao-lido`), and add a self-test per added form so a predicate that stops discriminating goes
   red. This is B-238's correction continued, not a new idea.
3. **Exclude components that receive their list** rather than fetching it — measured by the
   absence of any hook/fetch call in the file — and make that exclusion a named, tested predicate
   rather than a hand-kept skip list.
4. **Lower the ceiling to the resulting number** and state it. Not to 0 by fiat: the number must
   be what the disk says.

Deliberately NOT in scope: per-block analysis. The measurement shows the per-file limit is not
what is producing the residue, so building block-level analysis now would be solving the problem
the evidence does not point at.

## Verdict

`SHIPPABLE` — every pointer resolves, the mode contract is satisfied, all four corners populated.
