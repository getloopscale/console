// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Type-aware identifier migration for B-241 — Portuguese declarations to English.
 *
 * ## Why the compiler and not a substitution
 *
 * This item records a sweep that was TRIED AND REVERTED: 60 names applied with `\bNAME\b`
 * substitution, 270 files touched, 249 modified, `tsc` red, and — the part that mattered —
 * PROSE CORRUPTED, because `entrada` is also a Portuguese word and this repository comments in
 * Portuguese by convention. `sw-runtime-caching.ts` came out saying "uma input_ velha não é
 * servida".
 *
 * The two lessons it paid for are both properties of reading a program as text:
 *
 *   1. a substitution cannot tell an identifier from a word inside a comment;
 *   2. a substitution cannot tell one `erro` from another `erro` in a different scope, so it
 *      collides with the `error` already declared there.
 *
 * Both disappear when the rename goes through the compiler. `findRenameLocations` resolves the
 * SYMBOL under the cursor and returns the spans that refer to that symbol — with
 * `findInComments: false` a comment is not merely skipped, it is never a candidate. Rung 3 of the
 * parsimony ladder: `typescript` is already a devDependency and this repository already parses with
 * it (`src/test/source-scan.ts`, `src/test/i18n-guard.ts`).
 *
 * ## Why every rename is computed BEFORE any edit is written
 *
 * Two distinct symbols never share an identifier occurrence, so their rename spans are disjoint.
 * That makes it safe — and an order of magnitude faster — to build the program once, ask for every
 * rename against that pristine state, and then apply all edits per file from the highest offset
 * backwards. Re-scanning after each rename would cost a re-parse of ~450 files per name.
 *
 * The disjointness is not assumed: `EditPlan` refuses overlapping spans (fail-fast, Unbreakable
 * Rule 8), because an overlap would mean the premise is wrong and the output would be corrupt.
 *
 * ## What this harness does NOT do
 *
 * It does not decide the translation — `identifier-map.json` does, and that file is reviewed by a
 * human. It does not verify the result: `tsc --noEmit` and the suite do, per batch. And it never
 * checks that the target name is free in the destination scope, which is the one collision class
 * the language service will happily produce; the batch protocol exists for exactly that.
 */

/** One identifier declaration whose name is scheduled for renaming. */
class Declaration {
  constructor(fileName, position, name) {
    this.fileName = fileName;
    this.position = position;
    this.name = name;
  }
}

/**
 * Finds the declarations this migration is allowed to rename.
 *
 * The kinds mirror `src/test/i18n-guard.ts`'s `varrerIdentificadores` exactly, because that
 * scanner is what the B-241 ratchet counts: a harness that renamed a kind the ratchet does not
 * count would move the code without moving the number, and one that skipped a kind it does count
 * could never reach zero.
 */
class DeclarationScanner {
  constructor(names) {
    this.names = names;
  }

