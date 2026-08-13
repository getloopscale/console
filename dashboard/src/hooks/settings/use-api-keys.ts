import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import * as api from './api-keys-api';
import type { CreateKeyResponse, NewKey } from './api-keys-api';

/**
 * A camada de acesso a dados do domínio de chaves de API (B-012 / B-053).
 *
 * ## O que muda em relação ao que a página fazia
 *
 * A página declarava a chave de cache como literal — `['cloud', '/v1/api-keys/list']`
 * — em dois lugares: na consulta e na invalidação. Duas literais que precisam
 * ser idênticas, sem nada que force isso. Errar uma letra na invalidação não
 * quebra teste nenhum: a mutação passa, a lista não atualiza, e o operador
 * conclui que a criação falhou.
 *
 * `ADR-0006` existe por isso. A chave vem da factory, e há um único lugar onde
 * ela é escrita.
 *
 * ## Por que os invalidadores vivem aqui, e não em quem chama
 *
 * As três mutações invalidam a mesma listagem. Deixar isso no `onSuccess` de
 * cada chamador significa que a quarta mutação — a que ainda não existe — vai
 * ser escrita por alguém que precisa lembrar de invalidar. Quem sabe o que uma
 * escrita invalida é o dono do domínio.
 */

/** A listagem de chaves. */
export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.apiKeys.list(),
    queryFn: api.listar,
  });
}

/**
 * A linhagem de rotação de uma chave.
 *
 * `enabled` recebe o id porque o painel monta desmontado: sem isso a consulta
 * dispararia contra `/v1/api-keys//lineage` no primeiro render.
 */
export function useApiKeyLineage(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.apiKeys.lineage(id ?? ''),
    queryFn: () => api.linhagem(id!),
    enabled: !!id,
  });
}

function useInvalidarListagem() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.apiKeys.list() });
}

export function useCreateApiKey(onCriada: (key: CreateKeyResponse) => void) {
  const invalidar = useInvalidarListagem();
  return useMutation({
    mutationFn: (input: NewKey) => api.create(input),
    onSuccess: (resp) => {
      if (resp) onCriada(resp);
      void invalidar();
    },
  });
}

export function useRevogarApiKey(onRevogada: () => void) {
  const invalidar = useInvalidarListagem();
  return useMutation({
    mutationFn: (id: string) => api.revogar(id),
    onSuccess: () => {
      onRevogada();
      void invalidar();
    },
  });
}

export function useRotacionarApiKey(onRotacionada: (key: CreateKeyResponse) => void) {
  const invalidar = useInvalidarListagem();
  return useMutation({
    mutationFn: (id: string) => api.rotacionar(id),
    onSuccess: (resp) => {
      if (resp) onRotacionada(resp);
      void invalidar();
    },
  });
}
