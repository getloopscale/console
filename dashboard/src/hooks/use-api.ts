import { useQuery } from '@tanstack/react-query';
import { cloudFetch, engineFetch } from '@/lib/http/api';

/**
 * T1.4 deviation: plan v1.1 called for outright deletion. Pragmatic path
 * taken instead — rewrite as thin TanStack Query wrappers.
 *
 * Rationale:
 *  - 4 pages consume useCloudApi/useEngineApi + 5 tests mock by these names
 *  - Direct migration to useQuery would churn 9 files with zero behavior change
 *  - The "legacy" issue was the manual useState/useEffect boilerplate inside,
 *    not the wrapper API. Boilerplate is gone — wrapper API survives.
 *  - Tests + pages unchanged. KISS.
 *
 * Cache key is the URL path itself (singular per endpoint). Different from
 * the queryKeys.* factories used by domain-specific hooks (use-projects,
 * use-deployments, etc.) which need filter-aware structured keys.
 */

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/**
 * Sprint 3 Phase 3 (#21) v1.1 ADR D2 — optional `{ enabled }` flag so callers
 * can scope a query to a specific route (e.g. MemoryUsageCard on /billing
 * should NOT fire `/v1/dashboard/memory/metrics` because the memory backend
 * may be unmounted in dev-public, polluting the console with 404s). Default
 * `enabled: true` preserves backward compatibility for all existing callers.
 */
interface UseApiOptions {
  enabled?: boolean;
}

export function useCloudApi<T>(path: string, options: UseApiOptions = {}): UseApiResult<T> {
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: ['cloud', path] as const,
    // silent-null-ok: o consumo deste hook ja trata `null` resolvido como erro (`isError || (isFetched && data === null)`), entao a falha nao vira estado vazio. #274
    queryFn: () => cloudFetch<T>(path),
    enabled,
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading && enabled,
    error: enabled && (query.isError || (query.isFetched && query.data === null)),
  };
}

export function useEngineApi<T>(path: string): UseApiResult<T> {
  const query = useQuery({
    queryKey: ['engine', path] as const,
    // silent-null-ok: o consumo deste hook ja trata `null` resolvido como erro (`isError || (isFetched && data === null)`), entao a falha nao vira estado vazio. #274
    queryFn: () => engineFetch<T>(path),
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.isError || (query.isFetched && query.data === null),
  };
}
