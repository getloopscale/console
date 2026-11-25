// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { parse } from '@/test/source-scan';

/**
 * The product is LoopScale (getloopscale/console#521). Every string a user can read in the
 * dashboard must say so: page titles, headings, help text, the support address and the docs
 * site. The old brand reached users through all of them after the rename, because nothing
 * failed when a page still said "TheoCloud".
 *
 * This guard reads the text the code can show, not the comments: string literals, template
 * literal text and JSX text of every production module under `src/`. Comments that record the
 * project's history may still name Theo.
 *
 * The CLI binary is `loopscale` (#530), so a command the page tells the user to type must start
 * with it. A `theo ...` command fails as typed.
 *
 * The CLI is published as `@getloopscale/cli` (#556). An install command that names the old
 * `@usetheo/cli` package installs something else, so no visible text may name it.
 *
 * Kept on purpose:
 * - The `theo.yaml` file name is a contract owned by the CLI and the engine, not copy. It has no
 *   space after `theo`, so the command pattern skips it.
 * - `safe-redirect.ts` and `auth/session.ts` hold environment configuration (auth hosts, the
 *   session cookie domain), which changes with the deployment and not with the copy.
 */

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

const OLD_BRAND = /TheoCloud|usetheo\.dev|\bTheo\b/;

const ALLOWED_TEXT = new Set<string>();

/** A command line that starts with the old binary: `theo login`, `$ theo deploy --project x`. */
const OLD_CLI_COMMAND = /(?:^|[\s`'"$(])theo [a-z][a-z-]*/;

/** The npm package the CLI was published as before the rename. */
const OLD_CLI_PACKAGE = /@usetheo\/cli/;

const ENVIRONMENT_CONFIG_FILES = new Set([
  'src/lib/navigation/safe-redirect.ts',
  'src/lib/auth/session.ts',
]);

function isProductionModule(path: string): boolean {
  if (!/\.(ts|tsx)$/.test(path)) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(path)) return false;
  if (path.endsWith('.d.ts')) return false;
  return !path.startsWith('src/test/') && !path.startsWith('src/vendor/');
}

function listModules(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listModules(full);
    const path = relative(ROOT, full);
    return isProductionModule(path) ? [path] : [];
  });
}

function visibleTexts(path: string): Array<{ line: number; text: string }> {
  const source = parse(path, readFileSync(join(ROOT, path), 'utf-8'));
  const found: Array<{ line: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push({ line, text: node.text.replace(/\s+/g, ' ').trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('user-visible copy names LoopScale, not the old brand (#521)', () => {
  it('no production string, template or JSX text says TheoCloud, Theo or usetheo.dev', () => {
    const offenders = listModules(SRC)
      .filter((path) => !ENVIRONMENT_CONFIG_FILES.has(path))
      .flatMap((path) =>
        visibleTexts(path)
          .filter(({ text }) => OLD_BRAND.test(text) && !ALLOWED_TEXT.has(text))
          .map(({ line, text }) => `${path}:${line} ${JSON.stringify(text)}`),
      );
    expect(offenders).toEqual([]);
  });

  it('no production text tells the user to run a command with the old theo binary', () => {
    const offenders = listModules(SRC).flatMap((path) =>
      visibleTexts(path)
        .filter(({ text }) => OLD_CLI_COMMAND.test(text))
        .map(({ line, text }) => `${path}:${line} ${JSON.stringify(text)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no production text names the old @usetheo/cli package', () => {
    const offenders = listModules(SRC).flatMap((path) =>
      visibleTexts(path)
        .filter(({ text }) => OLD_CLI_PACKAGE.test(text))
        .map(({ line, text }) => `${path}:${line} ${JSON.stringify(text)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('the old package pattern matches the old install command and skips the new one', () => {
    expect(OLD_CLI_PACKAGE.test('npm install -g @usetheo/cli')).toBe(true);
    expect(OLD_CLI_PACKAGE.test('npm install -g @getloopscale/cli')).toBe(false);
  });

  it('the old command pattern matches commands and skips package and file names', () => {
    expect(OLD_CLI_COMMAND.test('theo login --device-flow')).toBe(true);
    expect(OLD_CLI_COMMAND.test('Run theo domain add <domain> to attach one.')).toBe(true);
    expect(OLD_CLI_COMMAND.test('npm install -g @usetheo/cli')).toBe(false);
    expect(OLD_CLI_COMMAND.test('Total deployable apps declared in theo.yaml')).toBe(false);
    expect(OLD_CLI_COMMAND.test('loopscale login')).toBe(false);
  });

  it('the scan sees the strings it guards, so an empty result is not a parse failure', () => {
    const texts = visibleTexts('src/pages/auth/check-email.tsx').map(({ text }) => text);
    expect(texts).toContain('mailto:support@getloopscale.com');
  });

  it('the HTML shell and the PWA manifest carry the LoopScale name', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    expect(html).toMatch(/<title>LoopScale<\/title>/);

    const viteConfig = readFileSync(join(ROOT, 'vite.config.ts'), 'utf-8');
    expect(viteConfig).toMatch(/\bname: 'LoopScale',/);
    expect(viteConfig).toMatch(/\bshort_name: 'LoopScale',/);
  });

  it('the logo announces LoopScale to assistive technology', () => {
    const logo = readFileSync(join(ROOT, 'public/logo.svg'), 'utf-8');
    expect(logo).toMatch(/aria-label="LoopScale"/);
    expect(logo).not.toMatch(/aria-label="Theo"/);
  });
});
