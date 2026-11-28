// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { childPath, crumbs, encodedFilePath, sortedEntries } from './workspace-paths';

describe('crumbs', () => {
  it('lists the directories from the workspace down to the path', () => {
    expect(crumbs('/workspace/src/app')).toEqual([
      { label: 'workspace', path: '/workspace' },
      { label: 'src', path: '/workspace/src' },
      { label: 'app', path: '/workspace/src/app' },
    ]);
    expect(crumbs('/workspace')).toEqual([{ label: 'workspace', path: '/workspace' }]);
  });
});

describe('childPath', () => {
  it('joins a directory and a name with one slash', () => {
    expect(childPath('/workspace', 'a.txt')).toBe('/workspace/a.txt');
    expect(childPath('/workspace/src/', 'a.txt')).toBe('/workspace/src/a.txt');
  });
});

describe('encodedFilePath', () => {
  it('drops the leading slash and encodes each segment, keeping the slashes', () => {
    expect(encodedFilePath('/workspace/my dir/a#1.txt')).toBe('workspace/my%20dir/a%231.txt');
  });
});

describe('sortedEntries', () => {
  it('puts directories first and orders each group by name', () => {
    const entries = [
      { name: 'b.txt', is_dir: false },
      { name: 'src', is_dir: true },
      { name: 'a.txt', is_dir: false },
      { name: 'docs', is_dir: true },
    ];
    expect(sortedEntries(entries).map((e) => e.name)).toEqual(['docs', 'src', 'a.txt', 'b.txt']);
  });
});
