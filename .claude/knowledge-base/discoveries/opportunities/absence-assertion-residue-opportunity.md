# Opportunity: 174 of the 326 absence assertions can already fail; the defect is 152, not 98 files

**Item:** B-242
**Repo:** theo-cloud/dashboard
**Mode:** review
**Date:** 2026-08-12
**Baseline:** `bce39891`

## Context

`dashboard/src/lib/absence-assertion-ratchet.test.ts:54` freezes at 98 the number of test files
that use `expect(queryBy…)` to assert absence. The item asks that the population go down, and
that each migrated file "assert a PRESENT element in the happy case, or justify why it cannot".

The ratchet's own docstring states the discriminator exactly, and it is what makes this
measurable rather than a matter of taste:

> `expect(queryBy…).toBeNull()` só prova alguma coisa quando o elemento consultado EXISTE no
> caso que passa e SOME no que falha. Quando ele está ausente nos dois, a asserção é satisfeita
> pelo comportamento correto e pelo defeito igualmente.

It is not a hypothesis there either — the file records four measured cases where a guard was
deleted and the tests stayed green.

## Corner 1 — Evidence

The ratchet counts **files whose text matches a FORM**. The defect is a property of each
**assertion**: whether the queried selector is one the passing case actually renders. Measured
2026-08-12 over all 373 test files:

```
test files                                  373
files matching the ratchet's form            98   <- the number the ceiling freezes
absence assertions inside them              326

  selector ALSO asserted PRESENT in the same
  file, via getBy…/findBy… with the same
  selector text  → the assertion CAN fail    174   (53%)

  selector never asserted present anywhere
  in the file    → suspect                   152   (47%), across 64 files
```

So more than half of the population is already sound by the ratchet's own criterion, and the
honest target is **64 files / 152 assertions**, not 98 files.

Where the suspect ones concentrate:

```
11  dashboard/src/pages/promptly/detail.test.tsx
10  dashboard/src/pages/promptly/catalogo.test.tsx
 8  dashboard/src/components/layout/app-sidebar.test.tsx
 5  dashboard/src/pages/infra/environments.test.tsx
 5  dashboard/src/pages/overview/overview.test.tsx
```

### The limits of this measurement, stated before anyone relies on it

The pairing test is **textual and file-scoped**: same file, same query kind, same selector text.
It errs in both directions and the direction matters:

- **False pairs** (counted safe, may not be): a file that asserts `getByRole('button', …)` in one
  test and `queryByRole('button', …)` with a *different* name in another matches on the prefix.
  These would be under-counted defects.
- **False suspects** (counted suspect, actually fine): a selector built from a variable, or an
  element asserted present via `toBeInTheDocument()` on a differently-spelled query.

This is the same class of limit the ratchet itself carries and declares. It is good enough to
**re-scope** the item — 152 is not 326 and 64 is not 98 — and not good enough to justify a
mechanical rewrite. Each of the 152 must be read.

## Corner 2 — Constraint Relation

<!-- UNKNOWN: `.claude/rules/current-constraint.md` is `status = undeclared`, and flow is not
     instrumented in this ecosystem. -->

`unknown` — no constraint is declared.

## Corner 3 — Blast Radius

Test files only, in `theo-cloud/dashboard`. No production source changes, so no runtime blast
radius at all. The risk is the opposite of the usual one: a migration that *weakens* a test while
appearing to strengthen it — replacing an absence assertion with a presence assertion that
happens to hold in both worlds. That risk is per-file and is why this cannot be swept
mechanically.

The ratchet file itself is the one shared artifact, and it carries self-tests.

No repository beyond this one is reachable. No ADR is required by
`discover-opportunity-golden-rule.md § 3`.

## Corner 4 — Verification

| The item's DoD | What the measurement says |
|---|---|
| "a populacao desce e o teto acompanha" | Reachable, and the target is 64 files rather than 98. |
| "cada arquivo migrado assere um elemento PRESENTE no caso feliz, ou justifica por que nao da" | Exactly the right criterion — and it is now measurable per assertion instead of per file. |

How we will know a migration is real and not cosmetic: for each rewritten assertion, delete the
production guard it protects and confirm the test goes RED. The ratchet's docstring records four
cases where that experiment failed silently; it is the only check that distinguishes a fixed test
from a re-worded one.

## Recommendation

1. **Re-scope the item to the 152 suspect assertions in 64 files**, and record that 174 were
   already sound — the ceiling has been freezing a number that is roughly twice the defect.
2. **Migrate by file, deepest first** (`promptly/detail.test.tsx` at 11, `catalogo.test.tsx` at
   10, `app-sidebar.test.tsx` at 8 — a quarter of the suspects live in three files), and for each
   one prove the migration with the delete-the-guard experiment rather than with a green suite.
3. **Teach the ratchet the discriminator it already documents.** Counting the form was the only
   thing available when it was written; counting assertions whose selector is never asserted
   present is closer to the defect, and it is what makes the number mean something. Keep the
   form-based count as a second, looser gate so a new file cannot enter unnoticed.

Deliberately NOT in scope: a mechanical rewrite. The measurement is explicitly not good enough
for that, and a sweep would produce exactly the silent weakening this ratchet exists to prevent.

## Verdict

`SHIPPABLE` — every pointer resolves, the mode contract is satisfied, all four corners populated.
