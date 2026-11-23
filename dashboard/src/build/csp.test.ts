// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One Content-Security-Policy, served by nginx, whose environment-specific origins come from
 * the deployment.
 *
 * The policy used to be declared twice, in a `<meta>` of index.html and in the nginx header,
 * each naming the usetheo.dev hosts. A browser applies every policy it receives and allows only
 * their intersection, and neither copy could be changed without rebuilding the image, so the
 * dashboard on any other host (staging on getloopscale.com) could not reach its own Kratos:
 * "Refused to connect because it violates the document's Content Security Policy".
 *
 * Now the header is the only policy. Its `connect-src` and `form-action` add the origins held
 * by two nginx variables, `$csp_connect_origins` and `$csp_form_origins`, which
 * nginx-csp-origins.conf sets to nothing and a deployment replaces with its own file.
 */

const ROOT = resolve(__dirname, '../..');

function read(path: string): string | null {
  try {
    return readFileSync(resolve(ROOT, path), 'utf-8');
  } catch {
    return null;
  }
}

function metaPolicy(html: string): string | null {
  return html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] ?? null;
}

function headerPolicy(): string {
  const conf = read('nginx-security-headers.conf');
  const m = conf?.match(/add_header Content-Security-Policy "([^"]+)" always;/);
  expect(m, 'nginx-security-headers.conf must ship a Content-Security-Policy').toBeTruthy();
  return m![1];
}

/** `{ 'script-src': ["'self'"], … }`. */
function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const fields = part.trim().split(/\s+/).filter(Boolean);
    if (fields.length > 0) out[fields[0]] = fields.slice(1);
  }
  return out;
}

describe('the Content-Security-Policy is one policy, configured per deployment', () => {
  it('index.html declares none: a <meta> policy would intersect with the header', () => {
    expect(metaPolicy(read('index.html')!)).toBeNull();
  });

  it('the built index.html declares none either', () => {
    const built = read('dist/index.html');
    // The bundle exists only after a build; the source file above is always checked.
    if (built !== null) expect(metaPolicy(built)).toBeNull();
  });

  it.each([
    ['connect-src', '$csp_connect_origins'],
    ['form-action', '$csp_form_origins'],
  ])('%s takes its environment origins from %s', (directive, variable) => {
    const sources = directives(headerPolicy())[directive];
    expect(sources).toContain("'self'");
    expect(sources).toContain(variable);
  });

  it('the header names no environment host', () => {
    expect(headerPolicy()).not.toMatch(/usetheo\.dev|getloopscale\.com/);
  });

  it('nginx-csp-origins.conf defines both variables, empty by default', () => {
    const conf = read('nginx-csp-origins.conf')!
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    for (const variable of ['$csp_connect_origins', '$csp_form_origins']) {
      const block = conf.match(new RegExp(`map \\$host \\${variable} \\{([^}]*)\\}`));
      expect(block, `nginx-csp-origins.conf defines no ${variable}`).toBeTruthy();
      expect(block![1].trim()).toBe('default "";');
    }
  });

  it('the image installs the origins file where nginx reads its http-level config', () => {
    expect(read('Dockerfile')).toMatch(
      /COPY nginx-csp-origins\.conf \/etc\/nginx\/conf\.d\/csp-origins\.conf/,
    );
  });

  it('frame-ancestors stays closed', () => {
    expect(directives(headerPolicy())['frame-ancestors']).toEqual(["'none'"]);
  });
});

describe("Red Team theo-cloud#67: script-src without 'unsafe-inline'", () => {
  // `'unsafe-inline'` in `script-src` removes the main defence against XSS. The bundle has no
  // inline handler (React uses synthetic events).
  it('nginx-security-headers.conf', () => {
    const scriptSrc = directives(headerPolicy())['script-src'];
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");
  });
});
