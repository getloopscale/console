// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

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
 * Environment construction is the largest line — larger than the tests themselves — and 131 of the
 * 379 files never touch a DOM API. That waste is what starves the workers, and starvation is what
 * makes the suite time out under `--sequence.shuffle` on a different file each run.
 *
 * The previous answer to the same diagnosis was to raise the timeouts to 20 s
 * (`vitest.config.ts` docblock). That trades a false red for a slower true red. This is the other
 * answer: stop paying for the DOM where nothing uses it.
 *
 * ## How "needs a DOM" is decided
 *
 * By READING THE SYNTAX TREE, not by grepping. A file needs jsdom when it names a DOM global
 * (`document`, `window`, `localStorage`, …), or imports a module that only works against one
 * (`@testing-library/*`, `react-dom`, `@getloopscale/loopzero-ui`, and this repo's own `@/test/render`).
 * Comments and strings are not candidates, because the parser does not offer them as identifiers —
 * the same property the B-241 rename relied on.
 *
 * ## The limits, declared rather than discovered later
 *
 * 1. **It reads ONE file.** A test that imports a helper touching `window` at module scope looks
 *    DOM-free here and fails under `node`. There is no static answer short of loading the module
 *    graph, so the suite is the second detector: a file that moves and breaks is a finding, and it
 *    goes back to jsdom in the exception list of `environment-fit.test.ts`. That is not
 *    hypothetical — the widening below moved three `.tsx` files and one of them,
 *    `pages/trust/violations-date.test.tsx`, failed exactly this way and was returned.
 *
 * 2. **It matches names, so a DOM reached by an alias is invisible.** `const d = globalThis;
 *    d.document` reads DOM-free. Qualified reads through the standard objects
 *    (`globalThis`/`window`/`self`/`top`/`parent`) ARE understood; an arbitrary alias is not.
 *
 * 3. **A few entries are conservative rather than wrong.** `Blob` and `Event` have been Node
 *    globals since 18, so a file using only those is kept on jsdom it does not need. This costs
 *    savings, never correctness, and removing them would turn green files red with no measurement
 *    behind the change.
 *
 * ## What the /review of 2026-08-13 changed
 *
 * The first version short-circuited on the extension — "a `.tsx` test renders JSX, so it needs a
 * DOM" — which excluded **213 of the 379 files** from the invariant. The axiom was refuted by a
 * file already in the tree (`components/dialogs/add-webhook-dialog.test.tsx`: node pragma, no
 * render), and it was hiding a vocabulary gap rather than substituting for one. All 43 JSX-bearing
 * `.test.tsx` files that the widened classifier first called DOM-free import `@/test/render`, which
 * `DOM_MODULES` did not know. Teaching it that name and dropping the short-circuit extends the
 * invariant to the whole suite and found 3 genuine misfits (2 moved, 1 returned as an exception).
 */

/**
 * Globals that only exist in a browser-like environment.
 *
 * Every entry is exercised by a case in `environment-fit.test.ts`, and that is deliberate. The
 * /review of 2026-08-13 deleted 15 of the original 24 and the whole guard stayed green: only
 * `document` and `location` were load-bearing against the corpus as it happens to be written today.
 * A vocabulary is not validated by which words the current files use — the input it must classify
 * is every file someone writes next.
 */
export const DOM_GLOBALS = new Set([
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement',
  'Element', 'Node', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'CustomEvent', 'Event',
  'DOMParser', 'XMLSerializer', 'Blob', 'FileReader', 'Image', 'CSS', 'history', 'location',
  // Added by the /review, which probed each one and found the classifier blind to it.
  'DOMRect', 'getSelection', 'alert', 'confirm', 'scrollTo', 'NodeList', 'DocumentFragment',
  'XMLHttpRequest', 'HTMLCollection',
]);

/**
 * The `HTMLxElement` / `SVGxElement` families, as a shape rather than an enumeration.
 *
 * `instanceof HTMLInputElement` was invisible, and listing every constructor the platform defines
 * would be a list nobody keeps current. The shape is stable and the namespace is not ours.
 */
const DOM_CONSTRUCTOR_SHAPE = /^(?:HTML|SVG)[A-Za-z]*Element$/;

/**
 * Objects whose properties ARE the globals: `globalThis.document` is `document`.
 *
 * Without this, the same rule that correctly rejects `config.location` also rejected every
 * qualified read — and a qualified read is the idiom people reach for precisely when they are being
 * careful about environments.
 */
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'top', 'parent']);

/**
 * Imports that only make sense against a DOM.
 *
 * `@/test/render` is this repository's own re-export of @testing-library, and leaving it out was the
 * gap that the `.tsx` short-circuit hid: all 43 JSX-bearing `.test.tsx` files that the widened
 * classifier first called DOM-free import exactly this module and nothing else DOM-shaped.
 */
const DOM_MODULES = /^(@testing-library\/|jsdom|@getloopscale\/loopzero-ui|react-dom|@\/test\/render$)/;

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

/** Is this identifier a reference to the global, rather than a property that merely shares its name? */
function isGlobalReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined || !ts.isPropertyAccessExpression(parent) || parent.name !== node) {
    return true;
  }
  // `globalThis.document` is the global; `config.location` is not. The object says which.
  return ts.isIdentifier(parent.expression) && GLOBAL_OBJECTS.has(parent.expression.text);
}

export function domFitness(fileName: string, source: string): DomFitness {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let reason: string | undefined;

  const visit = (node: ts.Node): void => {
    if (reason !== undefined) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (DOM_MODULES.test(node.moduleSpecifier.text)) reason = `imports ${node.moduleSpecifier.text}`;
    }
    if (ts.isIdentifier(node) && (DOM_GLOBALS.has(node.text) || DOM_CONSTRUCTOR_SHAPE.test(node.text))) {
      if (isGlobalReference(node)) reason = `names the DOM global \`${node.text}\``;
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
