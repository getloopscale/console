import { useQuery } from '@tanstack/react-query';
import type { Whoami } from '@/lib/api/types';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * use-whoami (T1.2): TanStack Query migration.
 *
 * staleTime: Infinity — whoami só muda em team switch ou logout. Mutation
 * use-switch-team (T1.3) chamará queryClient.clear() para nuke todos os
 * caches team-scoped (EC-02 fold — não apenas invalidate whoami; settings,
 * projects, secrets, etc., todos são team-scoped e devem refetch).
 */
export function useWhoami(): {
  whoami: Whoami | null;
  loading: boolean;
  error: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.whoami.all,
    // silent-null-ok: ESTE hook mapeia `null` resolvido para o campo `error` que ele devolve (`isError || (isFetched && data === null)`), entao a falha nao se perde AQUI. B-094: isso NAO garante que a tela leia esse `error` — medi e varias nao liam, e o onboarding chegava a afirmar 'faca login' a quem estava logado. Quem consome este hook e responsavel por ler `error`; o marcador cobre so a metade de cima. #274
    queryFn: () => engineFetch<Whoami>('/api/v1/auth/whoami'),
    staleTime: Infinity,
  });
  return {
    whoami: query.data ?? null,
    loading: query.isLoading,
    error: query.isError || (query.isFetched && query.data === null),
  };
}
