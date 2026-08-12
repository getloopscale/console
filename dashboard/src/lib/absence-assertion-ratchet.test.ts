// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { absenceAssertionsIn, unanchoredIn, selectorCore } from '@/test/absence-assertion';

const SRC = resolve(__dirname, '..');

/**
 * Absence-assertion ratchet (B-162 · family F4 · sharpened by B-242).
 *
 * ## The defect this freezes
 *
 * `expect(queryBy…).toBeNull()` only proves something when the queried element EXISTS in the case
 * that passes and DISAPPEARS in the one that fails. When it is absent in both, the assertion is
 * satisfied by correct behaviour and by the defect alike — and no change to the code can turn it
 * red.
 *
 * Not a hypothesis. Measured on 2026-08-11, by execution, in four cases:
 *
 *   - the skills-chart guard was DELETED and its 10 tests stayed green, because `CategoryBars`
 *     returns a `<p>` and no table when the bars are empty, and every page derives empty bars from
 *     a failed read: `queryByRole('table')` is null in both worlds;
 *   - the zero-sliver floor was RESTORED and 18 tests stayed green;
 *   - `capability-overview.test.ts`'s `rendered()` matched a JSX tag inside a comment — the hole
 *     its own docblock claimed to have closed;
 *   - the trust chart came up green with the catalogue BROKEN (B-227, since fixed).
 *
 * ## Why a ratchet and not a ban
 *
 * The form is not wrong in itself: against an element that exists in the happy case it is the right
 * assertion. Banning it would produce 97 suppressions and no reading. What is wrong is the
 * POPULATION growing with nobody looking — so the number freezes and only goes down.
 *
 * When fixing a file, lower the ceiling. When adding a test, prefer asserting the absence of an
 * element that IS present in the passing case (a heading, a label) over one that disappears in both.
 *
 * ## Third measurement (2026-08-12), after a review gutted the second
 *
 * The second measurement said 116 unanchored out of 327. A reviewer mutated the detector and
 * proved the self-test was decorative — it held a hardcoded COPY of the anchor rule, so widening
 * `(?:get|find)` to accept `query` took the count from 116 to 15 with 6/6 green.
 *
 * Rebuilt in `lib/absence-assertion.ts`, with each correction measured on its own:
 *
 *   340 / 117  raw
 *   337 / 116  comments stripped     — 3 assertions that live only inside a comment or an it.skip
 *   336 / 116  balanced parentheses  — 1 selector whose arguments contain a nested call
 *   309 / 110  assertions only       — 27 occurrences were `const el = queryBy…`, which assert
 *                                      NOTHING; 6 of them were reported as unanchored assertions
 *                                      that did not exist
 *   309 / 110  queryBy as an anchor  — no change on this corpus; a presence assertion written with
 *                                      `queryBy` is a legitimate anchor and no file uses one today
 *   317 / 111  trailing comma        — MY OWN undercount, caught by the file ceiling below
 *
 * **317 absence assertions, 111 unanchored, in 98 files.**
 *
 * That last line is the one worth reading. Requiring the matcher to follow the query's closing
 * paren missed the multi-line form, where a comma sits between them:
 *
 *     expect(
 *       screen.queryByText(/…/i),
 *     ).not.toBeInTheDocument();
 *
 * Nothing about the numbers looked wrong — 110 is a plausible number, and it was LOWER, which
 * reads as progress. What caught it was the per-file count disagreeing with the old detector by
 * exactly one file (`pages/infra/components/promote-dialog.test.tsx`). Two independent counts of
 * the same population is why the file ratchet stays; it is the only thing that made a silent
 * undercount visible, and a silent undercount is how a ratchet stops guarding while still passing.
 *
 * With that fixed the two counts agree: 98 files, both ways. The unanchored figure went UP from
 * the old 116 to 111 net of six false positives — a correction in both directions, not a
 * narrowing. Lowering a ceiling by narrowing its detector is what B-238 recorded and what B-235
 * repeated hours earlier.
 */

