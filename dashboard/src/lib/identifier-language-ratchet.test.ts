// @vitest-environment node
//
// The scan parses ~450 files and never touches a DOM. Under the suite's default jsdom the same
// work costs tens of seconds; in `node` it is a fraction of that. Same reasoning as
// `i18n-guard.test.ts`, and for the same reason: a slow guard is a guard someone eventually skips.

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { varrerIdentificadores, ehIdentificadorPT, arquivosDeProducao } from '@/test/i18n-guard';

const SRC = resolve(__dirname, '..');

/**
 * The corpus may not shrink silently.
 *
 * Adversarial review 2026-08-13 blinded the traversal — stopped it recursing into subdirectories —
 * and the guard scanned 4 files instead of 492 with all eight cases GREEN, the rejection case
 * included. That case scans a temp directory, so it proves the DETECTOR can fail and says nothing
 * about the scan reaching the corpus. A guard that cannot tell "clean" from "stopped looking" is a
 * number, not a guard.
 *
 * The sibling `absence-assertion-ratchet.test.ts` has defended this exact hole since it was written
 * ("the CORPUS does not shrink — the number cannot fall by looking away"); this file did not. Set
 * below today's 492 so adding files is never blocked and losing a directory is.
 */
const CORPUS_FLOOR = 460;

/**
 * B-241 — identifiers are written in English. This file used to be a ratchet; it is now a GUARD.
 *
 * ## What changed, and what the zero does and does not mean
 *
 * The population was 484 occurrences over 277 distinct names. It is now 0, migrated 2026-08-13 in
 * one slice through `scripts/rename-identifiers.mjs` — the TypeScript language service's rename,
 * not a substitution. 276 names came from the shared map, six from per-file targets where one
 * Portuguese word meant two different things or collided with an English name already in scope.
 *
 * **The zero is a zero BY THIS DETECTOR.** `MARCADOR` plus `SUPLEMENTO_IDENTIFICADORES` decide what
 * counts as unambiguously Portuguese, and that list has a tail: `rotulo`, `linguagem`, `variaveis`,
 * `ultimaVersao`, `resolucao`, `intencao` and others are still in the tree and are simply not in
 * it. Reading this zero as "no Portuguese identifier remains" would be the same mistake B-238 and
 * B-243 each cost a cycle to learn — the number measures the SPELLING the list knows, never the
 * defect. The tail is measured and registered as B-279 rather than left for someone to discover.
 *
 * ## Why the guard flips only now
 *
 * B-241's DoD says the guard goes in LAST, and the reason is mechanical: enabled at any number
 * above zero it rejects the migration's own intermediate states. And the shortcut that would have
 * reached zero sooner — removing words from `MARCADOR` — was refused: `varrerInterface` reads the
 * same list and is an ACTIVE guard over screen text, so every word dropped here would quietly widen
 * what may appear on screen (D4 of `dashboard-ratchet-burndown-plan.md`).
 *
 * ## Comments stay Portuguese
 *
 * The repo's convention, this item's DoD, and a property of how the migration ran: the rename went
 * through `findRenameLocations(..., findInStrings: false, findInComments: false)`, so across 159
 * files and 2 678 edits not one comment line and not one string literal changed. Verified by diff,
 * not asserted.
 */
describe('the dashboard names things in English (B-241)', () => {
  it('no production declaration is written in Portuguese', () => {
    const found = varrerIdentificadores(SRC);
    const sample = found
      .slice(0, 30)
      .map((a) => `  ${a.arquivo}:${String(a.linha)}  ${a.nome}`)
      .join('\n');

    expect(
      found,
      `\nPortuguese-form declarations in \`src/\`: ${String(found.length)}.\n\n` +
        `${sample}\n\n` +
        'The product is written in English and so is its code. Comments are NOT — Portuguese\n' +
        'comments are this repository\'s convention and this guard never looks at them.\n\n' +
        'If you are migrating a name, `scripts/rename-identifiers.mjs` does it through the\n' +
        'compiler; a search-and-replace corrupts prose and collides with homonyms, which is\n' +
        'recorded in B-241 as having happened.\n',
    ).toEqual([]);
  });

  it('the CORPUS does not shrink — the zero cannot be reached by looking away', () => {
    expect(
      arquivosDeProducao(SRC).length,
      'the scan lost files. A guard that stops looking reports the same zero as a clean tree.',
    ).toBeGreaterThanOrEqual(CORPUS_FLOOR);
  });
});

