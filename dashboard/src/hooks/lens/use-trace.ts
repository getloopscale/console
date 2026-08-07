import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import type { TraceSpanNode } from '@/lib/lens/trace-layout';

/**
 * B-048 — a árvore de um trace, num lugar só.
 *
 * ## O que a medição encontrou
 *
 * Quatro telas buscavam a mesma árvore, e as chaves **divergiam**:
 *
 *   ask.tsx                    ['cloud', path, traceId]
 *   trace-detail/index.tsx     ['cloud', path, traceId, 'tree']
 *   compare.tsx                ['cloud', path, id, 'tree']
 *   session-conversation.tsx   ['cloud', path, t.traceId, 'tree']
 *
 * `ask.tsx` lia de uma entrada de cache própria para o mesmo dado — abrir o
 * mesmo trace em Ask e em Trace Detail baixava a árvore duas vezes. Não é bug
 * de correção, é desperdício silencioso, e é o tipo de coisa que só aparece
 * quando alguém compara as quatro linhas lado a lado.
 *
 * ## Por que a política de erro é PARÂMETRO e não constante
 *
 * Três sites usam `throwOnError: true` — uma tela de trace que não carrega deve
 * dizer isso, não mostrar uma árvore vazia. O quarto (`session-conversation`)
 * deliberadamente NÃO usa: ele busca N traces com `useQueries` e mostra
 * "(could not load this turn)" no turno que falhou, mantendo os outros. Há
 * teste cobrindo esse comportamento (`session-detail.test.tsx:176`).
 *
 * Uniformizar seria quebrar a degradação graciosa: um turno ruim mataria a
 * conversa inteira. Por isso `fetchTrace` expõe a escolha, e o hook — que serve
 * o caso de tela única — assume o padrão seguro.
 */
export const TRACES_PATH = '/v1/dashboard/lens/traces';

/** Chave canônica da ÁRVORE de um trace. Os quatro sites convergiram nela. */
export function traceTreeQueryKey(traceId: string) {
  return ['cloud', TRACES_PATH, traceId, 'tree'] as const;
}

/**
 * Busca a árvore. `throwOnError` fica explícito no chamador porque os dois
 * comportamentos são legítimos — ver o docblock acima.
 */
export function fetchTrace(traceId: string, opcoes?: { throwOnError?: boolean }) {
  return cloudFetch<TraceSpanNode>(
    `${TRACES_PATH}/${encodeURIComponent(traceId)}`,
    {},
    { throwOnError: opcoes?.throwOnError ?? true },
  );
}

/** Uma tela, um trace: falha vira `isError`, nunca árvore vazia. */
export function useTrace(traceId: string | undefined, opcoes?: { enabled?: boolean }) {
  return useQuery({
    queryKey: traceTreeQueryKey(traceId ?? ''),
    queryFn: () => fetchTrace(traceId!, { throwOnError: true }),
    enabled: opcoes?.enabled ?? Boolean(traceId),
  });
}