const SELF = 'absence-assertion-ratchet.test.ts';

/** Unanchored assertions. Measured 2026-08-12 with the detector in `lib/absence-assertion.ts`. */
const CEILING_UNANCHORED = 111;

/** Files holding at least one absence assertion. Frozen 2026-08-11, remeasured 2026-08-12. */
const CEILING_FILES = 98;

/**
 * The corpus may not shrink silently.
 *
 * The B-235 ratchet had no floor, and skipping one directory took its count from 37 to 4 with every
 * case green — including the self-tests. A ratchet that cannot tell "fixed" from "stopped looking"
 * is a number, not a guard. Set below today's 376 so adding tests is never blocked and deleting a
 * swathe of them is.
 */
const TEST_FILE_FLOOR = 360;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'vendor') testFiles(full, out);
    } else if (/\.test\.tsx?$/.test(entry) && entry !== SELF) {
      // This file quotes the forms as literals in its self-tests; counting itself would be noise.
      out.push(full);
    }
  }
  return out;
}

function corpus(): { rel: string; source: string }[] {
  return testFiles(SRC).map((f) => ({
    rel: relative(SRC, f).replace(/\\/g, '/'),
    source: readFileSync(f, 'utf-8'),
  }));
}

function unanchored(): string[] {
  return corpus()
    .flatMap((a) => unanchoredIn(a.rel, a.source))
    .map((a) => `${a.file}:${String(a.line)}`)
    .sort();
}

function filesWithAbsenceAssertions(): string[] {
  return corpus()
    .filter((a) => absenceAssertionsIn(a.rel, a.source).length > 0)
    .map((a) => a.rel)
    .sort();
}

describe('ratchet on UNANCHORED absence assertions (B-242)', () => {
  it('the number only goes down — a new assertion is born anchored', () => {
    const loose = unanchored();

    expect(
      loose.length,
      `\nAbsence assertions whose selector is never asserted present in the file: ` +
        `${String(loose.length)} (ceiling ${String(CEILING_UNANCHORED)}).\n\n` +
        `${loose.slice(0, 10).join('\n')}\n\n` +
        'If it WENT UP: a new assertion queries something no case in the file ever shows, so it is\n' +
        'satisfied by the right behaviour and by the defect alike. Anchor it: assert the SAME\n' +
        'selector present in the case that renders it.\n\n' +
        'If it WENT DOWN: that is progress, and the ceiling above should follow.\n',
    ).toBeLessThanOrEqual(CEILING_UNANCHORED);
  });

  it('the ceiling matches disk', () => {
    expect(unanchored().length).toBe(CEILING_UNANCHORED);
  });

  it('the CORPUS does not shrink — the number cannot fall by looking away', () => {
    expect(corpus().length).toBeGreaterThanOrEqual(TEST_FILE_FLOOR);
  });
});

describe('ratchet on FILES using the form (F4)', () => {
  // Why both survive: the per-file count stops a NEW file slipping in unnoticed; the per-assertion
  // count measures what is actually left to fix. Anchoring an assertion does not remove its file
  // from the first count, so without the second a whole day of legitimate fixes reports as zero.

  it('the population does not grow', () => {
    const files = filesWithAbsenceAssertions();
    expect(
      files.length,
      `Files using \`expect(queryBy…)\` to assert absence: ${String(files.length)} ` +
        `(ceiling ${String(CEILING_FILES)}).\n`,
    ).toBeLessThanOrEqual(CEILING_FILES);
  });

  it('the ceiling matches disk — no slack to grow into', () => {
    expect(filesWithAbsenceAssertions().length).toBe(CEILING_FILES);
  });
});

