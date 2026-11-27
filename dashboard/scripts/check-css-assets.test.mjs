// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingCssAssets } from './check-css-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(HERE, '..', path), 'utf8');

describe('missingCssAssets', () => {
  const css = `@font-face{src:url(./fonts/a.woff2) format("woff2")}
    .b{background:url("/assets/b-1a2b.png")}
    .c{background:url('data:image/svg+xml,%3Csvg%3E')}
    .d{background:url(https://example.com/d.png)}
    .e{filter:url(#n)}`;

  it('reports a relative url whose file the build did not emit', () => {
    const emitted = new Set(['assets/b-1a2b.png']);
    expect(missingCssAssets(css, 'assets/index-abc.css', (path) => emitted.has(path))).toEqual([
      'assets/fonts/a.woff2',
    ]);
  });

  it('reports nothing when every file is there', () => {
    const emitted = new Set(['assets/b-1a2b.png', 'assets/fonts/a.woff2']);
    expect(missingCssAssets(css, 'assets/index-abc.css', (path) => emitted.has(path))).toEqual([]);
  });

  it('ignores a query string and a fragment after the file name', () => {
    const emitted = new Set(['assets/f.woff2']);
    expect(
      missingCssAssets('a{src:url(./f.woff2?v=1#iefix)}', 'assets/x.css', (path) => emitted.has(path)),
    ).toEqual([]);
  });
});

// The fonts 404'd on staging after the brand theme: index.css pulled the font stylesheet in with
// `@import`, and the build left its `url(./fonts/...)` as written, relative to a stylesheet that
// had moved to `assets/`. Imported from the entry module, Vite resolves the urls against the
// package file and emits the fonts.
describe('font stylesheet', () => {
  it('is imported by the entry module, where the build resolves its urls', () => {
    expect(read('src/main.tsx')).toMatch(/^import '@getloopscale\/ui\/fonts\.css';$/m);
    expect(read('src/index.css')).not.toMatch(/@import\s+['"]@getloopscale\/ui\/fonts\.css['"]/);
  });
});
