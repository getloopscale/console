import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * B-048 — a lista de coleções de RAG, num lugar só.
 *
 * ## O que existia antes
 *
 * Sete telas de `pages/rag/` declaravam a MESMA query, byte a byte:
 *
 *   queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
 *   queryFn: () => cloudFetch<{ items: Collection[] }>(
 *     '/v1/dashboard/rag/collections', {}, { throwOnError: true }),
 *
 * ...e cada uma redeclarava a interface `Collection` localmente. Três nomes
 * diferentes para o mesmo formato de resposta (`Collection`, `CollectionsResult`,
 * `{ items: Collection[] }`) num único domínio.
 *
 * ## Por que isso é mais que feio
 *
 * O custo não é a repetição — é que sete cópias divergem uma de cada vez. Basta
 * uma tela ganhar um filtro na chave, ou perder o `throwOnError`, para que ela
 * passe a ler de um cache diferente das outras seis, ou volte a engolir falha
 * num estado vazio (a classe do #274, que esta sessão fechou três vezes).
 *
 * Um dono só torna as duas divergências impossíveis por construção.
 *
 * ## `throwOnError` é deliberado
 *
 * Falha de rede aqui precisa virar `isError`, não lista vazia. Uma tela que
 * mostra "nenhuma coleção" quando o serviço está fora leva o operador a criar
 * uma coleção que já existe.
 */
export interface Collection {
  id: string;
  name: string | null;
  created_at?: string;
}

export interface CollectionsResult {
  items: Collection[];
}

const COLLECTIONS_PATH = '/v1/dashboard/rag/collections';

/** Chave canônica — as mutations abaixo invalidam por ela, sem repetir a tupla. */
const collectionsQueryKey = ['cloud', COLLECTIONS_PATH] as const;

export function useCollections() {
  return useQuery({
    queryKey: collectionsQueryKey,
    queryFn: () => cloudFetch<CollectionsResult>(COLLECTIONS_PATH, {}, { throwOnError: true }),
  });
}

/**
 * Cria uma coleção.
 *
 * B-235 — sem contrato de erro, uma criação recusada RESOLVIA `null`, o campo era limpo e a lista
 * recarregada. O operador via o próprio texto sumir e nenhuma coleção nova aparecer — a leitura
 * natural é que o nome foi rejeitado por já existir, e não que o servidor recusou a operação.
 */
export function useCreateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      cloudFetch<Collection>(
        COLLECTIONS_PATH,
        { method: 'POST', body: JSON.stringify({ name }) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collectionsQueryKey });
    },
  });
}

/**
 * Apaga uma coleção.
 *
 * B-235 — a leitura aqui é a que custa: a coleção sai da tela por invalidação otimista do diálogo
 * e volta na leitura seguinte. Entre uma e outra, o operador acredita que apagou os documentos que
 * ela guarda.
 */
export function useDeleteCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await cloudFetch(
        `${COLLECTIONS_PATH}/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collectionsQueryKey });
    },
  });
}
