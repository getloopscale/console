import { useInfiniteQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

interface EpisodeItem {
  id: string;
  text: string;
  scope_type: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface EpisodesPage {
  items: EpisodeItem[];
  nextCursor?: string;
}

const EPISODES_PAGE_SIZE = 20;

export interface EpisodeFilters {
  order: string;
  q: string;
  asOf: string;
  session: string;
}

/**
 * The episode log, paginated by cursor.
 *
 * Four filters feed both the query string and the cache key, built here from one argument. On an
 * INFINITE query getting that wrong costs more than on a plain one: pages accumulate under a key,
 * so a filter present in the URL and absent from the key appends the new filter's page to the old
 * filter's list, and the screen shows one continuous log assembled from two different questions.
 *
 * `throwOnError` turns a failure into `query.isError` instead of an empty list. Without it
 * `cloudFetch` resolved `null`, the page's error branch was UNREACHABLE, and the screen said
 * "No episodes yet" — "you have none" when the truth was "I could not ask".
 */
export function useEpisodes(filters: EpisodeFilters) {
  const { order, q, asOf, session } = filters;

  return useInfiniteQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/episodes', { order, q, asOf, session }] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (session) {
        params.set('scope', 'session');
        params.set('session_id', session);
      } else {
        params.set('scope', 'user');
      }
      params.set('limit', String(EPISODES_PAGE_SIZE));
      params.set('order', order);
      if (q) params.set('q', q);
      if (asOf) params.set('asOf', asOf);
      if (pageParam) params.set('after', pageParam);

      return cloudFetch<EpisodesPage>(
        `/v1/dashboard/memory/episodes?${params.toString()}`,
        undefined,
        { throwOnError: true },
      );
    },
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
  });
}
