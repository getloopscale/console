// @vitest-environment node
//
// This guard reads 379 files and never touches a DOM. Running it under jsdom would be the very
// waste it exists to measure.

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { domFitness, misfits, NODE_PRAGMA } from '@/test/environment-fit';

const SRC = resolve(__dirname, '..');

/**
 * B-280 — a test file that never touches a DOM must not construct one.
 *
 * ## The defect this closes
 *
 * Under `--sequence.shuffle` the suite failed on a DIFFERENT file each run — `lens/overview`,
 * then `lens/evaluators`, then `lens/overview` again — always with `Test timed out in 20000ms` and
 * never with an assertion, and every one of them passed 3/3 in isolation. That is not flakiness in
 * those tests; it is worker starvation, and starvation is a budget problem.
 *
 * The budget, measured over a full run:
 *
 *     transform 26.51s   setup 133.55s   import 562.67s   tests 487.42s   environment 690.34s
 *
 * Environment construction is the largest single line — larger than the tests themselves — and 131
 * of the 379 files were paying it without ever naming a DOM API.
 *
 * ## Why an invariant and not just a pass
 *
 * `commit 05132088` migrated a domain and left no guard; three months later the same domain had
 * regressed. A one-time sweep over 131 files with nothing holding them is that commit again: the
 * 131 becomes 120 next quarter, silently, and the cost creeps back.
 *
 * ## Why this is not the previous answer
 *
 * The same starvation was diagnosed once before and answered by raising the timeouts to 20 s
 * (`vitest.config.ts` docblock). That trades a false red for a slower true red — a genuinely hung
 * test now takes 20 s to say so, and the waste stays. This removes the waste instead.
 */
/**
 * Files that read no DOM API themselves and still need jsdom, because a module they IMPORT touches
 * a browser global at module scope.
 *
 * Measured, not guessed: each of these was moved to `node`, failed with `ReferenceError: window is
 * not defined` or `document is not defined`, and was moved back. `lib/http/config.ts` is the
 * clearest instance — `export const API_URL = getConfig().API_URL` runs at import time and reads
 * `window.__THEO_CONFIG__`, and `api.ts` (151 importers) imports it. `vitest.config.ts` names that
 * module by name as the reason the whole suite defaults to jsdom.
 *
 * A one-line defensive read (`globalThis.window?.`) was TRIED and REVERTED in the same session: it
 * did not unlock them, because `document` is read at module scope somewhere else in the graph too.
 * Chasing every eager global is a bigger change than this item, so it is registered as B-282 rather
 * than half-done here.
 *
 * This list is asserted EXACTLY, so a new straggler cannot join it silently and a fixed one cannot
 * be forgotten in it.
 */
const JSDOM_BY_TRANSITIVE_IMPORT: readonly string[] = [
  'hooks/overview/use-service-versions.test.ts',
  'hooks/projects/use-bulk-delete-projects.test.ts',
  'hooks/promptly/promptly-api.test.ts',
  'hooks/trust/trust-api.test.ts',
  'hooks/use-log-stream.cap.test.ts',
  'lib/api/query-keys.test.ts',
  'lib/auth-channel.test.ts',
  'lib/cache-policy.test.ts',
  'lib/http/query-client.test.ts',
  'lib/mocks/handlers.test.ts',
  'lib/navigation/navigation-target.test.ts',
  'lib/navigation/safe-navigator.test.ts',
  'pages/auth/kratos.test.ts',
  'pages/auth/recovery-errors.test.ts',
  'pages/deploy/components/promote-to-production-dialog-format.test.ts',
  'pages/deploy/export/log-download.test.ts',
  'pages/lens/dashboards/duration-histogram.test.ts',
  'pages/pages.smoke.test.ts',
  'pages/promptly/components/playground.test.ts',
  'pages/promptly/components/rollback.test.ts',
  'pages/settings/api-keys-scope-catalog.test.ts',
  'pages/workspace/use-workspace-selection.test.ts',
];

describe('every test file runs in the environment it actually needs (B-280)', () => {
  it('no DOM-free test file constructs a jsdom', () => {
    const stragglers = misfits(SRC).filter((f) => !JSDOM_BY_TRANSITIVE_IMPORT.includes(f));

    expect(
      stragglers,
      `\n${String(stragglers.length)} test file(s) build a jsdom they never use.\n\n` +
        `${stragglers.slice(0, 20).map((f: string) => `  ${f}`).join('\n')}\n\n` +
        `Add \`// ${NODE_PRAGMA}\` as the first line. If the file DOES need a DOM, it will fail\n` +
        'loudly and immediately — and then it belongs in jsdom, with the reason written beside it.\n',
    ).toEqual([]);
  });

  it('the documented exceptions are still exceptions — none silently fixed, none silently added', () => {
    // Without this, a file whose transitive import stops touching a global would sit in the list
    // for ever, and the list would drift from being a measurement into being folklore.
    const stillMisfitting = misfits(SRC);
    const stale = JSDOM_BY_TRANSITIVE_IMPORT.filter((f) => !stillMisfitting.includes(f));

    expect(
      stale,
      'these files no longer need jsdom by static reading — move them to `node` and delete them here',
    ).toEqual([]);
  });
});

describe('the classifier, exercised — not a copy of it', () => {
  // Without these, a classifier that returned "needs a DOM" for everything would make the guard
  // above pass vacuously — the shape of vacuity this repository keeps paying to find.

  it('a file naming a DOM global needs jsdom', () => {
    expect(domFitness('a.test.ts', 'it("x", () => { document.title = "y"; });').needsDom).toBe(true);
    expect(domFitness('a.test.ts', 'it("x", () => { localStorage.clear(); });').needsDom).toBe(true);
  });

  it('a file importing testing-library needs jsdom', () => {
    const source = "import { render } from '@testing-library/react';\nit('x', () => render(null));";
    expect(domFitness('a.test.ts', source).needsDom).toBe(true);
  });

  it('a `.tsx` test renders a component, so it needs jsdom without further reading', () => {
    expect(domFitness('a.test.tsx', 'it("x", () => { expect(1).toBe(1); });').needsDom).toBe(true);
  });

  it('a pure-logic file does NOT need jsdom — the case that makes the guard mean something', () => {
    const source = "import { sum } from './sum';\nit('x', () => { expect(sum(1, 2)).toBe(3); });";
    expect(domFitness('a.test.ts', source).needsDom).toBe(false);
  });

  it('a PROPERTY named like a DOM global is not the global', () => {
    // `config.location` is not `location`. Matching by name alone would call this file DOM-bound
    // and quietly leave it on jsdom — the classifier reading a spelling instead of a reference.
    const source = "it('x', () => { expect(config.location).toBe('eu'); });";
    expect(domFitness('a.test.ts', source).needsDom).toBe(false);
  });

  it('the word inside a COMMENT or a STRING is not a reference', () => {
    // Read from the syntax tree, so neither is a candidate. A grep would flag both.
    const source = [
      '// this test used to touch document.title',
      'it("x", () => { expect("window").toBe("window"); });',
    ].join('\n');
    expect(domFitness('a.test.ts', source).needsDom).toBe(false);
  });
});
