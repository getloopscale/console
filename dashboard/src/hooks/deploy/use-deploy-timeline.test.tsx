import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  signOutIfSessionEnded: vi.fn(async () => false),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({
  API_URL: '',
}));

import { useDeployTimeline } from './use-deploy-timeline';
import { __setTransporte } from '@/hooks/deploy/shared-event-source';

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
  // B-088 — o transporte deixou de ser o EventSource global (o JWT saiu da URL
// e foi para o header Authorization, o que `EventSource` nao permite). O fake
// abaixo continua valendo: `FetchEventSource` expoe a MESMA superficie. O que
// muda e onde ele e instalado — `__setTransporte` em vez de globalThis.
  __setTransporte((url, opcoes) => new MockEventSource(url, opcoes) as unknown as EventSource);
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

describe('B-174 — a defesa contra chegada fora de ordem passa a existir', () => {
  it('uma fase anterior a uma CONCLUÍDA não fica pendente para sempre', async () => {
    // O laço que dizia fazer isto tinha corpo VAZIO: `foundActive` era escrito e lido só dentro de
    // um `if` sem instruções. Na reconexão, `deploy.completed` pode chegar antes de
    // `build.completed` — e a fase de build ficava `pending` para sempre, com o comentário logo
    // acima afirmando que esse caso estava tratado.
    const { result } = renderHook(() => useDeployTimeline('dep-1'));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    act(() => {
      MockEventSource.instances[0].emit(
        'deploy_timeline.deploy.completed',
        JSON.stringify({ phase: 'deploy', status: 'completed' }),
        '1',
      );
    });

    await waitFor(() => {
      const build = result.current.phases.find((p) => p.phase === 'build');
      expect(build?.status).not.toBe('pending');
    });
  });
});

describe('B-181 — o buffer diz o que MUDOU, nunca o que É', () => {
  it('a fase de build continua concluída depois de o evento que a concluiu ser DESPEJADO do buffer', async () => {
    // O buffer de `useSSEStream` tem teto de 60 (`maxEvents`). O estado das fases era re-derivado
    // varrendo esse buffer do zero a cada render — então, num deploy com muitos eventos, o
    // `build.completed` saía pela frente da fila e a tela devolvia a fase a `pending`, andando
    // para trás sozinha diante de quem estava olhando.
    //
    // Este teste exercita o DESPEJO de verdade, e não o redutor isolado (esse é
    // `deploy-timeline-reducer.test.ts`): emite o evento que conclui a fase e depois 70 eventos,
    // ultrapassando o teto com folga.
    const { result } = renderHook(() => useDeployTimeline('dep-181'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const es = MockEventSource.instances[0];

    act(() => {
      es.emit('deploy_timeline.build.completed', {
        deploy_id: 'dep-181',
        phase: 'build',
        status: 'completed',
        timestamp: '2026-08-11T10:00:00Z',
      });
    });
    await waitFor(() => {
      expect(result.current.phases.find((p) => p.phase === 'build')?.status).toBe('completed');
    });

    act(() => {
      for (let i = 0; i < 70; i += 1) {
        es.emit('deploy_timeline.sign.in_progress', {
          deploy_id: 'dep-181',
          phase: 'sign',
          status: 'in_progress',
          timestamp: `2026-08-11T10:0${String(i % 10)}:00Z`,
        });
      }
    });

    const build = result.current.phases.find((p) => p.phase === 'build');
    expect(build?.status).toBe('completed');
    expect(build?.endedAt).toBe('2026-08-11T10:00:00Z');
  });
});
