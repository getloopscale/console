// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { nextBoardName } from './board-name';

describe('nextBoardName (M75 — unique default dashboard name)', () => {
  it('returns the bare base when no board uses it', () => {
    expect(nextBoardName([])).toBe('Tracing Overview');
    expect(nextBoardName(['Something else'])).toBe('Tracing Overview');
  });

  it('suffixes the smallest free number when the base is taken', () => {
    expect(nextBoardName(['Tracing Overview'])).toBe('Tracing Overview 2');
    expect(nextBoardName(['Tracing Overview', 'Tracing Overview 2'])).toBe('Tracing Overview 3');
  });

  it('fills the lowest gap, not just max+1', () => {
    expect(nextBoardName(['Tracing Overview', 'Tracing Overview 3'])).toBe('Tracing Overview 2');
  });

  it('respects a custom base', () => {
    expect(nextBoardName(['My board'], 'My board')).toBe('My board 2');
  });

  it('is unaffected by unrelated names and whitespace', () => {
    expect(nextBoardName(['  ', 'Latency', 'Tracing Overview'])).toBe('Tracing Overview 2');
  });
});
