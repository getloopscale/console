# Implementation — dashboard-ratchet-burndown (B-242, B-241)

**Plan:** `.claude/knowledge-base/plans/dashboard-ratchet-burndown-plan.md` (verdict `SHIPPABLE`, 92.8)
**Baseline sha:** `face8c87`
**Branch:** `workspace`
**Dates:** 2026-08-12 → 2026-08-13

## What shipped

| Item | Before | After | Status |
|---|---|---|---|
| B-242 — unanchored absence assertions | 102 in 58 files | **91** | still open, ceiling lowered |
| B-241 — Portuguese identifiers | 484 occurrences / 277 names | **0 / 0** | **shipped**, ratchet → guard |

Verification on the final state: `npx tsc --noEmit` clean, `npm run lint` clean (knip ratchet
30/30), full suite green.

## Phase 1 — B-242 (T1.1, T1.2)

Eleven absence assertions anchored, each proved by mutation. The proof has two halves and the
second is the finding: with the production copy broken, the NEW case goes red **while the old
absence assertion stays green**. In none of the eleven did the absence assertion fail on its own —
which is what "cannot fail" means, measured rather than asserted.

Two defects were found in my own work by the ratchet and by the mutation:

- the billing case first asserted its three labels through a `for` over an array; the detector
  reads the SELECTOR, and a selector that is a variable has no literal to match, so all three
  stayed counted;
- the new log-viewer case was born with an unanchored absence assertion of its own (`/oops/`).

A third, in production, survived a single-site mutation and is registered as **B-277**: the
usage-label rule exists twice in `billing.tsx` (`:193` and `:315`), so mutating one left all 20
cases green.

**Composition of the 91 that remain**, re-measured after reading the first batch: the "honest
class" is not one shape but three, and only the first is fixable —

1. an empty state asserted absent while data is present → anchorable;
2. a REMOVED section asserted never to return (`'No recent previews'`) → no positive case can
   exist by construction;
3. a selector built from a VARIABLE (`overview.test.tsx:173`) → a known false positive, already
   documented in the detector's own docblock.

## Phase 2 — B-241 (T2.1 … T2.4)

### The harness

`dashboard/scripts/rename-identifiers.mjs` — the TypeScript language service's
`findRenameLocations`, not a substitution. 17 cases, each checked against a deliberately broken
harness.

Three defects were found while building it, all by measurement:

- **shorthand renames the KEY.** Asked to rename the variable in `const nome = 1; return { nome }`,
  the service rewrites the shorthand whole. Refused by default (`ShorthandGuard`), overridable with
  `--allow-shorthand` once the sites are read — the harness makes you look.
- **the alias was invisible.** The first full run passed minimal compiler options, so `@/` did not
  resolve, cross-file usages were never found, and `tsc` returned 191 errors of the shape
  "Property 'arquivo' does not exist". A rename can be type-aware and still wrong, if it is aware
  of the wrong types. Fixed by reading the real `tsconfig.json`.
- **binding elements are declarations too.** `const [target, setAlvo] = useState()` is not counted
  by the ratchet, and skipping it broke the other half of every shorthand pair.

### What the compiler could not catch, and the suite did

`tsc` clean with **25 tests red**. One cause in three costumes: an object literal the compiler does
not contextually type — inside a conditional spread, inside a `.map()` whose only type is the
return annotation, and inside a `mockResolvedValue`, which is `unknown`. In each the literal kept
the old key while its interface moved.

The worst was production, not test: `usage.ts` emitted `{ custoUsd }` and `{ razaoDoCusto }` for an
interface already saying `costUsd` / `costRationale`. A conditional spread relaxes excess-property
checking, so the object's shape changed in silence.

Two more are invisible to any rename by definition: a `vi.mock` factory key
(`fetchPromptResolvido:`) and a property name asserted as a STRING (`toHaveProperty('campo')`).

### Collateral: a guard that was reading the vocabulary

`list-state.test.ts` flagged `promptly/create.tsx` after the migration. The page still consults both
errors two lines apart; the guard matched `\berroDe\w*` and the code had become `descriptionError`.
Its English counterpart was added, restricted to a lower-case initial so a type import (`ApiError`)
cannot make a page look compliant. Same lesson B-238 and B-243 recorded here, arriving from the
other direction: last time the guard was too narrow for the code; this time the code moved out from
under the guard.

### Verified, not asserted

```
comment lines changed across the whole 159-file diff  ->  0
string literals changed across the whole diff         ->  0
```

Both measured by diffing the multiset of quoted literals and by grepping changed comment lines.
They are the two lessons the reverted sweep paid for, and they are properties of
`findRenameLocations(..., findInStrings: false, findInComments: false)` rather than of care.

## Phase 3 — the guard (T3.1, T3.2)

The population reached 0, so `identifier-language-ratchet.test.ts` became a rejection, with three
cases proving it can fail (rejects Portuguese, accepts English, ignores Portuguese comments) and a
mutation check: gutting `ehIdentificadorPT` turns the rejection case red while the
"no declaration is Portuguese" case stays green — which is precisely why the rejection case exists.

**The zero is a zero BY THIS DETECTOR** and the file says so. `rotulo`, `linguagem`, `variaveis`,
`ultimaVersao`, `resolucao`, `intencao` are still in the tree and are not in `MARCADOR`. Registered
as **B-279**, with a case in the guard that fails if the detector ever learns one of them.

T3.2 — the harness stays: B-279 needs exactly this tool, and `knip` does not see `scripts/`
(`knip.json` scopes `project` to `src/**`), so it produces no dead-code finding.

## Wiring triad

| Task | Caller | Integration test | Runtime signal |
|---|---|---|---|
| T1.1/T1.2 | the ratchet reads the corpus | the suite itself | ceiling equality, proved live by raising it |
| T2.1 | `scripts/rename-identifiers.mjs --map …` (used for the migration) | `scripts/rename-identifiers.test.mjs`, 17 cases against a real temp project | per-name outcome (`renamed` / `not-found` / `skipped` + reason) printed by the CLI |
| T2.2 | consumed by T2.3 | `scripts/identifier-map.test.mjs` | — |
| T3.1 | the guard runs in the suite | its own three cases | the failure message names the file:line of every finding |

No runtime metric applies: nothing here reaches production code paths — the migration is a rename
and the rest is test-time tooling.

## Items registered on the way

- **B-277** — the usage-label rule is duplicated in `billing.tsx`; a single-site mutation survives.
- **B-278** — `npm audit --omit=dev` reports a HIGH in `prismjs` via `react-syntax-highlighter`, in
  PRODUCTION dependencies. Found by the slice's `/deps-audit`, which adds no dependency of its own.
- **B-279** — the identifier detector's tail, measurable only now that the body is gone.
