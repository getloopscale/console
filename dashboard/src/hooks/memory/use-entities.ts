import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface Entity {
  id: string;
  scope_type: string;
  memory_count: number;
  last_seen_at?: string;
  /**
   * M2 — on-demand evolving summary: a digest of the entity's currently-active outgoing relations
   * (`relation → target`). Empty string when it has none.
   */
  summary?: string;
}

export interface EntitiesResult {
  entities: Entity[];
}

export const ENTITIES_PAGE_SIZE = 25;

const entitiesQueryKey = ['cloud', '/v1/dashboard/memory/entities'] as const;
const memoriesListQueryKey = ['cloud', '/v1/dashboard/memory/list'] as const;

export interface EntityFilters {
  scope: string;
  session: string;
  offset: number;
  q: string;
}

/**
 * A filtered page of entities.
 *
 * B-244 — four filters feed both the query string and the cache key, built side by side in the
 * page. Same shape as the memories list next door, and the same failure if one is added to the URL
 * and forgotten in the key: results from another filter under this filter's labels.
 *
 * `throwOnError` carries the page's reason: without it a failed fetch resolves to an empty list and
 * renders as "no entities" (theo-cloud#250).
 */
export function useEntities(filters: EntityFilters) {
  const { scope, session, offset, q } = filters;

  return useQuery({
    queryKey: [...entitiesQueryKey, { activeScope: scope, session, offset, q }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('scope', scope);
      params.set('limit', String(ENTITIES_PAGE_SIZE));
      if (offset > 0) params.set('offset', String(offset));
      if (scope === 'session' && session) params.set('session_id', session);
      if (q.trim()) params.set('q', q.trim());

      return cloudFetch<EntitiesResult>(
        `/v1/dashboard/memory/entities?${params.toString()}`,
        {},
        { throwOnError: true },
      );
    },
  });
}

/**
 * Cascade-forget an entity (#252).
 *
 * The cascade itself lives in `pages/memory/entity-cascade.ts` and is passed in: it is a loop with
 * a fail-closed echo guard and a round ceiling, which is logic rather than transport, and moving it
 * here would drag that reasoning away from the tests that cover it.
 *
 * What belongs here is the invalidation, and BOTH keys matter. Forgetting an entity's memories
 * changes the entities list AND the memories list; refreshing only the first leaves the second
 * showing rows that no longer exist, which is the same "screen states something that is not true"
 * this whole item is about.
 */
export function useCascadeForgetEntity(cascade: (entity: Entity) => Promise<number>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cascade,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entitiesQueryKey });
      void queryClient.invalidateQueries({ queryKey: memoriesListQueryKey });
    },
  });
}
