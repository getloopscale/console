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
 * Kept on purpose:
 * - The CLI is still the `theo` binary from `@usetheo/cli`, so its install step keeps the CLI's
 *   own name. Lowercase `theo ...` commands do not match the pattern below.
 * - `safe-redirect.ts` and `auth/session.ts` hold environment configuration (auth hosts, the
 *   session cookie domain), which changes with the deployment and not with the copy.
 */

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

const OLD_BRAND = /TheoCloud|usetheo\.dev|\bTheo\b/;

const ALLOWED_TEXT = new Set(['Install the Theo CLI']);

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
