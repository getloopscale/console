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
    // VACUOUS TODAY, and said out loud rather than left to be discovered: the population is zero,
    // so `found` is empty and `missing` is empty no matter what the map holds. Review 2026-08-13
    // proved it by deleting 40 of the 276 entries — still green.
    //
    // It is kept because it stops being vacuous the moment B-279 widens the detector and a new
    // population appears, which is exactly when a missing entry becomes a silent no-op again. The
    // case below is the one that has teeth today.
    const found = new Set(varrerIdentificadores(SRC).map((a) => a.nome));
    const missing = [...found].filter((n) => !(n in map) && !DELIBERATELY_UNMAPPED.has(n));

    expect(
      missing,
      `\n${String(missing.length)} declared Portuguese name(s) have no entry in identifier-map.json.\n` +
        'A missing entry is a silent no-op: the harness reports success and the ratchet does not move.\n' +
        `${missing.slice(0, 20).join(', ')}\n`,
    ).toEqual([]);
  });

  it('the map still covers what it was written for — 301 entries, none silently dropped', () => {
    // The teeth the case above lost when the population reached zero. The map is the RECORD of the
    // migration; deleting entries from it must not be free.
    //
    // 276 after B-241, 301 after B-279 added the 25 names its sixteen tail words revealed. The
    // number moves only when a migration moves it, and it moves UP — a map entry is never removed,
    // because the name it renamed can come back.
    expect(Object.keys(map)).toHaveLength(301);
  });

  it('two names never share a target, except the one pair that is recorded here', () => {
    // The harness will happily emit a duplicate-identifier program from a map that collides with
    // itself — review proved it: `erro` and `falha` both mapping to `failure` produced
    // `export const failure = 1; export function failure() {…}`, both reported `renamed`, no
    // refusal. It is statically detectable from the map alone, before any code is read.
    //
    // One pair is legitimate and stays: `novo` (the NEXT side of a diff, in `diff.ts`) and
    // `proxima` (the NEXT page/version) are both `next`, in modules that never meet. Recorded here
    // rather than banned, so a NEW collision fails while this one does not.
    const byTarget = new Map();
    for (const [name, target] of Object.entries(map)) {
      byTarget.set(target, [...(byTarget.get(target) ?? []), name]);
    }
    const collisions = [...byTarget.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([target, names]) => `${target} <- ${names.sort().join(', ')}`)
      .sort();

    expect(collisions).toEqual(['next <- novo, proxima']);
  });

  it('no target shadows a browser global', () => {
    // `janela -> window` shadowed the DOM `window` in `promptly/detail.tsx`, in a component whose
    // own docblock reasons about `window.location`. Latent — nothing in the shadowed scope used the
    // global — but the reserved-word case next door bans `delete` and said nothing about this.
    // Found by adversarial review 2026-08-13; the site was renamed to `revisionsRange`.
    const globals = new Set([
      'window', 'document', 'location', 'history', 'navigator', 'screen', 'origin', 'name',
      'open', 'close', 'top', 'parent', 'self', 'status', 'length', 'event', 'frames',
    ]);
    const shadowing = Object.entries(map)
      .filter(([, target]) => globals.has(target))
      .map(([name, target]) => `${name} -> ${target}`);

    // The four that exist today are recorded, not banned: three of them (`name`, `origin`, `open`)
    // are only ever LOCALS or object fields, where shadowing a global is harmless and the English
    // word is the right one. `janela -> window` is the one that bit, and its single production site
    // was renamed. A NEW entry landing here has to be looked at.
    expect(shadowing.sort()).toEqual([
      'abrir -> open',
      'janela -> window',
      'nome -> name',
      'origem -> origin',
    ]);
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
