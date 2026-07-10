import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recurrence guard for #175 (the @usetheo/ui Alert-body drop). Every page/component MUST import
 * `Alert` from the app-side `alert-guard` wrapper (which renders `children` as the body), NEVER the
 * raw `@usetheo/ui` Alert (which silently drops `children`). Reaching for the raw primitive again
 * re-opens the exact class M87 closed — this test fails loudly. Scope widened from `pages/lens` to the
 * whole `src/**` tree (M87: all 45 Alert consumers now route through the guard), matching the
 * `no-restricted-imports` ESLint ban's coverage. The guard file itself is the ONE sanctioned
 * raw-Alert consumer (excluded below).
 */
const SRC_DIR = join(__dirname, '..');
const GUARD_REL = join('components', 'ui', 'alert-guard.tsx');

function srcTsxFiles(): string[] {
  // node's globSync (Node 22+) — the repo's runtime.
  return globSync('**/*.tsx', { cwd: SRC_DIR })
    .filter((f) => !f.endsWith(GUARD_REL) && !/\.(test|stories)\.tsx$/.test(f))
    .map((f) => join(SRC_DIR, f));
}

describe('#175 recurrence guard — dashboard-wide Alert usage', () => {
  it('no src file imports Alert directly from @usetheo/ui (must use the alert-guard wrapper)', () => {
    const offenders: string[] = [];
    for (const file of srcTsxFiles()) {
      const src = readFileSync(file, 'utf8');
      // multiline-aware: match the whole @usetheo/ui named-import block
      const uiImport = src.match(/import\s*\{([^}]*)\}\s*from\s*'@usetheo\/ui';/s);
      if (uiImport && /\bAlert\b/.test(uiImport[1])) offenders.push(file);
    }
    expect(offenders, `raw @usetheo/ui Alert import found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every file that renders <Alert> imports it from the alert-guard wrapper', () => {
    const offenders: string[] = [];
    for (const file of srcTsxFiles()) {
      const src = readFileSync(file, 'utf8');
      if (!/<Alert[\s>]/.test(src)) continue; // renders no Alert
      if (!/from\s*'@\/components\/ui\/alert-guard'/.test(src)) offenders.push(file);
    }
    expect(offenders, `<Alert> rendered without the alert-guard import in: ${offenders.join(', ')}`).toEqual([]);
  });
});
