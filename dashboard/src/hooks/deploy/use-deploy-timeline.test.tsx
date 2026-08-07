import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  ensureSSEToken: vi.fn(async () => 'tok'),
  clearToken: vi.fn(),
  hasValidToken: vi.fn(() => true),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  API_URL: '',
}));

import { useDeployTimeline } from './use-deploy-timeline';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  addEventListener(type: string, l: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  removeEventListener() {}
  emit(type: string, data: unknown, lastEventId = '') {
    const ev = { data: JSON.stringify(data), lastEventId };
    (this.listeners[type] ?? []).forEach((l) => l(ev));
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error global stub
  globalThis.EventSource = MockEventSource;
  vi.clearAllMocks();
});

afterEach(() => {
  MockEventSource.instances = [];
});

describe('useDeployTimeline', () => {
  it('returns 5 pending phases when no events have arrived', () => {
    const { result } = renderHook(() => useDeployTimeline('dep-1'));
    expect(result.current.phases.map((p) => p.phase)).toEqual([
      'build',
      'sign',
      'release',
      'deploy',
      'live',
    ]);
    expect(result.current.phases.every((p) => p.status === 'pending')).toBe(true);
    expect(result.current.overall).toBe('queued');
  });

  it('returns null when deployID is empty', () => {
    const { result } = renderHook(() => useDeployTimeline(null));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.phases).toHaveLength(5);
  });

  it('marks build/in_progress when the first event arrives', async () => {
    const { result } = renderHook(() => useDeployTimeline('dep-2'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit(
        'deploy_timeline.build.in_progress',
        {
          deploy_id: 'dep-2',
          phase: 'build',
          status: 'in_progress',
          timestamp: '2026-06-18T12:00:00Z',
          substate_message: 'cloning repository',
        },
        '1',
      );
    });
    await waitFor(() => {
      expect(result.current.phases[0].status).toBe('in_progress');
    });
    expect(result.current.phases[0].substateMessage).toBe('cloning repository');
    expect(result.current.overall).toBe('running');
  });

  it('drives the full happy path to live/completed', async () => {
    const { result } = renderHook(() => useDeployTimeline('dep-3'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const es = MockEventSource.instances[0];
    const sequence = [
      ['deploy_timeline.build.in_progress', { phase: 'build', status: 'in_progress' }],
      ['deploy_timeline.build.completed', { phase: 'build', status: 'completed' }],
      ['deploy_timeline.sign.completed', { phase: 'sign', status: 'completed' }],
      ['deploy_timeline.release.completed', { phase: 'release', status: 'completed' }],
      ['deploy_timeline.deploy.completed', { phase: 'deploy', status: 'completed' }],
      ['deploy_timeline.live.completed', { phase: 'live', status: 'completed' }],
    ] as const;
    act(() => {
      sequence.forEach(([type, payload], idx) => {
        es.emit(
          type,
          { ...payload, deploy_id: 'dep-3', timestamp: `2026-06-18T12:0${idx}:00Z` },
          String(idx + 1),
        );
      });
    });
    await waitFor(() => {
      expect(result.current.phases[4].status).toBe('completed');
    });
    expect(result.current.overall).toBe('live');
  });

  it('surfaces aggregator-degraded reason from synthetic event', async () => {
    const { result } = renderHook(() => useDeployTimeline('dep-4'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit(
        'deploy_timeline.aggregator.degraded',
        {
          deploy_id: 'dep-4',
          degraded_reason: 'timeline temporarily unavailable',
          timestamp: '2026-06-18T12:00:00Z',
        },
        '99',
      );
    });
    await waitFor(() => {
      expect(result.current.aggregatorDegradedReason).toBe(
        'timeline temporarily unavailable',
      );
    });
    expect(result.current.overall).toBe('degraded');
  });

  it('marks overall=failed when any phase reaches failed', async () => {
    const { result } = renderHook(() => useDeployTimeline('dep-5'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit(
        'deploy_timeline.deploy.failed',
        {
          deploy_id: 'dep-5',
          phase: 'deploy',
          status: 'failed',
          timestamp: '2026-06-18T12:00:00Z',
          degraded_reason: 'pods failed to come up',
        },
        '1',
      );
    });
    await waitFor(() => {
      expect(result.current.overall).toBe('failed');
    });
    expect(result.current.phases[3].status).toBe('failed');
    expect(result.current.phases[3].degradedReason).toBe('pods failed to come up');
  });
});
