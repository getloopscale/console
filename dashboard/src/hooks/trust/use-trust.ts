import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchTrust,
  fetchValidators,
  fetchEnforcementEvents,
} from './trust-api';
import { queryKeys } from '@/lib/api/query-keys';
import type {
  ViolationsPayload,
  ValidatorsPayload,
  ConversationPayload,
} from './trust-payloads';
import type { EnforcementPayload, CatalogPayload } from './trust-payloads';

/**
 * Camada de acesso a dados do domínio trust.
 *
 * ## Por que existe (B-052)
 *
 * `trust-api.ts` exporta 8 funções de transporte e **zero** query keys, então
 * cada uma das 5 páginas consumidoras escolhia a sua. `overview.tsx:56` lia
 * `['cloud', '/v1/dashboard/trust/policy-violations']`; `guardrails.tsx:54` um
 * `QUERY_KEY` local. Árvores de cache disjuntas — criar um guardrail nunca
 * atualizava a contagem do overview.
 *
 * Mesmo defeito de `domains` (B-018) e de `team` (B-060), pela terceira vez. A
 * factory de query key existe desde então; o que faltava aqui era o dono que a
 * usa.
 *
 * ## O que este módulo NÃO faz
 *
 * Transporte. `trust-api.ts` continua sendo quem fala HTTP, e este hook o
 * consome — decisão D2 do plano. Reescrever 8 funções que já funcionam não
 * resolve necessidade nenhuma (`parsimony-ladder.md` degrau 1), e juntar
 * contrato-de-endpoint com política-de-cache no mesmo arquivo daria a ele duas
 * razões de mudar.
 *
 * ## A forma
 *
 * Espelha `hooks/projects/use-projects.ts`: `useQuery` + chave da factory +
 * `error` exposto ao consumidor. Esse último ponto é o que impede a classe do
 * `#274` — uma leitura que falha e resolve `null` renderiza o estado vazio, e a
 * tela diz "você não tem violações" quando não conseguiu perguntar.
 */

/**
 * O hook devolve o PAYLOAD CRU, não um array já extraído.
 *
 * Foi uma medição que decidiu: `coverageGap(violations, validators)`
 * (`trust-series.ts:172`) recebe os payloads e trata DUAS formas para o mesmo
 * dado — `validators?.validators ?? validators?.items`. Um hook que extraísse o
 * array escolheria uma das formas pelo consumidor, e a outra sumiria em
 * silêncio.
 *
 * Projetar pela necessidade de um consumidor e descobrir a do segundo depois é
 * exatamente como a camada pela metade nasceu.
 *
 * Os tipos vêm de `trust-series.ts`, que é onde o domínio já os declara. Inventar
 * tipos inline aqui criaria uma terceira descrição do mesmo payload — e o
 * defeito que este plano corrige começou com duas.
 */
export interface TrustQuery<T> {
  data: T | null | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * DEFEITO REAL CORRIGIDO AQUI (B-052).
 *
 * `overview.tsx:56` e `violations.tsx:154` usavam a MESMA chave
 * `['cloud', '/v1/dashboard/trust/policy-violations']` com limites DIFERENTES:
 * 200 e 100. O TanStack serve quem cacheou primeiro — então abrir
 * `/trust/violations` e depois o overview fazia o `coverageGap` calcular a
 * cobertura sobre 100 violações em vez de 200, **sub-reportando lacunas numa
 * tela de compliance**. É a direção errada de errar.
 *
 * O limite na chave separa os dois caches. É o mesmo motivo pelo qual
 * `queryKeys.projects.list(filters)` carrega os filtros desde T1.2.
 */
export function useTrustViolations(limit: number): TrustQuery<ViolationsPayload> {
  const query = useQuery({
    queryKey: queryKeys.trust.violations({ limit }),
    queryFn: () =>
      fetchTrust<ViolationsPayload>(`/policy-violations?limit=${limit}`),
  });
  return { data: query.data, loading: query.isLoading, error: query.isError };
}

/**
 * `fetchValidators()` é literalmente `fetchTrust('/validators')`
 * (`trust-api.ts:32`) — mesmo endpoint, dois nomes. `overview.tsx` chamava um e
 * `guardrails.tsx` o outro, com chaves diferentes, o que fazia o mesmo catálogo
 * ocupar duas entradas de cache que nunca se invalidavam juntas.
 */
/**
 * O MESMO endpoint tem dois tipos declarados no repositório: `ValidatorsPayload`
 * (usado por `coverageGap`) e `CatalogPayload` (usado pela tabela de guardrails).
 * O hook devolve a interseção, e o consumidor estreita — converter para um só
 * seria decidir por duas telas de uma vez, o que é outro escopo.
 */
export function useTrustValidators(): TrustQuery<ValidatorsPayload & CatalogPayload> {
  const query = useQuery({
    queryKey: queryKeys.trust.validators(),
    queryFn: () => fetchValidators<ValidatorsPayload & CatalogPayload>(),
  });
  return { data: query.data, loading: query.isLoading, error: query.isError };
}

export function useTrustEnforcement(limit: number): TrustQuery<EnforcementPayload> {
  const query = useQuery({
    // O limite entra na chave. `enforcement.tsx:43` não o carregava, então pedir
    // 50 e depois 200 serviria o cache dos 50 para os dois — a tela mostraria
    // menos linhas do que pediu, em silêncio.
    queryKey: queryKeys.trust.enforcement(limit),
    queryFn: () => fetchEnforcementEvents<EnforcementPayload>(limit),
  });
  return { data: query.data, loading: query.isLoading, error: query.isError };
}

/**
 * O detalhe de uma conversa. `enabled` é do chamador porque a página só busca
 * quando há conversa selecionada — ver a nota de N+1 no cabeçalho de
 * `violations.tsx`.
 */
export function useTrustConversation(id: string | null): TrustQuery<ConversationPayload> {
  const query = useQuery({
    queryKey: queryKeys.trust.conversation(id),
    enabled: Boolean(id),
    queryFn: () =>
      fetchTrust<ConversationPayload>(`/conversations/${encodeURIComponent(id ?? '')}`),
  });
  return { data: query.data, loading: query.isLoading, error: query.isError };
}

/**
 * Invalidação do domínio inteiro.
 *
 * Existe para que uma página que muda estado (criar/apagar guardrail) não
 * precise conhecer a chave de todas as outras — era exatamente o que a tupla
 * literal obrigava, e por isso as árvores ficavam disjuntas.
 */
export function useInvalidateTrust(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.trust.all });
  };
}
