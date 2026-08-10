import { useQuery } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Project } from '@/lib/api/types';

/**
 * use-project (M16) — fetch a SINGLE project by name via GET /api/v1/projects/{name}
 * (through the cloud BFF `/engine` proxy, same as use-projects).
 *
 * Replaces the previous `useProjects().find(p => p.name === name)` on the project
 * detail page, which searched a client-side list capped at 50 — a tenant with >50
 * projects opening the 51st got a false "Project not found". The engine's single
 * GET resolves by name server-side over the full tenant list (no cap), so the
 * dead-end is gone.
 */
export function useProject(name: string | undefined): {
  project: Project | undefined;
  loading: boolean;
  error: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.projects.detail(name ?? ''),
    // silent-null-ok: ESTE hook mapeia `null` resolvido para o campo `error` que ele devolve (`isError || (isFetched && data === null)`), entao a falha nao se perde AQUI. B-094: isso NAO garante que a tela leia esse `error` — medi e varias nao liam, e o onboarding chegava a afirmar 'faca login' a quem estava logado. Quem consome este hook e responsavel por ler `error`; o marcador cobre so a metade de cima. #274
    queryFn: () => engineFetch<Project>(`/api/v1/projects/${encodeURIComponent(name!)}`),
    enabled: !!name,
  });
  return {
    project: query.data ?? undefined,
    loading: query.isLoading,
    error: query.isError || (query.isFetched && query.data === null),
  };
}