  /** @returns {Declaration[]} in source order, for one file. */
  scan(fileName, sourceFile) {
    const found = [];
    const visit = (node) => {
      if (this.#declares(node) && node.name !== undefined && ts.isIdentifier(node.name)) {
        if (this.names.has(node.name.text)) {
          found.push(new Declaration(fileName, node.name.getStart(sourceFile), node.name.text));
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return found;
  }

  #declares(node) {
    return (
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodDeclaration(node)
    );
  }
}

/**
 * The set of edits to make, grouped per file and applied back-to-front.
 *
 * Back-to-front is not a style choice: applying the lowest offset first shifts every later span by
 * the length delta, so the second edit on a line lands in the wrong place. Sorting descending keeps
 * every pending offset valid.
 */
class EditPlan {
  constructor() {
    /** @type {Map<string, {start:number,length:number,text:string}[]>} */
    this.byFile = new Map();
  }

  add(fileName, start, length, text) {
    const edits = this.byFile.get(fileName) ?? [];
    edits.push({ start, length, text });
    this.byFile.set(fileName, edits);
  }

  get size() {
    let n = 0;
    for (const edits of this.byFile.values()) n += edits.length;
    return n;
  }

  /**
   * @param {(fileName: string) => string} read
   * @returns {Map<string, string>} the new content, per file that changed.
   */
  render(read) {
    const out = new Map();
    for (const [fileName, edits] of this.byFile) {
      const ordered = [...edits].sort((a, b) => b.start - a.start);
      this.#refuseOverlap(fileName, ordered);
      let text = read(fileName);
      for (const e of ordered) {
        text = text.slice(0, e.start) + e.text + text.slice(e.start + e.length);
      }
      out.set(fileName, text);
    }
    return out;
  }

  /** Two symbols never share an occurrence; an overlap means the premise broke. Fail loudly. */
  #refuseOverlap(fileName, descending) {
    for (let i = 1; i < descending.length; i += 1) {
      const later = descending[i - 1];
      const earlier = descending[i];
      if (earlier.start + earlier.length > later.start) {
        throw new Error(
          `overlapping rename spans in ${fileName}: ` +
            `[${String(earlier.start)},${String(earlier.start + earlier.length)}) overlaps ` +
            `[${String(later.start)},${String(later.start + later.length)}) — ` +
            'two renames claim the same identifier occurrence, so the output would be corrupt',
        );
      }
    }
  }
}

/**
 * A TypeScript program held in memory, with the language service on top of it.
 *
 * Files are read from disk once and kept in a map so the harness can be driven against a temp
 * directory in tests without touching the real project.
 */
class InMemoryProject {
  /**
   * @param {string[]} fileNames absolute paths
   * @param {ts.CompilerOptions} compilerOptions
   */
  constructor(fileNames, compilerOptions) {
    this.fileNames = fileNames;
    this.texts = new Map(fileNames.map((f) => [f, readFileSync(f, 'utf8')]));
    this.compilerOptions = compilerOptions;
    this.service = ts.createLanguageService(this.#host(), ts.createDocumentRegistry());
  }

  read(fileName) {
    const text = this.texts.get(fileName);
    if (text === undefined) throw new Error(`file not in project: ${fileName}`);
    return text;
  }

  sourceFile(fileName) {
    const program = this.service.getProgram();
    if (program === undefined) throw new Error('the language service produced no program');
    const sf = program.getSourceFile(fileName);
    if (sf === undefined) throw new Error(`no source file for ${fileName}`);
    return sf;
  }

  #host() {
    return {
      getScriptFileNames: () => this.fileNames,
      getScriptVersion: () => '1',
      getScriptSnapshot: (fileName) => {
        const text = this.texts.get(fileName);
        if (text !== undefined) return ts.ScriptSnapshot.fromString(text);
        if (!ts.sys.fileExists(fileName)) return undefined;
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? '');
      },
      getCurrentDirectory: () => process.cwd(),
      getCompilationSettings: () => this.compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
  }
}

/**
 * Refuses a rename that would change an object KEY.
 *
 * `const nome = 1; return { nome };` is one identifier doing two jobs. Asked to rename the
 * variable, the language service rewrites the shorthand whole — measured, not assumed: the output
 * is `return { name }`, and the object's key silently changed with it. Inside TypeScript that stays
 * consistent, because every typed reader is rewritten too. Outside it does not: a key that is
 * serialised, persisted, or read by name at runtime is now a different key, and nothing in the type
 * system can see the difference.
 *
 * So the shorthand is refused rather than applied. The fix is to expand it by hand
 * (`{ nome: valor }`) and decide which of the two names is the key — a decision a migration harness
 * has no business making silently. This is Unbreakable Rule 8: the ambiguous case fails loudly.
 */
class ShorthandGuard {
  constructor(project) {
    this.project = project;
  }

  /** @returns {string|undefined} the reason to refuse, or undefined when the rename is safe. */
  refuse(locations) {
    for (const location of locations) {
      // A location the project does not hold (a .d.ts) is not ours to judge.
      let sourceFile;
      try {
        sourceFile = this.project.sourceFile(location.fileName);
      } catch {
        continue;
      }
      const node = this.#tokenAt(sourceFile, location.textSpan.start);
      if (node !== undefined && node.parent !== undefined && ts.isShorthandPropertyAssignment(node.parent)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(location.textSpan.start);
        return (
          `a shorthand property at ${location.fileName}:${String(line + 1)} would have its KEY renamed ` +
          'with the variable — expand it to `{ key: value }` by hand and decide which name is the key'
        );
      }
    }
    return undefined;
  }

  #tokenAt(sourceFile, position) {
    let found;
    const visit = (node) => {
      if (node.getStart(sourceFile) === position && ts.isIdentifier(node)) found = node;
      if (node.getStart(sourceFile) <= position && position < node.getEnd()) ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return found;
  }
}

/** What happened to one mapped name. */
class RenameOutcome {
  constructor(name, target, status, edits, reason) {
    this.name = name;
    this.target = target;
    this.status = status; // 'renamed' | 'not-found' | 'skipped'
    this.edits = edits;
    this.reason = reason;
  }
}

/**
 * Turns a `{portuguese: english}` map into an EditPlan over a project.
 *
 * One symbol at a time, against the pristine program: see the module docblock for why that is both
 * safe and the fast path.
 */
class SymbolRenamer {
  constructor(project) {
    this.project = project;
    this.shorthand = new ShorthandGuard(project);
  }

