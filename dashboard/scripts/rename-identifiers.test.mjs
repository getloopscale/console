// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RenameHarness,
  EditPlan,
  applyCollisionOverrides,
  isProductionFile,
  typescriptFilesUnder,
} from './rename-identifiers.mjs';

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

  it('…and `--allow-shorthand` performs it, once a human has read the sites', () => {
    // The override exists because the refusal is a prompt to look, not a verdict. On this
    // repository the 15 flagged sites are internal prop bags and return shapes whose key is itself
    // a mapped name, so renaming both sides is consistent — and `tsc` is what proves it.
    write('a.ts', 'export function f() {\n  const nome = 1;\n  return { nome };\n}\n');

    const harness = new RenameHarness({ root: dir, files: typescriptFilesUnder(dir) });
    const result = harness.run({ nome: 'name' }, { allowShorthand: true });

    expect(result.outcomes.find((o) => o.name === 'nome').status).toBe('renamed');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('return { name };');
  });

  it('`declaredIn` restricts which DECLARATIONS are renamed, and usages still follow', () => {
    // One Portuguese name can mean two things in two files — `nova` is the new REVISION in
    // `rollback.ts` and the incoming PAGE in `paging.ts`. A single global target would name one of
    // them badly, so each is renamed on its own with the right word.
    write('a.ts', 'export const nova = 1;\n');
    write('b.ts', 'import { nova } from "./a";\nexport const eco = nova;\nexport const outra = () => { const nova = 2; return nova; };\n');

    const harness = new RenameHarness({ root: dir, files: typescriptFilesUnder(dir) });
    harness.run({ nova: 'newRevision' }, { declaredIn: 'a.ts' });

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const newRevision = 1;\n');
    const b = readFileSync(join(dir, 'b.ts'), 'utf8');
    // the IMPORTED symbol followed…
    expect(b).toContain('import { newRevision } from "./a";');
    expect(b).toContain('export const eco = newRevision;');
    // …and b.ts's own local, declared elsewhere, did not.
    expect(b).toContain('const nova = 2;');
  });

  it('REFUSES a shorthand DESTRUCTURING too — the read direction, which is the worse one', () => {
    // The guard shipped knowing only `return { nome }` (the write direction). Adversarial review
    // 2026-08-13 found the mirror image unguarded: `const { nome } = await res.json()` renamed the
    // KEY of an untyped payload read, reported `renamed`, and left `tsc` and the suite green while
    // the field silently became `undefined` at runtime. The write direction at least breaks typed
    // consumers loudly. Against a guard that only knows `isShorthandPropertyAssignment`, this case
    // reports `renamed` and the file comes back with `const { name } = data`.
    write(
      'a.ts',
      [
        'export async function load(res: Response) {',
        '  const data: any = await res.json();',
        '  const { nome } = data;',
        '  return nome;',
        '}',
        '',
      ].join('\n'),
    );

    const result = run({ nome: 'name' });

    const outcome = result.outcomes.find((o) => o.name === 'nome');
    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toMatch(/shorthand destructuring/);
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('const { nome } = data;');
  });

  it('a symbol with TWO declarations produces one edit per occurrence, not two', () => {
    // Measured on the real run: `temContinuacao` is declared twice (a property signature and the
    // shape that consumes it), the scanner walks both, and the language service answers with the
    // same spans each time. Before this, the identical edit was counted as an overlap and the whole
    // migration aborted at `promptly-api.ts:3442`. Two edits at one span with DIFFERENT text is
    // still a conflict and still throws — that case is below.
    write('a.ts', 'export interface P { temContinuacao: boolean }\nexport interface Q extends P { temContinuacao: boolean }\n');

    const result = run({ temContinuacao: 'hasContinuation' });

    expect(result.outcomes.find((o) => o.name === 'temContinuacao').status).toBe('renamed');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe(
      'export interface P { hasContinuation: boolean }\nexport interface Q extends P { hasContinuation: boolean }\n',
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

  // Review 2026-08-13 mutated `#declares` one kind at a time: dropping `isFunctionDeclaration`,
  // `isParameter`, `isInterfaceDeclaration`, `isTypeAliasDeclaration`, `isMethodDeclaration` or
  // `isBindingElement` changed real behaviour (2 edits -> 0) and the suite stayed green. Only two
  // of the eight kinds were exercised. `isBindingElement` is the sharpest: it carries an eight-line
  // comment recording a measured failure and had nothing holding it.
  //
  // One case per kind, not a loop: each needs its own program build (~2.5s), and eight in one case
  // blew the 20s timeout. It also means a failure names the kind that broke.
  const KINDS = [
    ['variable', 'alvo', 'target', 'export const alvo = 1;'],
    ['function declaration', 'salvar', 'save', 'export function salvar() { return 1; }'],
    ['parameter', 'arquivo', 'file', 'export function f(arquivo: string) { return arquivo; }'],
    ['interface', 'Alvo', 'Target', 'export interface Alvo { id: string }'],
    ['type alias', 'Recorte', 'Scope', 'export type Recorte = string;'],
    ['property signature', 'chave', 'key', 'export interface X { chave: string }'],
    ['method', 'salvar', 'save', 'export class C { salvar() { return 1; } }'],
    [
      'binding element',
      'setAlvo',
      'setTarget',
      'import { useState } from "react";\nexport function f() { const [t, setAlvo] = useState(1); return setAlvo; }',
    ],
  ];

  for (const [kind, name, target, source] of KINDS) {
    it(`renames a ${kind} — the declaration kind is covered`, () => {
      write('a.ts', `${source}\n`);

      const result = run({ [name]: target });

      expect(result.outcomes.find((o) => o.name === name).status).toBe('renamed');
      // A NON-ZERO edit count: review found no case asserted one, so `edits: plan.size -> 0`
      // survived as a mutant.
      expect(result.edits).toBeGreaterThan(0);
      expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain(target);
    });
  }

  it('does NOT rename a declaration in a test file — the population is production only', () => {
    // `isProductionFile` had no test: turning it into `return true` renamed a declaration inside
    // `a.test.ts`, which the ratchet does not count. Work that moves code without moving the number.
    write('a.test.ts', 'export const alvo = 1;\n');

    const result = run({ alvo: 'target' });

    expect(result.outcomes.find((o) => o.name === 'alvo').status).toBe('not-found');
    expect(readFileSync(join(dir, 'a.test.ts'), 'utf8')).toBe('export const alvo = 1;\n');
  });

  it('judges `src/test` RELATIVE to the root, not against the absolute path', () => {
    // A checkout living under any directory whose path contains `src/test` classified the entire
    // codebase as tests: every declaration skipped, `renamed: 0`, no error, ratchet frozen.
    expect(isProductionFile('/home/dev/src/test/checkout/src/pages/a.tsx', '/home/dev/src/test/checkout/src')).toBe(true);
    expect(isProductionFile('/p/src/test/helper.ts', '/p/src')).toBe(false);
    expect(isProductionFile('/p/src/pages/foo/test/helper.ts', '/p/src')).toBe(false);
    expect(isProductionFile('/p/src/pages/a.test.tsx', '/p/src')).toBe(false);
  });
});

describe('EditPlan — the safety net, reachable because it is exported', () => {
  // Review 2026-08-13 deleted the `#refuseOverlap(...)` call entirely and the suite stayed green:
  // within a single run two symbols cannot share an occurrence (both would carry the same spelling,
  // hence the same map key and the same replacement, which `#deduplicate` collapses first). The
  // module comment claimed "the disjointness is not assumed" while the refusal was unreachable, and
  // a comment in the test file cited a case proving it that did not exist. Exporting the class is
  // what makes the claim testable instead of decorative.

  it('THROWS on two edits claiming one span with different text', () => {
    const plan = new EditPlan();
    plan.add('/x/a.ts', 13, 4, 'name');
    plan.add('/x/a.ts', 13, 4, 'label');

    expect(() => plan.render(() => 'export const nome = 1;\n')).toThrow(/overlapping rename spans/);
  });

  it('THROWS on partially overlapping spans', () => {
    const plan = new EditPlan();
    plan.add('/x/a.ts', 13, 4, 'name');
    plan.add('/x/a.ts', 15, 4, 'label');

    expect(() => plan.render(() => 'export const nomeDoCampo = 1;\n')).toThrow(/overlapping rename spans/);
  });

  it('collapses the identical edit and renders it once', () => {
    const plan = new EditPlan();
    plan.add('/x/a.ts', 13, 4, 'name');
    plan.add('/x/a.ts', 13, 4, 'name');

    expect(plan.render(() => 'export const nome = 1;\n').get('/x/a.ts')).toBe('export const name = 1;\n');
  });
});

describe('applyCollisionOverrides — one harness per entry, or edits vanish', () => {
  // BLOCKER found by adversarial review 2026-08-13. `InMemoryProject` snapshots its files at
  // construction and never re-reads after writing, so reusing one harness across override entries
  // planned entry n+1 against the PRISTINE text and wrote the whole file back — discarding entry
  // n's edits in any shared file while reporting both `renamed`.
  //
  // Against the old single-harness version this case fails: `consumer.ts` comes back importing
  // `nome` from a module that exports `promptName`, and the program no longer compiles.

  it('two overrides touching a COMMON file both survive', () => {
    write('one.ts', 'export const nome = 1;\n');
    write('two.ts', 'export const linhas = 2;\n');
    write(
      'consumer.ts',
      'import { nome } from "./one";\nimport { linhas } from "./two";\nexport const total = nome + linhas;\n',
    );
    const overrides = join(dir, 'overrides.json');
    writeFileSync(
      overrides,
      JSON.stringify({ 'one.ts': { nome: 'promptName' }, 'two.ts': { linhas: 'usageRows' } }),
      'utf8',
    );

    applyCollisionOverrides(
      () => new RenameHarness({ root: dir, files: typescriptFilesUnder(dir) }),
      overrides,
    );

    expect(readFileSync(join(dir, 'one.ts'), 'utf8')).toBe('export const promptName = 1;\n');
    expect(readFileSync(join(dir, 'two.ts'), 'utf8')).toBe('export const usageRows = 2;\n');
    const consumer = readFileSync(join(dir, 'consumer.ts'), 'utf8');
    expect(consumer).toContain('import { promptName } from "./one";');
    expect(consumer).toContain('import { usageRows } from "./two";');
    expect(consumer).toContain('export const total = promptName + usageRows;');
  });
});
