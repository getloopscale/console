// @vitest-environment node
//
// The scan parses ~450 files and never touches a DOM. Under the suite's default jsdom the same
// work costs tens of seconds; in `node` it is a fraction of that. Same reasoning as
// `i18n-guard.test.ts`, and for the same reason: a slow guard is a guard someone eventually skips.

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  varrerIdentificadores,
  varrerBindingElementsPT,
  ehIdentificadorPT,
  arquivosDeProducao,
} from '@/test/i18n-guard';

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
 * not a substitution. 301 names are in the shared map (276 after B-241, 25 more after B-279), plus
 * six per-file targets where one Portuguese word meant two different things or collided with an
 * English name already in scope.
 *
 * **The zero is a zero BY THIS DETECTOR**, and the detector is narrow on TWO independent axes.
 * Reading it as "no Portuguese identifier remains" would be the same mistake B-238 and B-243 each
 * cost a cycle to learn — the number measures what the detector LOOKS FOR, never the defect.
 *
 * 1. **The vocabulary.** `MARCADOR` plus `SUPLEMENTO_IDENTIFICADORES` decide what counts as
 *    unambiguously Portuguese, and any word outside them is invisible. B-279 closed one tail —
 *    `rotulo`, `linguagem`, `variaveis`, `ultima`, `resolucao`, `intencao` and ten more are now IN
 *    the supplement and their 43 declarations are migrated. The NEXT tail was measured the same way
 *    and registered as B-281; the `KNOWN TAIL` case below holds it and goes red when the detector
 *    learns one of its words.
 *
 * 2. **The node kinds.** `varrerIdentificadores` inspects seven kinds — variable, function,
 *    parameter, interface, type alias, property signature, method. It does NOT inspect
 *    `BindingElement`, so every name introduced by destructuring is outside the zero. Measured at
 *    HEAD: **40 declarations over 33 names**, nearly all `const [erro, setErro] = useState()`. The
 *    `BINDING ELEMENTS` ratchet below pins that 40 so it cannot grow while the headline says zero.
 *    This gap was found by the /review of the B-279 slice, not by the slice — the guard was
 *    reporting a true zero and an untrue impression at the same time.
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
 * files and 2 678 edits the COMPILER changed not one comment line and not one string literal.
 * Verified by diff, not asserted.
 *
 * The COMMITS are a weaker claim than the compiler, and the difference cost a correction. Each
 * migration commit also carried hand edits that the compiler cannot see — a `toHaveProperty('campo')`
 * whose key is a string, a docblock naming a renamed field — and those did change literals and
 * comments. "The rename touched no prose" is true; "the commit touched no prose" is not, and
 * bundling the two in one commit is what made the first reading of it wrong.
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

/**
 * The second axis of the zero, pinned so it cannot grow.
 *
 * `varrerIdentificadores` does not inspect `BindingElement`, so a name introduced by destructuring
 * — overwhelmingly `const [erro, setErro] = useState()` — is outside the headline zero. Found by
 * the /review of the B-279 slice: the guard was reporting a true zero and an untrue impression at
 * the same time, and nothing in the tree said so.
 *
 * A ceiling rather than a rejection, because migrating the 40 is its own item (B-285) and a red
 * guard nobody can turn green gets skipped. `toBe`, not `<=`: the number moves only on purpose. It
 * goes red when someone adds a Portuguese-named destructuring AND when someone migrates one, and
 * both of those are edits whose author should be the one to move this line.
 */
const BINDING_ELEMENT_CEILING = 40;

describe('the OTHER Portuguese declarations — the ones the zero above does not look at', () => {
  it('BINDING ELEMENTS are counted, and the count only moves on purpose', () => {
    const found = varrerBindingElementsPT(SRC);
    const sample = found
      .slice(0, 12)
      .map((a) => `  ${a.arquivo}:${String(a.linha)}  ${a.nome}`)
      .join('\n');

    expect(
      found.length,
      `\nPortuguese-named destructured declarations: ${String(found.length)}, ` +
        `ceiling ${String(BINDING_ELEMENT_CEILING)}.\n\n${sample}\n\n` +
        'UP means a new one was introduced — rename it before committing.\n' +
        'DOWN means you migrated some, which is the point: lower the ceiling in the same commit.\n',
    ).toBe(BINDING_ELEMENT_CEILING);
  });

  it('the binding scanner can FAIL — array and object destructuring both count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'binding-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.ts'),
        [
          'declare const useState: <T>(v: T) => [T, (n: T) => void];',
          'declare const resposta: { nome: string; label: string };',
          'export const [erro, setErro] = useState(0);',
          'export const { nome } = resposta;',
        ].join('\n'),
        'utf8',
      );
      expect(varrerBindingElementsPT(dir).map((a) => a.nome).sort()).toEqual([
        'erro',
        'nome',
        'setErro',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the binding scanner ACCEPTS English — the count is not trivially everything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'binding-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.ts'),
        [
          'declare const useState: <T>(v: T) => [T, (n: T) => void];',
          'declare const response: { name: string };',
          'export const [error, setError] = useState(0);',
          'export const { name } = response;',
        ].join('\n'),
        'utf8',
      );
      expect(varrerBindingElementsPT(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a RENAMED binding is not a finding — `nome: promptName` is already migrated', () => {
    // The distinction the harness's ShorthandGuard exists for. `{ nome: promptName }` reads the
    // Portuguese KEY of a wire shape and binds it to an English local; the key belongs to the
    // response, not to us, and renaming it would corrupt the read. Only the local name is ours,
    // and here it is already English.
    const dir = mkdtempSync(join(tmpdir(), 'binding-guard-'));
    try {
      writeFileSync(
        join(dir, 'exemplo.ts'),
        ['declare const wire: { nome: string };', 'export const { nome: promptName } = wire;'].join('\n'),
        'utf8',
      );
      expect(varrerBindingElementsPT(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
