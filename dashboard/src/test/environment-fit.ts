// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Which test files need a DOM, and which are paying for one they never touch (B-280).
 *
 * ## Why this exists
 *
 * `vitest.config.ts` gives every test file a jsdom environment. Measured over a full run:
 *
 *     transform 26.51s   setup 133.55s   import 562.67s   tests 487.42s   environment 690.34s
 *
 * Environment construction is the largest line — larger than the tests themselves — and 130 of the
 * 379 files never touch a DOM API. That waste is what starves the workers, and starvation is what
 * makes the suite fail under `--sequence.shuffle` on a different file each run, always by timeout
 * and never by assertion.
 *
 * The previous answer to the same diagnosis was to raise the timeouts to 20 s
 * (`vitest.config.ts` docblock). That trades a false red for a slower true red. This is the other
 * answer: stop paying for the DOM where nothing uses it.
 *
 * ## How "needs a DOM" is decided, and the honest limit
 *
 * By READING THE SYNTAX TREE, not by grepping. A file needs jsdom when it names a DOM global
 * (`document`, `window`, `localStorage`, …), imports a library that only works against one
 * (`@testing-library/*`), or renders (`render(`, `screen.`). Comments and strings are not
 * candidates, because the parser does not offer them as identifiers — the same property the B-241
 * rename relied on.
 *
 * LIMIT, declared rather than discovered later: this reads ONE file. A test that imports a helper
 * which touches `window` at module scope looks DOM-free here and fails under `node`. There is no
 * static answer to that short of loading the module graph, so the suite is the second detector —
 * a file that moves and breaks is a finding, and it keeps jsdom with the reason written beside it.
 */

/** Globals that only exist in a browser-like environment. */
const DOM_GLOBALS = new Set([
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement',
  'Element', 'Node', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'CustomEvent', 'Event',
  'DOMParser', 'XMLSerializer', 'Blob', 'FileReader', 'Image', 'CSS', 'history', 'location',
]);

/** Imports that only make sense against a DOM. */
const DOM_MODULES = /^(@testing-library\/|jsdom|@theokit\/ui|react-dom)/;

/** The pragma vitest reads. */
export const NODE_PRAGMA = '@vitest-environment node';

/** Module-private: `misfits` is the only caller, and knip is right that an export with no importer
 * is surface for nothing. */
function testFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'vendor' && entry !== 'node_modules') testFilesUnder(path, out);
    } else if (/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

export interface DomFitness {
  readonly needsDom: boolean;
  readonly reason: string | undefined;
}

export function domFitness(fileName: string, source: string): DomFitness {
  // A `.tsx` test renders JSX; JSX in a test is a component under test, which needs a DOM.
  if (fileName.endsWith('.tsx')) return { needsDom: true, reason: 'renders JSX' };

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let reason: string | undefined;

  const visit = (node: ts.Node): void => {
    if (reason !== undefined) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (DOM_MODULES.test(node.moduleSpecifier.text)) reason = `imports ${node.moduleSpecifier.text}`;
    }
    if (ts.isIdentifier(node) && DOM_GLOBALS.has(node.text)) {
      // A property access like `foo.document` is not the global.
      const parent = node.parent;
      const isProperty = parent !== undefined && ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isProperty) reason = `names the DOM global \`${node.text}\``;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return { needsDom: reason !== undefined, reason };
}

/** Files that could run under `node` and do not say so. */
export function misfits(root: string): string[] {
  const out: string[] = [];
  for (const file of testFilesUnder(root)) {
    const source = readFileSync(file, 'utf8');
    if (source.includes(NODE_PRAGMA)) continue;
    const { needsDom } = domFitness(file, source);
    if (!needsDom) out.push(relative(root, file).replace(/\\/g, '/'));
  }
  return out.sort();
}
