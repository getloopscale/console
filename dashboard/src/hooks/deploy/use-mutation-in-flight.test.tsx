/**
 * Hermetic tests for use-mutation-in-flight. Validates the generalized
 * publish/subscribe contract used by RollbackDialog + PromoteToProduction
 * Dialog + (future) RedeployDialog to render the transitional badge
 * during long-running deploy mutations (sponsor LIVE 2026-06-18).
 *
 * Back-compat: also exercises the kind-filter behavior — a rollback-
 * specific reader (use-rollback-in-flight wrapper) MUST return null
 * when only a promote is in flight, and vice-versa.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useMutationInFlight,
  useStartMutation,
  useEndMutation,
  __resetMutationInFlightStore,
} from './use-mutation-in-flight';
import { useRollbackInFlight } from '@/hooks/deploy/use-rollback-in-flight';

beforeEach(() => {
  __resetMutationInFlightStore();
});

describe('use-mutation-in-flight', () => {
  it('returns null when nothing is in flight', () => {
    const { result } = renderHook(() => useMutationInFlight('loopzero-example'));
    expect(result.current).toBeNull();
  });

  it('publishes and subscribers receive the promote update', () => {
    const { result: reader } = renderHook(() =>
      useMutationInFlight('loopzero-example'),
    );
    const { result: starter } = renderHook(() => useStartMutation());
    act(() => {
      starter.current({
        kind: 'promote',
        projectName: 'loopzero-example',
        targetBuildId: 'build-abc',
        targetSha: 'e6001ec',
        startedAt: 1718000000000,
      });
    });
    expect(reader.current).toEqual({
      kind: 'promote',
      projectName: 'loopzero-example',
      targetBuildId: 'build-abc',
      targetSha: 'e6001ec',
      startedAt: 1718000000000,
    });
  });

  it('isolates in-flight state per project', () => {
    const { result: aReader } = renderHook(() => useMutationInFlight('a'));
    const { result: bReader } = renderHook(() => useMutationInFlight('b'));
    const { result: starter } = renderHook(() => useStartMutation());
    act(() => {
      starter.current({
        kind: 'promote',
        projectName: 'a',
        targetBuildId: 'build-a-1',
        targetSha: 'aaa1111',
        startedAt: 1,
      });
    });
    expect(aReader.current?.targetBuildId).toBe('build-a-1');
    expect(bReader.current).toBeNull();
  });

  it('clears in-flight state via useEndMutation and notifies subscribers', () => {
    const { result: reader } = renderHook(() => useMutationInFlight('p'));
    const { result: starter } = renderHook(() => useStartMutation());
    const { result: ender } = renderHook(() => useEndMutation());
    act(() => {
      starter.current({
        kind: 'promote',
        projectName: 'p',
        targetBuildId: 'build-x',
        targetSha: '1234567',
        startedAt: 1,
      });
    });
    expect(reader.current).not.toBeNull();
    act(() => {
      ender.current('p');
    });
    expect(reader.current).toBeNull();
  });

  it('replaces prior in-flight entry when a second mutation starts for the same project', () => {
    // Backend serializes mutations under withEnvironmentLock, but defense
    // in depth: if a second start sneaks in, the store reflects the
    // latest (we never end up with two simultaneous transitional badges
    // for the same project).
    const { result: reader } = renderHook(() => useMutationInFlight('p'));
    const { result: starter } = renderHook(() => useStartMutation());
    act(() => {
      starter.current({
        kind: 'rollback',
        projectName: 'p',
        targetBuildId: 'build-1',
        targetSha: 'aaa1111',
        startedAt: 1,
      });
    });
    act(() => {
      starter.current({
        kind: 'promote',
        projectName: 'p',
        targetBuildId: 'build-2',
        targetSha: 'bbb2222',
        startedAt: 2,
      });
    });
    expect(reader.current?.kind).toBe('promote');
    expect(reader.current?.targetBuildId).toBe('build-2');
  });

  it('rollback-specific reader returns null when only a promote is in flight', () => {
    const { result: rollbackReader } = renderHook(() =>
      useRollbackInFlight('p'),
    );
    const { result: starter } = renderHook(() => useStartMutation());
    act(() => {
      starter.current({
        kind: 'promote',
        projectName: 'p',
        targetBuildId: 'build-x',
        targetSha: '1234567',
        startedAt: 1,
      });
    });
    // The legacy rollback badge code path MUST NOT light up for a
    // promote — the kind filter preserves the original semantic.
    expect(rollbackReader.current).toBeNull();
  });

  it('rollback-specific reader returns the entry when a rollback is in flight', () => {
    const { result: rollbackReader } = renderHook(() =>
      useRollbackInFlight('p'),
    );
    const { result: starter } = renderHook(() => useStartMutation());
    act(() => {
      starter.current({
        kind: 'rollback',
        projectName: 'p',
        targetBuildId: 'build-x',
        targetSha: '1234567',
        startedAt: 1,
      });
    });
    expect(rollbackReader.current).toEqual({
      projectName: 'p',
      targetBuildId: 'build-x',
      targetSha: '1234567',
      startedAt: 1,
    });
  });

  it('never touches the network (pure module-level state)', () => {
    let fetchCount = 0;
    const originalFetch = global.fetch;
    global.fetch = ((..._args: unknown[]) => {
      fetchCount++;
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    try {
      const { result: starter } = renderHook(() => useStartMutation());
      renderHook(() => useMutationInFlight('p'));
      act(() => {
        starter.current({
          kind: 'promote',
          projectName: 'p',
          targetBuildId: 'b',
          targetSha: '1234567',
          startedAt: 1,
        });
      });
      expect(fetchCount).toBe(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
