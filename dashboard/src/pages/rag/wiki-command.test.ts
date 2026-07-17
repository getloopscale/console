import { describe, it, expect } from 'vitest';

import { toCommandItems } from './wiki-command';

describe('toCommandItems (KB14 Cmd+K palette)', () => {
  it('maps pages to command items with leaf label + full path as searchable', () => {
    const items = toCommandItems([
      { id: 'p1', name: 'api/auth.md', type: 'api' },
      { id: 'p2', name: 'Overview.md', type: 'concept' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'p1', label: 'auth.md', searchable: 'api/auth.md' });
    // folder + non-default type surface as a hint line
    expect(items[0].hint).toBe('api · api');
    // default type (concept) is omitted from the hint; no folder → no hint
    expect(items[1].hint).toBeUndefined();
  });

  it('returns an empty list for no pages', () => {
    expect(toCommandItems([])).toEqual([]);
  });
});
