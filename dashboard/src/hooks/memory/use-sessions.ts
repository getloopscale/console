import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface SessionRow {
  session_id: string;
  memory_count: number;
  last_activity_at?: string;
}

/**
 * How many sessions the pickers read. A session list is not paginated on screen — it is a picker —
 * so the ceiling is what keeps a workspace with thousands of sessions from stalling the control.
 */
const SESSION_PICKER_LIMIT = 100;

/**
 * The user's memory sessions, for the scope pickers.
 *
 * There is deliberately NO `staleTime` here. B-077 — the `staleTime: 60_000` this read used to
 * carry repeated the global default (`lib/http/query-client.ts`) verbatim, so it declared no policy
 * of its own: the day the default changed, this line would have frozen alone while the comment
 * above it kept claiming an intent it no longer delivered. The default gives the same 60s, and now
 * it moves for everyone at once.
 */
export function useMemorySessions() {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/sessions'] as const,
    queryFn: () =>
      cloudFetch<{ sessions: SessionRow[] }>(
        `/v1/dashboard/memory/sessions?limit=${SESSION_PICKER_LIMIT}`,
        {},
        { throwOnError: true },
      ),
  });
}
