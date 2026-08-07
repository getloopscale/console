import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth helpers before importing the hook so the EventSource
// constructor is wrapped with our stub.
vi.mock('@/lib/api', () => ({
  ensureSSEToken: vi.fn(async () => 'tok-1'),
  clearToken: vi.fn(),
  hasValidToken: vi.fn(() => true),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({
  API_URL: '',
}));

import { useSSEStream } from './use-sse-stream';
import { clearToken } from '@/lib/api';

interface MockListenerMap {
  [event: string]: Array<(ev: unknown) => void>;
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  // Espelha a API real: a spec define CONNECTING=0, OPEN=1, CLOSED=2.
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  url: string;
  listeners: MockListenerMap = {};
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Defer onopen so consumers can attach handlers first.
    queueMicrotask(() => {
      if (!this.closed) {
        this.readyState = 1;
        this.onopen?.({});
      }
    });
  }

  addEventListener(type: string, listener: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (ev: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  emit(type: string, data: string, lastEventId = '') {
    const ev = { data, lastEventId };
    if (type === 'message') {
      this.onmessage?.(ev);
    }
    (this.listeners[type] ?? []).forEach((l) => l(ev));
  }

  triggerError() {
    this.onerror?.({});
  }

  /**
   * B-014 — erro que FECHA a conexao, como o browser faz num HTTP nao-2xx
   * (401 de token expirado). readyState vai para CLOSED e nao ha reconexao
   * nativa: `onerror` roda UMA vez.
   *
   * O mock nao tinha esse caso — todo erro deixava readyState em CONNECTING —
   * e e exatamente por isso que o defeito passou pela suite: o teste do limiar
   * de 3 simulava um cenario que, no 401, nunca acontece.
   */
  triggerFatalError() {
    this.readyState = 2;
    this.onerror?.({});
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error — overriding global EventSource for tests.
  globalThis.EventSource = MockEventSource;
  vi.clearAllMocks();
});

afterEach(() => {
  // @ts-expect-error — restore
  delete globalThis.EventSource;
});

describe('useSSEStream', () => {
  it('test_emits_typed_events_for_known_event_types', async () => {
    const { result } = renderHook(() =>
      useSSEStream('/api/v1/test', { eventTypes: ['build.step.started'] }),
    );

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    act(() => {
      MockEventSource.instances[0].emit(
        'build.step.started',
        JSON.stringify({ step_name: 'clone-repo' }),
        '5',
      );
    });

    await waitFor(() => expect(result.current.events.length).toBe(1));
    expect(result.current.events[0].type).toBe('build.step.started');
    expect((result.current.events[0].data as { step_name: string }).step_name).toBe(
      'clone-repo',
    );
    expect(result.current.lastEventID).toBe('5');
  });

  it('test_path_null_does_not_connect', () => {
    renderHook(() => useSSEStream(null));
    expect(MockEventSource.instances.length).toBe(0);
  });

  it('test_unmount_closes_eventsource', async () => {
    const { unmount } = renderHook(() => useSSEStream('/api/v1/test'));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    unmount();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('test_maxEvents_caps_buffer_fifo', async () => {
    const { result } = renderHook(() =>
      useSSEStream('/api/v1/test', { eventTypes: ['x'], maxEvents: 3 }),
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => {
      for (let i = 1; i <= 5; i++) {
        es.emit('x', JSON.stringify({ i }), String(i));
      }
    });

    await waitFor(() => expect(result.current.events.length).toBe(3));
    // FIFO drop: keep most recent 3 (3,4,5).
    const ids = result.current.events.map((e) => (e.data as { i: number }).i);
    expect(ids).toEqual([3, 4, 5]);
  });

  it('test_paused_freezes_state_updates_but_keeps_connection', async () => {
    const { result, rerender } = renderHook(
      ({ paused }: { paused: boolean }) =>
        useSSEStream('/api/v1/test', { eventTypes: ['x'], paused }),
      { initialProps: { paused: false } },
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    rerender({ paused: true });
    act(() => {
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 1 }), '1');
    });
    // Paused: buffer accepts the event but state does not flush yet.
    expect(result.current.events.length).toBe(0);
  });

  it('test_initial_lastEventID_seeds_url', async () => {
    renderHook(() =>
      useSSEStream('/api/v1/test', { initialLastEventID: '42' }),
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    expect(MockEventSource.instances[0].url).toContain('last_event_id=42');
  });

  it('test_token_refresh_on_three_consecutive_errors_EC3', async () => {
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => {
      es.triggerError();
      es.triggerError();
      es.triggerError();
    });

    await waitFor(() => expect(clearToken).toHaveBeenCalledTimes(1));
    // B-014 — a reabertura agora passa por backoff exponencial com jitter, entao
    // a nova conexao nao e sincrona com o terceiro erro.
    await waitFor(
      () => expect(MockEventSource.instances.length).toBe(2),
      { timeout: 4000 },
    );
  });

  it('test_um_unico_erro_FATAL_dispara_recuperacao_de_token_B014', async () => {
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    // Um 401: o browser fecha a conexao e nao retenta. Antes de B-014, o
    // failureCount parava em 1, o limiar de 3 nunca era atingido, e o stream
    // ficava morto em silencio ate a proxima navegacao.
    act(() => {
      es.triggerFatalError();
    });

    await waitFor(() => expect(clearToken).toHaveBeenCalledTimes(1));
    await waitFor(
      () => expect(MockEventSource.instances.length).toBe(2),
      { timeout: 4000 },
    );
  });

  it('test_erro_NAO_fatal_isolado_nao_reabre_deixa_o_browser_retentar_B014', async () => {
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    // readyState segue CONNECTING: o browser ja esta retentando sozinho, e
    // reabrir na primeira falha so brigaria com ele. O limiar de 3 existe para
    // este caminho — e este teste e o que impede B-014 de virar "reabre sempre".
    act(() => {
      es.triggerError();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(clearToken).not.toHaveBeenCalled();
    expect(MockEventSource.instances.length).toBe(1);
  });

  it('test_lastEventID_propagates_to_reconnect_url_EC9', async () => {
    const { result } = renderHook(() =>
      useSSEStream('/api/v1/test', { eventTypes: ['x'] }),
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => {
      es.emit('x', JSON.stringify({ a: 1 }), '7');
    });
    await waitFor(() => expect(result.current.lastEventID).toBe('7'));

    // Trigger 3 errors -> reconnect.
    act(() => {
      es.triggerError();
      es.triggerError();
      es.triggerError();
    });

    await waitFor(() => expect(MockEventSource.instances.length).toBe(2));
    expect(MockEventSource.instances[1].url).toContain('last_event_id=7');
  });

  it('test_clear_resets_buffer', async () => {
    const { result } = renderHook(() =>
      useSSEStream('/api/v1/test', { eventTypes: ['x'] }),
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    act(() => {
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 1 }), '1');
    });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    act(() => result.current.clear());
    await waitFor(() => expect(result.current.events.length).toBe(0));
  });
});
