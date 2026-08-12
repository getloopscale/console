---
slug: charts-primitive-honesty
items: B-146, B-147, B-148, B-149 (2nd bullet), B-185, B-186, B-187, B-188
date: 2026-08-11
source_opportunity: .claude/knowledge-base/discoveries/opportunities/dashboard-code-review-sweep-opportunity.md
---

# Plan — the bar and the number beside it stop disagreeing, and the chart says out loud what it currently says only in colour

## Goal

`CategoryBars` is the one chart primitive the dashboard has, rendered by five capability
overviews. Three separate defects let it **state something false**: the number cell prints a
value the bar refused to draw, a real non-zero count renders as an invisible bar, and the four
`tone` variants — one of which means *"this policy is NOT enforced"* — reach the user through
background colour alone, inside an `aria-hidden` element.

After this slice: one sanitisation feeds both the bar and the number; a non-zero count is never
invisible while a zero is never a sliver; and every tone is announced.

## Baseline Context

| File | LoC | Role |
|---|---|---|
| `dashboard/src/components/charts/category-bars.tsx` | 107 | The primitive. Exports `barWidths`, `CategoryBars`, `CategoryBar`, `CategoryBarsProps` |
| `dashboard/src/components/charts/category-bars.test.tsx` | — | 5 `barWidths` cases + render cases asserting the table role and row names |
| `dashboard/src/pages/promptly/components/projections.ts` | — | Exports `promptsPorAmbiente`, `resumoCatalogo`; holds `SEM_AMBIENTE` |
| `dashboard/src/pages/skills/overview.tsx` | — | `porCategoria` at `:117`, chart gate at `:263` |

**Callers of `CategoryBars` (5, all verified by grep):** `pages/promptly/overview.tsx`,
`pages/memory/overview.tsx`, `pages/trust/overview.tsx`, `pages/skills/overview.tsx`,
`pages/rag/overview.tsx`.

**Callers that pass a `tone` (3, verified):**

- `trust/overview.tsx:227` — `tone: c.enforced ? 'muted' : 'warning'`. **This is the sharp one:
  `warning` is the only carrier of "this policy is not enforced".**
- `rag/overview.tsx:111,113` — `positive` for high confidence, `warning` for low.
- `promptly/overview.tsx:166` — `muted` for the `not promoted` bucket.

**Git sha at plan time:** `4760cb56`.

**Baseline:** `npm test` 353 files / 2927 tests green; `npm run typecheck` clean; `npm run lint`
clean.

**Glossary.** *Bucket* — one `CategoryBar`. *Track* — the grey full-width `div` a bar is drawn
inside. *Settled-success* — a query gate that is true only on `isSuccess`, never on
`!isLoading && !error` (the shape B-149/B-150/B-151 were about).

**Architecture boundary.** `src/components/charts/` is presentation. It must not import from
`src/hooks/` or `src/lib/http/`. The arithmetic stays a pure exported function so a mutation test
can reach it, per the rationale already written into the file at `:41-43`.

## Evidence (measured 2026-08-11, re-verified against the current tree)

- **B-148** — `category-bars.tsx:100` prints `format(bar.value)`, the **raw** value, while the bar
  at `:96` uses `widths[i]` from the sanitising `barWidths` (`:48`). Default formatter is
  `String(v)`, so a `NaN` reaches the DOM beside a 0%-wide bar.
- **B-185** — `category-bars.tsx:54` is `clean.map((v) => (v / max) * 100)` with **no floor**.
  Computed: `barWidths([3, 9000]) -> [0.0333, 100]`. A real count of 3 renders as nothing.
- **B-186** — `category-bars.tsx:82-84` opens `<table><caption><tbody>`;
  `grep -n "thead\|columnheader" src/components/charts/` returns nothing. The bar occupies its own
  `<td>` (`:90-99`) whose only content is an `aria-hidden` div — so assistive tech reads a
  three-column table with one permanently empty column. The module's own docblock at `:19-20`
  claims *"the bar is drawn inside the value cell"*, which the code does not do.
