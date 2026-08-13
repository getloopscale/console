# Opportunity — the two open dashboard ratchets: unanchored absence assertions (B-242) and Portuguese identifiers (B-241)

- **Date measured:** 2026-08-12
- **Domain:** `frontend-dashboard`
- **Repo:** `theo-cloud/dashboard`
- **Mode:** `review` (re-measurement of two `triaged` items against the current tree)
- **Baseline on the day of measurement:** `npx vitest run` — **378 files / 3318 tests green**; ratchets at their committed ceilings.

## Why this ran

The session goal names five items: B-270, B-244, B-242, B-235, B-241. Three of them
(`B-270`, `B-244`, `B-235`) already read `status: shipped` in `BACKLOG.md`, closed earlier the
same day. Re-opening a closed item to redo it is the duplicate work the single registry exists to
prevent, so the first act was to confirm the three closures hold against the current tree, and the
measurement then went to the two that are actually open.

## Corner 1 — Evidence

### The three shipped items, re-verified rather than assumed

| Item | Claim in the registry | Verified today | Verdict |
|---|---|---|---|
| B-270 | `publish` workflow unblocked; `check_reusable_inputs.py` is the net | `python3 .claude/scripts/check_reusable_inputs.py` → `PASS — every cross-repo input is declared by its callee` | HOLDS |
| B-244 | `data-access-layer` ratchet 53 → 3 | `src/lib/data-access-layer.test.ts` green inside the 3318 | HOLDS |
| B-235 | `ambiguous-null` ratchet 39 → 4 | `src/lib/ambiguous-null-ratchet.test.ts` green inside the 3318 | HOLDS |

`gh` cannot reach the remote from this checkout (`none of the git remotes … point to a known
GitHub host`), so the B-270 block's own statement — that v1.0.0 and v1.0.1 still carry zero
assets and only a fresh cut changes that — is **not** re-verified here. It is left standing as
written rather than restated as if it had been checked.

### B-242 — unanchored absence assertions

Measured with the committed detector (`src/test/absence-assertion.ts`), not a fresh count:

```
absence assertions        322
unanchored                102     (ceiling 102, matches disk)
files holding the form     98     (ceiling  98, matches disk)
files holding an unanchored one   58
```

The ceiling is exact on both counts, so there is no slack: the population can only move by work.

**The composition of the 102, measured rather than carried over.** The block claims "~50 / ~52".
Splitting each unanchored assertion by whether its selector core appears anywhere else in the same
file:

```
67   the text exists NOWHERE else in the file   <- the honest class of B-242
35   the text is introduced by a fixture/mock   <- the never-leak class, owned by B-276
```

This disagrees with the block's own "~50 / ~52", and the disagreement is the point: the earlier
figure came from the rejected rule that scanned every string literal (it moved 50 at once and
broke the query-kind invariant — recorded in B-276's `kill_reason_candidate`). Counting only the
core's presence outside the assertion's own text gives 35. Both are heuristics for sizing; neither
licenses a mass rewrite, and each of the 67 still has to be read.

Top files by unanchored count: `pages/infra/environments.test.tsx` (5),
`pages/promptly/detail.test.tsx` (5), `pages/auth/recovery.test.tsx` (4, all never-leak),
then a long tail of 3s and 2s across 55 more files.

### B-241 — Portuguese identifiers

Measured with the committed detector (`src/test/i18n-guard.ts` → `varrerIdentificadores`):

```
occurrences   484   (ceiling 484, matches disk)
distinct      277   (ceiling 277, matches disk)
local-only    217 names — declared and used in exactly one file
```

By declaration kind (`ts.SyntaxKind`), which the ratchet does not record and which decides the
risk:

```
190  VariableDeclaration
108  PropertySignature      <- the only kind that could carry a wire contract
 82  Parameter
 71  FunctionDeclaration
 23  InterfaceDeclaration
  8  TypeAliasDeclaration
  2  MethodDeclaration
```

**The wire-contract hazard is measured and closed.** A rename of a `PropertySignature` that
mirrors a JSON key changes the TypeScript on both sides of a test while leaving the real server
speaking the old key — green suite, broken product. So the question was asked of the contracts
themselves, not of the dashboard:

- `openapi/promptly.yaml`, `openapi/themory.yaml` — grep for the fourteen most common Portuguese
  field words: **zero matches**.
- Go `json:"…"` struct tags across `internal/` and `cmd/` — **one** Portuguese tag, in
  `internal/config/secret_test.go:81`, a test fixture unrelated to any dashboard surface.

So no Portuguese identifier in the dashboard can be a wire key: a field named `nome` bound to a
response would already be permanently `undefined`. Spot-checked in `lib/mocks/promptly-handlers.ts`,
where every Portuguese name is a LOCAL (`const busca = url.searchParams.get('search')`,
`const corpo = await req.json()`) while the payload keys around them are English.

The other measured hazard is the one the item already records and is unchanged: the reverted sweep
corrupted **prose inside comments** (`entrada` → `input_` in `sw-runtime-caching.ts`) and hit
**collisions with homonyms** already in scope. Both are properties of textual substitution.

## Corner 2 — Constraint relation

`unknown` — `rules/current-constraint.md` is `status = undeclared`. No flow instrumentation exists
across the ecosystem, so any claim here would be an assertion dressed as a measurement.

## Corner 3 — Blast radius

Confined to `theo-cloud/dashboard`. Neither item changes a public surface:

- B-242 edits test files only, plus two ceiling constants.
- B-241 renames internal identifiers. Nothing crosses the HTTP boundary (§ Corner 1), nothing is
  exported from the package (`dashboard` is a private app, `"private": true`), and comments stay
  Portuguese by the repo's convention and the item's own DoD.

The one cross-cutting artifact is `src/test/i18n-guard.ts`, whose `MARCADOR` list is shared by the
interface-text guard and the identifier ratchet. Turning the identifier guard from a ratchet into a
rejection changes what new code is allowed to be named — the deliberate point of B-241's DoD, and
the reason its own DoD says the guard goes in **last**.

## Corner 4 — Verification

Tied to each item's `dod`:

- **B-242** — `unanchored` falls below 102 and `CEILING_UNANCHORED` follows; every migrated
  assertion is proved by deleting the production behaviour and watching the test go RED, never by
  a green suite.
- **B-241** — `varrerIdentificadores` falls from 484, both ceilings follow, `npm run typecheck` is
  clean after each batch, and the suite is green in fixed order and under shuffle. The guard's own
  rejection is proved by a self-test, and the guard is enabled only once the population is zero.

Where the limit plausibly moves next: with the identifiers migrated, the residual Portuguese
surface is **file names** (`catalogo.tsx`, `composicao.ts`, `confirmacoes-de-ponteiro.tsx`,
`painel-de-abas.tsx`, `producao.tsx`) — which no detector in the repo measures and which this
item's DoD does not name. That is a separate item if anyone wants it, not a silent extension of
this one.

## What this opportunity does NOT claim

- That the 67 honest-class assertions are all fixable. Some will turn out to be never-leak
  assertions the fixture heuristic missed; those get read and recorded, not forced.
- That the whole 484 can be migrated in one pass. The reverted sweep is the evidence that it
  cannot be done textually; how far a type-aware pass gets is a measurement, not a promise.