describe('the detector, exercised — not a copy of it', () => {
  // The previous self-test re-implemented the anchor rule on a string literal and checked its own
  // copy. Widening `(?:get|find)` to `(?:get|find|query)` in the real detector took the corpus
  // count from 116 to 15 and all six cases stayed green. These call the SAME functions the ratchet
  // uses, so gutting the detector turns them red.

  const absence = "expect(screen.queryByText(/nothing here/i)).toBeNull();";

  it('flags an absence assertion with no anchor', () => {
    expect(unanchoredIn('x.test.ts', absence)).toHaveLength(1);
  });

  it('does NOT flag one anchored by a findBy on the same selector', () => {
    const source = "expect(await screen.findByText(/nothing here/i)).toBeInTheDocument();\n" + absence;
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(1);
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(0);
  });

  it('does NOT accept a bare `queryBy` as an anchor — that is the mutation that gutted it', () => {
    // Reading a node is not asserting it is there. Accepting this took 116 to 15.
    const source = "const el = screen.queryByText(/nothing here/i);\n" + absence;
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(1);
  });

  it('DOES accept a `queryBy` used to assert PRESENCE', () => {
    const source =
      "expect(screen.queryByText(/nothing here/i)).toBeInTheDocument();\n" + absence;
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(0);
  });

  it('a bare read is not an assertion at all', () => {
    // 27 of 336 occurrences were reads like this; the previous detector counted every one.
    expect(absenceAssertionsIn('x.test.ts', "const el = screen.queryByRole('table');")).toHaveLength(0);
  });

  it('an assertion that exists only inside a COMMENT is not counted', () => {
    const source = ['// ' + absence, '/* ' + absence + ' */'].join('\n');
    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(0);
  });

  it('reads a selector whose arguments contain a nested call', () => {
    // `[^)]*?` stopped at the first `)`, so this selector's core was never seen.
    const source = "expect(screen.queryByRole('row', { name: new RegExp(label) })).toBeNull();";
    const found = absenceAssertionsIn('x.test.ts', source);
    expect(found).toHaveLength(1);
    expect(found[0].selector).toContain('new RegExp(label)');
  });

  it('reads the multi-line form, where a comma sits before the closing `expect(`', () => {
    // My own undercount. Requiring the matcher to follow the query's `)` missed this shape and
    // silently dropped one file; only the per-file ceiling disagreeing by one made it visible.
    const source = [
      'expect(',
      '  screen.queryByText(/nothing here/i),',
      ').not.toBeInTheDocument();',
    ].join('\n');

    expect(absenceAssertionsIn('x.test.ts', source)).toHaveLength(1);
  });

  it('an anchor on a DIFFERENT query kind does not count', () => {
    // `getByTestId('nothing here')` does not prove `queryByText(/nothing here/)` can fail.
    const source = "expect(screen.getByTestId('nothing here')).toBeInTheDocument();\n" + absence;
    expect(unanchoredIn('x.test.ts', source)).toHaveLength(1);
  });

  it('`selectorCore` needs 4 characters, so short noise is not an anchor', () => {
    expect(selectorCore("/nothing here/i")).toBe('nothing here');
    expect(selectorCore("'ab'")).toBeNull();
  });

  it('recognises the absence matchers, and only those', () => {
    for (const form of [
      `expect(screen.queryByRole('table')).toBeNull();`,
      `expect(screen.queryByText(/xxxx/)).not.toBeInTheDocument();`,
      `expect(within(card).queryByLabelText('yyyy')).toBeNull();`,
      `expect(screen.queryByTestId('zzzz')).toBeFalsy();`,
    ]) {
      expect(absenceAssertionsIn('x.test.ts', form), `should have flagged: ${form}`).toHaveLength(1);
    }
    for (const benign of [
      `expect(screen.getByRole('table')).toBeInTheDocument();`,
      `const el = screen.queryByRole('table');`,
      `await screen.findByText(/xxxx/);`,
    ]) {
      expect(absenceAssertionsIn('x.test.ts', benign), `should NOT have flagged: ${benign}`).toHaveLength(0);
    }
  });
});
