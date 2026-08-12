// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * The two primitives every source-scanning ratchet in this repository needs.
 *
 * They live here because both of the repo's scanning guards learned the same two lessons the
 * hard way, separately:
 *
 *   - A guard that reads PROSE measures the guard's vocabulary, not the defect. The B-235 window
 *     absolved three real calls because a comment below them mentioned `throwOnError`; the B-242
 *     detector counted assertions that only appear inside a comment or an `it.skip`.
 *   - A guard that guesses where a call ENDS is guessing. A line window, or a `[^)]*` capture,
 *     both break on the first argument that spans lines or contains a nested call — and they
 *     break silently, which is the part that costs.
 *
 * Duplicating them would be duplicating knowledge, not code (Unbreakable Rule 12): a fix to
 * either one has to reach both, and nothing would make it.
 *
 * They live under `src/test/` and not `src/lib/` because they are test support, and
 * `test-only-module-guard.test.ts` is right to say so — it flagged them the moment they landed in
 * `src/lib/`, as production modules whose only importer is a test. Allowlisting that would have
 * been suppressing a true finding; moving them states the fact instead.
 */

/**
 * Strips comments while preserving line count and string contents.
 *
 * Line count is preserved so a reported line number still points at the right line. String
 * contents are preserved so a URL path (`'/v1/a//b'`) is not truncated at its own slashes.
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

/**
 * The text between a `(` and the `)` that closes it, counting nesting and ignoring quotes.
 *
 * `openParen` is the index OF the opening parenthesis. Returns `null` when it is never closed —
 * a truncated file or invalid syntax — so the caller skips it rather than reading to end of file.
 */
export function balancedArgs(source: string, openParen: number): string | null {
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
  return null;
}

/** 1-based line number of a character offset. */
export function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}