- **B-187** — `TONE` (`:57-62`) maps four variants to background classes applied at `:95`, inside
  the `aria-hidden="true"` track at `:93`. `grep -rn "tone" src/components/charts/` matches only
  the source file — **zero occurrences in the test file**.
- **B-188** — `memory/overview.test.tsx:158-168` asserts the row's accessible *name*
  (`/entities extracted\s*0/i`), never a width. Honest correction to the item: the primitive's own
  suite (`category-bars.test.tsx:49-53`) *would* fail if an unconditional `Math.max(2, …)` floor
  were restored, so "has no regression test" overstates it. What is genuinely missing is a case
  asserting a **real zero beside a positive max**.
- **B-146** — `projections.ts:77` `const SEM_AMBIENTE = 'not promoted'` counts prompts with **zero
  labels** (`:102`), while the KPI card `Not promoted` (`promptly/overview.tsx:125-126`) renders
  `resumo.naoPromovidos`, a different predicate (`latestVersion > maiorVersaoServida`, `:130`).
  `catalogo.tsx:51-54` already names the no-label slice `No environment`.
- **B-147** — `projections.ts:113` `a.label.localeCompare(b.label)` over keys built unfiltered at
  `:98`. **Reproduced by execution** during measurement: replaying the body in node with
  `[{labels:[{label:'prod',version:1}]},{labels:[{version:1}]}]` threw
  `TypeError: Cannot read properties of undefined (reading 'localeCompare')`.
- **B-149, 2nd bullet** — the settled-success gate at `skills/overview.tsx:263` is fixed, but
  `porCategoria = catalogByCategory(paginas)` (`:117`) reads `paginas` while the table below reads
  `acervo = paginas.length > 0 ? paginas : pagina` (`:133`). On the first frame after success
  `paginas` is still empty, so the chart says "Nothing recorded in this window." above a populated
  table.

## ADRs

### ADR-1 — one geometry function, not two sanitisers

**Decision.** Replace `barWidths(values): number[]` with
`barGeometry(values): ReadonlyArray<{ value: number; widthPct: number }>`, and have the number
cell print `geometry[i].value` rather than `bar.value`.

**Rationale.** B-148 is not "the cell forgot to sanitise" — it is that *two* places decide what a
value is, so they are free to disagree, and today they do. A second sanitiser call in the cell
would fix today's symptom and leave the divergence available to the next edit. Returning both
numbers from one pass makes the disagreement unrepresentable.

**Alternatives considered.**
1. *Sanitise in the cell too* — smallest diff, keeps two call sites of the same rule. Rejected:
   it re-creates the exact shape the item is about.
2. *Sanitise at the caller (all five overviews)* — pushes the rule into five files and makes the
   primitive trust its input. Rejected: five copies of one rule, and the primitive is the only
   place that knows a width must be drawable.
3. *Keep `barWidths` and add a sibling `barValues`* — two functions traversing the same array with
   the same predicate. Rejected: same divergence risk, more surface.

**Cost.** `barWidths` is exported and directly unit-tested. Renaming it is a breaking change to a
module-internal API with two known consumers (the component and its test). Both are in this slice.

### ADR-2 — the floor applies to non-zero values only

**Decision.** `widthPct = value <= 0 ? 0 : Math.max(MIN_VISIBLE_PCT, (value / max) * 100)`, with
`MIN_VISIBLE_PCT = 1.5`.

**Rationale.** B-185 and the defect B-129 fixed are *inverses of each other*, and the history is
the reason to be careful: an unconditional `Math.max(2, …)` made a genuine zero draw a visible
sliver, which read as "almost something". Removing it fixed that and introduced this one. The
conditional floor is the only form that satisfies both — a zero draws nothing, a real count is
never invisible.

