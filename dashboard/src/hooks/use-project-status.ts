import { useQuery } from '@tanstack/react-query';
import type { ProjectStatusDetail } from '@/lib/api/types';
import { engineFetch, ApiError } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * use-project-status (T1.2): TanStack Query migration with refetchInterval.
 *
 * EC-09 fold: refetchIntervalInBackground: false — pausa polling quando
 * tab está hidden (battery drain em laptops + mobile/PWA).
 */
export interface UseProjectStatusOptions {
  intervalMs?: number;
  env?: string;
  /**
   * Optional gate that overrides `enabled = !!projectName`. Used by
   * project-detail (#115 closure) to call this hook twice — once for
   * the default production view, and once for the sibling preview env
   * — without the second call firing when no sibling exists.
   */
  enabled?: boolean;
}

export function useProjectStatus(
  projectName: string | undefined,
  options: UseProjectStatusOptions = {},
): {
  status: ProjectStatusDetail | null;
  loading: boolean;
  error: boolean;
} {
  // Backend (api/internal/routes/status.go) defaults env to "production"
  // when the query param is absent — clients only need to pass it when
  // querying a non-prod environment (preview, staging).
  const { intervalMs = 5000, env, enabled: enabledOpt } = options;
  const path = env
    ? `/api/v1/projects/${encodeURIComponent(projectName!)}/status?env=${encodeURIComponent(env)}`
    : `/api/v1/projects/${encodeURIComponent(projectName!)}/status`;
  const query = useQuery({
    queryKey: [...queryKeys.projectStatus.detail(projectName), env ?? 'production'],
    // Red Team theo-cloud#96 closure: opt into throwOnError so a 404
    // surfaces as a typed ApiError TanStack Query can inspect — the
    // default `T | null` path makes every non-2xx look like a transient
    // network failure and triggers the default 3-retry policy. A
    // non-existent project will NEVER come back from the dead, so a
    // 404 (and any other 4xx) must short-circuit retry.
    queryFn: () =>
      engineFetch<ProjectStatusDetail>(path, undefined, { throwOnError: true }),
    enabled: !!projectName && (enabledOpt ?? true),
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    // Red Team theo-cloud#96 closure: do not retry on 4xx. They're
    // non-retryable by definition (client-side fault or "project
    // doesn't exist"). 5xx + network errors keep the default retry
    // policy.
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
  });
  return {
    status: query.data ?? null,
    loading: query.isLoading,
    error: query.isError || (query.isFetched && query.data === null),
  };
}
