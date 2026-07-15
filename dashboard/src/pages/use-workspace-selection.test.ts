import { describe, it, expect } from 'vitest';

import { toBulkRequest, selectionStats } from './use-workspace-selection';
import type { StorageFile } from './workspace';

describe('toBulkRequest', () => {
  it('splits keys into files (paths) and folders (trailing slash → prefixes)', () => {
    const r = toBulkRequest(new Set(['a.txt', 'data/', 'b/c.txt', 'skills/']));
    expect([...r.paths].sort()).toEqual(['a.txt', 'b/c.txt']);
    expect([...r.prefixes].sort()).toEqual(['data/', 'skills/']);
  });

  it('is empty for an empty selection', () => {
    expect(toBulkRequest(new Set())).toEqual({ paths: [], prefixes: [] });
  });
});

describe('selectionStats', () => {
  const files: StorageFile[] = [
    { path: 'data/a.txt', size: 10, content_type: 'text/plain' },
    { path: 'data/b.txt', size: 20, content_type: 'text/plain' },
    { path: 'data/.keep', size: 1, content_type: 'application/octet-stream' },
    { path: 'x.txt', size: 5, content_type: 'text/plain' },
  ];

  it('counts files under a selected prefix, excludes the .keep marker, sums size', () => {
    expect(selectionStats(files, { paths: [], prefixes: ['data/'] })).toEqual({ count: 2, size: 30 });
  });

  it('dedupes an overlap (a folder AND a file inside it counted once)', () => {
    expect(selectionStats(files, { paths: ['data/a.txt'], prefixes: ['data/'] })).toEqual({ count: 2, size: 30 });
  });

  it('counts a directly-selected file', () => {
    expect(selectionStats(files, { paths: ['x.txt'], prefixes: [] })).toEqual({ count: 1, size: 5 });
  });

  it('is zero for a selection that matches nothing loaded', () => {
    expect(selectionStats(files, { paths: [], prefixes: ['nope/'] })).toEqual({ count: 0, size: 0 });
  });
});
