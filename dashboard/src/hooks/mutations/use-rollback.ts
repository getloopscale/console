import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { RollbackResponse } from '@/lib/api/types';

/**
 * useRollback — reverter um ambiente para um build anterior.
 *
 * Irmão de `usePromote`, e fecha a mesma metade do B-013: a chamada sai do
 * diálogo e passa a ter dono. Ver o bloco de `use-promote.ts` para o porquê
 * completo — vale igual aqui, e reverter produção é o outro POST em que perder
 * o refresh de token custa mais caro.
 *
 * A diferença de contrato é só o corpo: o rollback nomeia o ambiente E o build
 * de destino, enquanto o promote nomeia a origem e assume `production`.
 */
export function useRollback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { projectName: string; environment: string; buildId: string }) =>
      engineFetch<RollbackResponse>(
        `/api/v1/projects/${encodeURIComponent(vars.projectName)}/rollback`,
        {
          method: 'POST',
          // Por chamada, nunca por diálogo: reverter tem efeito de mundo real, e
          // um duplo clique ou um retry de rede não pode reverter duas vezes.
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            environment: vars.environment,
            build_id: vars.buildId,
          }),
        },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.builds.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.environments.all });
    },
  });
}
