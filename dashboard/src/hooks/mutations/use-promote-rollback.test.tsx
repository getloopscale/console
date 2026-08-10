import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// B-113 — o hook passou de `cloudFetch('/engine/api/v1/…')` para `engineFetch('/api/v1/…')`.
// A URL final e a requisição são as MESMAS (`engineFetch(p)` é `cloudFetch('/engine' + p)`); o que
// muda é haver UM vocabulário para endereçar a engine, em vez de dois. O mock segue a fonte, e as
// asserções de path abaixo passam a afirmar o caminho sem o prefixo repetido à mão.
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/http/api')>('@/lib/http/api');
  return { ...actual, engineFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

import { usePromote } from './use-promote';
import { useRollback } from './use-rollback';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * B-013 — promover e reverter passam a ter dono, e o dono é testável sem modal.
 *
 * Enquanto a chamada morava dentro do diálogo, o único jeito de exercitá-la era
 * montar o modal, digitar a frase de confirmação e clicar. Isso não é um teste
 * da promoção — é um teste do formulário que dispara a promoção, e ele passa
 * verde mesmo quando a invalidação de cache não acontece.
 *
 * Estes quatro casos são o que o diálogo nunca conseguiu cobrir.
 */

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('usePromote / useRollback (B-013)', () => {
  beforeEach(() => {
    mockCloudFetch.mockReset();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });

  it('promote manda from/to e opta por throwOnError', async () => {
    mockCloudFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => usePromote(), { wrapper });
    await result.current.mutateAsync({ projectName: 'app x', fromEnvironment: 'preview-7' });

    const [path, init, cfg] = mockCloudFetch.mock.calls[0];
    // O nome do projeto vai codificado: um projeto com espaço ou barra montaria
    // uma URL diferente da pretendida, e o alvo de uma promoção é o último
    // lugar onde isso pode acontecer em silêncio.
    expect(path).toBe('/api/v1/projects/app%20x/promote');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      from: 'preview-7',
      to: 'production',
    });
    // `throwOnError` é o que faz uma recusa do backend REJEITAR em vez de
    // resolver null. Sem ele o chamador precisa lembrar de checar, e um `if`
    // esquecido vira uma promoção que falha calada.
    expect(cfg).toEqual({ throwOnError: true });
  });

  it('promote gera uma Idempotency-Key NOVA a cada chamada', async () => {
    mockCloudFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => usePromote(), { wrapper });
    await result.current.mutateAsync({ projectName: 'p', fromEnvironment: 'preview' });
    await result.current.mutateAsync({ projectName: 'p', fromEnvironment: 'preview' });

    const chaves = mockCloudFetch.mock.calls.map(
      (c) => ((c[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(chaves[0]).toBeTruthy();
    // Reusar a chave entre chamadas faria o backend tratar uma SEGUNDA promoção
    // deliberada como repetição da primeira e descartá-la — o oposto do que a
    // idempotência existe para proteger.
    expect(chaves[0]).not.toBe(chaves[1]);
  });

  it('promote invalida builds E environments — o release ativo mudou nos dois', async () => {
    mockCloudFetch.mockResolvedValue({ ok: true });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => usePromote(), { wrapper });
    await result.current.mutateAsync({ projectName: 'p', fromEnvironment: 'preview' });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    // Esta é a asserção que o diálogo não conseguia fazer, e era exatamente o
    // que ficava para trás quando alguém abria a promoção de um lugar novo: a
    // badge "● Active" continuava no build antigo até um refresh manual.
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.builds.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.environments.all });
  });

  it('uma recusa do backend REJEITA a mutation em vez de resolver', async () => {
    mockCloudFetch.mockRejectedValue(new Error('402 plan limit'));
    const { result } = renderHook(() => usePromote(), { wrapper });
    await expect(
      result.current.mutateAsync({ projectName: 'p', fromEnvironment: 'preview' }),
    ).rejects.toThrow('402 plan limit');
  });

  it('rollback nomeia ambiente E build — o promote assume producao, este nao', async () => {
    mockCloudFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useRollback(), { wrapper });
    await result.current.mutateAsync({ projectName: 'p', environment: 'production', buildId: 'b-9' });

    const [path, init] = mockCloudFetch.mock.calls[0];
    expect(path).toBe('/api/v1/projects/p/rollback');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      environment: 'production',
      build_id: 'b-9',
    });
  });

  it('rollback tambem invalida os dois caches', async () => {
    mockCloudFetch.mockResolvedValue({ ok: true });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRollback(), { wrapper });
    await result.current.mutateAsync({ projectName: 'p', environment: 'production', buildId: 'b-9' });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.builds.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.environments.all });
  });
});
