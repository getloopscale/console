import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCatalogPage,
  fetchPrompt,
  fetchPromptResolvido,
  fetchPromptUsage,
  fetchRevisions,
  fetchDependentes,
  fetchLabels,
  fetchPolicy,
  fetchComments,
  type CatalogPage,
} from '@/hooks/promptly/promptly-api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Camada de acesso a dados do domínio promptly.
 *
 * ## O que este domínio tinha de diferente (B-052)
 *
 * Era o único dos três com **uma** query key declarada — `CATALOG_QUERY_KEY`
 * (`promptly-api.ts:23`), com o comentário certo: *"uma só, porque o recurso é
 * um só"*. O problema é que ela era a única: as outras onze leituras escreviam a
 * tupla à mão dentro das telas, e três delas ficaram sob o mesmo prefixo dessa
 * chave por acidente e não por contrato.
 *
 * ## Q2 do plano, resolvido: a forma da chave MUDA
 *
 * `CATALOG_QUERY_KEY` era `['cloud', '/v1/dashboard/promptly/prompts']`; na
 * factory é `['promptly', 'catalog', filtros]`. A identidade de cache muda,
 * então **há um refetch único no primeiro carregamento após o deploy**.
 *
 * A alternativa era preservar a forma antiga dentro da factory, o que manteria o
 * cache e quebraria a convenção — e uma convenção com uma exceção é uma
 * convenção que ninguém consegue aplicar sem consultar. O custo escolhido é uma
 * requisição a mais, uma vez; está no CHANGELOG porque uma tela que recarrega
 * sozinha sem explicação é um susto que ninguém consegue diagnosticar depois.
 */

/**
 * A forma de retorno, MEDIDA e não adivinhada.
 *
 * Ela cresceu quatro vezes durante esta migração — `isFetching`, depois
 * `refetch`, depois `isSuccess`, depois `isPending` — porque eu decidia o que o
 * consumidor precisava em vez de perguntar ao consumidor. Medido nos três
 * domínios: `data` 23×, `error` 8×, `refetch` 4×, `isFetching` 4×, `isSuccess`
 * 2×, `isPending` 1×. São estes seis, e nenhum outro.
 *
 * As distinções de estado são de TanStack e as páginas dependem delas por bons
 * motivos, não por descuido:
 *
 * - `loading` (isLoading) — primeira busca; a tela não tem o que mostrar.
 * - `isFetching` — revalidação com dado antigo em tela; o botão gira, o conteúdo
 *   fica. Colapsar os dois faria a tela piscar vazia a cada refresh.
 * - `isSuccess` — distinto de `!loading && !error`: entre montar e a primeira
 *   resposta os três são falsos, e `catalogo.tsx:299` usa isso para não afirmar
 *   "nenhum resultado" antes de ter perguntado. Classe do #274 de novo.
 * - `isPending` — sem dado ainda, incluindo o caso `enabled: false`.
 */
export interface PromptlyQuery<T> {
  data: T | null | undefined;
  loading: boolean;
  error: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isPending: boolean;
  refetch: () => void;
}

function envolver<T>(query: {
  data: T | null | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isPending: boolean;
  refetch: () => unknown;
}): PromptlyQuery<T> {
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isFetching: query.isFetching,
    isSuccess: query.isSuccess,
    isPending: query.isPending,
    refetch: () => void query.refetch(),
  };
}

export function usePromptlyCatalog<T>(
  filtros: Record<string, unknown>,
  limite: number,
): PromptlyQuery<CatalogPage<T>> {
  const query = useQuery({
    queryKey: queryKeys.promptly.catalog({ ...filtros, limite }),
    queryFn: () => fetchCatalogPage<T>(limite, filtros),
  });
  return envolver(query);
}

export function usePrompt<T>(name: string | undefined): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.prompt(name),
    enabled: Boolean(name),
    queryFn: () => fetchPrompt<T>(name ?? ''),
  });
  return envolver(query);
}

