import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './query-keys';

/**
 * B-018 — invalidacao hierarquica do recurso `domains`.
 *
 * O defeito medido pela auditoria: as mutations de dominio invalidavam
 * `['domains']` enquanto o polling de status lia
 * `['engine', '/api/v1/domains/:name']`. Sao dois namespaces independentes, e
 * `invalidateQueries(['domains'])` nunca alcancava o segundo — um verify ou
 * delete bem-sucedido deixava a tela de detalhe servindo dado velho.
 *
 * Este teste falha contra a chave antiga (a query 'engine' permanece fresh
 * apos a invalidacao) e passa com a hierarquia unificada. E o predicado de
 * invalidacao do proprio TanStack Query que decide — nao uma comparacao de
 * strings que eu poderia escrever para dar verde.
 */
describe('queryKeys.domains — invalidacao hierarquica (B-018)', () => {
  it('invalidar a raiz domains alcanca a query de DETALHE', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detail = queryKeys.domains.detail('exemplo.com');

    qc.setQueryData(detail, { name: 'exemplo.com', status: 'pending' });
    expect(qc.getQueryState(detail)?.isInvalidated).toBe(false);

    await qc.invalidateQueries({ queryKey: queryKeys.domains.all });

    expect(qc.getQueryState(detail)?.isInvalidated).toBe(true);
  });

  it('invalidar a raiz domains alcanca a query de LISTA', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = queryKeys.domains.list();

    qc.setQueryData(list, []);
    await qc.invalidateQueries({ queryKey: queryKeys.domains.all });

    expect(qc.getQueryState(list)?.isInvalidated).toBe(true);
  });

  it('NAO alcanca um recurso vizinho — a hierarquia delimita o raio', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const projects = queryKeys.projects.list();

    qc.setQueryData(projects, []);
    await qc.invalidateQueries({ queryKey: queryKeys.domains.all });

    // Uma invalidacao que alcanca tudo nao prova nada sobre a hierarquia.
    expect(qc.getQueryState(projects)?.isInvalidated).toBe(false);
  });

  it('o namespace legado engine NAO era alcancado — a regressao que este teste guarda', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const legado = ['engine', '/api/v1/domains/exemplo.com'] as const;

    qc.setQueryData(legado, { name: 'exemplo.com' });
    await qc.invalidateQueries({ queryKey: queryKeys.domains.all });

    // Esta era exatamente a chave que o polling usava antes de B-018.
    expect(qc.getQueryState(legado)?.isInvalidated).toBe(false);
  });
});

/**
 * O bloco acima prova a HIERARQUIA da factory. Sozinho ele nao guarda o hook:
 * se alguem devolvesse `use-domain-status-polling` para a chave legada
 * `['engine', ...]`, aqueles quatro testes seguiriam verdes e a invalidacao
 * voltaria a nao alcancar o detalhe — o defeito de B-018 reaparecendo sob um
 * teste verde. Este bloco fecha essa brecha: renderiza o hook de verdade e
 * pergunta ao cache sob qual chave a query foi registrada.
 */
describe('useDomainStatusPolling registra a query sob a hierarquia domains (B-018)', () => {
  it('a chave efetiva do hook e alcancada por invalidateQueries(domains.all)', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { QueryClientProvider } = await import('@tanstack/react-query');
    const { useDomainStatusPolling } = await import('@/hooks/use-domain-status-polling');
    const React = await import('react');

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    renderHook(() => useDomainStatusPolling('exemplo.com'), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientProvider, { client: qc }, children),
    });

    // A query precisa existir no cache antes de podermos afirmar algo sobre a chave.
    await waitFor(() => {
      expect(qc.getQueryCache().getAll().length).toBeGreaterThan(0);
    });

    const chaves = qc.getQueryCache().getAll().map((q) => q.queryKey);
    const alcancadas = qc
      .getQueryCache()
      .findAll({ queryKey: queryKeys.domains.all })
      .map((q) => q.queryKey);

    // Toda query que o hook abriu tem de cair sob ['domains'] — senao a
    // invalidacao das mutations continua nao a alcancando.
    expect(alcancadas.length).toBe(chaves.length);
    expect(alcancadas.length).toBeGreaterThan(0);
  });
});
