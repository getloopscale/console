import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useClockTick } from './use-clock-tick';

function Elapsed({ since }: { since: number }) {
  useClockTick(30_000);
  return <p>{Math.round((Date.now() - since) / 1000)} seconds ago</p>;
}

describe('useClockTick', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a relative time moving while the page stays open', () => {
    render(<Elapsed since={Date.now() - 2000} />);
    expect(screen.getByText('2 seconds ago')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('62 seconds ago')).toBeInTheDocument();
  });
});
