// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RenameHarness, typescriptFilesUnder } from './rename-identifiers.mjs';

/**
 * The B-241 harness, exercised against a real (tiny) project on disk.
 *
 * Every case here encodes something the REVERTED sweep got wrong, or something a naive
 * implementation of this harness would get wrong. They are not decoration: each one was checked
 * against a deliberately broken harness and observed to fail (see the comment on each).
 */

let dir;

function write(relative, source) {
  const path = join(dir, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, source, 'utf8');
  return path;
}

function run(map) {
  const harness = new RenameHarness({ root: dir, files: typescriptFilesUnder(dir) });
  return harness.run(map);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rename-identifiers-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('RenameHarness (B-241)', () => {
  it('renames a symbol and every usage of it, across files', () => {
    write('a.ts', 'export const nome = "x";\n');
    write('b.ts', 'import { nome } from "./a";\nexport const eco = nome;\n');

    const result = run({ nome: 'name' });

    expect(result.outcomes.find((o) => o.name === 'nome').status).toBe('renamed');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const name = "x";\n');
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toContain('import { name } from "./a";');
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toContain('export const eco = name;');
  });

  it('does NOT touch the same word inside a COMMENT — the reverted sweep\'s first lesson', () => {
    // `sw-runtime-caching.ts` came out of the reverted sweep saying "uma input_ velha não é
    // servida", because `entrada` is a Portuguese word and this repo comments in Portuguese.
    // Against a harness built with `findInComments: true` this case fails.
    write(
      'a.ts',
      [
        '// A entrada antiga não é servida: a entrada nova vence.',
        '/** Docblock: a entrada é validada antes daqui. */',
        'export const entrada = 1;',
        '',
      ].join('\n'),
    );

    run({ entrada: 'input' });

    const after = readFileSync(join(dir, 'a.ts'), 'utf8');
    expect(after).toContain('// A entrada antiga não é servida: a entrada nova vence.');
    expect(after).toContain('/** Docblock: a entrada é validada antes daqui. */');
    expect(after).toContain('export const input = 1;');
  });

  it('does NOT touch the same word inside a STRING LITERAL — interface text is another guard\'s job', () => {
    // `i18n-guard.test.ts` owns screen text. A rename that edited strings would silently change
    // what the product says. Fails against `findInStrings: true`.
    write('a.ts', 'export const erro = "erro ao salvar";\n');

    run({ erro: 'failure' });

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const failure = "erro ao salvar";\n');
  });

  it('renames by SYMBOL, so a same-spelled name that is not a declaration is left alone', () => {
    // The property that separates a symbol rename from a substitution, and the second lesson of the
    // reverted sweep. `b.ts` holds the word `erro` three times and declares it zero times: as a key
    // in an untyped object literal, as the property read back off it, and inside a string. A
    // `\berro\b` sed rewrites all three and breaks the object; the compiler rewrites none of them,
    // because none of them refer to the symbol declared in `a.ts`.
    write('a.ts', 'export const erro = 1;\n');
    write(
      'b.ts',
      [
        'const resposta = { erro: "sim" };',
        'export const lido = resposta.erro;',
        'export const texto = "erro ao salvar";',
        '',
      ].join('\n'),
    );

    run({ erro: 'failure' });

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const failure = 1;\n');
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe(
      'const resposta = { erro: "sim" };\nexport const lido = resposta.erro;\nexport const texto = "erro ao salvar";\n',
    );
  });

  it('renames EVERY declaration of a mapped name, each as its own symbol', () => {
    // The migration has to reach all of them — the same name is declared as a local in dozens of
    // files (`erro` in seven, measured). Each is renamed independently, which is what makes it safe;
    // the reverted sweep failed because it rewrote them as one piece of text.
    write('a.ts', 'export const erro = 1;\n');
    write('b.ts', 'export function f() {\n  const erro = 2;\n  return erro;\n}\n');

    const result = run({ erro: 'failure' });

    expect(result.outcomes.find((o) => o.name === 'erro').status).toBe('renamed');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const failure = 1;\n');
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toContain('const failure = 2;');
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toContain('return failure;');
  });

  it('reports `not-found` for a mapped name that does not exist', () => {
    // A stale map entry must be visible, never counted as done. The whole B-241 measurement
    // depends on the difference between "renamed" and "nothing happened".
    write('a.ts', 'export const ok = 1;\n');

    const result = run({ inexistente: 'missing' });

    expect(result.edits).toBe(0);
    expect(result.outcomes.find((o) => o.name === 'inexistente').status).toBe('not-found');
  });

  it('applies several edits in ONE file back-to-front', () => {
    // Two occurrences on the same line: applying the lowest offset first shifts the second span by
    // the length delta and corrupts it. Against a forward-applying harness this case fails.
    write('a.ts', 'export const nome = 1; export const eco = nome + nome;\n');

    run({ nome: 'identificationName' });

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe(
      'export const identificationName = 1; export const eco = identificationName + identificationName;\n',
    );
  });

  it('REFUSES a rename that would change an object key through a shorthand property', () => {
    // Measured, and the reason `ShorthandGuard` exists: asked to rename the VARIABLE `nome`, the
    // language service rewrites `{ nome }` whole, so the object's KEY changes with it. Inside
    // TypeScript that stays consistent; for anything that serialises or reads the key by name it
    // does not, and nothing in the type system can tell the difference.
    //
    // Against a harness without the guard this case fails: the file comes back as `{ name }` and
    // the outcome reads `renamed`.
    write('a.ts', 'export function f() {\n  const nome = 1;\n  return { nome };\n}\n');

    const result = run({ nome: 'name' });

    const outcome = result.outcomes.find((o) => o.name === 'nome');
    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toMatch(/shorthand property/);
    // Nothing was written: a refusal is not a partial rename.
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe(
      'export function f() {\n  const nome = 1;\n  return { nome };\n}\n',
    );
  });

  it('an empty map is a no-op that reports zero edits', () => {
    write('a.ts', 'export const nome = 1;\n');

    const result = run({});

    expect(result.edits).toBe(0);
    expect(result.filesChanged).toEqual([]);
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const nome = 1;\n');
  });

  it('refuses to write outside the project root', () => {
    write('a.ts', 'export const nome = 1;\n');
    const outside = mkdtempSync(join(tmpdir(), 'rename-outside-'));
    try {
      writeFileSync(join(outside, 'b.ts'), 'import { nome } from "../x";\n', 'utf8');
      const harness = new RenameHarness({
        root: join(dir, 'nowhere'),
        files: typescriptFilesUnder(dir),
      });
      expect(() => harness.run({ nome: 'name' })).toThrow(/refusing to write outside/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
