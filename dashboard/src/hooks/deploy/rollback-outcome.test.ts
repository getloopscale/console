// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { RollbackResponse } from '@/lib/api/types';
import {
  classifyRollback,
  followRollback,
  ROLLBACK_DEADLINE_MS,
} from './rollback-outcome';

const accepted: RollbackResponse = {
  status: 'in_progress',
  rolled_back_release: 'rel-current',
  reactivated_release: 'rel-target',
  environment: 'production',
  url: 'https://app.example.test',
};

function statusWith(id: string | null) {
  return {
    active_release: id
      ? { id, build_id: 'b', status: 'ACTIVE', created_at: '2026-11-25T00:00:00Z' }
      : null,
  };
}

/** A clock the test moves: `sleep` advances it instead of waiting. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
    }),
  };
}

describe('classifyRollback', () => {
  it('is in progress while the environment has no active release', () => {
    expect(classifyRollback(accepted, statusWith(null))).toBe('in_progress');
    expect(classifyRollback(accepted, {})).toBe('in_progress');
  });

  it('succeeded when the active release is the one the API said it would reactivate', () => {
    expect(classifyRollback(accepted, statusWith('rel-target'))).toBe('succeeded');
  });

  it('failed when the release rolled back from is active again', () => {
    expect(classifyRollback(accepted, statusWith('rel-current'))).toBe('failed');
  });

  it('superseded when a third release is active', () => {
    expect(classifyRollback(accepted, statusWith('rel-newer'))).toBe('superseded');
  });
});

describe('followRollback', () => {
  it('polls until the target release is active', async () => {
    const clock = fakeClock();
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce(statusWith(null))
      .mockResolvedValueOnce(statusWith(null))
      .mockResolvedValueOnce(statusWith('rel-target'));

    const outcome = await followRollback(accepted, readStatus, { ...clock, intervalMs: 5000 });

    expect(outcome.state).toBe('succeeded');
    expect(outcome.activeReleaseId).toBe('rel-target');
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it('reports a failure as soon as the previous release is active again', async () => {
    const clock = fakeClock();
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce(statusWith(null))
      .mockResolvedValueOnce(statusWith('rel-current'));

    const outcome = await followRollback(accepted, readStatus, clock);

    expect(outcome.state).toBe('failed');
    expect(outcome.activeReleaseId).toBe('rel-current');
  });

  it('keeps polling through a status read that fails', async () => {
    const clock = fakeClock();
    const readStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(statusWith('rel-target'));

    const outcome = await followRollback(accepted, readStatus, clock);

    expect(outcome.state).toBe('succeeded');
  });

  it('times out at the deadline and carries the last read error', async () => {
    const clock = fakeClock();
    const readStatus = vi.fn().mockRejectedValue(new Error('status unavailable'));

    const outcome = await followRollback(accepted, readStatus, {
      ...clock,
      intervalMs: 5000,
      deadlineMs: 12_000,
    });

    expect(outcome.state).toBe('timed_out');
    expect(outcome.activeReleaseId).toBeNull();
    expect(outcome.lastReadError?.message).toBe('status unavailable');
    // 0s, 5s, 10s, 15s: the read at 15s is the first one past the deadline.
    expect(readStatus).toHaveBeenCalledTimes(4);
  });

  it('waits as long as the API may take: 15 minutes plus the state change', () => {
    expect(ROLLBACK_DEADLINE_MS).toBe(16 * 60 * 1000);
  });
});