  /**
   * @param {Record<string,string>} map
   * @returns {{plan: EditPlan, outcomes: RenameOutcome[]}}
   */
  planAll(map) {
    const scanner = new DeclarationScanner(new Set(Object.keys(map)));
    const plan = new EditPlan();
    /** @type {Map<string, RenameOutcome>} */
    const outcomes = new Map();
    for (const name of Object.keys(map)) {
      outcomes.set(name, new RenameOutcome(name, map[name], 'not-found', 0, undefined));
    }

    for (const fileName of this.project.fileNames) {
      for (const declaration of scanner.scan(fileName, this.project.sourceFile(fileName))) {
        const target = map[declaration.name];
        const locations = this.project.service.findRenameLocations(
          declaration.fileName,
          declaration.position,
          /* findInStrings */ false,
          /* findInComments */ false,
          {},
        );

        const previous = outcomes.get(declaration.name);
        if (locations === undefined || locations.length === 0) {
          // A position the service refuses to rename (a symbol from a .d.ts, for instance).
          // Reported, never silently counted as done.
          if (previous.status !== 'renamed') {
            outcomes.set(
              declaration.name,
              new RenameOutcome(
                declaration.name,
                target,
                'skipped',
                previous.edits,
                `the language service returned no rename locations at ${declaration.fileName}:${String(declaration.position)}`,
              ),
            );
          }
          continue;
        }

        const refusal = this.shorthand.refuse(locations);
        if (refusal !== undefined) {
          outcomes.set(
            declaration.name,
            new RenameOutcome(declaration.name, target, 'skipped', previous.edits, refusal),
          );
          continue;
        }

        for (const location of locations) {
          plan.add(
            location.fileName,
            location.textSpan.start,
            location.textSpan.length,
            `${location.prefixText ?? ''}${target}${location.suffixText ?? ''}`,
          );
        }
        outcomes.set(
          declaration.name,
          new RenameOutcome(declaration.name, target, 'renamed', previous.edits + locations.length, undefined),
        );
      }
    }

    return { plan, outcomes: [...outcomes.values()] };
  }
}

/**
 * The façade the CLI and the tests both drive.
 *
 * `run` is deliberately two steps — plan, then write — so a caller can inspect what would change
 * without changing it, and so the overlap refusal happens before a single byte is written.
 */
export class RenameHarness {
  /**
   * @param {{root: string, files: string[], compilerOptions?: ts.CompilerOptions}} options
   */
  constructor({ root, files, compilerOptions }) {
    this.root = resolve(root);
    this.project = new InMemoryProject(
      files.map((f) => resolve(f)),
      compilerOptions ?? { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, allowJs: false },
    );
  }

  /**
   * @param {Record<string,string>} map
   * @param {{write?: boolean}} options
   */
  run(map, { write = true } = {}) {
    const { plan, outcomes } = new SymbolRenamer(this.project).planAll(map);
    const rendered = plan.render((f) => this.project.read(f));

    for (const fileName of rendered.keys()) {
      if (!fileName.startsWith(this.root)) {
        throw new Error(`refusing to write outside the project root: ${fileName}`);
      }
    }

    if (write) {
      for (const [fileName, text] of rendered) writeFileSync(fileName, text, 'utf8');
    }

    return {
      edits: plan.size,
      filesChanged: [...rendered.keys()],
      outcomes,
      rendered,
    };
  }
}

/** Every `.ts`/`.tsx` under `dir`, tests INCLUDED — a symbol renamed without its test usages breaks the build. */
export function typescriptFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'vendor') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) typescriptFilesUnder(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

async function main(argv) {
  const mapFlag = argv.indexOf('--map');
  if (mapFlag === -1) {
    console.error('usage: node scripts/rename-identifiers.mjs --map <file.json> [--dry-run]');
    return 2;
  }
  const mapPath = argv[mapFlag + 1];
  const raw = readFileSync(mapPath, 'utf8').trim();
  /** @type {Record<string,string>} */
  const map = raw === '' ? {} : JSON.parse(raw);

  const root = resolve('src');
  const harness = new RenameHarness({ root, files: typescriptFilesUnder(root) });
  const result = harness.run(map, { write: !argv.includes('--dry-run') });

  for (const outcome of result.outcomes) {
    if (outcome.status !== 'renamed') {
      console.log(`${outcome.status}: ${outcome.name}${outcome.reason ? ` — ${outcome.reason}` : ''}`);
    }
  }
  console.log(`renamed: ${String(result.outcomes.filter((o) => o.status === 'renamed').length)}`);
  console.log(`edits: ${String(result.edits)}`);
  console.log(`files changed: ${String(result.filesChanged.length)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
