// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Red Team theo-cloud#67 regression-protector — CSP must NOT have
// `'unsafe-inline'` in `script-src` (CWE-693 / OWASP A05). The prior
// CSP kept it for "/__config.js runtime injection" but /__config.js
// is loaded via <script src="..."> (external), NOT inline — so the
// `'unsafe-inline'` directive was dead CSP space that weakened the
// principal XSS defense.
//
// The prod nginx CSP (dashboard/nginx.conf:26) ALREADY ships
// `script-src 'self'` without `'unsafe-inline'` and the dashboard
// works — empirical proof the directive is unnecessary.

describe('Red Team theo-cloud#67 — CSP script-src must not allow unsafe-inline', () => {
  it('dashboard/index.html meta CSP rejects unsafe-inline in script-src', () => {
    const indexHtml = readFileSync(
      resolve(__dirname, '../../index.html'),
      'utf-8',
    );
    const metaMatch = indexHtml.match(
      /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/,
    );
    expect(metaMatch, 'meta CSP must exist').not.toBeNull();
    const csp = metaMatch![1];

    // Extract the script-src directive specifically.
    const scriptSrcMatch = csp.match(/script-src ([^;]+);/);
    expect(scriptSrcMatch, 'script-src directive must exist').not.toBeNull();
    const scriptSrc = scriptSrcMatch![1];

    expect(
      scriptSrc,
      `Red Team #67: script-src MUST NOT contain 'unsafe-inline'. ` +
        `Got: "${scriptSrc}". Prod nginx ships 'self' alone; the directive ` +
        `was dead CSP space that weakened XSS defense.`,
    ).not.toContain("'unsafe-inline'");

    // Defensive: must still allow 'self' (the dashboard's own bundle).
    expect(scriptSrc).toContain("'self'");
  });

  it('dashboard/dist/index.html (production bundle) also rejects unsafe-inline in script-src', () => {
    // Only check dist if it was built — guard so the test passes in
    // CI environments that skip the bundle step.
    let distHtml: string;
    try {
      distHtml = readFileSync(
        resolve(__dirname, '../../dist/index.html'),
        'utf-8',
      );
    } catch {
      console.warn('dist/index.html not built — skipping prod bundle check');
      return;
    }
    const metaMatch = distHtml.match(
      /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/,
    );
    expect(metaMatch).not.toBeNull();
    const csp = metaMatch![1];
    const scriptSrcMatch = csp.match(/script-src ([^;]+);/);
    expect(scriptSrcMatch).not.toBeNull();
    expect(
      scriptSrcMatch![1],
      'Red Team #67: prod bundle CSP must NOT contain unsafe-inline in script-src',
    ).not.toContain("'unsafe-inline'");
  });
});
