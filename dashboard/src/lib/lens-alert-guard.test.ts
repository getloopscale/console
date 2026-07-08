import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recurrence guard for #175 (the @usetheo/ui Alert-body drop). Every lens page MUST import `Alert`
 * from the app-side `alert-guard` wrapper (which renders `children` as the body), NEVER the raw
 * `@usetheo/ui` Alert (which silently drops `children`). A page that reaches for the raw primitive
 * again re-opens the exact class this milestone closed — so this test fails loudly.
 */
const LENS_DIR = join(__dirname, '..', 'pages', 'lens');

function lensTsxFiles(): string[] {
  // node's globSync (Node 22+) — the repo's runtime; falls back to a manual walk if unavailable.
  return globSync('**/*.tsx', { cwd: LENS_DIR }).map((f) => join(LENS_DIR, f));
}

describe('#175 recurrence guard — lens Alert usage', () => {
  it('no lens page imports Alert directly from @usetheo/ui (must use the alert-guard wrapper)', () => {
    const offenders: string[] = [];
    for (const file of lensTsxFiles()) {
      const src = readFileSync(file, 'utf8');
      const uiImport = src.match(/import\s*\{([^}]*)\}\s*from\s*'@usetheo\/ui';/);
      if (uiImport && /\bAlert\b/.test(uiImport[1])) offenders.push(file);
    }
    expect(offenders, `raw @usetheo/ui Alert import found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every lens page that renders <Alert> imports it from the alert-guard wrapper', () => {
    const offenders: string[] = [];
    for (const file of lensTsxFiles()) {
      const src = readFileSync(file, 'utf8');
      if (!/<Alert[\s>]/.test(src)) continue; // page renders no Alert
      if (!/from\s*'@\/components\/ui\/alert-guard'/.test(src)) offenders.push(file);
    }
    expect(offenders, `<Alert> rendered without the alert-guard import in: ${offenders.join(', ')}`).toEqual([]);
  });
});