**Alternatives considered.**
1. *Leave it unfloored* — accepts that `[3, 9000]` renders the 3 as blank. Rejected: the chart
   exists to make a distribution legible; a category present but undrawable is the failure it is
   supposed to prevent.
2. *Log scale* — makes small values visible without a floor. Rejected: a log axis on an unlabelled
   bar is a misreading waiting to happen, and there is no axis to declare the scale on.
3. *`min-width` in CSS on the inner div* — same effect, expressed where a mutation test cannot
   reach it. Rejected for the reason the file already states at `:41-43`.

**Value of `MIN_VISIBLE_PCT`.** 1.5% of a track that is `w-full` in a card is ~4-6 px at common
widths — enough to be seen, small enough that it cannot be mistaken for a meaningful proportion.
Stated as a heuristic, not a measured threshold.

### ADR-3 — tone gets an accessible carrier; the API is not dropped

**Decision.** Keep the four variants. Render, inside the value cell, a visually-hidden suffix
naming the tone, overridable per bar via a new optional `toneLabel`. `default` announces nothing.

**Rationale.** Colour is the sole carrier today (WCAG 1.4.1). The obvious parsimonious move —
delete an unasserted API (ladder rung 1) — is wrong here **because the measurement shows the API
carries product meaning**: `trust/overview.tsx:227` uses `warning` to mean "this policy is not
enforced", and dropping it would delete that reading rather than fix it.

`toneLabel` exists because the primitive cannot know what a tone means on a given screen. Falling
back to the variant name keeps the announcement honest when a caller does not say.

**Alternatives considered.**
1. *Delete `tone`* — rejected above; it would remove a real signal.
2. *Announce a fixed phrase per variant ("needs attention")* — invents product copy the primitive
   has no standing to write, and would be wrong on at least one of the three call sites.
3. *`aria-label` on the row* — collides with the row's accessible name, which the existing tests
   (and `memory/overview.test.tsx:158`) match on.

### ADR-4 — two logical columns, not three

**Decision.** Move the bar inside the value cell. The table becomes `Category | Value`, with a
`<thead>` carrying `scope="col"` headers.

**Rationale.** Closes B-186 and, in the same edit, makes the module docblock's claim at `:19-20`
true. A column whose every cell is `aria-hidden` is a column that exists only to be skipped.

**Alternatives considered.** *Keep three columns and give the bar column an `sr-only` header* —
rejected: it names a column that carries nothing, which is worse than not having it.

## Coverage Matrix

Every claim in the Goal maps to at least one task.

| Goal claim | Item(s) | Task |
|---|---|---|
| one sanitisation feeds both the bar and the number | B-148 | T1 |
| a non-zero count is never invisible | B-185 | T2 |
| a zero is never a sliver (kept) | B-188 | T2, T3 |
| every tone is announced | B-187 | T4 |
| the accessible reading has column headers and no empty column | B-186 | T5 |
| the chart stops disagreeing with the table beside it | B-149 | T6 |
| two different quantities stop sharing one label | B-146 | T7 |
| a malformed label entry stops unmounting the page | B-147 | T8 |

## Dependencies

No new dependency. Everything below is stdlib (`Math.max`, `Array.prototype.map`) or already
installed (`react`, `@testing-library/react`, `vitest`). Parsimony ladder: stopped at **rung 2**
for the arithmetic and **rung 6** for the markup — nothing here needs a library.

| Package | Version | Status | Rule 9 |
|---|---|---|---|
| — | — | no new dependency added | n/a |

## Tasks

### Phase 1 — the primitive

#### T1 — one geometry, so the bar and the number cannot disagree (B-148)

**Why this step.** Everything else in the primitive is easier once there is a single sanitised
source; T2 then changes one expression rather than two.

**TDD.**

