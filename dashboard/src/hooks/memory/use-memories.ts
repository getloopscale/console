import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface MemoryRow {
  id: string;
  content: string;
  category?: string;
  created_at?: string;
  /** Session-separation (2026-07-23): non-empty marks a SESSION-tier row. */
  session_id?: string;
}

export interface MemoryListResult {
  memories: MemoryRow[];
  next_offset?: number;
  total?: number;
}

export const MEMORIES_PAGE_SIZE = 25;

const memoriesQueryKey = ['cloud', '/v1/dashboard/memory/list'] as const;

export interface MemoryFilters {
  category: string;
  from: string;
  to: string;
  offset: number;
  session: string;
}

/**
 * A filtered page of memories.
 *
 * B-244 — every filter is part of BOTH the query string and the cache key, and the page built the
 * two side by side. That is five values kept in step by hand; the first one added to the URL and
 * forgotten in the key makes the list show another filter's results under this filter's labels.
 *
 * The date widening is the endpoint's rule, not the form's: `<input type="date">` yields
 * `YYYY-MM-DD` and the provider's `from`/`to` expect RFC3339 datetimes (ADR D3), so a day is
 * widened to its full inclusive range. A screen that sent the bare date would silently exclude
 * everything recorded after midnight on the `to` day.
 *
 * `throwOnError` carries the page's own reason, which is worth keeping verbatim: without it a
 * failed fetch resolves `null` and this page renders it identically to an empty list — the exact
 * "No memories yet on a 404/502" defect recorded as theo-cloud#250.
 */
export function useMemories(filters: MemoryFilters) {
  const { category, from, to, offset, session } = filters;

  return useQuery({
    queryKey: [...memoriesQueryKey, { category, from, to, offset, session }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('limit', String(MEMORIES_PAGE_SIZE));
      if (offset > 0) params.set('offset', String(offset));
      if (category) params.set('category', category);
      if (session) {
        params.set('scope', 'session');
        params.set('session_id', session);
      }
      if (from) params.set('from', `${from}T00:00:00Z`);
      if (to) params.set('to', `${to}T23:59:59Z`);

      return cloudFetch<MemoryListResult>(
        `/v1/dashboard/memory/list?${params.toString()}`,
        {},
        { throwOnError: true },
      );
    },
  });
}

/**
 * Forget one memory.
 *
 * B-235 — no error contract. A refused DELETE resolved `null`, `onSuccess` fired, the confirmation
 * closed and the row came back on the next read. For a `hard` delete the reading is worse than
 * "the product undid my action": the user asked for permanent erasure, was shown success, and the
 * content is still there.
 */
export function useForgetMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { id: string; hard: boolean }): Promise<void> => {
      await cloudFetch(
        `/v1/dashboard/memory/forget/${encodeURIComponent(vars.id)}${vars.hard ? '?hard=true' : ''}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoriesQueryKey });
    },
  });
}
