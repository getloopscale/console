// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { varrerIdentificadores, ehIdentificadorPT } from '../src/test/i18n-guard.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');
const map = JSON.parse(readFileSync(resolve(HERE, 'identifier-map.json'), 'utf8'));

/**
 * The B-241 translation map, checked against the same scanner that counts the population.
 *
 * A map is data, and data with no test is a place for a typo to live: a target that is still
 * Portuguese, two names colliding in one file, or a name silently missing so the migration reports
 * progress it did not make.
 */

/**
 * Names deliberately NOT in the map, each with the reason.
 *
 * `nova` means two different things in the two files that declare it — the new REVISION in
 * `rollback.ts` and the incoming PAGE in `paging.ts`. One global target would name one of them
 * badly, so each gets its own target in `identifier-map-collisions.json`. Keeping it out of the
 * shared map is what makes that visible instead of accidental.
 */
const DELIBERATELY_UNMAPPED = new Set(['nova']);

describe('identifier-map.json (B-241)', () => {
  it('no target is itself flagged as Portuguese — a half-translated name cannot enter', () => {
    const stillPortuguese = Object.entries(map).filter(([, target]) => ehIdentificadorPT(target));
    expect(stillPortuguese, `these targets are still Portuguese: ${JSON.stringify(stillPortuguese)}`).toEqual([]);
  });

  it('every name the scanner reports is either mapped or deliberately excluded WITH a reason', () => {
    const found = new Set(varrerIdentificadores(SRC).map((a) => a.nome));
    const missing = [...found].filter((n) => !(n in map) && !DELIBERATELY_UNMAPPED.has(n));

    expect(
      missing,
      `\n${String(missing.length)} declared Portuguese name(s) have no entry in identifier-map.json.\n` +
        'A missing entry is a silent no-op: the harness reports success and the ratchet does not move.\n' +
        `${missing.slice(0, 20).join(', ')}\n`,
    ).toEqual([]);
  });

  it('every per-file collision target holds to the same rules as the shared map', () => {
    // `identifier-map-collisions.json` deliberately DISAGREES with the shared map for one name in
    // one file — that is what it is for: `nome` becomes `name` everywhere and `promptName` inside
    // `promptly-handlers.ts`, where a route param already owns `name`. So the invariant is not
    // agreement; it is that an override is held to the same standard, and points at a real file.
    //
    // This case replaced one that walked the live population. With the migration finished that
    // walk reached zero declarations and asserted nothing — a test that passes because there is
    // nothing left to check is exactly the vacuity this repository keeps paying to find.
    const collisions = JSON.parse(
      readFileSync(resolve(HERE, 'identifier-map-collisions.json'), 'utf8'),
    );

    const problems = [];
    for (const [file, perFile] of Object.entries(collisions)) {
      if (!existsSync(resolve(HERE, '..', file))) problems.push(`${file}: no such file`);
      for (const [name, target] of Object.entries(perFile)) {
        if (ehIdentificadorPT(target)) problems.push(`${file}: "${name}" -> "${target}" is still Portuguese`);
        if (target === name) problems.push(`${file}: "${name}" maps to itself`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(Object.keys(collisions).length).toBeGreaterThan(0);
  });

  it('the population the map was written for is now EMPTY, and that is the guard\'s job to keep', () => {
    // The map is kept as the record of what was renamed and as the tool B-279 will need for the
    // detector's tail. This case states the relationship between the two artifacts rather than
    // leaving the map looking like live configuration: nothing in `src/` matches it any more.
    expect(varrerIdentificadores(SRC)).toEqual([]);
  });

  it('no target is a JavaScript reserved word', () => {
    // `excluir` translates most naturally to `delete`, which cannot be an identifier. The map says
    // `remove`; this case is what stops the natural translation from being written by accident.
    const reserved = new Set([
      'delete', 'new', 'class', 'function', 'return', 'const', 'let', 'var', 'if', 'else',
      'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'this', 'super', 'import',
      'export', 'default', 'typeof', 'instanceof', 'in', 'of', 'void', 'null', 'true', 'false',
      'try', 'catch', 'finally', 'throw', 'yield', 'await', 'with', 'enum',
    ]);
    const bad = Object.entries(map).filter(([, target]) => reserved.has(target));
    expect(bad, `reserved words used as targets: ${JSON.stringify(bad)}`).toEqual([]);
  });
});
