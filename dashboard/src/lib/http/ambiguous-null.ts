// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

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
 */

/** One call site, with its argument list already extracted. */
export interface FoundCall {
  readonly file: string;
  readonly line: number;
  readonly args: string;
}

/**
 * Strips comments while preserving line count.
 *
 * Without this, a commented-out `cloudFetch(...)` is counted as a live defect — the ratchet rises
 * because of code nobody runs. Measuring the guard's vocabulary instead of the defect is the
 * mistake B-238, B-243 and this item's own first two measurements already cost.
 */
export function withoutComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'lineComment' | 'blockComment' | 'string' = 'code';
  let quote = '';
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'lineComment'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'blockComment'; out += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'string'; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'string') {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === quote) state = 'code';
      out += c; i++; continue;
    }
    if (state === 'lineComment') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
      i++; continue;
    }
    // blockComment
    if (c === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
    out += c === '\n' ? c : ' ';
    i++;
  }
  return out;
}

/** `cloudFetch(` or `cloudFetch<T>(` — NEVER `cloudFetchRaw`, which takes no config. */
const CALL_OPENING = /(?<![\w.])cloudFetch\s*(?:<[^(]*?>)?\s*\(/g;

/**
 * A call's argument list, by balanced-paren counting.
 *
 * This item's first measurement checked LINE by line and said 13; the second used a 12-line
 * window and said 37, missing two calls whose `throwOnError` sits 12 and 14 lines below. A window
 * is a guess about how long a call is; the parentheses are the call.
 */
function argsOf(source: string, openParen: number): string | null {
  let depth = 0;
  let insideQuote: string | null = null;
  for (let i = openParen; i < source.length; i++) {
    const c = source[i];
    const previous = source[i - 1];
    if (insideQuote !== null) {
      if (c === insideQuote && previous !== '\\') insideQuote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { insideQuote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return null; // unclosed call — truncated file or invalid syntax
}

/** `{ throwOnError: true }` present IN THE ARGUMENTS. `false` is the defect spelled out. */
export function hasContract(args: string): boolean {
  return /\bthrowOnError\s*:\s*true\b/.test(args);
}

/** Every `cloudFetch` call in a file, with its real arguments. */
export function callsIn(file: string, source: string): FoundCall[] {
  const code = withoutComments(source);
  const found: FoundCall[] = [];
  for (const m of code.matchAll(CALL_OPENING)) {
    const open = m.index + m[0].length - 1;
    const args = argsOf(code, open);
    if (args === null) continue;
    found.push({
      file,
      line: code.slice(0, m.index).split('\n').length,
      args,
    });
  }
  return found;
}

/** The calls with no `{ throwOnError: true }` — where `null` still means five things. */
export function callsWithoutContractIn(file: string, source: string): FoundCall[] {
  return callsIn(file, source).filter((c) => !hasContract(c.args));
}
