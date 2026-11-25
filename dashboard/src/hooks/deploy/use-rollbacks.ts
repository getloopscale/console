import { useQuery } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import type { RollbackListResponse, RollbackRecord } from '@/lib/api/types';

/** The query key prefix of every project's rollback list, for invalidation. */
export const ROLLBACKS_QUERY_KEY = ['engine', '/api/v1/projects/rollbacks'] as const;

/** How often the list is read again while a rollback is still in progress. */
const IN_PROGRESS_REFETCH_MS = 5_000;

export interface UseRollbacksResult {
  rollbacks: RollbackRecord[];
  loading: boolean;
  /** True when the list could not be read; `rollbacks` is then empty. */
  error: boolean;
}

/**
 * The recorded rollbacks of a project, newest first.
 *
 * A rollback in progress is closed by the API in the background, so the list
 * is read again every few seconds until none is in progress.
 */
export function useRollbacks(projectName: string): UseRollbacksResult {
  const query = useQuery({
    queryKey: [...ROLLBACKS_QUERY_KEY, projectName] as const,
    queryFn: () =>
      engineFetch<RollbackListResponse>(
        `/api/v1/projects/${encodeURIComponent(projectName)}/rollbacks`,
        undefined,
        { throwOnError: true },
      ),
    enabled: Boolean(projectName),
    refetchInterval: (q) =>
      q.state.data?.rollbacks?.some((r) => r.status === 'in_progress') ? IN_PROGRESS_REFETCH_MS : false,
  });
  return {
    rollbacks: query.data?.rollbacks ?? [],
    loading: query.isLoading,
    error: query.isError,
  };
}