```
test_the_number_cell_prints_the_sanitised_value_not_the_raw_one
  Arrange: bars = [{label:'a', value: NaN}, {label:'b', value: 10}]
  Act:     render <CategoryBars title="t" bars={bars} />
  Assert:  the row named /a/ contains "0" and does NOT contain "NaN"
  RED because: the cell prints format(bar.value) === String(NaN) === "NaN"

test_barGeometry_returns_value_and_width_from_one_pass
  Arrange: values = [10, -3, NaN, Infinity]
  Act:     barGeometry(values)
  Assert:  [{value:10,widthPct:100},{value:0,widthPct:0},{value:0,widthPct:0},{value:0,widthPct:0}]
```

**Acceptance criteria.** `barWidths` no longer exists; `barGeometry` is exported and covered;
`category-bars.tsx` has exactly one call to it; no caller of `CategoryBars` changes.

#### T2 — a real count is never invisible, a zero never a sliver (B-185, B-188)

**Why this step.** This is the pair the history says must be tested together — fixing either one
alone is how the codebase got here.

**TDD.**

```
test_a_small_nonzero_value_still_draws_a_visible_bar
  Arrange: values = [3, 9000]
  Act:     barGeometry(values)
  Assert:  result[0].widthPct >= 1.5
  RED because: (3/9000)*100 === 0.0333

test_a_genuine_zero_draws_nothing_even_beside_a_large_max   <- the B-188 gap
  Arrange: values = [0, 9000]
  Act:     barGeometry(values)
  Assert:  result[0].widthPct === 0   (exactly, not "small")
  RED-proof: this is the case that fails if T2's floor is written unconditionally
```

**Acceptance criteria.** Both tests present; the existing
`barWidths([10,-3,NaN,Infinity]) -> [100,0,0,0]` case survives as `barGeometry`, unchanged in
meaning.

#### T3 — the zero-sliver regression is asserted at the screen, not only in the primitive (B-188)

**Why this step.** The primitive test proves the arithmetic. `memory/overview.test.tsx:158` claims
to prove the screen and does not — it matches the row's accessible name, which is identical
whether the bar is 0% or 2% wide.

**TDD.**

```
test_a_zero_bucket_renders_a_zero_width_bar_on_the_memory_overview
  Arrange: the existing memory overview fixture with entities_extracted = 0 beside a positive max
  Act:     render
  Assert:  the bar element inside the row named /entities extracted/ has style width "0%"
  RED because: no test reads the width today
```

**Acceptance criteria.** The assertion reads the rendered width, not the row name.

#### T4 — every tone is announced, not only coloured (B-187)

**Why this step.** `trust/overview.tsx:227` is the call site where an unannounced tone is a
compliance reading lost.

**TDD.**

```
test_a_warning_tone_is_announced_to_assistive_technology
  Arrange: bars = [{label:'pii-redaction', value: 4, tone:'warning'}]
  Act:     render
  Assert:  the row's text content includes "warning"
  RED because: tone reaches the DOM only as a class inside aria-hidden

test_toneLabel_overrides_the_variant_name
  Arrange: bars = [{label:'pii-redaction', value: 4, tone:'warning', toneLabel:'not enforced'}]
  Assert:  row text includes "not enforced" and not "warning"

test_the_default_tone_announces_nothing
  Arrange: bars = [{label:'a', value: 1}]
  Assert:  row text is exactly the label and the value
```

**Acceptance criteria.** All four variants exercised; `trust/overview.tsx` passes a `toneLabel`
naming what its `warning` means.

#### T5 — the accessible reading gains column headers and loses the empty column (B-186)

**Why this step.** Closing it in the same slice as T4 means the table's accessible structure is
settled once rather than twice.

**TDD.**

```
test_the_chart_exposes_column_headers
  Assert:  getAllByRole('columnheader') has length 2, named /category/i and /value/i
  RED because: grep thead|columnheader over src/components/charts/ returns nothing

test_the_bar_lives_inside_the_value_cell
  Assert:  each row has exactly 1 <th scope=row> + 1 <td>, and the bar track is within that <td>
  RED because: the bar is a separate <td> today
```

