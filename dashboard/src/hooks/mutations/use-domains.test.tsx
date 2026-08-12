import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { queryKeys } from '@/lib/api/query-keys';
import { useAddDomain, useDeleteDomain, useVerifyDomain } from './use-domains';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(async () => ({ domain: 'app.exemplo.com', status: 'pending' })),
}));

/**
 * B-017 / B-058 — o caminho de escrita de dominios invalida a lista.
 *
 * O defeito medido: o AddDomainSheet fazia o POST com `engineFetch` cru e so
 * chamava `onAdded`. O consumidor real (domains.tsx) nao passa `onAdded`, entao
 * adicionar um dominio nao atualizava NADA na tela. Em paralelo, o hook
 * `useAddDomain` — que ja invalidava corretamente — estava orfao, com uma
 * assinatura (`project_id`) que nao correspondia ao formulario.
 *
 * Havia um segundo defeito, mais silencioso: a lista era lida com a chave
 * `['engine', '/api/v1/domains']` enquanto as mutations invalidavam
 * `['domains']`. Dois namespaces disjuntos — delete e verify, que JA estavam em
 * uso, tambem nunca atualizavam a tabela.
 *
 * Estes testes verificam a propriedade que interessa ao usuario: depois de
 * escrever, a QUERY DA LISTA fica invalidada. Quem decide e o predicado do
 * TanStack Query, nao uma comparacao de chaves que eu poderia escrever para dar
 * verde.
 */
function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

/** Semeia a lista exatamente com a chave que domains.tsx usa para ler. */
function seedList(qc: QueryClient) {
  const key = queryKeys.domains.list();
  qc.setQueryData(key, { domains: [] });
  expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
  return key;
}

describe('caminho de escrita de dominios invalida a lista (B-017)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('useAddDomain invalida a lista apos o create', async () => {
    const qc = makeClient();
    const key = seedList(qc);

    const { result } = renderHook(() => useAddDomain(), { wrapper: wrapper(qc) });
    await result.current.mutateAsync({
      domain: 'app.exemplo.com',
      project: 'meu-projeto',
      app: 'web',
      environment: 'production',
    });

    await waitFor(() => {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  it('useDeleteDomain invalida a lista', async () => {
    const qc = makeClient();
    const key = seedList(qc);

    const { result } = renderHook(() => useDeleteDomain(), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('app.exemplo.com');

    await waitFor(() => {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  it('useVerifyDomain invalida a lista', async () => {
    const qc = makeClient();
    const key = seedList(qc);

    const { result } = renderHook(() => useVerifyDomain(), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('app.exemplo.com');

    await waitFor(() => {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  it('a chave LEGADA da lista nao era alcancada — a regressao que isto guarda', async () => {
    const qc = makeClient();
    const legado = ['engine', '/api/v1/domains'] as const;
    qc.setQueryData(legado, { domains: [] });

    const { result } = renderHook(() => useDeleteDomain(), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('app.exemplo.com');

    // Era exatamente assim que domains.tsx lia a lista antes de B-017: por isso
    // delete e verify "funcionavam" sem nunca atualizar a tabela.
    expect(qc.getQueryState(legado)?.isInvalidated).toBe(false);
  });
});
