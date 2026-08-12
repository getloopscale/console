// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { withoutComments, balancedArgs, lineOf } from '@/test/source-scan';

/**
 * The B-242 detector, separated from the test that freezes its count.
 *
 * `expect(queryBy…).toBeNull()` only proves something when the queried element EXISTS in the case
 * that passes and DISAPPEARS in the one that fails. When it is absent in both, the assertion is
 * satisfied by correct behaviour and by the defect alike, and no change to the code can turn it
 * red. That property — "is this same selector asserted PRESENT anywhere in the file?" — is what
 * this module measures.
 *
 * It lives outside the test file because the previous version's self-test held a hardcoded COPY of
 * the anchor rule and checked the copy. A reviewer proved the consequence with a mutation:
 * widening `(?:get|find)` to also accept `query` took the count from 116 to 15 with 6/6 tests
 * green. A detector that can be gutted without a test falling is not a detector — the same defect
 * B-237 recorded, and the same one the B-235 ratchet shipped.
 *
 * HEURISTIC, and wrong in both directions: it compares the literal core of a selector within one
 * file. A selector built from a variable counts as unanchored without being; two selectors sharing
 * a prefix count as anchored without being. It sizes the work and shows progress — it does NOT
 * rewrite anything, and each finding has to be read.
 */

export interface AbsenceAssertion {
  readonly file: string;
  readonly line: number;
  /** `Role`, `Text`, `TestId`, … — the suffix of `queryBy…`. */
  readonly kind: string;
  /** The selector arguments, verbatim. */
  readonly selector: string;
  readonly anchored: boolean;
}

/** `queryBy…(` / `queryAllBy…(`, optionally through `screen.` or `within(x).`. */
const QUERY_CALL = /(?<![\w.])(?:screen\.|within\([^;]{0,120}?\)\.)?query(?:All)?By([A-Za-z]+)\s*\(/g;

/**
 * The matcher that makes a query an ABSENCE assertion.
 *
 * Without this the detector counted every `queryBy…` occurrence — including
 * `const el = screen.queryByRole('table');`, which asserts nothing and is the normal way to grab a
 * node before doing something else with it. 27 of the 336 occurrences were reads like that, and 6
 * of them were being reported as unanchored assertions that did not exist.
 */
const ABSENCE_TAIL = /^\s*\)\s*,?\s*\)?\s*\.(?:not\s*\.\s*toBeInTheDocument|toBeNull|toBeFalsy|not\s*\.\s*toBeTruthy)/;

/**
 * A `queryBy…` used to assert PRESENCE is a legitimate anchor.
 *
 * `expect(screen.queryByText(x)).toBeInTheDocument()` states the element is there, which is exactly
 * what an anchor is. Accepting `query` UNCONDITIONALLY is the mutation that gutted this detector
 * (116 -> 15); accepting it only in a presence assertion is the principled version. Measured on the
 * current corpus it changes nothing — no file anchors this way today — and it is here so that a
 * file which does is not miscounted.
 */
const PRESENCE_TAIL = /^\s*\)\s*,?\s*\)?\s*\.(?:toBeInTheDocument|toBeTruthy|toBeVisible|not\s*\.\s*toBeNull)/;

/** The literal core of a selector: the first quoted run of at least 4 characters. */
export function selectorCore(selector: string): string | null {
  const m = /[/'"`]([^/'"`]{4,})/.exec(selector);
  return m ? m[1].slice(0, 18) : null;
}

interface RawQuery {
  kind: string;
  selector: string;
  index: number;
  isAbsence: boolean;
  isPresence: boolean;
}

function rawQueries(code: string): RawQuery[] {
  const out: RawQuery[] = [];
  for (const m of code.matchAll(QUERY_CALL)) {
    const open = m.index + m[0].length - 1;
    const args = balancedArgs(code, open);
    if (args === null) continue;
    const after = code.slice(open + 1 + args.length);
    // `expect(` immediately before is what turns a read into an assertion.
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    const inExpect = /expect\(\s*(?:await\s+)?$/.test(before);
    out.push({
      kind: m[1],
      selector: args.trim(),
      index: m.index,
      isAbsence: inExpect && ABSENCE_TAIL.test(after),
      isPresence: inExpect && PRESENCE_TAIL.test(after),
    });
  }
  return out;
}

const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every absence assertion in a file, each marked anchored or not. */
export function absenceAssertionsIn(file: string, source: string): AbsenceAssertion[] {
  const code = withoutComments(source);
  const queries = rawQueries(code);
  return queries
    .filter((q) => q.isAbsence && q.selector !== '')
    .map((q) => {
      const core = selectorCore(q.selector);
      let anchored = false;
      if (core !== null) {
        // `getBy…`/`findBy…` throw when absent, so using one at all asserts presence.
        anchored = new RegExp(`(?:get|find)(?:All)?By${q.kind}\\s*\\([^)]{0,200}${escape(core)}`).test(code);
        if (!anchored) {
          anchored = queries.some((o) => o.isPresence && o.kind === q.kind && o.selector.includes(core));
        }
      }
      return { file, line: lineOf(code, q.index), kind: q.kind, selector: q.selector, anchored };
    });
}

/** The assertions that cannot fail — the number that matters. */
export function unanchoredIn(file: string, source: string): AbsenceAssertion[] {
  return absenceAssertionsIn(file, source).filter((a) => !a.anchored);
}
