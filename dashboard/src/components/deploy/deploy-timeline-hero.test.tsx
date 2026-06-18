import { act, render, screen, waitFor, within } from '@testing-library/react';
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

import { DeployTimelineHero } from './deploy-timeline-hero';

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
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const es = MockEventSource.instances[0];
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
    const cells = screen.getAllByRole('listitem');
    expect(cells).toHaveLength(5);
    expect(cells.every((c) => c.getAttribute('data-status') === 'pending')).toBe(
      true,
    );
  });
});
