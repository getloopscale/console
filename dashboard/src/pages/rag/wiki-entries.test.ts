import { describe, it, expect } from 'vitest';

import { deriveWikiEntries, leafName, breadcrumbSegments, prefixForCrumb, type WikiEntry } from './wiki-entries';

const pages: WikiEntry[] = [
  { id: 'p1', name: 'api/auth.md', status: 'ready' },
  { id: 'p2', name: 'api/deploy.md', status: 'ready' },
  { id: 'p3', name: 'api/v2/tokens.md', status: 'ready' },
  { id: 'p4', name: 'Overview.md', status: 'ready' },
  { id: 'k1', name: 'runbooks/.keep', status: 'ready' }, // empty-folder marker
];

describe('deriveWikiEntries (single-list folder browser)', () => {
  it('at root: shows top-level folders + top-level pages, hides the .keep marker', () => {
    const { folders, pages: p } = deriveWikiEntries(pages, '');
    expect(folders).toEqual(['api', 'runbooks']); // runbooks visible via its .keep marker
    expect(p.map((x) => x.id)).toEqual(['p4']); // only Overview.md is a root page
  });

  it('drills into a folder: pages directly under it + nested subfolders', () => {
    const { folders, pages: p } = deriveWikiEntries(pages, 'api/');
    expect(folders).toEqual(['v2']); // api/v2/ is a subfolder
    expect(p.map((x) => x.id)).toEqual(['p1', 'p2']); // api/auth.md, api/deploy.md
  });

  it('an empty folder (only a .keep) shows no pages', () => {
    const { folders, pages: p } = deriveWikiEntries(pages, 'runbooks/');
    expect(folders).toEqual([]);
    expect(p).toEqual([]);
  });
});

describe('path helpers', () => {
  it('leafName returns the last segment', () => {
    expect(leafName('api/v2/tokens.md')).toBe('tokens.md');
    expect(leafName('Overview.md')).toBe('Overview.md');
  });
  it('breadcrumbSegments splits the prefix', () => {
    expect(breadcrumbSegments('api/v2/')).toEqual(['api', 'v2']);
    expect(breadcrumbSegments('')).toEqual([]);
  });
  it('prefixForCrumb rebuilds the prefix up to a crumb', () => {
    expect(prefixForCrumb('api/v2/', 0)).toBe('api/');
    expect(prefixForCrumb('api/v2/', 1)).toBe('api/v2/');
  });
});
