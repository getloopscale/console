// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { callsIn, callsWithoutContractIn, hasContract } from '@/test/ambiguous-null';
import { withoutComments } from '@/test/source-scan';

const SRC = resolve(__dirname, '../..');

/**
 * B-235 — how many calls still let `null` mean five different things.
 *
 * ## What `null` collapses
 *
 * Without `{ throwOnError: true }`, `cloudFetch` resolves `null` for: a transient auth failure, an
 * ended session, a non-2xx response, a network rejection — and a SUCCESSFUL `204`/`205`. The
 * caller receives a value and cannot tell which of the five happened, so it picks one: almost
 * always "there is no data", which is the one of the five that is usually wrong. B-171 and B-264
 * are two visible defects this produced — the second made deleting your account report success.
 *
 * ## Four measurements, and why the first three were wrong
 *
 *   13  grep by LINE — most calls span several
 *   41  matched `cloudFetchRaw`, which does NOT take this option (it returns `Response | null` by
 *       design)
 *   37  a 12-line window: it absolved 3 real calls because a COMMENT below them mentioned
 *       `throwOnError` — including the docblock of the NEXT function — and accused 2 calls whose
 *       `throwOnError: true` sits 12 and 14 lines below, outside the window
 *   39  this one
 *
 * The fourth measures the CALL: comments stripped first, arguments extracted by balanced
 * parentheses, and `{ throwOnError: false }` — the defect spelled out — counted as a defect rather
 * than as compliance. A window is a guess about how long a call is; the parentheses are the call.
 *
 * **132 calls already carry the contract; 39 do not.** 77% of the code already asks for the typed
 * error, one call at a time: the ambiguous default is the MINORITY.
 *
 * ## Why a ratchet, and not flipping the default
 *
 * Flipping it without touching the 39 would make each of them THROW where it used to resolve — 39
 * behaviour changes with no test describing what each screen does on a failure. Making the 39
 * explicit first was TRIED and reverted: it touched 34 production files, broke 12 tests asserting
 * the exact shape of the call, and bought one thing — that new code gets the safe default. This
 * ratchet buys the same thing without the diff, and makes the 39 countable.
 */

/** The detector measures; this number freezes. Measured 2026-08-12. ONLY GOES DOWN. */
const CEILING_WITHOUT_CONTRACT = 39;

/**
 * The corpus may not shrink silently.
 *
 * Without this floor, adding `e !== 'pages'` to the walk dropped the count from 37 to 4 and EVERY
 * case stayed green — the self-tests included. The ratchet could not tell "it went down because it
 * was fixed" from "it went down because I stopped looking", which is exactly how the B-243 guard
 * went blind to 31 of 59 pages.
 */
const FILE_FLOOR = 430;

/** The module itself defines the contract; and the detector does not measure itself. */
const NOT_CONSUMERS = new Set(['lib/http/api.ts', 'test/ambiguous-null.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e !== 'node_modules' && e !== 'mocks') sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) {
      out.push(full);
    }
  }
  return out;
}

function corpus(): { rel: string; source: string }[] {
  return sourceFiles(SRC)
    .map((f) => ({ rel: relative(SRC, f).replace(/\\/g, '/'), source: readFileSync(f, 'utf8') }))
    .filter((a) => !NOT_CONSUMERS.has(a.rel));
}

export function callsWithoutContract(): string[] {
  return corpus()
    .flatMap((a) => callsWithoutContractIn(a.rel, a.source))
    .map((c) => `${c.file}:${String(c.line)}`)
    .sort();
}

describe('ambiguous-`null` ratchet (B-235)', () => {
  it('no NEW call lets `null` mean five things', () => {
    const without = callsWithoutContract();

    expect(
      without.length,
      `\nCalls to \`cloudFetch\` without \`{ throwOnError: true }\`: ${String(without.length)} ` +
        `(ceiling ${String(CEILING_WITHOUT_CONTRACT)}).\n\n` +
        `${without.slice(0, 10).join('\n')}\n\n` +
        'If it WENT UP: a new call receives `null` for an auth failure, an ended session, a\n' +
        'non-2xx, a network rejection AND a successful 204, with no way to tell them apart. Pass\n' +
        '`{ throwOnError: true }` and handle the `ApiError` — 132 calls already do.\n\n' +
        'If it WENT DOWN: that is progress, and the ceiling above should follow.\n',
    ).toBeLessThanOrEqual(CEILING_WITHOUT_CONTRACT);
  });

  it('the ceiling matches disk — no slack to grow into', () => {
    expect(callsWithoutContract().length).toBe(CEILING_WITHOUT_CONTRACT);
  });

  it('the CORPUS does not shrink — the number cannot fall by looking away', () => {
    expect(corpus().length).toBeGreaterThanOrEqual(FILE_FLOOR);
  });
});

