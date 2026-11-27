import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNow } from './use-clock-tick';

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads the time again at each interval', () => {
    const { result } = renderHook(() => useNow(30_000));
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current - first).toBe(60_000);
  });
});
