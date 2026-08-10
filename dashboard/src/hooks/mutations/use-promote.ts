import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { PromoteResponse } from '@/lib/api/types';

/**
 * usePromote — promover um deploy de preview para produção.
 *
 * ## B-013, segunda metade
 *
 * A primeira metade trocou o `window.fetch` cru por `cloudFetchRaw`: o caminho
 * anterior pegava o JWT com `ensureSSEToken()` — o helper do EventSource — e
 * montava o request à mão, fora do pipeline de auth do client. Sem retry após
 * refresh no 401, sem o interceptor de 402 (limite de plano). Promover para
 * produção é exatamente onde perder o refresh custa mais caro.
 *
 * Esta metade move a chamada para o dono certo. Um diálogo é uma tela: coleta a
 * confirmação e mostra o resultado. Enquanto a rede morava dentro dele, o único
 * jeito de testar a promoção era montando um modal, e a invalidação de cache
 * dependia de quem abrisse o diálogo lembrar de fazê-la.
 *
 * ## `throwOnError` e não `Response`
 *
 * `cloudFetchRaw` devolvia a `Response` e o diálogo ramificava por status. Aqui
 * o erro é uma `ApiError` com `status` e `body` — os mesmos dois dados que
 * `formatPromoteError` já consumia. A diferença é que uma rejeição sobe pelo
 * `mutation.error` em vez de exigir que cada chamador se lembre de checar o
 * `resp.ok`; um `if` esquecido virava uma promoção que falhou em silêncio.
 *
 * ## Idempotency-Key
 *
 * Gerada por chamada, não por diálogo. Promover é uma operação com efeito de
 * mundo real: um duplo clique ou um retry de rede não pode promover duas vezes.
 */
export function usePromote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { projectName: string; fromEnvironment: string }) =>
      engineFetch<PromoteResponse>(
        `/api/v1/projects/${encodeURIComponent(vars.projectName)}/promote`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ from: vars.fromEnvironment, to: 'production' }),
        },
        { throwOnError: true },
      ),
    onSuccess: () => {
      // O release ativo mudou: a grade de deploys e a listagem de ambientes
      // ficaram desatualizadas no mesmo instante. Invalidar aqui é o que tira
      // essa responsabilidade de cada chamador — era ela que fazia a badge
      // "● Active" aparecer no lugar errado quando alguém esquecia.
      queryClient.invalidateQueries({ queryKey: queryKeys.builds.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.environments.all });
    },
  });
}
