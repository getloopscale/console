import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * M88 recurrence guard for #138 (the KPI-primitive vocabulary split). The dashboard standardized its
 * headline-KPI tiles on `MetricCard` (the house convention across every observability surface);
 * `StatTile` was the outlier (memory/rag pages) and is fully removed. A file that reaches for `StatTile`
 * again re-opens the split — this test fails loudly. (StatTile is an interactive button primitive; a
 * genuinely-clickable stat is a different concern and would warrant its own ADR, not a silent re-split.)
 */
const SRC_DIR = join(__dirname, '..');

function srcTsxFiles(): string[] {
  return globSync('**/*.tsx', { cwd: SRC_DIR })
    .filter((f) => !/\.(test|stories)\.tsx$/.test(f))
    .map((f) => join(SRC_DIR, f));
}

describe('#138 recurrence guard — one KPI primitive (MetricCard)', () => {
  it('no dashboard file imports or renders StatTile (unified on MetricCard)', () => {
    const offenders: string[] = [];
    for (const file of srcTsxFiles()) {
      const src = readFileSync(file, 'utf8');
      if (/\bStatTile\b/.test(src)) offenders.push(file);
    }
    expect(offenders, `StatTile usage found (should be MetricCard) in: ${offenders.join(', ')}`).toEqual([]);
  });
});
