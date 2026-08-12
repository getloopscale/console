// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import ts from 'typescript';
import { parse, callSites } from '@/test/source-scan';

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
 * the anchor rule and checked the copy. A reviewer proved the consequence with a mutation: widening
 * `(?:get|find)` to also accept `query` took the count from 116 to 15 with 6/6 tests green. A
 * detector that can be gutted without a test falling is not a detector — the same defect B-237
 * recorded, and the same one the B-235 ratchet shipped.
 *
 * ## Read from the syntax tree (B-269)
 *
 * An assertion is a SHAPE, and the shape is what the parser hands over:
 *
 *     expect( queryByText(/x/) ) . not . toBeInTheDocument ()
 *     ───┬──   ──────┬────────     ─────────────┬─────────
 *     root      subject                      matcher path
 *
 * Reading it as text needed three separate repairs, each found by a reviewer after the fact: strip
 * comments (an assertion inside an `it.skip` was being counted), balance parentheses (a selector
 * with a nested call was truncated), and allow a trailing comma (the multi-line form was dropped
 * entirely, and only a second independent count caught it). None of the three exist here — the
 * grammar answers all of them.
 *
 * It also removes a guard that could not be exercised. The text version checked for a literal
 * `expect(` in the 40 characters before the query; no fixture could discriminate it, because a
 * matcher already implies the wrapper. Here the wrapper is not implied, it is required: the walk
 * starts at the matcher and must ARRIVE at an `expect(…)` call, or the query is not an assertion.
 *
 * ## Honest limit
 *
 * Still HEURISTIC where it matters most: anchoring compares the literal core of a selector inside
 * one file. A selector built from a variable counts as unanchored without being; two selectors
 * sharing a prefix count as anchored without being. The AST fixed how assertions are FOUND, not
 * how selectors are COMPARED — that would need type information the ratchets do not use. It sizes
 * the work and shows progress; each finding still has to be read.
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

const QUERY = /^query(?:All)?By([A-Za-z]+)$/;
const PRESENT = /^(?:get|find)(?:All)?By([A-Za-z]+)$/;

/** Matchers that assert the subject is ABSENT, keyed by the path walked back from the call. */
const ABSENCE = new Set(['toBeNull', 'toBeFalsy', 'not.toBeInTheDocument', 'not.toBeTruthy']);
/** …and the ones that assert it is PRESENT. A `queryBy` used this way is a legitimate anchor. */
const PRESENCE = new Set(['toBeInTheDocument', 'toBeTruthy', 'toBeVisible', 'not.toBeNull']);

/** The literal core of a selector: the first quoted run of at least 4 characters. */
export function selectorCore(selector: string): string | null {
  const m = /[/'"`]([^/'"`]{4,})/.exec(selector);
  return m ? m[1].slice(0, 18) : null;
}

interface Assertion {
  subject: ts.Expression;
  path: string;
}

/**
 * Walk back from a matcher call to the `expect(…)` it belongs to.
 *
 * `expect(x).not.toBeInTheDocument()` parses as a call whose expression is a property access chain
 * rooted at the `expect(x)` call. Returns the subject and the dotted matcher path, or `null` when
 * the chain does not reach an `expect`.
 */
function assertionOf(call: ts.CallExpression): Assertion | null {
  const path: string[] = [];
  let node: ts.Expression = call.expression;

  while (ts.isPropertyAccessExpression(node)) {
    path.unshift(node.name.text);
    node = node.expression;
  }
  if (path.length === 0) return null;

  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'expect') return null;
  if (node.arguments.length === 0) return null;

  let subject = node.arguments[0];
  while (ts.isAwaitExpression(subject) || ts.isParenthesizedExpression(subject)) {
    subject = subject.expression;
  }
  return { subject, path: path.join('.') };
}

/** Every absence assertion in a file, each marked anchored or not. */
export function absenceAssertionsIn(file: string, source: string): AbsenceAssertion[] {
  const sf = parse(file, source);
  const calls = callSites(sf);

  // Selectors asserted PRESENT, by query kind. `getBy…`/`findBy…` throw when absent, so using one
  // at all asserts presence; a `queryBy…` counts only inside a presence matcher.
  const present = new Map<string, string[]>();
  const add = (kind: string, text: string) => {
    const list = present.get(kind) ?? [];
    list.push(text);
    present.set(kind, list);
  };

  const absences: { kind: string; selector: string; line: number }[] = [];

  for (const c of calls) {
    const asPresent = PRESENT.exec(c.name);
    if (asPresent) add(asPresent[1], c.argsText);

    if (!ts.isCallExpression(c.node)) continue;
    const assertion = assertionOf(c.node);
    if (assertion === null) continue;

    // The subject must be the query call itself, not something derived from it.
    if (!ts.isCallExpression(assertion.subject)) continue;
    const subjectName = calls.find((x) => x.node === assertion.subject);
    if (subjectName === undefined) continue;
    const asQuery = QUERY.exec(subjectName.name);
    if (asQuery === null || subjectName.argsText === '') continue;

    if (PRESENCE.has(assertion.path)) add(asQuery[1], subjectName.argsText);
    else if (ABSENCE.has(assertion.path)) {
      absences.push({ kind: asQuery[1], selector: subjectName.argsText, line: subjectName.line });
    }
  }

  return absences.map((a) => {
    const core = selectorCore(a.selector);
    const anchored =
      core !== null && (present.get(a.kind) ?? []).some((text) => text.includes(core));
    return { file, line: a.line, kind: a.kind, selector: a.selector, anchored };
  });
}

/** The assertions that cannot fail — the number that matters. */
export function unanchoredIn(file: string, source: string): AbsenceAssertion[] {
  return absenceAssertionsIn(file, source).filter((a) => !a.anchored);
}