/**
 * O texto resolvido — a travessia do grafo de composição.
 *
 * `habilitado` é do CHAMADOR, e é obrigatório passá-lo com intenção:
 * `detail.tsx` só pede quando o prompt de fato compõe E o operador escolheu ver
 * o resolvido. O comentário original registra o motivo — a travessia custaria em
 * toda abertura de prompt que não referencia nada.
 *
 * A primeira versão deste hook ignorava isso e habilitava sempre. Dois testes
 * apanharam, e é o tipo de perda que passaria despercebida numa revisão: o
 * comportamento visível não muda, só a conta no fim do mês.
 */
export function usePromptResolvido<T>(
  name: string | undefined,
  habilitado = true,
): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.resolved(name),
    enabled: Boolean(name) && habilitado,
    retry: false,
    queryFn: () => fetchPromptResolvido<T>(name ?? ''),
  });
  return envolver(query);
}

export function usePromptDependentes<T>(name: string | undefined): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.dependents(name),
    enabled: Boolean(name),
    queryFn: () => fetchDependentes<T>(name ?? ''),
  });
  return envolver(query);
}

export function usePromptLabels<T>(name: string | undefined): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.labels(name),
    enabled: Boolean(name),
    queryFn: () => fetchLabels<T>(name ?? ''),
  });
  return envolver(query);
}

/**
 * O histórico de revisões, numa JANELA.
 *
 * `habilitado` não é opcional na prática, e o motivo está no comentário que a
 * página carregava: *"só depois de saber a última versão — pedir antes traria a
 * janela errada e a tela piscaria do histórico velho para o novo, com o operador
 * podendo clicar no intervalo"*. Numa tela de onde sai a promoção para produção,
 * clicar no intervalo errado reaponta produção para uma revisão velha (#364).
 *
 * A primeira versão deste hook habilitava sempre e disparava com `after=0` no
 * primeiro render. O teste do #364 apanhou — ele lê a PRIMEIRA chamada, que é
 * exatamente onde o defeito mora.
 */
export function usePromptRevisions<T>(
  name: string | undefined,
  limite: number,
  after = 0,
  habilitado = true,
): PromptlyQuery<T> {
  const query = useQuery({
    // Limite E cursor entram na chave. É a mesma lição de `trust` (200 vs 100) e
    // de `skills` (o catálogo sem limite): duas janelas do mesmo recurso não são
    // o mesmo dado. `after` foi acrescentado depois de medir — a primeira versão
    // do hook o descartava, o que teria quebrado a paginação de `detail.tsx` sem
    // erro de tipo, porque o parâmetro tem valor padrão.
    queryKey: queryKeys.promptly.revisions(name, limite, after),
    enabled: Boolean(name) && habilitado,
    queryFn: () => fetchRevisions<T>(name ?? '', limite, after),
  });
  return envolver(query);
}

export function usePromptPolicy<T>(
  name: string | undefined,
  label: string | undefined,
): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.policy(name, label),
    enabled: Boolean(name && label),
    queryFn: () => fetchPolicy<T>(name ?? '', label ?? ''),
  });
  return envolver(query);
}

export function usePromptUsage<T>(
  name: string | undefined,
  dias: number,
): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.usage(name, dias),
    enabled: Boolean(name),
    queryFn: () => fetchPromptUsage<T>(name ?? '', dias),
  });
  return envolver(query);
}

export function usePromptComments<T>(
  name: string | undefined,
  version: number,
): PromptlyQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.promptly.comments(name, version),
    enabled: Boolean(name),
    queryFn: () => fetchComments<T>(name ?? '', version),
  });
  return envolver(query);
}

/**
 * Invalidação por prompt, e não do domínio inteiro.
 *
 * Publicar uma revisão de UM prompt não deve refazer o catálogo nem as leituras
 * dos outros. A hierarquia `['promptly','prompt',name,...]` é o que permite essa
 * precisão — com as tuplas escritas à mão, cada tela invalidava as chaves que
 * conhecia, o que era ao mesmo tempo demais e de menos.
 */
export function useInvalidatePrompt(): (name: string) => void {
  const queryClient = useQueryClient();
  return (name: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptly.prompt(name) });
  };
}

