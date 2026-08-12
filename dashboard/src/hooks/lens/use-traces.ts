import { useMutation, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import * as api from './traces-api';

/**
 * A camada de acesso a dados da listagem de traces (B-012).
 *
 * ## A chave da listagem tem de continuar sendo por VALOR de filtro
 *
 * A página chaveava por `filters` e `page`, e o comentário original explicava
 * por quê — vale repetir aqui, porque é a armadilha que a mudança de dono
 * poderia apagar:
 *
 * A janela temporal (`from`) é calculada a partir do relógio **no momento da
 * busca**, dentro de `buildTraceQuery`. Se `from` entrasse na chave, cada
 * render produziria uma chave nova e o React Query buscaria de novo, para
 * sempre. Chavear pelos VALORES dos filtros mantém a chave estável entre
 * renders; a janela é resolvida só na hora de buscar.
 *
 * `page` está na chave porque as setas de próxima/anterior precisam buscar a
 * janela certa (M81).
 */
export function useTraces(filtros: unknown, page: number, queryString: string) {
  return useQuery({
    queryKey: queryKeys.lens.traces(filtros, page),
    queryFn: () => api.listar(queryString),
  });
}

/**
 * As chaves de atributo mais frequentes do workspace, para sugerir no filtro
 * (M92).
 *
 * Uma descoberta vazia ou com falha deixa o campo como texto livre — o filtro
 * continua funcionando. É por isso que o chamador não trata `isError`: aqui a
 * ausência de sugestão é degradação aceitável, não defeito.
 */
export function useChavesDeAtributo() {
  return useQuery({
    queryKey: queryKeys.lens.spanAttributes(),
    queryFn: api.chavesDeAtributo,
  });
}

/**
 * Transforma os traces selecionados num dataset de regressão.
 *
 * `retry: false` é deliberado e vem do comportamento original: a operação não é
 * idempotente — repeti-la cria um segundo dataset com o mesmo conteúdo.
 */
export function useCriarDatasetDeRegressao(onCriado: (datasetId: string) => void) {
  return useMutation({
    mutationFn: (traceIds: string[]) =>
      api.criarDatasetDeRegressao(
        traceIds,
        `regression ${new Date().toISOString().slice(0, 19)}`,
      ),
    retry: false,
    onSuccess: onCriado,
  });
}