describe('the detector, exercised — not a copy of it', () => {
  // The previous self-tests were decorative: they held a COPY of the rule and checked the copy, so
  // three mutations that destroyed the detector stayed green — the window cut to one line, the
  // core truncated, the alternation widened. That is the defect B-237 already recorded in this
  // repository, re-shipped by me and caught in review.
  //
  // These call the SAME functions the ratchet uses.

  it('finds a single-line call with no contract', () => {
    expect(callsWithoutContractIn('x.ts', "const r = await cloudFetch<Thing>('/v1/things');")).toHaveLength(1);
  });

  it('does NOT accuse a call that carries the contract', () => {
    const source = "const r = await cloudFetch<Thing>('/v1/things', {}, { throwOnError: true });";
    expect(callsWithoutContractIn('x.ts', source)).toHaveLength(0);
  });

  it('finds the contract 14 lines down — parentheses, not a window', () => {
    // The two `promptly-api.ts` calls the 12-line window accused falsely.
    const source = [
      'export function create<T>(a: string, b: string) {',
      '  return cloudFetch<T>(',
      '    `${BASE}/prompts`,',
      '    {',
      "      method: 'POST',",
      "      headers: { 'Content-Type': 'application/json' },",
      '      body: JSON.stringify({',
      '        a,',
      '        b,',
      '        c: 1,',
      '        d: 2,',
      '        e: 3,',
      '      }),',
      '    },',
      '    { throwOnError: true },',
      '  );',
      '}',
    ].join('\n');

    expect(callsIn('x.ts', source)).toHaveLength(1);
    expect(callsWithoutContractIn('x.ts', source)).toHaveLength(0);
  });

  it('the NEXT call does not absolve the previous one', () => {
    // Mutation: `argsOf` returning the rest of the file instead of stopping at the closing paren.
    // The corpus count caught it; NO self-test did — which is the same criticism this rewrite
    // exists to answer. Here the first call is the defect and the second carries the contract: a
    // greedy extraction absolves both.
    const source = [
      "const a = await cloudFetch<A>('/v1/a');",
      "const b = await cloudFetch<B>('/v1/b', {}, { throwOnError: true });",
    ].join('\n');

    const without = callsWithoutContractIn('x.ts', source);
    expect(without).toHaveLength(1);
    expect(without[0].line).toBe(1);
  });

  it('is NOT absolved by prose that mentions the option', () => {
    // Three real calls were absolved by a comment below them — one by the docblock of the NEXT
    // function. Measuring the vocabulary instead of the defect is the mistake B-238, B-243 and
    // this item's first two measurements already cost.
    const source = [
      "const r = await cloudFetch<Thing>('/v1/things');",
      '// M82 — the sibling uses throwOnError so a 409 rejects; this one does not.',
      '/** throwOnError: true would be wrong here. */',
    ].join('\n');

    expect(callsWithoutContractIn('x.ts', source)).toHaveLength(1);
  });

  it('does NOT count a COMMENTED-OUT call — dead code is not a live defect', () => {
    // This is what `withoutComments` actually earns. The case above passes even without it (the
    // parentheses already stop before the prose); this one does not: unstripped, a commented call
    // enters the count and the ratchet rises over code nobody runs.
    const source = [
      '// const old = await cloudFetch<Thing>(`/v1/legacy`);',
      '/* await cloudFetch<Thing>(`/v1/also-legacy`); */',
      "const r = await cloudFetch<Thing>('/v1/things', {}, { throwOnError: true });",
    ].join('\n');

    expect(callsIn('x.ts', source)).toHaveLength(1);
    expect(callsWithoutContractIn('x.ts', source)).toHaveLength(0);
  });

  it('`throwOnError: false` is the defect spelled out, not compliance', () => {
    // The earlier check was `includes('throwOnError')`, so the NEGATED option passed.
    const source = "const r = await cloudFetch<Thing>('/v1/x', {}, { throwOnError: false });";
    expect(callsWithoutContractIn('x.ts', source)).toHaveLength(1);
  });

  it('does not confuse `cloudFetchRaw`, which does not offer the option', () => {
    expect(callsIn('x.ts', "const r = await cloudFetchRaw('/v1/blob', {});")).toHaveLength(0);
  });

  it('does not confuse a DIFFERENT function whose name ends in `cloudFetch`', () => {
    // Removing the lookbehind that guards this changed nothing in the corpus — no such name
    // exists today — so the guard was unexercised and free to rot. It stays because the name it
    // protects against is one refactor away (`client.cloudFetch`, `mockCloudFetch`), and an
    // unexercised guard is indistinguishable from a broken one.
    expect(callsIn('x.ts', "await client.cloudFetch('/v1/a');")).toHaveLength(0);
    expect(callsIn('x.ts', "await mockCloudFetch('/v1/a');")).toHaveLength(0);
    expect(callsIn('x.ts', "await cloudFetch('/v1/a');")).toHaveLength(1);
  });

  it('`withoutComments` preserves lines, so the line number stays right', () => {
    const source = 'a\n// comment\nb\n/* block\nstill block */\nc';
    expect(withoutComments(source).split('\n')).toHaveLength(source.split('\n').length);
  });

  it('`withoutComments` does NOT erase a slash inside a string', () => {
    expect(withoutComments("const p = '/v1/a//b';")).toContain('//b');
  });

  it('`hasContract` requires `true`, not the mere presence of the key', () => {
    expect(hasContract('{ throwOnError: true }')).toBe(true);
    expect(hasContract('{ throwOnError: false }')).toBe(false);
    expect(hasContract('{ onResponse: r => r }')).toBe(false);
  });
});