**Acceptance criteria.** The docblock claim at `:19-20` becomes true; existing row-name
assertions in the five overviews still pass (the accessible name is unchanged).

### Phase 2 — the consumers

#### T6 — the chart reads the same collection the table reads (B-149, 2nd bullet)

**Why this step.** The settled-success gate landed; this is the half that did not, and it produces
the same false statement ("Nothing recorded") the gate was added to prevent.

**TDD.**

```
test_the_category_chart_is_not_empty_while_the_table_below_has_rows
  Arrange: a first successful page where `paginas` is empty and `pagina` has rows
  Act:     render skills overview
  Assert:  the "By category" region does NOT show "Nothing recorded in this window."
  RED because: porCategoria reads `paginas`, the table reads `acervo`
```

**Acceptance criteria.** `porCategoria` is derived from `acervo`; declaration order in
`skills/overview.tsx` adjusted so `acervo` precedes it.

#### T7 — two quantities stop sharing one label (B-146)

**Why this step.** Same screen, same word, two different predicates — a reader cannot tell which
number they are looking at.

**TDD.**

```
test_the_no_label_bucket_is_named_No_environment_not_not_promoted
  Arrange: rows where one prompt has zero labels
  Act:     promptsPorAmbiente(rows)
  Assert:  a bucket labelled 'No environment' exists and none is labelled 'not promoted'
  RED because: SEM_AMBIENTE === 'not promoted'
```

**Amendments required (these tests pin the current wording and MUST turn red, then be
updated):** `promptly/overview.test.tsx:63` (`/^Not promoted2$/`) and `:221`
(`/not promoted\s*1/`); `promptly/overview.tsx:166` matches on the literal `'not promoted'` to
assign the muted tone and must follow the rename.

**Acceptance criteria.** The KPI card keeps `Not promoted`; the bucket reads `No environment`,
matching `catalogo.tsx:51-54`.

#### T8 — a malformed label entry stops unmounting the page (B-147)

**Why this step.** It is the only item in this slice that takes the whole screen down, and it was
reproduced by execution.

**TDD.**

```
test_a_label_entry_without_a_label_field_does_not_throw
  Arrange: rows = [{labels:[{label:'prod',version:1}]}, {labels:[{version:1}]}]
  Act:     promptsPorAmbiente(rows)
  Assert:  does not throw; the malformed entry is counted as No environment
  RED because: localeCompare is called on undefined (reproduced 2026-08-11)
```

**Acceptance criteria.** Non-string / empty labels are dropped at ingestion in **both**
`promptsPorAmbiente` and `resumoCatalogo` — `resumoCatalogo:118` does `ambientes.add(l.label)`
with the same unguarded access and must be fixed in the same task, or the next reader will fix
one and leave the other.

## Wiring triad

| Pillar | How it is satisfied |
|---|---|
| Caller | Every change is inside a primitive rendered by five production overviews; T6/T7 edit production call sites directly. No new module without a caller. |
| Integration test | T3, T4 (trust call site), T5 and T6 assert through a rendered page, not the pure function. |
| Runtime metric | **Deliberately none.** This slice changes rendering of already-rendered data — there is no new runtime behaviour an operator could watch, and adding a counter for "a bar was drawn" would be instrumentation theatre. Recorded here so the omission is a decision, not an oversight. |

## Failure scenarios

No external I/O is introduced or touched by this slice — `CategoryBars` and `projections.ts` are
pure given their props. The failure modes that exist are **malformed input**, and they are the
subject of T1 and T8 rather than a separate section: `NaN`/`Infinity`/negative values (T1),
missing `label` field (T8), empty collection (already handled at `:74-76`).

## Concurrency tests

**(none — single-threaded.)** No mutex, lock, atomic, async iteration, channel or shared mutable
state is introduced. `promptsPorAmbiente` builds a `Map` local to one call.

## Drawbacks & Risks

