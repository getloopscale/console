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

import { useDeployTimelineWithSteps } from './use-deploy-timeline-with-steps';

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

describe('useDeployTimelineWithSteps', () => {
  it('opens two SSE streams: deploy_timeline + build step', async () => {
    renderHook(() => useDeployTimelineWithSteps('dep-1'));
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2));
    const urls = MockEventSource.instances.map((i) => i.url);
    expect(urls.some((u) => u.includes('/deploys/dep-1/timeline'))).toBe(true);
    expect(urls.some((u) => u.includes('/builds/dep-1/stream'))).toBe(true);
  });

  it('groups J-17 build steps under their canonical phase via phase_group mapping', async () => {
    const { result } = renderHook(() => useDeployTimelineWithSteps('dep-2'));
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2));
    const stepStream = MockEventSource.instances.find((i) => i.url.includes('/builds/'));
    expect(stepStream).toBeTruthy();
    act(() => {
      stepStream!.emit(
        'build.step.started',
        { step_name: 'clone-repo', started_at: '2026-06-18T12:00:00Z', phase_group: 'clone' },
        '1',
      );
      stepStream!.emit(
        'build.step.succeeded',
        {
          step_name: 'clone-repo',
          started_at: '2026-06-18T12:00:00Z',
          ended_at: '2026-06-18T12:00:09Z',
          duration_seconds: 9,
          phase_group: 'clone',
        },
        '2',
      );
      stepStream!.emit(
        'build.step.succeeded',
        {
          step_name: 'cosign-sign',
          started_at: '2026-06-18T12:02:30Z',
          ended_at: '2026-06-18T12:03:02Z',
          duration_seconds: 32,
          phase_group: 'sign',
        },
        '3',
      );
      stepStream!.emit(
        'build.step.succeeded',
        {
          step_name: 'gitops-push',
          started_at: '2026-06-18T12:03:02Z',
          ended_at: '2026-06-18T12:03:06Z',
          duration_seconds: 4,
          phase_group: 'deliver',
        },
        '4',
      );
    });

    await waitFor(() => {
      const build = result.current.phases.find((p) => p.phase === 'build');
      expect(build?.steps.length).toBeGreaterThanOrEqual(1);
    });

    const phases = result.current.phases;
    const findPhase = (n: string) => phases.find((p) => p.phase === n)!;

    expect(findPhase('build').steps.map((s) => s.name)).toContain('clone-repo');
    expect(findPhase('sign').steps.map((s) => s.name)).toContain('cosign-sign');
    expect(findPhase('release').steps.map((s) => s.name)).toContain('gitops-push');
    expect(findPhase('deploy').steps).toHaveLength(0);
    expect(findPhase('live').steps).toHaveLength(0);
  });

  it('exposes step duration + status fields for UI render', async () => {
    const { result } = renderHook(() => useDeployTimelineWithSteps('dep-3'));
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2));
    const stepStream = MockEventSource.instances.find((i) => i.url.includes('/builds/'))!;
    act(() => {
      stepStream.emit(
        'build.step.succeeded',
        {
          step_name: 'install-deps',
          started_at: '2026-06-18T12:00:00Z',
          ended_at: '2026-06-18T12:00:47Z',
          duration_seconds: 47,
          phase_group: 'install',
        },
        '1',
      );
    });

    await waitFor(() => {
      const build = result.current.phases.find((p) => p.phase === 'build');
      expect(build?.steps[0]?.durationSeconds).toBe(47);
    });
    const step = result.current.phases.find((p) => p.phase === 'build')!.steps[0];
    expect(step.status).toBe('succeeded');
    expect(step.name).toBe('install-deps');
  });
});
