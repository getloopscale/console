import { useQuery } from '@tanstack/react-query';
import type { Build } from '@/lib/api/types';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * use-deployment (T1.2): TanStack Query migration. Public signature
 * unchanged: { build, loading, error }.
 */
export function useDeployment(buildId: string | undefined): {
  build: Build | null;
  loading: boolean;
  error: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.builds.detail(buildId ?? ''),
    // silent-null-ok: ESTE hook mapeia `null` resolvido para o campo `error` que ele devolve (`isError || (isFetched && data === null)`), entao a falha nao se perde AQUI. B-094: isso NAO garante que a tela leia esse `error` — medi e varias nao liam, e o onboarding chegava a afirmar 'faca login' a quem estava logado. Quem consome este hook e responsavel por ler `error`; o marcador cobre so a metade de cima. #274
    queryFn: () => engineFetch<Build>(`/api/v1/builds/${encodeURIComponent(buildId!)}`),
    enabled: !!buildId,
  });
  return {
    build: query.data ?? null,
    loading: query.isLoading,
    error: query.isError || (query.isFetched && query.data === null),
  };
}
