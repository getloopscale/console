import { describe, it, expect } from 'vitest';

import { parseSlash, filterSlashItems, SLASH_ITEMS } from './kb-editor-slash';

describe('parseSlash (KB11 slash-menu trigger)', () => {
  it('opens on a bare slash at the start of a block', () => {
    expect(parseSlash('/')).toBe('');
  });

  it('captures the query typed after the slash', () => {
    expect(parseSlash('/head')).toBe('head');
    expect(parseSlash('/list')).toBe('list');
  });

  it('does not trigger mid-word (e.g. a path)', () => {
    expect(parseSlash('path/to')).toBeNull();
    expect(parseSlash('src/index')).toBeNull();
  });

  it('does not trigger once a space is typed after the query', () => {
    expect(parseSlash('/head ')).toBeNull();
  });

  it('does not trigger when there is text before the slash on the block', () => {
    expect(parseSlash('hello /head')).toBeNull();
  });
});

describe('filterSlashItems (KB11 palette filter)', () => {
  it('returns the whole palette for an empty query', () => {
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length);
  });

  it('matches by label', () => {
    const r = filterSlashItems('head');
    expect(r.map((i) => i.id)).toEqual(['h1', 'h2', 'h3']);
  });

  it('matches by keyword', () => {
    const r = filterSlashItems('todo');
    // "todo" is not a keyword in the base palette; ensure keyword matching works via "ul"
    expect(filterSlashItems('ul').map((i) => i.id)).toContain('bullet');
    expect(r).toEqual([]);
  });

  it('returns empty for a no-match query', () => {
    expect(filterSlashItems('zzzzz')).toEqual([]);
  });
});
