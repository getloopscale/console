// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * Hermetic regression-lock for the canonical PaaS env lexicon
 * (issue #127, ADR-Q6 of qa-dogfood-cleanup-2026-06-21-plan).
 *
 * Canonical: every PaaS project has EXACTLY TWO permanent environments:
 *   - `preview`     — auto-deployed branch + PR previews
 *   - `production`  — the named-release target
 *
 * The legacy `'staging'` term was off-model. It surfaced in:
 *   - components/secrets/add-secret-sheet.tsx (defaults)
 *   - components/secrets/bulk-upload-sheet.tsx (defaults)
 *   - associated unit tests
 *
 * Per EC-1 of the plan, the audit pattern is ANCHORED to the canonical
 * usage points — `availableEnvs`, `defaultEnvs`, and `env === 'staging'`
 * comparisons. It deliberately does NOT match:
 *   - generic test fixtures using `'staging'` as a sample env-name
 *   - prose comments documenting the historical rename
 *   - mock data in `dev-mocks.ts` (intentional sample data for design)
 *
 * Without the anchored pattern this audit would false-positive on every
 * test that uses 'staging' as a generic input — defeating the gate.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const SRC_ROOT = resolve(__dirname, '..');

const STAGING_DIRECTIVE_RE = new RegExp(
  String.raw`(availableEnvs|defaultEnvs)\s*[:=].*['"]staging['"]|` +
    String.raw`\benv\s*===\s*['"]staging['"]|` +
    String.raw`\benv\s*==\s*['"]staging['"]`,
);

// Files that ARE the audit OR document the legacy rename and would
// false-positive on their own description text. Pure allowlist of
// well-known references — keep narrow.
const SELF_AUDIT_ALLOWLIST = new Set<string>([
  resolve(__dirname, 'env-terminology.test.ts'),
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      walk(p, files);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      if (SELF_AUDIT_ALLOWLIST.has(p)) continue;
      files.push(p);
    }
  }
  return files;
}

/**
 * Pure audit — returns the list of "FILE:LINE — snippet" strings that
 * violate ADR-Q6. Empty array means the canonical lexicon holds.
 */
export function auditCanonicalEnvLexicon(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    body.split('\n').forEach((line, idx) => {
      if (STAGING_DIRECTIVE_RE.test(line)) {
        violations.push(`${file}:${idx + 1} — ${line.trim()}`);
      }
    });
  }
  return violations;
}

describe('canonical PaaS env lexicon (#127, ADR-Q6)', () => {
  const files = walk(SRC_ROOT);

  it('does not reference `staging` as an `availableEnvs` / `defaultEnvs` default or `env === "staging"` check', () => {
    const violations = auditCanonicalEnvLexicon(files);
    if (violations.length > 0) {
      throw new Error(
        'Canonical lexicon violation (ADR-Q6 of qa-dogfood-cleanup-2026-06-21):\n' +
          violations.map((v) => '  - ' + v).join('\n') +
          '\n\nRename `staging` to `preview` per the PaaS model (preview + production are the two permanent envs).',
      );
    }
  });

  // Negative-control: mutate an in-memory fixture line, then assert the
  // audit fires. A guard that passes the negative control is theatre.
  it('negative-control: audit catches the regression shape', () => {
    const mockFile = '/tmp/__env_lex_neg_control.ts';
    writeFileSync(
      mockFile,
      "export const x = { availableEnvs: ['production', 'staging'] };\n",
    );
    const violations = auditCanonicalEnvLexicon([mockFile]);
    unlinkSync(mockFile);
    expect(violations.length).toBeGreaterThan(0);
  });
});
