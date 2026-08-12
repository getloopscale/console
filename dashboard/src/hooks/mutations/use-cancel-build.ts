import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Cancel a running build. Invalidates builds list + the specific build detail.
 *
 * B-145 / B-168 — sem `{ throwOnError: true }`, `cloudFetch` RESOLVE `null` num não-2xx. Uma
 * promise resolvida é sucesso para o `useMutation`: `onSuccess` rodava, as duas chaves eram
 * invalidadas, e o diálogo fechava informando ao operador um cancelamento que o servidor recusou.
 *
 * Cancelar um build é destrutivo e quem opera age sobre a resposta. As três mutações irmãs deste
 * diretório já passavam a flag, cada uma com um comentário nomeando exatamente esta falha
 * (`use-environments.ts`, `use-rollback.ts`, `use-promote.ts`) — esta era a que faltava.
 */
export function useCancelBuild() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (buildId: string) =>
      engineFetch(
        `/api/v1/builds/${encodeURIComponent(buildId)}/cancel`,
        { method: 'POST' },
        { throwOnError: true },
      ),
    onSuccess: (_data, buildId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.builds.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.builds.detail(buildId) });
    },
  });
}
