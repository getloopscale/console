import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/lib/http/api', () => ({
  ensureSSEToken: vi.fn(async () => 'jwt-de-teste'),
  clearToken: vi.fn(),
  engineFetch: vi.fn(async () => null),
  cloudFetch: vi.fn(async () => null),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '', AUTH_URL: '', ACCOUNTS_URL: '' }));

import { useDeploymentStream } from '@/hooks/deploy/use-deployment-stream';
import { __setTransporte } from '@/hooks/deploy/shared-event-source';

/**
 * B-020 — orcamento de conexoes SSE por URL.
 *
 * ## O defeito que isto mede
 *
 * A aba Timeline de um deploy abre TRES EventSource, e DUAS apontam para a mesma
 * URL. `DeployTimelineHero` (montado pelo layout) chama
 * `useDeployTimelineWithSteps`, que por dentro abre `useDeployTimeline` +
 * `useDeploymentStream(deployId)`; ao mesmo tempo o `<Outlet/>` renderiza
 * `TimelineTab`, que renderiza `BuildTimelineLive`, que chama
 * `useDeploymentStream(build.build_id)`. Quando os dois ids coincidem — o caso
 * normal — sao duas conexoes identicas para o mesmo endpoint.
 *
 * O browser concede ~6 conexoes por dominio. Gastar duas com o mesmo stream nao
 * e desperdicio teorico: e uma a menos para o resto da pagina, e o dobro de
 * trabalho no servidor por espectador.
 *
 * ## Por que este teste existe antes da correcao
 *
 * As duas saidas possiveis mexem em composicao — passar os steps por prop a
 * partir do layout, ou dedupar por URL dentro de `useSSEStream` com refcount. As
 * duas sao arriscadas sem uma medida objetiva de "quantas conexoes existem", e e
 * exatamente isso que falta hoje: nenhum teste conta conexoes.
 *
 * Este arquivo mede. O primeiro caso PASSA e fixa o comportamento atual como
 * baseline; o segundo esta `skip` com a asserção que a correcao deve tornar
 * verdadeira. Quem implementar B-020 remove o `.skip` — se a contagem cair para
 * um, a correcao funcionou; se nao cair, ela nao funcionou, independentemente de
 * a tela parecer certa.
 */
class ContadorEventSource {
  static abertas: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 0;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  /** B-088 — token e cursor viajam em header; o fake guarda para poder assertar. */
  opcoes: { token: string | null; lastEventId?: string | null } | undefined;
  constructor(url: string, opcoes?: { token: string | null; lastEventId?: string | null }) {
    this.opcoes = opcoes;
    // A URL carrega `?token=`; o orcamento e por ENDPOINT, entao normalizamos.
    ContadorEventSource.abertas.push(url.split('?')[0] ?? url);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

/** Quantas conexoes distintas x quantas no total — a diferenca e o desperdicio. */
function contagem() {
  const total = ContadorEventSource.abertas.length;
  const distintas = new Set(ContadorEventSource.abertas).size;
  return { total, distintas, duplicadas: total - distintas };
}

describe('orcamento de conexoes SSE (B-020)', () => {
  beforeEach(() => {
    ContadorEventSource.abertas = [];
    __setTransporte((url, opcoes) => new ContadorEventSource(url, opcoes) as unknown as EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('TRES consumidores do mesmo build seguem numa conexao — nao e um caso especial de dois', async () => {
    // Este caso era o BASELINE: assertava `total: 2, duplicadas: 1`, fixando o
    // defeito para que a correcao tivesse contra o que medir. Ele cumpriu o
    // papel e a asserção antiga ficou falsa por bom motivo.
    //
    // No lugar dela, a versao que continua valendo alguma coisa: TRES. Uma
    // deduplicacao escrita para o caso de dois — um `if` guardando a segunda
    // conexao — passaria no teste de dois e falharia aqui. O que se quer e
    // refcount, e o unico jeito de distinguir os dois e contar mais que dois.
    renderHook(() => useDeploymentStream('build-1'), { wrapper });
    renderHook(() => useDeploymentStream('build-1'), { wrapper });
    renderHook(() => useDeploymentStream('build-1'), { wrapper });

    await waitFor(() => expect(ContadorEventSource.abertas.length).toBeGreaterThanOrEqual(1));

    const { total, distintas, duplicadas } = contagem();
    expect(distintas).toBe(1);
    expect(total).toBe(1);
    expect(duplicadas).toBe(0);
  });

  it('B-020 RESOLVIDO: consumidores do mesmo build compartilham UMA conexao', async () => {
    // Este teste nasceu `skip`, escrito antes da correcao, com a asserção que
    // ela teria de tornar verdadeira. A correcao chegou em `shared-event-source
    // .ts`: a multiplexacao mora no TRANSPORTE, entao o `useSSEStream` — com a
    // recuperacao de token, o backoff e o conserto do B-014 — nao foi tocado.
    renderHook(() => useDeploymentStream('build-1'), { wrapper });
    renderHook(() => useDeploymentStream('build-1'), { wrapper });

    await waitFor(() => expect(ContadorEventSource.abertas.length).toBeGreaterThanOrEqual(1));

    const { total, duplicadas } = contagem();
    expect(total).toBe(1);
    expect(duplicadas).toBe(0);
  });

  it('builds DIFERENTES continuam com conexoes proprias — o dedup nao pode colapsar demais', async () => {
    renderHook(() => useDeploymentStream('build-1'), { wrapper });
    renderHook(() => useDeploymentStream('build-2'), { wrapper });

    await waitFor(() => expect(ContadorEventSource.abertas.length).toBeGreaterThanOrEqual(2));

    // Guarda o lado oposto: uma deduplicacao que ignorasse o id do build
    // entregaria os eventos do build errado, que e pior que a conexao extra.
    expect(contagem().distintas).toBe(2);
  });
});
