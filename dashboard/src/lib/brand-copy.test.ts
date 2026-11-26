// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { parse } from '@/test/source-scan';

/**
 * The product is LoopScale (getloopscale/loop-console#521), and the places a user meets the name
 * first must say so: the page title, the PWA manifest and the logo's accessible name.
 *
 * The scan below reads the text the code can show: string literals, template literal text
 * and JSX text of a production module under `src/`.
 */

const ROOT = resolve(__dirname, '../..');

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

describe('the product presents itself as LoopScale (#521)', () => {
  it('the scan sees the strings a page shows', () => {
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
  });
});
