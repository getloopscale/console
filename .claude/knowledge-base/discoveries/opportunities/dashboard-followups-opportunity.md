# Opportunity — the five followups the ratchet-burndown slice left open (B-242, B-277, B-278, B-279, B-280)

- **Date measured:** 2026-08-13
- **Domain:** `frontend-dashboard`
- **Repo:** `theo-cloud/dashboard`
- **Mode:** `review` (four of the five were registered hours earlier by this repository's own review; this measures them)
- **Baseline:** `4a63fd9e`, tree clean, `workspace`. Fixed-order suite 380 files / 3361 tests green.

## Why this ran

Four of these items (B-277, B-278, B-279, B-280) were registered `raw` by the adversarial review of
the previous slice, and one (B-242) came out of it with a lower number and an open composition.
`cycle-backlog` is explicit that a `raw` item carries a hypothesis and not evidence — so this is the
measurement that either turns each into work or kills it.

Two of the four were registered by me, and **one of them is wrong**. That correction is the first
finding below, because an item that misnames its own severity sends the next person to the wrong
dependency.

## Corner 1 — Evidence

### B-278 — the item misattributed the HIGH, and misstated what reaches the bundle

The block says: *"`prismjs` carrega uma vulnerabilidade HIGH e entra no bundle por
`react-syntax-highlighter`"*. Measured with `npm audit --omit=dev --json` plus `npm ls`:

| Package | Severity | Advisory | Path |
|---|---|---|---|
| `nanoid` | **HIGH** (CVSS 5.9) | GHSA-2v37-7h3g-55p8 — infinite loop when size is zero | `@theokit/ui@1.3.2 → vite@6.4.3 → postcss@8.5.25 → nanoid@3.3.16` |
| `prismjs` | **MODERATE** (CVSS 4.9) | GHSA-x7hr-w5r2-h6wg — DOM Clobbering | `react-syntax-highlighter@15.6.6 → refractor@3.6.0 → prismjs@1.27.0` |
| `refractor`, `react-syntax-highlighter` | MODERATE | via `prismjs` | — |

Two corrections to my own block:

1. **The HIGH is `nanoid`, not `prismjs`.** I read the audit's last printed block and attributed
   the summary's "1 high" to it. `prismjs` is MODERATE.
2. **`nanoid` does not reach the bundle; `prismjs` does.** `nanoid` arrives through
   `@theokit/ui`'s declaration of `vite` as a *runtime* dependency — a packaging defect in that
   package — and vite/postcss are build tooling that Rollup never bundles into the app.
   `react-syntax-highlighter` IS a production dependency (`package.json § dependencies`) and is
   imported by `pages/rag/components/code-block.tsx` and `markdown-view.tsx`, so the vulnerable
   `prismjs@1.27.0` is shipped.

So the severity that matters for the product is the **MODERATE DOM-Clobbering in a package we
render untrusted-ish markdown with**, and the HIGH is a supply-chain fact about a dev-time
transitive that a bundler drops. Both are real; they are not the same kind of real, and the block
said the opposite of each.

`fixAvailable` for the prismjs chain is `react-syntax-highlighter@16.1.1`, **semver major**.

### B-277 — measured, and it is three sites, not two

```
src/pages/settings/billing.tsx:193   label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
src/pages/settings/billing.tsx:314   <span …>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
src/pages/rag/connectors.tsx:61      provider.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
```

The item registered the two in `billing.tsx`. A third does the same job one separator apart. There
is no existing helper: `src/lib/formatting/format.ts` holds `humanizeAuthor`, `formatNumber`,
`formatDuration`, `shortId` and eight more, and nothing that turns a machine key into a label.

Three call sites of one piece of knowledge is the Rule-of-3 threshold this repo's own DRY rule
names, so the extraction is justified rather than speculative.

### B-279 — the tail is 46 occurrences over 16 words, and the earlier sizing was noise

The item's evidence table came from `grep -rlw`, which counts FILES MENTIONING a word — including
Portuguese prose in comments, which this repo permits. It said `inteiro` 84 and `mostrar` 37, and
warned in the block itself that the number "serve para dimensionar, nao para ser o teto".

Measured properly, by walking the same declaration kinds `varrerIdentificadores` counts:

```
   8 occ   bruto                          2 occ   normalizar
   7 occ   variaveis (4 names)            2 occ   vistas
   6 occ   ultima    (3 names)            2 occ   endereco (2 names)
   5 occ   resolucao (2 names)            1 occ   linguagem
   4 occ   rotulo    (2 names)            1 occ   ultimo
   2 occ   rotulos                        1 occ   mostrar
   2 occ   variavel  (2 names)            1 occ   inteiro
   2 occ   intencao  (2 names)            0 occ   bruta

TOTAL 46 occurrences
```

`inteiro` is **1 declaration**, not 84 files' worth — the difference between the two numbers is
exactly the prose the convention allows. Every one of the 16 is unambiguously Portuguese; none is
an English word or a one-accent cognate, so all 16 pass the same admission test `MARCADOR`'s
docblock states.

**Where they go matters and is measured:** `SUPLEMENTO_IDENTIFICADORES` is read ONLY by
`ehIdentificadorPT`. `varrerInterface` — the ACTIVE guard over on-screen text — reads `MARCADOR`
alone. So adding to the supplement tightens the identifier guard and cannot widen what the
interface guard rejects, which is the exact hazard B-279's own DoD asks to be checked.

### B-280 — the cause is starvation, and the lever is measured

Three facts already established (two runs, plus isolation):

- a **different file** fails each run (`lens/overview.test.tsx`, then `lens/evaluators.test.tsx`);
- the failure is always `Test timed out in 20000ms`, never an assertion;
- both files pass **3/3 in isolation** under `--sequence.shuffle`, and neither was touched by the
  slice that surfaced the failure.

The cost distribution from a full run is where the lever is:

```
transform 29.69s   setup 144.08s   import 570.86s   tests 461.23s   environment 732.22s
```

**Environment setup is the single largest line, larger than the tests themselves.** And it is
mostly unnecessary:

```
test files                              379
touch the DOM (render/screen/document)  227
already declare `@vitest-environment node`  22
touch neither                           130   <- paying jsdom for nothing
```

130 files — 34% — construct a jsdom they never use. That is the measured, non-cosmetic fix, and it
is the opposite of the shortcut the item refuses (raising the timeout a second time).

### B-242 — of the 91 remaining, 16 are anchorable and the rest are two other problems

Classified by asking whether the queried text exists in the SCREEN the test owns (`x.test.tsx` →
`x.tsx`), which is what decides whether a positive case can exist at all:

```
ANCHORABLE          16   the screen holds the text — a positive case is possible
fixture              25   the text is introduced by the test's own fixture (B-276's class)
absent-everywhere    50   removed copy, a variable selector, or text owned by another component
```

The 16 are the honest target. The 50 are not work on this item: an assertion that the copy REMOVED
in a past slice must not come back has no positive case by construction, and a selector built from
a variable is a documented false positive of the detector.

## Corner 2 — Constraint relation

`unknown` — `rules/current-constraint.md` is `status = undeclared`, and no flow instrumentation
exists across the ecosystem. Claiming a constraint here would be an assertion dressed as a
measurement.

## Corner 3 — Blast radius

Confined to `theo-cloud/dashboard`, with one exception worth naming.

| Item | Radius |
|---|---|
| B-242 | test files only |
| B-277 | one new helper in `lib/formatting/format.ts` + 3 call sites |
| B-279 | `src/test/i18n-guard.ts` supplement + 46 declarations. Touches the shared `i18n-guard` module, but the SUPPLEMENT half only — `varrerInterface` is unaffected (measured above) |
| B-280 | `vitest.config.ts` and up to 130 test files' environment pragma. Changes how the whole suite runs, so a mistake here is visible everywhere at once |
| B-278 | **reaches beyond this repo.** The `nanoid` HIGH exists because `@theokit/ui@1.3.2` declares `vite` as a runtime dependency; the fix belongs in that package, not here. The `prismjs` MODERATE needs a semver-major bump of a rendering dependency |

B-278 is the only one whose correct fix is partly in another repository, which per
`discover-opportunity-golden-rule.md § 3` means the plan needs an ADR.

## Corner 4 — Verification

| Item | How we will know |
|---|---|
| B-242 | `unanchoredIn` < 91 with the ceiling following; each anchoring proved by breaking the screen and watching the NEW case go red |
| B-277 | one owner; mutating it reddens at least one case in each of the three consumers' tests |
| B-278 | `npm audit --omit=dev` reports no HIGH and no MODERATE reaching the bundle, OR an allowlist entry with sunset and the reason |
| B-279 | the 16 words are in the supplement, the 46 occurrences are migrated, `varrerIdentificadores` is 0 again, and `i18n-guard.test.ts` (interface text) stays green |
| B-280 | `npx vitest run src --sequence.shuffle` green N consecutive times, with N and the machine load recorded — and the environment line measurably smaller |

Where the limit plausibly moves next: with 130 files off jsdom, the next bottleneck is `import`
(570s), which is module-graph cost and would need a different instrument entirely.

## What this opportunity does NOT claim

- That the 16 anchorable assertions are all fixable. Each still has to be read; the classifier is a
  heuristic over one file pair and it can be wrong in both directions.
- That moving 130 files to `node` is free. Some will fail because they touch a global the jsdom
  environment happens to provide, and each of those is a finding, not a rollback.
- That the `prismjs` bump to 16.1.1 is safe. It is semver-major on a rendering path; the
  measurement here is that a fix EXISTS, not that it drops in.