describe('the guard, exercised — not a copy of it', () => {
  // The counterpart that makes the case above mean something. Without these, a detector that
  // returned nothing at all would pass, which is exactly how the first version of the interface
  // guard "reported zero with Portuguese still on screen" (`i18n-guard.ts` docblock).

  it('REJECTS a Portuguese declaration — the guard can fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identifier-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.ts'),
        ['export const nomeDoCampo = 1;', 'export function buscarLinhas() { return []; }'].join('\n'),
        'utf8',
      );

      const found = varrerIdentificadores(dir);
      expect(found.map((a) => a.nome).sort()).toEqual(['buscarLinhas', 'nomeDoCampo']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ACCEPTS English — the rejection is not trivially true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identifier-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.ts'),
        ['export const fieldName = 1;', 'export function fetchRows() { return []; }'].join('\n'),
        'utf8',
      );
      expect(varrerIdentificadores(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a Portuguese COMMENT is not a finding — the convention is not the defect', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identifier-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.ts'),
        [
          '// A entrada antiga não é servida: a janela de cache decide, e o nome do campo importa.',
          '/** Docblock em português: revisão, ambiente, chave, linha. */',
          'export const fieldName = 1;',
        ].join('\n'),
        'utf8',
      );
      expect(
        varrerIdentificadores(dir),
        'the guard read a comment — it is matching text instead of declarations',
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT flag a COGNATE — the contamination that produced 329', () => {
    // Each of these is a valid English word, or differs by a letter. Counting them is what made
    // three of the four earlier measurements of this item wrong.
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

  it('the KNOWN TAIL is MEASURED, not merely stated (B-279 closed, B-281 opened)', () => {
    // The honest limit of the zero above, and it MOVES. B-279's tail — `rotulo`, `linguagem`,
    // `variaveis`, `ultimaVersao`, `resolucao`, `intencao` and ten more — is now IN the supplement
    // and its 43 declarations are migrated, so those words left this list by being learned. That is
    // the case working as designed: it goes red when the detector improves.
    //
    // What replaced them was measured the same way, by counting DECLARATION words the lists do not
    // contain (`falha` 7, `colunas` 5, `frase` 4, `compoe` 4, `maior` 4, …). Registered as B-281.
    // `salvar` was in the first draft of this list and the case rejected it: `MARCADOR` already
    // knows it. The list is what the detector does NOT see, and it is checked, not asserted.
    //
    // `atual` (18 occurrences) is NOT in this list and that is a decision, not an omission: the
    // supplement's own docblock names it, with `total` and `item`, as a cognate deliberately kept
    // out — it is what made an earlier measurement report 329 instead of a usable number.
    const tail = ['falha', 'colunas', 'frase', 'maior', 'compoe', 'acervo', 'abas'];

    for (const invisible of tail) {
      expect(
        ehIdentificadorPT(invisible),
        `${invisible} is now detected — move it out of this list and migrate the population it reveals`,
      ).toBe(false);
    }

    // …and each one is really in the tree, so the list cannot quietly become fiction.
    const declared = new Set<string>();
    for (const file of arquivosDeProducao(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const word of tail) if (new RegExp(`\\b${word}\\b`, 'i').test(source)) declared.add(word);
    }
    expect(
      [...declared].sort(),
      'a word left the tree — B-281 shrank, and this list should shrink with it',
    ).toEqual([...tail].sort());
  });
});
