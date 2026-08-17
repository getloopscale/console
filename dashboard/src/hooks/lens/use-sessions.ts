import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * One session row, as the lens session-list DTO returns it.
 *
 * Every aggregate is optional on purpose: the screen renders an honest em-dash when a field is
 * absent rather than a zero, and a zero here would be indistinguishable from "no data" — the same
 * distinction `useCreateMonitor` refuses to blur with a fabricated threshold.
 */
export interface Session {
  sessionId: string;
  traceCount?: number;
  /** M54 — aggregates the lens already returns, so a session is identifiable without opening it. */
  lastSeenAt?: string;
  costUsd?: number;
  totalTokens?: number;
  errorRate?: number;
  firstMessagePreview?: string;
  /** M131 — Arize-parity residual columns: the bookend reply, span-time duration, best-effort user. */
  lastMessagePreview?: string;
  durationMs?: number;
  userId?: string;
}

export interface SessionsResult {
  sessions: Session[];
  /** M81 — server-side pagination envelope. */
  total?: number;
}

export const SESSIONS_PAGE_SIZE = 50;

/**
 * A page of sessions.
 *
 * B-244 — `page` is part of the cache key, and that is the whole reason this was worth moving
 * rather than leaving: without it react-query answers page 3 with page 1's rows while the pager
 * says 3. The page number, the offset and the key all derive from one argument here, so they
 * cannot drift apart the way two hand-maintained copies do.
 */
export function useSessions(page: number) {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/sessions', page] as const,
    queryFn: () =>
      cloudFetch<SessionsResult>(
        `/v1/dashboard/lens/sessions?limit=${String(SESSIONS_PAGE_SIZE)}` +
          `&offset=${String((page - 1) * SESSIONS_PAGE_SIZE)}`,
        {},
        { throwOnError: true },
      ),
  });
}
