# Code-quality audit — dashboard code-review sweep (B-131..B-236)

- **Date:** 2026-08-11
- **Scope:** the 16 commits since the `1.0.0` release (`6c618990..HEAD`) — 81 files, +5704 / −724
- **Languages enabled:** TypeScript (`rules/code-quality-languages.txt`)
- **Verdict:** `PASS_WITH_CAVEATS`

## Detectors

| Detector | Tool | Result |
|---|---|---|
| D1 — dead code | `knip` | **Unused files: 0. Unused runtime exports: 0. Duplicate exports: 0. Unlisted dependencies: 0. Unlisted binaries: 0.** |
| D1 — dead types | `knip` | 84 exported types with no importer — the ratcheted class (see caveat) |
| D2 — symbol fabrication | `tsc --noEmit` | Clean. No production reference to an undefined symbol |
| D3 — cross-package wiring | `eslint` (layer boundaries, `no-restricted-imports`) | Clean |
| D4 — mutation | manual, per changed guard | See § Mutation verification |

## Command gates

| Gate | Result |
|---|---|
| `npm test` | **359 files / 3031 tests green** (baseline at cycle start: 353 / 2927) |
| `npm run typecheck` | clean (`tsc --noEmit` + the e2e project) |
| `npm run lint` | clean — `eslint`, `check-guard-pairs`, `check-knip-ratchet` |
| `npm run size` | **TOTAL EAGER 305.35 kB brotli / 320 kB hard gate** — pass |
| `max-lines` budget | respected; **four annotations DESCENDED** (703→685, 555→545, 521→513, 513→513) |
| knip type ratchet | 85 → **84**, tightened |
| absence-assertion ratchet | held at 98 — no new file entered the population |
| LoC budget ratchet | held; every exempt file at or below its annotation |

## Mutation verification

Every guard or fix whose correctness is not self-evident was verified by mutating the production
code and confirming the test goes red. This is recorded because a detector that cannot fail is the
defect this whole sweep is about.

| What | Mutation applied | Result |
|---|---|---|
| `barGeometry` floor | removed the floor entirely (the B-185 state) | RED — 1 test |
| `barGeometry` floor | made the floor unconditional (the B-188 state) | RED — 1 test |
| `colecaoDescrita` | returned the accumulated array only | RED — 1 test |
| `tokenGeneration` guard | replaced the comparison with `true` | RED — 1 test |
| docs numeric guard | edited a document's stated count | RED, naming both numbers |
| `list-state` page guard | renamed `estadoDaLista` at one call site | RED, naming the page |

**One guard failed its own mutation check and was tightened as a result.** The first version of the
`list-state` page guard accepted five loose alternatives; a page whose error consultation had been
removed still passed, because the regex matched something unrelated elsewhere in the file. A guard
that approves for the wrong reason is not a guard. It now accepts only the two sanctioned forms.

## Caveats (why `PASS_WITH_CAVEATS` and not `PASS`)

1. **84 exported types with no importer.** Pre-existing debt, governed by
   `scripts/check-knip-ratchet.mjs`, which this cycle **tightened** from 85 to 84. It is a soft
   floor by the golden rule's rubric (`dead_internal_symbol` class), not a cap.
2. **`SSEStreamEvent` is now in that list.** It gained `receivedAt` (B-224) and is exported for
   consumers that read the event shape; knip counts it as unimported because consumers use it
   structurally. Not new debt, but named here rather than left to be discovered.
3. **B-235 is deliberately unclosed.** `cloudFetch`'s default `T | null` still collapses five
   outcomes. The ambiguity was mitigated where it produced a visible defect (B-171) and documented
   at the source; discriminating the signature is a breaking change across 151 importers and is
   recorded as an open question, not taken silently.
4. **B-183 is partially done.** The duplicated `Delivery` interface was extracted; the 545-line
   duplicated CRUD was not. The item stays open with a note saying which half.

## What was NOT audited

- **Runtime behaviour in a browser.** No live-test ran; every claim here is from static analysis
  and the test suite. Screens were not exercised against `app-dev.usetheo.dev`.
- ~~Bundle size~~ — **measured after this file was first written.** `npm run size` passes:
  **TOTAL EAGER 305.35 kB brotli against the 320 kB hard gate.** Recorded as a correction rather
  than edited into the original claim, because "not measured" and "measured and fine" are
  different facts and the first one was written here.
- **Mutation score as a percentage.** No `stryker` run. The mutation verification above is
  per-guard and manual, which is stronger evidence for those six and no evidence for anything else.
