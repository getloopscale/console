import { cloudFetch } from '@/lib/api';

/**
 * Real per-entity cascade forget (#252). The previous implementation ignored
 * the entity and deleted the first GLOBAL page (up to 200 arbitrary memories).
 * Now every round lists ONLY the entity's memories via the provider's
 * `?entity=` filter (memory_entities join, server-side) and forgets them,
 * looping until the filtered listing is empty.
 */

const PAGE = 100;
const FORGET_CONCURRENCY = 5;
/** Hard ceiling: 50 rounds × 100 = 5000 memories — far above any real entity. */
const MAX_ROUNDS = 50;

export interface CascadeScope {
  /** 'user' | 'session' — the active Entities tab. */
  scope: string;
  /** Session instance when scope === 'session'. */
  sessionId?: string;
}

/**
 * Deletes every memory linked to `entityName` under the given scope.
 * Returns the number of memories forgotten. Throws if a round makes no
 * progress (a failing forget must surface, never spin).
 */
export async function cascadeForgetEntity(
  entityName: string,
  { scope, sessionId }: CascadeScope,
): Promise<number> {
  let forgotten = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE));
    params.set('entity', entityName);
    if (scope === 'session' && sessionId) {
      params.set('scope', 'session');
      params.set('session_id', sessionId);
    }
    // Always offset 0 — each round's deletions shrink the filtered set.
    const listResp = await cloudFetch<{ memories: { id: string }[] }>(
      `/v1/dashboard/memory/list?${params.toString()}`,
      {},
      { throwOnError: true },
    );
    const ids = (listResp?.memories ?? []).map((m) => m.id);
    if (ids.length === 0) return forgotten;

    let roundForgotten = 0;
    for (let i = 0; i < ids.length; i += FORGET_CONCURRENCY) {
      const batch = ids.slice(i, i + FORGET_CONCURRENCY);
      const results = await Promise.all(
        batch.map((id) =>
          cloudFetch<null>(`/v1/dashboard/memory/forget/${id}`, { method: 'DELETE' })
            .then(() => true)
            .catch(() => false),
        ),
      );
      roundForgotten += results.filter(Boolean).length;
    }
    forgotten += roundForgotten;
    // Fail LOUD instead of spinning when nothing was deletable this round
    // (e.g. every forget 4xx'd) — silence here would look like success.
    if (roundForgotten === 0) {
      throw new Error(`cascade stalled: ${ids.length} memories listed but none could be forgotten`);
    }
  }
  return forgotten;
}
