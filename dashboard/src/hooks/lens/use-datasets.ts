import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export interface DatasetItem {
  traceId: string;
  createdAt?: string;
}

export interface DatasetDetail {
  id: string;
  name: string;
  items: DatasetItem[];
}

export interface DatasetsResult {
  datasets: Dataset[];
}

const DATASETS_PATH = '/v1/dashboard/lens/datasets';

/**
 * Chave canônica. Deixou de ser exportada em 2026-08-12 (B-244): ela existia para a tela invalidar
 * sem repetir a tupla, e agora quem invalida são os hooks daqui. Um export sem importador é
 * superfície a mais — a mesma leitura que o knip aplica e que o B-245 congelou.
 */
const datasetsQueryKey = ['cloud', DATASETS_PATH] as const;

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

/** Chave do DETALHE de um dataset. Deriva da mesma raiz, então invalidar a lista não a esquece. */
function datasetDetailQueryKey(id: string) {
  return [...datasetsQueryKey, id] as const;
}

/**
 * Um dataset e seus itens.
 *
 * B-244 — a tela declarava esta query, e com ela a chave. A chave do detalhe TEM de derivar da
 * mesma raiz que a lista (`['cloud', DATASETS_PATH, id]`), senão uma invalidação da lista não
 * alcança o detalhe aberto e a tela mostra itens que já foram removidos. Com a chave montada em
 * dois lugares, esse acordo é uma coincidência que dura até alguém editar um dos dois.
 */
export function useDatasetDetail(id: string | null) {
  return useQuery({
    queryKey: datasetDetailQueryKey(id ?? ''),
    queryFn: () =>
      cloudFetch<DatasetDetail>(
        `${DATASETS_PATH}/${encodeURIComponent(id ?? '')}`,
        {},
        { throwOnError: true },
      ),
    enabled: id !== null && id !== '',
  });
}

/**
 * Criar um dataset.
 *
 * B-244/B-235 — a tela montava este POST sem `{ throwOnError: true }`, então uma recusa RESOLVIA
 * `null`, o `onSuccess` disparava mesmo assim, o diálogo fechava e o campo era limpo. O usuário
 * saía acreditando ter criado um dataset que não existe — e a lista, ao recarregar, simplesmente
 * não o mostrava, o que se lê como "sumiu" e não como "nunca foi criado".
 *
 * `null` num 2xx aqui é violação de contrato, não dataset sem id: o POST existe para devolver o
 * que foi criado.
 */
export function useCreateDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<Dataset> => {
      const created = await cloudFetch<Dataset>(
        DATASETS_PATH,
        { method: 'POST', body: JSON.stringify({ name }) },
        { throwOnError: true },
      );
      if (created === null) {
        throw new Error('The dataset was accepted but the server did not say which one it is.');
      }
      return created;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: datasetsQueryKey });
    },
  });
}

/**
 * Remover um item de um dataset.
 *
 * B-244/B-235 — mesma falta de contrato, e aqui o efeito é o oposto do de criar: a linha some da
 * tela porque o `onSuccess` dispara, e volta na próxima leitura. Uma remoção que o servidor recusou
 * reportada como concluída.
 *
 * Invalida a lista E o detalhe: a contagem de itens vive na lista, então atualizar só o detalhe
 * deixa `itemCount` mentindo até o próximo refetch.
 */
export function useRemoveDatasetItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (r: { datasetID: string; traceId: string }): Promise<void> => {
      await cloudFetch(
        `${DATASETS_PATH}/${encodeURIComponent(r.datasetID)}/items/${encodeURIComponent(r.traceId)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
    },
    onSuccess: (_data, r) => {
      void queryClient.invalidateQueries({ queryKey: datasetDetailQueryKey(r.datasetID) });
      void queryClient.invalidateQueries({ queryKey: datasetsQueryKey });
    },
  });
}

/**
 * Renomear um dataset. `throwOnError` já estava na tela — um 409 tem de rejeitar para o Alert
 * tipado aparecer, e renomear para um nome em uso é exatamente o caso que produz 409.
 */
export function useRenameDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (r: { id: string; name: string }) =>
      cloudFetch<Dataset>(
        `${DATASETS_PATH}/${encodeURIComponent(r.id)}`,
        { method: 'PUT', body: JSON.stringify({ name: r.name }) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: datasetsQueryKey });
    },
  });
}

/** Apagar um dataset — cascateia runs e itens no looptrace. */
export function useDeleteDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch<void>(
        `${DATASETS_PATH}/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: datasetsQueryKey });
    },
  });
}
