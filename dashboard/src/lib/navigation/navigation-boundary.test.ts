// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * B-138 · T5 — the guard that makes the boundary durable.
 *
 * The typed boundary is the primary defence: a `NavigationTarget` cannot be constructed
 * around the predicate, so a sink that takes one cannot be handed an unjudged string. But
 * nothing stops a future author from writing `window.location.href = x` directly and never
 * meeting the boundary at all. That is exactly how the codebase arrived here — the guard
 * existed, was tested, and one of nine call sites used it.
 *
 * This test is the backstop. It reads the source tree as text and fails when a raw
 * navigation sink appears outside the boundary module or the documented allowlist.
 *
 * ## Its own honesty gate
 *
 * A guard that cannot fail is worse than no guard, and the 2026-08-11 review proved four
 * such tests in this repo by deleting the code they claimed to protect and watching them
 * stay green. So the second test here plants a violation and asserts the detector catches
 * it. Without that, this file would be the fifth.
 */

const SRC = resolve(__dirname, '../..');

/** `form.action = …` and `window.location.href = …` in their assignment form. */
const RAW_SINK = /(?:^|[^.\w])(?:form\.action|(?:window\.)?location\.href|window\.location)\s*=(?!=)/;

/**
 * The ONLY file allowed to hold a raw sink is the boundary itself.
 *
 * An allowlist was written first and deleted: it was keyed by file, and `settings/billing.tsx`
 * earned an entry for one literal `/memory` route — which then hid the two network-derived
 * navigations in the same file (`portal.url`, `result.url`) from this very guard. A name-based
 * exemption is the same defect shape as a name-based match, and it fails silently. So there is
 * no allowlist: every navigation goes through the boundary, including the ones whose
 * destination is a literal. `NavigationTarget.parse('/login')` accepts a same-origin path, so
 * the uniform rule costs an import and buys an invariant with nothing to argue about later.
 */
const BOUNDARY = 'lib/navigation/navigation-sink.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'vendor' || entry === 'mocks') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function violations(): { file: string; line: number; text: string }[] {
  const found: { file: string; line: number; text: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === BOUNDARY) continue;
    readFileSync(file, 'utf-8').split('\n').forEach((text, i) => {
      if (RAW_SINK.test(text)) found.push({ file: rel, line: i + 1, text: text.trim() });
    });
  }
  return found;
}

describe('navigation boundary — no raw sink outside it', () => {
  it('every server-supplied navigation goes through SafeNavigator', () => {
    const found = violations();
    expect(
      found,
      found.length === 0
        ? ''
        : `Raw navigation sinks outside the boundary:\n` +
          found.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join('\n') +
          `\n\nUse \`safeNavigator.goTo(url)\` / \`safeNavigator.submitTo(action, fields)\` from ` +
          `\`@/lib/navigation\`. This holds even when the destination is a literal in-app path: ` +
          `there is no allowlist, because the one this guard shipped with hid two real sinks.`,
    ).toEqual([]);
  });

  it('detects a planted violation — the guard can fail', () => {
    // Proves the detector is load-bearing. A guard nobody has seen fail is a guard nobody
    // knows works; this repo shipped four such tests before the 2026-08-11 review.
    const planted = [
      `  window.location.href = payload.next;`,
      `      form.action = flow.ui.action;`,
      `location.href = data.logout_url`,
    ];
    for (const line of planted) {
      expect(RAW_SINK.test(line), `should have flagged: ${line}`).toBe(true);
    }
    // And does not fire on shapes that are not assignments to a sink.
    for (const benign of [
      `  const href = location.href;`,
      `  if (window.location.href === expected) {`,
      `  expect(sink.assignments).toEqual(['/x']);`,
    ]) {
      expect(RAW_SINK.test(benign), `should NOT have flagged: ${benign}`).toBe(false);
    }
  });
});
