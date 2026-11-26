// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import ts from 'typescript';

/**
 * Finding calls in TypeScript source, for the ratchets that count them.
 *
 * ## Why the compiler and not a regex
 *
 * The first version of this module hand-rolled a lexer (`withoutComments`, a character-by-character
 * state machine) and an argument extractor (`balancedArgs`, a depth counter over brackets). An
 * architecture review named it as a Rule 9 miss — `typescript` is already a devDependency, and
 * `i18n-guard.ts`, in this same directory, had solved the identical problem with
 * `ts.createSourceFile` for the reasons its own docblock gives.
 *
 * The review also named the failure the hand-roll carried, and it was measured rather than
 * loopscalerised: a depth counter reads `(` and `)` as text, but a regex literal is not text. `/\(/`
 * holds one unbalanced paren, and against `cloudFetch(build(/\(/), {}, { throwOnError: true })` the
 * old extractor did not merely misread the arguments — it lost the call entirely and reported ZERO
 * call sites. A silently vanishing call is the exact defect class these ratchets exist to catch in
 * the code they scan: a guard that guesses where a call ends is guessing.
 *
 * Zero such selectors existed in the corpus when this was written, so nothing was miscounted in
 * practice. The rewrite is not a bug fix; it is removing the guess.
 *
 * ## What the parser gives for free
 *
 * Comments are not nodes, so nothing has to strip them. Argument boundaries come from the grammar,
 * so nothing has to count brackets. String, template and regex literals are single tokens, so none
 * of their contents can be mistaken for syntax. The three lessons the hand-roll learned separately
 * are all properties of parsing.
 *
 * ## Honest limits
 *
 * - It parses ONE file with no type information. `cloudFetch` here is whatever is named
 *   `cloudFetch` in this file; the ratchets rely on the repo's single import of it, not on the
 *   checker. A type-aware version needs a Program, which needs the whole tsconfig graph, which is
 *   an order of magnitude more work per run for an answer the ratchets do not use.
 * - Syntactically invalid source still parses — the TS parser recovers rather than throwing — so a
 *   broken file yields whatever nodes survived recovery instead of an error. That matches what the
 *   ratchets want (a file mid-edit should not crash the suite) and is stated so nobody reads a
 *   successful parse as a validity check.
 *
 * Lives under `src/test/` and not `src/lib/` because it is test support, and
 * `test-only-module-guard.test.ts` was right to say so — it flagged this module as a production
 * file whose only importer is a test the moment it landed in `src/lib/`.
 */

/** One call expression, with the pieces both ratchets need. */
export interface CallSite {
  /** The callee as written: `cloudFetch`, `screen.queryByText`, `within(x).queryByRole`. */
  readonly callee: string;
  /** The last identifier of the callee: `cloudFetch`, `queryByText`. */
  readonly name: string;
  /** The argument list, verbatim, without the enclosing parentheses. */
  readonly argsText: string;
  /** 1-based line of the callee. */
  readonly line: number;
  readonly node: ts.CallExpression;
}

/** Parse one file. `.tsx` matters: without it, JSX is read as type assertions. */
export function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The last identifier of a callee expression — `queryByText` in `within(row).queryByText`. */
function trailingName(expression: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return '';
}

/** Every call expression in the file, in source order. */
export function callSites(sf: ts.SourceFile): CallSite[] {
  const found: CallSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const start = node.expression.getStart(sf);
      found.push({
        callee: node.expression.getText(sf),
        name: trailingName(node.expression),
        argsText: node.arguments.map((a) => a.getText(sf)).join(', '),
        line: sf.getLineAndCharacterOfPosition(start).line + 1,
        node,
      });
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return found;
}
