// T1.1: TanStack Query singleton — server state library.
// Substitui 7 hooks domain-specific (use-projects, use-deployments, etc.) +
// manual TTL cache em use-projects.ts. Cache + dedup + refetch on focus
// out-of-the-box.
//
// Defaults per ADR D2 (plan v1.1):
//   - staleTime 60s — matches existing use-projects.ts TTL
//   - gcTime 5min — cache survives 5min after last consumer unmounts
//   - refetchOnWindowFocus — FAANG default (tab switch = re-validate)
//   - retry 1 com exponential backoff
//   - mutations: retry 0 (never auto-retry user actions)

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/**
 * Red Team theo-cloud#93 absorption (2026-06-27): retry guard.
 *
 * The previous `retry: 1` blanket retried EVERYTHING — including 4xx
 * client errors like 404 (project not found) and 403 (forbidden), which
 * won't recover on retry and waste a network round-trip + delay the
 * not-found render the user is waiting for.
 *
 * FAANG default: retry only on transient failures (5xx + network). On
 * any 4xx ApiError (the typed error from `cloudFetch({throwOnError})`),
 * return false to surface the error immediately. Mirrors TanStack's own
 * docs recommendation.
 */
function retryGuard(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
  }
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: retryGuard,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 30_000),
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Invalidate all queries whose key starts with the given prefix. */
export function invalidate(prefix: readonly unknown[]): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: prefix });
}
