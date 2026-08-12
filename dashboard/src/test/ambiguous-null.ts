// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { withoutComments, balancedArgs, lineOf } from '@/test/source-scan';

/**
 * The B-235 detector, separated from the test that freezes its count.
 *
 * It lives in its own module for a measured reason: while the logic sat inside the test file,
 * the self-tests meant to prove it held a COPY of the rule and checked the copy. Three mutations
 * that destroyed the detector stayed green — the search window cut to one line, the selector's
 * core truncated, the alternation widened. That is the defect B-237 already recorded in this
 * repository, re-shipped.
 *
 * Exported, the self-tests call THIS function. If it stops discriminating, they go red.
 *
 * Comment stripping and balanced-paren extraction come from `lib/source-scan` — the B-242
 * detector needs the same two, and a fix to either has to reach both.
 */

/** One call site, with its argument list already extracted. */
export interface FoundCall {
  readonly file: string;
  readonly line: number;
  readonly args: string;
}

/** `cloudFetch(` or `cloudFetch<T>(` — NEVER `cloudFetchRaw`, which takes no config. */
const CALL_OPENING = /(?<![\w.])cloudFetch\s*(?:<[^(]*?>)?\s*\(/g;

/** `{ throwOnError: true }` present IN THE ARGUMENTS. `false` is the defect spelled out. */
export function hasContract(args: string): boolean {
  return /\bthrowOnError\s*:\s*true\b/.test(args);
}

/**
 * Every `cloudFetch` call in a file, with its real arguments.
 *
 * This item's first measurement checked LINE by line and said 13; the second used a 12-line
 * window and said 37, missing two calls whose `throwOnError` sits 12 and 14 lines below. A window
 * is a guess about how long a call is; the parentheses are the call.
 */
export function callsIn(file: string, source: string): FoundCall[] {
  const code = withoutComments(source);
  const found: FoundCall[] = [];
  for (const m of code.matchAll(CALL_OPENING)) {
    const open = m.index + m[0].length - 1;
    const args = balancedArgs(code, open);
    if (args === null) continue;
    found.push({ file, line: lineOf(code, m.index), args });
  }
  return found;
}

/** The calls with no `{ throwOnError: true }` — where `null` still means five things. */
export function callsWithoutContractIn(file: string, source: string): FoundCall[] {
  return callsIn(file, source).filter((c) => !hasContract(c.args));
}
