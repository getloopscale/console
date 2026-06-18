/**
 * Hermetic tests for use-rollback-in-flight. Validates the singleton
 * publish/subscribe contract used by RollbackDialog (publisher) and
 * deployments.tsx (subscriber) to render the transitional badge during
 * the ~90s sync gap (sponsor LIVE 2026-06-18).
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useRollbackInFlight,
  useStartRollback,
  useEndRollback,
  __resetRollbackInFlightStore,
} from './use-rollback-in-flight';

beforeEach(() => {
  __resetRollbackInFlightStore();
});

describe('use-rollback-in-flight', () => {
  it('returns null when nothing is in flight', () => {
    const { result } = renderHook(() => useRollbackInFlight('theokit-example'));
    expect(result.current).toBeNull();
  });

  it('publishes and subscribers receive the update on the same project', () => {
    const { result: reader } = renderHook(() =>
      useRollbackInFlight('theokit-example'),
    );
    const { result: starter } = renderHook(() => useStartRollback());
    act(() => {
      starter.current({
        projectName: 'theokit-example',
        targetBuildId: 'build-abc',
        targetSha: 'e6001ec',
        startedAt: 1718000000000,
      });
    });
    expect(reader.current).toEqual({
      projectName: 'theokit-example',
      targetBuildId: 'build-abc',
      targetSha: 'e6001ec',
      startedAt: 1718000000000,
    });
  });

  it('isolates in-flight state per project', () => {
    const { result: aReader } = renderHook(() => useRollbackInFlight('a'));
    const { result: bReader } = renderHook(() => useRollbackInFlight('b'));
    const { result: starter } = renderHook(() => useStartRollback());
    act(() => {
      starter.current({
        projectName: 'a',
        targetBuildId: 'build-a-1',
        targetSha: 'aaa1111',
        startedAt: 1,
      });
    });
    expect(aReader.current?.targetBuildId).toBe('build-a-1');
    expect(bReader.current).toBeNull();
  });

  it('clears in-flight state via useEndRollback and notifies subscribers', () => {
    const { result: reader } = renderHook(() => useRollbackInFlight('p'));
    const { result: starter } = renderHook(() => useStartRollback());
    const { result: ender } = renderHook(() => useEndRollback());
    act(() => {
      starter.current({
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

  it('end on an empty project is a no-op (no spurious notifications)', () => {
    let renderCount = 0;
    const { result: ender } = renderHook(() => useEndRollback());
    renderHook(() => {
      renderCount++;
      return useRollbackInFlight('never-active');
    });
    const before = renderCount;
    act(() => {
      ender.current('never-active');
    });
    expect(renderCount).toBe(before);
  });

  it('never touches the network (pure module-level state)', () => {
    let fetchCount = 0;
    const originalFetch = global.fetch;
    global.fetch = ((..._args: unknown[]) => {
      fetchCount++;
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    try {
      const { result: starter } = renderHook(() => useStartRollback());
      renderHook(() => useRollbackInFlight('p'));
      act(() => {
        starter.current({
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
