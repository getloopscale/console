import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const mockFetchTrust = vi.fn();
const mockFetchValidators = vi.fn();
const mockFetchEnforcement = vi.fn();
vi.mock('@/hooks/trust/trust-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/hooks/trust/trust-api',
  );
  return {
    ...actual,
    fetchTrust: (...a: unknown[]) => mockFetchTrust(...a),
    fetchValidators: (...a: unknown[]) => mockFetchValidators(...a),
    fetchEnforcementEvents: (...a: unknown[]) => mockFetchEnforcement(...a),
  };
});

import {
  useTrustViolations,
  useTrustValidators,
  useTrustEnforcement,
  useInvalidateTrust,
} from './use-trust';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * B-052 — o domínio trust ganha camada de acesso a dados.
 *
 * ## O defeito medido
 *
 * `trust-api.ts` exporta 8 funções de transporte e **zero** query keys, então
 * cada uma das 5 páginas consumidoras escolhia a sua. `overview.tsx:56` lia
 * `['cloud', '/v1/dashboard/trust/policy-violations']`; `guardrails.tsx:54` um
 * `QUERY_KEY` local. Árvores de cache disjuntas — criar um guardrail nunca
 * atualizava a contagem do overview.
 *
 * É o mesmo defeito que `domains` teve (B-018) e que `team` teve (B-060), pela
 * terceira vez. A factory existe desde então justamente para isto.
 *
 * ## O que estes testes protegem
 *
 * Que a chave vem da factory, e que uma falha de leitura chega ao consumidor
 * como erro e não como lista vazia — a classe do `#274`, em que uma leitura
 * falha vira "você não tem nada" na tela.
 */

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('use-trust (B-052)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('as violações usam a chave da factory, não uma tupla literal', async () => {
    mockFetchTrust.mockResolvedValue({ violations: [] });
    const { result } = renderHook(() => useTrustViolations(200), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A chave literal `['cloud', '/v1/dashboard/...']` que overview.tsx usava é
    // invisível para `invalidateQueries({ queryKey: queryKeys.trust.all })` —
    // era por isso que criar um guardrail não atualizava o overview.
    const chaves = qc.getQueryCache().getAll().map((q) => q.queryKey);
    expect(chaves).toContainEqual(queryKeys.trust.violations({ limit: 200 }));
  });

  it('invalidar `trust.all` alcança violações E validadores', async () => {
    mockFetchTrust.mockResolvedValue({ violations: [] });
    mockFetchValidators.mockResolvedValue({ validators: [] });
    renderHook(() => useTrustViolations(200), { wrapper });
    renderHook(() => useTrustValidators(), { wrapper });
    await waitFor(() => expect(qc.getQueryCache().getAll().length).toBe(2));

    // Esta é a propriedade que a hierarquia compra, e a razão de `all` existir:
    // uma invalidação alcança o domínio inteiro. Com chaves literais, cada
    // página precisava saber a chave de todas as outras.
    const alcancadas = qc
      .getQueryCache()
      .findAll({ queryKey: queryKeys.trust.all });
    expect(alcancadas.length).toBe(2);
  });

  it('uma falha de leitura expõe erro — NÃO uma lista vazia', async () => {
    mockFetchTrust.mockRejectedValue(new Error('503 upstream'));
    const { result } = renderHook(() => useTrustViolations(200), { wrapper });

    await waitFor(() => expect(result.current.error).toBe(true));
    // Classe do #274: uma leitura que falha e resolve `null` renderiza o estado
    // vazio, e a tela diz "você não tem violações" quando na verdade não
    // conseguiu perguntar. São fatos diferentes e a tela precisa distingui-los.
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(true);
  });

  it('o enforcement mantém o limite na chave — janelas diferentes não colidem', async () => {
    mockFetchEnforcement.mockResolvedValue({ events: [] });
    renderHook(() => useTrustEnforcement(50), { wrapper });
    await waitFor(() => expect(mockFetchEnforcement).toHaveBeenCalledWith(50));

    // Sem o limite na chave, pedir 50 e depois 200 serviria o cache dos 50 para
    // os dois — a tela mostraria menos linhas do que pediu, em silêncio.
    const chaves = qc.getQueryCache().getAll().map((q) => q.queryKey);
    expect(chaves).toContainEqual(queryKeys.trust.enforcement(50));
    expect(chaves).not.toContainEqual(queryKeys.trust.enforcement(200));
  });

  it('a invalidação do domínio alcança o que a chave literal não alcançava', async () => {
    mockFetchValidators.mockResolvedValue({ validators: [] });
    mockFetchTrust.mockResolvedValue({ violations: [] });
    const { result } = renderHook(
      () => ({ inv: useInvalidateTrust(), v: useTrustValidators(), vio: useTrustViolations(200) }),
      { wrapper },
    );
    await waitFor(() => expect(qc.getQueryCache().getAll().length).toBe(2));
    mockFetchValidators.mockClear();
    mockFetchTrust.mockClear();

    result.current.inv();

    // Este caso nasceu de uma regressão real cometida durante a migração: as
    // páginas leitoras foram para a factory antes das escritoras, e por alguns
    // minutos `guardrail-new.tsx` invalidava `['cloud', '/v1/dashboard/trust/
    // validators']` — uma chave que ninguém mais lia. Criar um guardrail
    // deixaria de atualizar a lista, e NENHUM teste pegava, porque nenhum
    // cobria "criar e ver a lista mudar".
    await waitFor(() => expect(mockFetchValidators).toHaveBeenCalled());
    expect(mockFetchTrust).toHaveBeenCalled();
  });

  it('DEFEITO CORRIGIDO — limites diferentes NÃO compartilham cache', async () => {
    mockFetchTrust.mockResolvedValue({ violations: [] });
    renderHook(() => useTrustViolations(200), { wrapper });
    renderHook(() => useTrustViolations(100), { wrapper });
    await waitFor(() => expect(mockFetchTrust).toHaveBeenCalledTimes(2));

    // ESTE era o defeito. `overview.tsx:56` (limit=200) e `violations.tsx:154`
    // (limit=100) usavam a MESMA chave literal, então o TanStack servia quem
    // cacheou primeiro. Abrir /trust/violations e depois o overview fazia o
    // `coverageGap` calcular a cobertura sobre 100 violações em vez de 200 —
    // uma tela de compliance SUB-REPORTANDO lacunas, que é a direção errada.
    //
    // Duas entradas distintas é o conserto, e é o mesmo motivo pelo qual
    // `queryKeys.projects.list(filters)` carrega os filtros desde T1.2.
    expect(qc.getQueryCache().getAll().length).toBe(2);
    expect(mockFetchTrust).toHaveBeenCalledWith('/policy-violations?limit=200');
    expect(mockFetchTrust).toHaveBeenCalledWith('/policy-violations?limit=100');
  });
});
