// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { parse, callSites } from '@/test/source-scan';

/**
 * The B-235 detector, separated from the test that freezes its count.
 *
 * It lives in its own module for a measured reason: while the logic sat inside the test file, the
 * self-tests meant to prove it held a COPY of the rule and checked the copy. Three mutations that
 * destroyed the detector stayed green — the search window cut to one line, the selector's core
 * truncated, the alternation widened. That is the defect B-237 already recorded in this repository,
 * re-shipped.
 *
 * Exported, the self-tests call THIS function. If it stops discriminating, they go red.
 *
 * ## What it reads, and what four measurements cost to learn
 *
 *   13  grep by LINE — most calls span several
 *   41  matched `cloudFetchRaw`, which takes no config: it returns `Response | null` BY DESIGN
 *   37  a 12-line window, wrong in both directions — absolving calls because a COMMENT below them
 *       mentioned the option, accusing calls whose option sat 14 lines down
 *   39  balanced parentheses over comment-stripped text
 *
 * The fifth reading is this one, and it changes no number: `ts.createSourceFile` gives the call's
 * arguments from the grammar. Comments are not nodes. A regex literal is one token, so the
 * unbalanced paren in `/\(/` — which made the previous extractor lose the whole call — is not
 * syntax to be counted (B-269).
 */

/** One call site, with its argument list already extracted. */
export interface FoundCall {
  readonly file: string;
  readonly line: number;
  readonly args: string;
}

/** `{ throwOnError: true }` present IN THE ARGUMENTS. `false` is the defect spelled out. */
export function hasContract(args: string): boolean {
  return /\bthrowOnError\s*:\s*true\b/.test(args);
}

/**
 * Every `cloudFetch` call in a file, with its real arguments.
 *
 * `cloudFetchRaw` is excluded by identity rather than by regex: the callee's trailing name must be
 * exactly `cloudFetch`. A property access — `client.cloudFetch`, `mockCloudFetch` — is a different
 * function and is not counted, which the parser settles without a lookbehind.
 */
export function callsIn(file: string, source: string): FoundCall[] {
  return callSites(parse(file, source))
    .filter((c) => c.callee === 'cloudFetch')
    .map((c) => ({ file, line: c.line, args: c.argsText }));
}

/** The calls with no `{ throwOnError: true }` — where `null` still means five things. */
export function callsWithoutContractIn(file: string, source: string): FoundCall[] {
  return callsIn(file, source).filter((c) => !hasContract(c.args));
}
