// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { varrerIdentificadores, ehIdentificadorPT } from '@/test/i18n-guard';

const SRC = resolve(__dirname, '..');

/**
 * B-241 — identifiers still written in Portuguese.
 *
 * ## The blocker was the measurement, not the migration
 *
 * This item carried a number nobody could reproduce. Four attempts gave four answers:
 *
 *   278  recorded as INFLATED, for matching `isError`/`ApiError` against the prefix "erro"
 *   179  the correction the item carries — method never written down
 *   314  mine, 2026-08-12, repeating 278's defect exactly: my regex matched `error` by PREFIX,
 *        55 files in one stroke
 *   329  mine, corrected to whole-word matching — still inflated
 *   398  reusing `MARCADOR` alone
 *   484  this one, with an identifier-specific supplement
 *
 * The third contamination is the one narrowing a regex cannot fix: **Portuguese and English share
 * cognates.** `total` (38 files), `item` (14), `texto` (15), `atual` (14) are each a valid word in
 * both languages or differ by a letter. A word list cannot separate the two without someone
 * deciding cognate by cognate — and that decision was written nowhere.
 *
 * Except it was. `i18n-guard.ts`'s `MARCADOR` is exactly that decision, made for interface text and
 * documented as "acento, ou palavra que não existe em inglês". It contains `nome`, `chave`, `linha`,
 * `janela`, `busca`; it does NOT contain `total`, `item`, `atual`. Reusing it rather than writing a
 * second list is parsimony rung 4, and it removes the obvious failure of two lists drifting apart.
 *
 * `MARCADOR` alone gave 398, and stopping there would have UNDER-counted: it was written for
 * interface text, so words that are unambiguous in an identifier but never appear as a screen
 * label — `erro`, `vazio`, `seletor`, `teto` — are simply not in it. `erro` being absent while
 * `error` must stay absent is the exact distinction the first measurement destroyed by matching
 * prefixes. A supplement lists them, holds no cognates, and takes the count to 484. Silently
 * accepting 398 would have been the same defect this whole session documents, one more time.
 *
 * The count is now defined by a committed, tested artifact instead of by whoever measured last.
 *
 * ## What this ratchet is for, and what it is not
 *
 * It freezes the population so it can only shrink. It does NOT perform the migration, and the
 * migration is not mechanical: this item records a sweep that touched 270 files, corrupted prose
 * inside comments, and was reverted. `local` marks the identifiers declared and used in a single
 * file — the safe batch to rename first, because a rename there cannot collide with a homonym
 * elsewhere.
 *
 * Comments stay in Portuguese. That is the repo's convention and this item's DoD says so
 * explicitly; I claimed three times that a conflict there was blocking this item, and re-reading
 * it, there is none. The blocker was always the measurement.
 */

/** Occurrences. Measured 2026-08-12 with `MARCADOR`. ONLY GOES DOWN. */
const CEILING_OCCURRENCES = 484;

/** Distinct names. Falls faster than occurrences — one rename closes every use of that name. */
const CEILING_DISTINCT = 277;

function found() {
  return varrerIdentificadores(SRC);
}

describe('identifier-language ratchet (B-241)', () => {
  it('the population does not grow — new code is written in English', () => {
    const all = found();
    const top = [...new Set(all.map((a) => a.nome))].slice(0, 8).join(', ');

    expect(
      all.length,
      `\nPortuguese-form identifiers: ${String(all.length)} occurrences ` +
        `(ceiling ${String(CEILING_OCCURRENCES)}).\n\n` +
        `e.g. ${top}\n\n` +
        'If it WENT UP: a new declaration was written in Portuguese. The repo is migrating the\n' +
        'other way — comments stay Portuguese by convention, identifiers do not.\n\n' +
        'If it WENT DOWN: that is progress, and both ceilings should follow.\n',
    ).toBeLessThanOrEqual(CEILING_OCCURRENCES);
  });

  it('the occurrence ceiling matches disk', () => {
    expect(found().length).toBe(CEILING_OCCURRENCES);
  });

  it('the distinct-name ceiling matches disk', () => {
    expect(new Set(found().map((a) => a.nome)).size).toBe(CEILING_DISTINCT);
  });

  it('the safe batch is identified — names living in exactly one file', () => {
    // 217 of the 277 are declared and used in a single file. Those are where a rename cannot
    // collide with a homonym in another scope, which is the failure mode the reverted sweep hit:
    // `erro` appears in dozens of files as a LOCAL, and `\berro\b -> error` collided with the
    // `error` already in scope in many of them.
    const localOnly = new Set(found().filter((a) => a.local).map((a) => a.nome));
    expect(localOnly.size).toBeGreaterThanOrEqual(210);
  });
});

describe('the detector, exercised — not a copy of it', () => {
  it('flags an unambiguously Portuguese name', () => {
    expect(ehIdentificadorPT('nomeDoCampo')).toBe(true);
    expect(ehIdentificadorPT('linhas')).toBe(true);
  });

  it('does NOT flag English', () => {
    expect(ehIdentificadorPT('fieldName')).toBe(false);
    expect(ehIdentificadorPT('rows')).toBe(false);
  });

  it('does NOT flag a COGNATE — the contamination that produced 329', () => {
    // Each of these is a valid English word, or differs by a letter. Counting them is what made
    // three of the four earlier measurements wrong.
    for (const cognate of ['total', 'item', 'atual', 'items', 'totalCount']) {
      expect(ehIdentificadorPT(cognate), `${cognate} is not evidence of Portuguese`).toBe(false);
    }
  });

  it('matches by WORD, never by prefix — the defect that produced 314', () => {
    // `error`/`isError`/`ApiError` all contain "erro". Matching by prefix pulled in 55 files at
    // once, which is the same mistake this item already recorded someone making before me.
    for (const english of ['error', 'isError', 'ApiError', 'errorRate']) {
      expect(ehIdentificadorPT(english), `${english} is English`).toBe(false);
    }
    expect(ehIdentificadorPT('erro')).toBe(true);
  });

  it('an accent alone is enough, without any word list', () => {
    expect(ehIdentificadorPT('validaçao')).toBe(true);
  });
});