1. **`barWidths` → `barGeometry` is a rename of a tested export.** If any consumer outside this
   repo imported it, this breaks them. Measured: `grep -rn "barWidths" src` yields the component
   and its test only, and the module is not in any package export. Risk accepted, and it is why
   the rename is in T1 rather than spread across the slice.
2. **`MIN_VISIBLE_PCT = 1.5` is a heuristic, not a measurement.** Too high and a small category
   over-reads; too low and it is invisible again. Mitigation: it is a named constant with the
   reasoning beside it, and T2 pins both ends (zero exact, non-zero floored).
3. **T7 renames user-visible copy.** Two tests pin the old wording and will go red. That redness
   is correct and the plan says so, but a reviewer who sees only the diff could read it as a
   weakened test. Mitigation: the amendment is its own commit, referencing B-146.
4. **T4 adds text to every toned row.** Screen readers will announce more. If a call site's tone
   is decorative rather than semantic, that announcement is noise. Measured: all three call sites
   are semantic. `default` — the only decorative variant — announces nothing.
5. **T5 changes DOM structure.** Five overviews have render tests matching row names. The
   accessible name is composed of the row header plus the value cell, both preserved, so they
   should pass — but this is the task most likely to surface an unexpected red.

## Unresolved Questions

1. **Should `MIN_VISIBLE_PCT` be shared with any future chart primitive?** Not yet — there is one
   primitive. Revisit at the second (Rule of 3 says wait for the third).
2. **`trust/overview.tsx`'s `toneLabel` wording.** The plan requires one; "not enforced" is the
   phrase the surrounding code uses, but the product owner may prefer other copy. Proceeding with
   "not enforced" and flagging it — it is one string, changed in one place.

## Prior Art

- **In-repo, and the reason ADR-2 is conditional:** B-129 introduced an unconditional
  `Math.max(2, …)` floor; B-129's own follow-up removed it because a zero drew a sliver. This
  slice is the third position on the same line and must satisfy both earlier readings.
- **In-repo:** `src/lib/list-state.ts` (B-167) is the precedent for putting a rendering *decision*
  in a pure exported function so it is testable without a render. `barGeometry` follows it.
- **In-repo:** `TrendChart` in `@usetheo/ui` carries a separate accessible table beside its SVG.
  `CategoryBars` exists precisely to avoid that duplication (docblock `:16-24`); T5 finishes the
  job by making the single table a complete one.
- **Standard:** WCAG 2.2 SC 1.4.1 (Use of Color) is what makes T4 a defect rather than a
  preference; SC 1.3.1 (Info and Relationships) is what T5 answers.

## Test Plan

| Level | What |
|---|---|
| Unit | `barGeometry` — sanitisation, floor, exact zero, empty, all-zero |
| Unit | `promptsPorAmbiente` / `resumoCatalogo` — malformed label entries, bucket naming, ordering |
| Integration (render) | `CategoryBars` — column headers, single value cell, tone announcement × 4 variants, `toneLabel` override |
| Integration (render) | memory overview — zero-width bar; skills overview — chart not empty over a populated table; promptly overview — renamed bucket |
| Regression | Full suite must stay green at ≥ 2927 tests |

## Definition of done (all must hold)

- [ ] `barWidths` is gone; `barGeometry` is the single source of both numbers
- [ ] `barGeometry([3,9000])[0].widthPct >= 1.5` and `barGeometry([0,9000])[0].widthPct === 0`
- [ ] The chart exposes exactly 2 column headers and no `aria-hidden`-only column
- [ ] All four tones are exercised by a test and announced to assistive technology
- [ ] `skills/overview.tsx` derives `porCategoria` from `acervo`
- [ ] `promptsPorAmbiente` labels the no-label bucket `No environment`; the KPI keeps `Not promoted`
- [ ] A label entry missing `label` neither throws nor is counted as a named environment, in both
      `promptsPorAmbiente` and `resumoCatalogo`
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all green
- [ ] `CHANGELOG.md` `[Unreleased]` updated (Unbreakable Rule 6)
</content>
