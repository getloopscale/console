import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/api';
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
    // silent-null-ok: o consumo deste hook ja trata `null` resolvido como erro (`isError || (isFetched && data === null)`), entao a falha nao vira estado vazio. #274
    queryFn: () => cloudFetch<Project>(`/engine/api/v1/projects/${encodeURIComponent(name!)}`),
    enabled: !!name,
  });
  return {
    project: query.data ?? undefined,
    loading: query.isLoading,
    error: query.isError || (query.isFetched && query.data === null),
  };
}
