import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * B-048 — a lista de datasets de lens, num lugar só.
 *
 * Três telas declaravam a mesma query com a mesma chave, e cada uma com um
 * formato de resposta próprio: `DatasetsResult` em `datasets.tsx`,
 * `{ datasets: { id, name }[] }` inline em `experiments.tsx` e em
 * `playground/variant-column.tsx`.
 *
 * Os dois formatos inline são um SUBCONJUNTO do completo — só leem `id` e
 * `name`. Isso é o modo mais silencioso de a duplicação cobrar: quando o
 * back-end acrescentar um campo que uma tela precisa, o autor vai encontrar
 * três declarações e mudar a que estava aberta.
 *
 * `throwOnError` é deliberado: falha de rede vira `isError`, não lista vazia.
 * Uma tela que mostra "nenhum dataset" com o serviço fora leva o operador a
 * recriar o que já existe.
 */
export interface Dataset {
  id: string;
  name: string;
  createdAt?: string;
  itemCount?: number;
}

export interface DatasetsResult {
  datasets: Dataset[];
}

const DATASETS_PATH = '/v1/dashboard/lens/datasets';

/** Chave canônica — exportada para invalidar sem repetir a tupla. */
export const datasetsQueryKey = ['cloud', DATASETS_PATH] as const;

/**
 * `enabled` é o ÚNICO parâmetro, e existe porque é a única coisa que de fato
 * variava entre as três telas: o modal de execução só precisa da lista fora da
 * visão de comparação, e a coluna do playground só depois de haver um resultado
 * para salvar. Chave e formato de resposta são iguais nos três — se não fossem,
 * o hook seria a abstração errada.
 */
export function useDatasets(opcoes?: { enabled?: boolean }) {
  return useQuery({
    queryKey: datasetsQueryKey,
    queryFn: () => cloudFetch<DatasetsResult>(DATASETS_PATH, {}, { throwOnError: true }),
    enabled: opcoes?.enabled,
  });
}
