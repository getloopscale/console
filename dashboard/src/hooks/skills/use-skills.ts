import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSkills,
  fetchSkill,
  fetchSkillVersions,
  fetchSkillChannels,
  fetchSkillInstructions,
  fetchBundles,
  fetchBundleTokens,
  fetchBundleAdoption,
  retrieveSkills,
  fetchOperation,
} from '@/hooks/skills/skills-api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Camada de acesso a dados dos domínios skills e bundles.
 *
 * ## O defeito medido (B-052)
 *
 * `skills-api.ts` exporta 23 funções de transporte e **zero** query keys, então
 * as 8 páginas consumidoras escolhiam a sua. O resultado é o pior dos três
 * domínios: o mesmo prefixo `['cloud', '/v1/dashboard/skills', X]` carregava
 * **três coisas diferentes** no slot `X` —
 *
 * - `overview.tsx:77` — um token de paginação
 * - `detail.tsx:61` — um id de skill
 * - `bundle-detail.tsx:104` — um limite numérico
 *
 * Tupla posicional com slot sem tipo colide por coincidência de valor, e o
 * defeito aparece como "a tela mostrou o dado de outra coisa" — que ninguém
 * associa a cache. A factory dá nome a cada leitura, então o slot deixa de ser
 * posicional.
 *
 * ## Bundles têm raiz própria
 *
 * Estão no mesmo domínio de produto, mas invalidar `skills.all` depois de criar
 * um bundle refaria o catálogo inteiro sem motivo, e o inverso também. Duas
 * raízes é o que permite invalidar o que mudou.
 *
 * ## Forma
 *
 * Devolve o payload cru (`data`), como em `hooks/trust/use-trust.ts` e pelo
 * mesmo motivo: consumidores diferentes extraem campos diferentes, e um hook que
 * escolhe por eles esconde os outros.
 *
 * ## Por que genérico no payload
 *
 * `trust` pôde usar tipos do domínio porque havia UM tipo por payload. Aqui cada
 * uma das 8 páginas declara o seu localmente, e escolher um canônico para todas
 * seria decidir por oito telas de uma vez — outro escopo. O transporte já é
 * genérico (`fetchSkills<T>`), então o hook espelha o mesmo contrato: quem chama
 * diz o que espera, como já dizia antes.
 */

export interface SkillsQuery<T> {
  data: T | null | undefined;
  loading: boolean;
  error: boolean;
  /**
   * A leitura TERMINOU com dados. Distinto de `!loading && !error`: em TanStack v5
   * `isLoading` é `isPending && isFetching`, então offline no mount as duas ficam falsas
   * com `data === undefined`, e quem afirma algo a partir disso afirma sobre nada. Toda
   * tela que faz uma afirmação — "nenhuma violação", "nada registrado" — precisa deste,
   * não daquele (B-161).
   */
  isSuccess: boolean;
  /**
   * Refetch em segundo plano, distinto de `loading`.
   *
   * `loading` é a primeira busca — a tela não tem o que mostrar. `isFetching` é
   * uma revalidação com dado antigo na tela: o botão gira, o conteúdo fica. As
   * páginas de skills já distinguiam os dois, e um hook que expusesse só o
   * primeiro faria a tela piscar vazia a cada refresh.
   */
  isFetching: boolean;
  refetch: () => void;
}

/**
 * O catálogo, servindo `overview`, `catalog` e `bundle-detail`.
 *
 * Os três chamavam `fetchSkills(limit, token)` com chaves diferentes — o mesmo
 * dado ocupando três entradas de cache que nunca se invalidavam juntas. Um
 * leitor, uma chave.
 */
export function useSkillsCatalog<T>(
  limit: number,
  token?: string | null,
): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.catalog(limit, token ?? null),
    queryFn: () => fetchSkills<T>(limit, token ?? undefined),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useSkill<T>(id: string | undefined): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.detail(id),
    enabled: Boolean(id),
    queryFn: () => fetchSkill<T>(id ?? ''),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useSkillInstructions<T>(id: string | undefined): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.instructions(id),
    enabled: Boolean(id),
    queryFn: () => fetchSkillInstructions<T>(id ?? ''),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useSkillVersions<T>(id: string | undefined): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.versions(id),
    enabled: Boolean(id),
    queryFn: () => fetchSkillVersions<T>(id ?? ''),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useSkillChannels<T>(id: string | undefined): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.channels(id),
    enabled: Boolean(id),
    queryFn: () => fetchSkillChannels<T>(id ?? ''),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useSkillsDiscovery<T>(
  consulta: string,
  topK: number,
  incluirRascunhos: boolean,
  incluirDescontinuadas: boolean,
  habilitado: boolean,
): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.discovery(consulta, incluirRascunhos, incluirDescontinuadas),
    enabled: habilitado,
    queryFn: () =>
      retrieveSkills<T>(consulta, topK, incluirRascunhos, incluirDescontinuadas),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

/**
 * O acompanhamento de uma operação assíncrona.
 *
 * `refetchInterval` aceita a forma FUNÇÃO, e não só um número, de propósito:
 * `authoring.tsx` usa o estado da própria query para PARAR de sondar quando a
 * operação chega a um estado terminal. O comentário lá registra que sem isso o
 * polling seguia para sempre numa aba esquecida aberta, custando uma requisição
 * por segundo sem ninguém lendo — um hook que aceitasse só o número devolveria
 * esse defeito.
 */
export function useSkillOperation<T>(
  id: string | undefined,
  opcoes?: {
    refetchInterval?:
      | number
      | false
      | ((query: { state: { data: unknown } }) => number | false);
  },
): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.skills.operation(id),
    enabled: Boolean(id),
    refetchInterval: opcoes?.refetchInterval as never,
    queryFn: () => fetchOperation<T>(id ?? ''),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useBundles<T>(): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.bundles.list(),
    queryFn: () => fetchBundles<T>(),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useBundleTokens<T>(bundleId: string | undefined): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.bundles.tokens(bundleId),
    enabled: Boolean(bundleId),
    queryFn: () => fetchBundleTokens<T>(bundleId ?? ''),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

export function useBundleAdoption<T>(
  bundleId: string | undefined,
  dias: number,
): SkillsQuery<T> {
  const query = useQuery({
    queryKey: queryKeys.bundles.adoption(bundleId, dias),
    enabled: Boolean(bundleId),
    queryFn: () => fetchBundleAdoption<T>(bundleId ?? '', dias),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    isSuccess: query.isSuccess && query.data != null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

/**
 * Invalidação por raiz.
 *
 * Duas funções e não uma: publicar uma skill não deve refazer a lista de
 * bundles, e criar um bundle não deve refazer o catálogo. Uma invalidação que
 * alcança demais custa tráfego que ninguém pediu — e a que alcança de menos é o
 * defeito que este plano corrige.
 */
export function useInvalidateSkills(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
  };
}

export function useInvalidateBundles(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bundles.all });
  };
}
