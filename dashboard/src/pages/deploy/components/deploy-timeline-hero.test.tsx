import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  signOutIfSessionEnded: vi.fn(async () => false),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({
  API_URL: '',
}));

import { DeployTimelineHero } from './deploy-timeline-hero';
import { __setTransporte } from '@/hooks/deploy/shared-event-source';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  opcoes: { lastEventId?: string | null } | undefined;
  constructor(url: string, opcoes?: { lastEventId?: string | null }) {
    this.opcoes = opcoes;
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
    // B-088 — o transporte deixou de ser o EventSource global (o JWT foi para
    // o header Authorization). O fake expoe a mesma superficie; muda so onde
    // ele e instalado.
    __setTransporte((url, opcoes) => new MockEventSource(url, opcoes) as unknown as EventSource);
  vi.clearAllMocks();
});

afterEach(() => {
  MockEventSource.instances = [];
});

describe('DeployTimelineHero', () => {
  it('renders all 5 phase names in canonical order', () => {
    render(<DeployTimelineHero deployId="dep-1" />);
    const list = screen.getByTestId('deploy-timeline-phases');
    const cells = within(list).getAllByRole('listitem');
    expect(cells).toHaveLength(5);
    expect(within(cells[0]).getByText('Build')).toBeTruthy();
    expect(within(cells[1]).getByText('Sign')).toBeTruthy();
    expect(within(cells[2]).getByText('Release')).toBeTruthy();
    expect(within(cells[3]).getByText('Deploy')).toBeTruthy();
    expect(within(cells[4]).getByText('Live')).toBeTruthy();
  });

  it('marks the in_progress phase with aria-current="step"', async () => {
    render(<DeployTimelineHero deployId="dep-2" />);
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1));
    const es = MockEventSource.instances.find((i) => i.url.includes('/deploys/')) ?? MockEventSource.instances[0];
    act(() => {
      es.emit(
        'deploy_timeline.build.in_progress',
        {
          deploy_id: 'dep-2',
          phase: 'build',
          status: 'in_progress',
          timestamp: '2026-06-18T12:00:00Z',
        },
        '1',
      );
    });
    await waitFor(() => {
      const cells = screen.getAllByRole('listitem');
      expect(cells[0].getAttribute('aria-current')).toBe('step');
    });
  });

  it('shows Live pill when overall status is live', async () => {
    render(<DeployTimelineHero deployId="dep-3" />);
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1));
    const es = MockEventSource.instances.find((i) => i.url.includes('/deploys/')) ?? MockEventSource.instances[0];
    const events = [
      'build',
      'sign',
      'release',
      'deploy',
      'live',
    ].map((phase, idx) => ({
      type: `deploy_timeline.${phase}.completed`,
      data: {
        deploy_id: 'dep-3',
        phase,
        status: 'completed',
        timestamp: `2026-06-18T12:0${idx}:00Z`,
      },
      id: String(idx + 1),
    }));
    act(() => {
      events.forEach((e) => es.emit(e.type, e.data, e.id));
    });
    await waitFor(() => {
      const hero = screen.getByTestId('deploy-timeline-hero');
      expect(hero.getAttribute('data-overall')).toBe('live');
    });
  });

  it('renders an alert role when aggregator degrades', async () => {
    render(<DeployTimelineHero deployId="dep-4" />);
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1));
    const es = MockEventSource.instances.find((i) => i.url.includes('/deploys/')) ?? MockEventSource.instances[0];
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
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('timeline temporarily unavailable');
    });
  });

  it('has an accessible live region for screen-reader narration', () => {
    render(<DeployTimelineHero deployId="dep-5" />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toMatch(/Deploy/);
  });

  it('hides itself politely when deployId is empty (still renders skeleton)', () => {
    render(<DeployTimelineHero deployId="" />);
    // Always renders 5 cells — empty deployId yields pending skeletons.
    const list = screen.getByTestId('deploy-timeline-phases');
    const listCells = within(list).getAllByRole('listitem');
    expect(listCells).toHaveLength(5);
    expect(listCells.every((c) => c.getAttribute('data-status') === 'pending')).toBe(
      true,
    );
  });

  it('emphasizes a running step with aria-current + halo + live tick', async () => {
    render(<DeployTimelineHero deployId="dep-running-step" />);
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2));
    const timelineStream = MockEventSource.instances.find((i) => i.url.includes('/deploys/'))!;
    const stepStream = MockEventSource.instances.find((i) => i.url.includes('/builds/'))!;
    // Make the build phase active so its cell defaults to expanded.
    act(() => {
      timelineStream.emit(
        'deploy_timeline.build.in_progress',
        {
          deploy_id: 'dep-running-step',
          phase: 'build',
          status: 'in_progress',
          timestamp: '2026-06-18T12:00:00Z',
        },
        '1',
      );
      stepStream.emit(
        'build.step.started',
        {
          step_name: 'build-image',
          started_at: '2026-06-18T12:00:00Z',
          phase_group: 'build',
        },
        '1',
      );
    });
    await waitFor(() => {
      const list = screen.getByTestId('phase-steps-build');
      const runningRow = list.querySelector('[data-step-status="running"]');
      expect(runningRow).not.toBeNull();
      expect(runningRow!.getAttribute('aria-current')).toBe('step');
    });
    const list = screen.getByTestId('phase-steps-build');
    expect(within(list).getByText('in progress')).toBeTruthy();
  });

  it('shows phase step count badge + expandable disclosure when steps arrive', async () => {
    render(<DeployTimelineHero deployId="dep-steps" />);
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2));
    const stepStream = MockEventSource.instances.find((i) => i.url.includes('/builds/'))!;
    act(() => {
      stepStream.emit(
        'build.step.succeeded',
        {
          step_name: 'clone-repo',
          started_at: '2026-06-18T12:00:00Z',
          ended_at: '2026-06-18T12:00:09Z',
          duration_seconds: 9,
          phase_group: 'clone',
        },
        '1',
      );
      stepStream.emit(
        'build.step.succeeded',
        {
          step_name: 'install-deps',
          started_at: '2026-06-18T12:00:10Z',
          ended_at: '2026-06-18T12:00:57Z',
          duration_seconds: 47,
          phase_group: 'install',
        },
        '2',
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('phase-step-count-build').textContent).toBe('2');
    });

    const toggle = screen.getByTestId('phase-toggle-build');
    // Default-expanded for build phase since it's pending-not-completed
    // → user can click to collapse.
    const initiallyExpanded = toggle.getAttribute('aria-expanded') === 'true';
    if (!initiallyExpanded) {
      await userEvent.click(toggle);
    }
    await waitFor(() => {
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
    const stepsList = screen.getByTestId('phase-steps-build');
    expect(within(stepsList).getByText(/Clone repo/i)).toBeTruthy();
    expect(within(stepsList).getByText(/Install deps/i)).toBeTruthy();
  });
});
