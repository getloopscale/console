// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { countByState, expiresIn, metadataPairs, ruleLines, runningFor, visibleSandboxes } from './list-view';

const row = (id: string, state: string, created_at: string) => ({ id, state, created_at });
const rows = [
  row('sbx_aaa111', 'running', '2026-11-28T10:00:00Z'),
  row('sbx_bbb222', 'paused', '2026-11-28T10:05:00Z'),
  row('sbx_ccc333', 'running', '2026-11-28T09:00:00Z'),
];

describe('visibleSandboxes', () => {
  it('keeps the sandboxes whose id contains the search text, ignoring case and spaces', () => {
    expect(visibleSandboxes(rows, { search: ' BBB ', state: 'all', order: 'newest' }).map((s) => s.id)).toEqual([
      'sbx_bbb222',
    ]);
  });

  it('keeps one state when a state is chosen', () => {
    expect(visibleSandboxes(rows, { search: '', state: 'paused', order: 'newest' }).map((s) => s.id)).toEqual([
      'sbx_bbb222',
    ]);
  });

  it('orders by start time in the chosen direction', () => {
    const ids = (order: 'newest' | 'oldest') =>
      visibleSandboxes(rows, { search: '', state: 'all', order }).map((s) => s.id);
    expect(ids('newest')).toEqual(['sbx_bbb222', 'sbx_aaa111', 'sbx_ccc333']);
    expect(ids('oldest')).toEqual(['sbx_ccc333', 'sbx_aaa111', 'sbx_bbb222']);
  });
});

describe('countByState', () => {
  it('counts every sandbox and each state', () => {
    expect(countByState(rows)).toEqual({ all: 3, running: 2, paused: 1, pending: 0 });
  });
});

describe('runningFor', () => {
  const at = (iso: string) => Date.parse(iso);

  it('writes seconds, then minutes, then hours and minutes', () => {
    expect(runningFor('2026-11-28T10:00:00Z', at('2026-11-28T10:00:42Z'))).toBe('42s');
    expect(runningFor('2026-11-28T10:00:00Z', at('2026-11-28T10:07:05Z'))).toBe('7m 5s');
    expect(runningFor('2026-11-28T10:00:00Z', at('2026-11-28T13:20:59Z'))).toBe('3h 20m');
  });

  it('reads zero when the server clock is ahead of this one', () => {
    expect(runningFor('2026-11-28T10:00:05Z', at('2026-11-28T10:00:00Z'))).toBe('0s');
  });

  it('writes a dash for a start time it cannot read', () => {
    expect(runningFor('', 0)).toBe('—');
  });
});

describe('metadataPairs', () => {
  it('writes each label as key=value in the order of the keys', () => {
    expect(metadataPairs({ suite: 'demo', app: 'api' })).toEqual(['app=api', 'suite=demo']);
    expect(metadataPairs(undefined)).toEqual([]);
  });
});

describe('expiresIn', () => {
  it('writes the time left, and zero once it has passed', () => {
    expect(expiresIn('2026-11-28T10:05:00Z', Date.parse('2026-11-28T10:00:30Z'))).toBe('4m 30s');
    expect(expiresIn('2026-11-28T10:05:00Z', Date.parse('2026-11-28T10:06:00Z'))).toBe('0s');
    expect(expiresIn(undefined, 0)).toBe('—');
  });
});

describe('ruleLines', () => {
  it('reads one rule per line, trimmed, without the empty lines', () => {
    expect(ruleLines('pypi.org\n  files.pythonhosted.org \n\n')).toEqual(['pypi.org', 'files.pythonhosted.org']);
    expect(ruleLines('')).toEqual([]);
  });
});
