import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth helpers before importing the hook so the EventSource
// constructor is wrapped with our stub.
vi.mock('@/lib/http/api', () => ({
  signOutIfSessionEnded: vi.fn(async () => false),
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({
  API_URL: '',
}));

import { useSSEStream } from '@/hooks/deploy/use-sse-stream';
import { signOutIfSessionEnded } from '@/lib/http/api';
import { __setTransporte } from '@/hooks/deploy/shared-event-source';
import type { StreamEndReason } from '@/hooks/deploy/stream-end-reason';

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

  /** B-088 — o fake recebe as OPCOES agora: o token e o cursor de retomada
   * saíram da URL e viajam em header. Guardá-las é o que permite assertar sobre
   * eles sem reintroduzir a asserção sobre a query, que é o defeito. */
  opcoes: { lastEventId?: string | null } | undefined;
  constructor(url: string, opcoes?: { lastEventId?: string | null }) {
    this.opcoes = opcoes;
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

  /**
   * B-160 — o mock passa a informar a CAUSA, como o transporte real faz. Sem isso ele
   * modelava um `EventSource` que ja nao existe, e um teste que exercita um transporte
   * imaginario nao protege o de verdade.
   */
  triggerError(reason: StreamEndReason = { kind: 'network-error' }) {
    this.onerror?.({ reason });
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
  /**
   * B-172 — este helper NAO carregava status, e o teste que o usa dizia "Um 401" no comentario.
   * Ele passava identico para um 404 ou um 503, entao a asserção de que o token e limpo nao
   * provava nada sobre POR QUE ele seria limpo. O status agora e obrigatorio.
   */
  triggerFatalError(status: number) {
    this.readyState = 2;
    this.onerror?.({ reason: { kind: 'http-error', status } });
  }

  /** Fim limpo do corpo pelo servidor — nao e falha e nao deve tocar no token. */
  triggerServerClose() {
    this.readyState = 2;
    this.onerror?.({ reason: 'server-closed' });
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // B-088 — o transporte deixou de ser o EventSource global (o JWT saiu da URL
// e foi para o header Authorization, o que `EventSource` nao permite). O fake
// abaixo continua valendo: `FetchEventSource` expoe a MESMA superficie. O que
// muda e onde ele e instalado — `__setTransporte` em vez de globalThis.
  __setTransporte((url, opcoes) => new MockEventSource(url, opcoes) as unknown as EventSource);
  vi.clearAllMocks();
});

afterEach(() => {
    __setTransporte(null);
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

  it('test_despausar_mostra_o_que_chegou_durante_a_pausa_B179', async () => {
    // `paused` congela as atualizações SEM desconectar — é o propósito declarado dele. Antes deste
    // caso, o buffer só era sincronizado quando o PRÓXIMO evento chegava: quem despausava um
    // stream silencioso ficava olhando dados velhos por tempo indeterminado, o que é uma pausa que
    // não se consegue desfazer — pior do que não ter pausa.
    const { result, rerender } = renderHook(
      ({ paused }: { paused: boolean }) =>
        useSSEStream('/api/v1/test', { eventTypes: ['x'], paused }),
      { initialProps: { paused: false } },
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    rerender({ paused: true });
    act(() => {
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 1 }), '1');
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 2 }), '2');
    });
    expect(result.current.events.length).toBe(0);

    rerender({ paused: false });

    await waitFor(() => { expect(result.current.events.length).toBe(2); });
    expect(result.current.lastEventID).toBe('2');
  });

  it('test_initial_lastEventID_vai_por_HEADER_e_nao_pela_url', async () => {
    renderHook(() =>
      useSSEStream('/api/v1/test', { initialLastEventID: '42' }),
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    // B-088 — este caso assertava `url).toContain('last_event_id=42')`. O cursor
    // estava na query pelo mesmo motivo que o token: `EventSource` nao aceita
    // header. Com o transporte sobre `fetch` os dois voltaram para o header, e a
    // asserção antiga ficou falsa por bom motivo.
    expect(MockEventSource.instances[0].url).not.toContain('last_event_id');
    expect(MockEventSource.instances[0].opcoes?.lastEventId).toBe('42');
  });

  it('test_falhas_de_rede_repetidas_NAO_limpam_o_token_B173', async () => {
    // Este caso era `test_token_refresh_on_three_consecutive_errors_EC3` e afirmava o contrario:
    // tres erros seguidos de QUALQUER natureza limpavam o token. O limiar que ele testava era
    // INALCANCAVEL em producao — `FetchEventSource` dispara `onerror` no maximo uma vez por
    // instancia, e o contador zerava antes de cada reabertura. O teste passava porque o mock
    // reusa a mesma instancia, que producao nunca faz.
    //
    // O limiar foi removido (B-173). Uma falha de rede nao diz nada sobre a credencial, quantas
    // vezes aconteca — o que ela pede e reabrir, que e o que este caso agora afirma.
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => { es.triggerError(); });

    await waitFor(
      () => expect(MockEventSource.instances.length).toBe(2),
      { timeout: 4000 },
    );
    expect(signOutIfSessionEnded).not.toHaveBeenCalled();
  });

  it('test_um_unico_erro_FATAL_dispara_recuperacao_de_token_B014', async () => {
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    // Um 401: a credencial e a causa provavel, entao trocar o token e o remedio certo.
    act(() => {
      es.triggerFatalError(401);
    });

    await waitFor(() => expect(signOutIfSessionEnded).toHaveBeenCalledTimes(1));
    await waitFor(
      () => expect(MockEventSource.instances.length).toBe(2),
      { timeout: 4000 },
    );
  });

  it('test_um_5xx_reabre_SEM_tocar_na_credencial_B172', async () => {
    // Este caso era `test_erro_NAO_fatal_isolado_nao_reabre_deixa_o_browser_retentar_B014` e
    // afirmava que um erro isolado NAO reabre, "deixando o browser retentar". Este transporte nao
    // tem retentativa de browser — ele e `fetch` desde B-088 —, entao o que o caso descrevia como
    // delegacao era, na verdade, um stream morto. Ele so passava porque esperava 50 ms e o
    // backoff e maior que isso: uma asserção verde sobre a ausencia de algo que ainda ia
    // acontecer.
    //
    // O que importa medir aqui e a outra metade do B-172: um 5xx reabre, e nao encosta no JWT da
    // aplicacao inteira.
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => { es.triggerFatalError(503); });

    await waitFor(
      () => expect(MockEventSource.instances.length).toBe(2),
      { timeout: 4000 },
    );
    expect(signOutIfSessionEnded).not.toHaveBeenCalled();
  });

  it('test_lastEventID_propaga_na_RECONEXAO_por_header_EC9', async () => {
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
    // A invariante do EC-9 nao mudou — a reconexao RETOMA de onde parou, senao
    // o servidor reenvia o stream inteiro e o reducer refaz todo o trabalho. O
    // que mudou (B-088) e por onde o cursor viaja: header, nao query.
    expect(MockEventSource.instances[1].url).not.toContain('last_event_id');
    expect(MockEventSource.instances[1].opcoes?.lastEventId).toBe('7');
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

/**
 * B-160 — a regressão que prova que o laço acabou.
 *
 * Um deploy que termina fecha o stream normalmente. Antes, isso batia no ramo de
 * "token expirado", limpava o JWT da aplicação inteira e reabria — e como `onopen`
 * zerava o backoff a cada volta, o ciclo rodava a ~1 Hz para sempre, contra o mesmo
 * endpoint de troca cuja quota `api.ts:180` registra como já estourada uma vez.
 */
describe('B-160 — fim limpo de stream não é falha de credencial', () => {
  it('test_a_clean_server_close_does_NOT_clear_the_application_token', async () => {
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => {
      es.triggerServerClose();
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(signOutIfSessionEnded).not.toHaveBeenCalled();
  });

  it('test_repeated_clean_closes_never_clear_the_token', async () => {
    renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    for (let i = 0; i < 5; i += 1) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => {
        es.triggerServerClose();
      });
      await new Promise((r) => setTimeout(r, 30));
    }

    // Cinco encerramentos limpos e o token da aba segue intacto. Antes eram cinco
    // trocas de token.
    expect(signOutIfSessionEnded).not.toHaveBeenCalled();
  });
});

describe('B-221/B-224 — identidade estável e carimbo que não se move', () => {
  it('o handle devolvido é referencialmente estável entre renders', async () => {
    // Um hook que devolve um objeto novo a cada render obriga todo consumidor a ou desestruturar
    // com cuidado ou re-executar. É o contrato dele empurrando trabalho para quem o chama.
    const { result, rerender } = renderHook(() =>
      useSSEStream('/api/v1/test', { eventTypes: ['x'] }),
    );
    // Wait for the SETTLED state, not just the instance: the stream opens synchronously since
    // usetheoai/theo#477 (no token to await first), so `onopen` can still flip `connected` after
    // the instance exists — and a value that changes must change the handle.
    await waitFor(() => expect(result.current.connected).toBe(true));

    const antes = result.current;
    rerender();
    expect(result.current).toBe(antes);
    expect(result.current.clear).toBe(antes.clear);
  });

  it('MAS muda quando um valor muda — estável não é parado', async () => {
    // Sem este caso, `useMemo(() => ({...}), [])` passaria no anterior e devolveria dados velhos
    // para sempre, que é um defeito pior do que o que se estava consertando.
    const { result } = renderHook(() => useSSEStream('/api/v1/test', { eventTypes: ['x'] }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const antes = result.current;

    act(() => {
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 1 }), '1');
    });

    expect(result.current).not.toBe(antes);
    expect(result.current.events.length).toBe(1);
  });

  it('carimba a chegada de cada evento UMA vez, na ingestão', async () => {
    const { result, rerender } = renderHook(() =>
      useSSEStream('/api/v1/test', { eventTypes: ['x'] }),
    );
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    act(() => {
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 1 }), '1');
    });
    const primeiro = result.current.events[0].receivedAt;
    expect(primeiro).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    act(() => {
      MockEventSource.instances[0].emit('x', JSON.stringify({ a: 2 }), '2');
    });
    rerender();

    // O carimbo do PRIMEIRO evento não pode ter andado porque um segundo chegou.
    expect(result.current.events[0].receivedAt).toBe(primeiro);
  });
});
