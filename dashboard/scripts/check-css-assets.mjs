#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
/**
 * Proves that every file a built stylesheet points to was emitted by the build.
 *
 * A `url()` the build leaves as written is a 404 in production and nothing else: the build
 * passes, the tests pass, the dev server serves the file from `node_modules`. It was measured on
 * staging with the brand fonts, which fell back to the system typeface on every page.
 *
 * Run after `vite build`, on `dist/`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_IN_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;

/**
 * The files a stylesheet points to that do not exist.
 *
 * @param {string} css the stylesheet text
 * @param {string} cssPath where the stylesheet sits, relative to the site root
 * @param {(path: string) => boolean} exists whether a path relative to the site root is a file
 * @returns {string[]} the missing paths, relative to the site root
 */
export function missingCssAssets(css, cssPath, exists) {
  const missing = [];
  for (const match of css.matchAll(URL_IN_CSS)) {
    const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    // A data URI carries its bytes, a fragment names an element, and another origin is not ours.
    if (target === '' || /^(data:|#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    const file = target.split(/[?#]/)[0];
    const path = file.startsWith('/')
      ? file.slice(1)
      : posix.normalize(posix.join(posix.dirname(cssPath), file));
    if (!exists(path)) missing.push(path);
  }
  return missing;
}

function main() {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const assets = join(dist, 'assets');
  if (!existsSync(assets)) {
    console.error(`check-css-assets: ${assets} does not exist. Run the build first.`);
    process.exit(2);
  }
  const sheets = readdirSync(assets).filter((name) => name.endsWith('.css'));
  if (sheets.length === 0) {
    console.error(`check-css-assets: no stylesheet in ${assets}. A check with nothing to read proves nothing.`);
    process.exit(2);
  }
  const missing = sheets.flatMap((name) =>
    missingCssAssets(readFileSync(join(assets, name), 'utf8'), `assets/${name}`, (path) =>
      existsSync(join(dist, path)),
    ).map((path) => `${name} -> ${path}`),
  );
  if (missing.length > 0) {
    console.error('check-css-assets: a stylesheet points to files the build did not emit:');
    for (const line of missing) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`check-css-assets: ${sheets.length} stylesheet(s), every url() resolves.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
