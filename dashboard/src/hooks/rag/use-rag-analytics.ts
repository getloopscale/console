import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface ScaleObservability {
  collection_id: string;
  corpus: { documents: number; chunks: number; size_bytes: number };
  communities: { total: number; max_level: number; per_level: Record<string, number> };
  extraction: { tokens: number };
}

export interface RagAnalytics {
  window: { since: string };
  totals: { retrievals: number; answers: number; empty_retrieval_rate: number };
  latency: { p50_ms: number; p95_ms: number };
  confidence: { high: number; medium: number; low: number };
  /** looprag rc.80+ attaches this block only when the request carries `collection_id`. */
  scale?: ScaleObservability;
}

const analyticsQueryKey = ['cloud', '/v1/dashboard/rag/analytics'] as const;

/**
 * The RAG M5 summary, optionally scoped to one collection.
 *
 * B-244 — two screens read this endpoint and each declared its own copy of the response. The copies
 * had already drifted: `analytics` knew about the `scale` block, `overview` did not, so the field
 * that looprag rc.80+ returns was invisible to one of its two readers.
 *
 * They had also drifted on the CACHE KEY, and that one costs a request on every visit. `overview`
 * keyed on `['cloud', path]` while `analytics` keyed on `['cloud', path, collectionID]` with an
 * empty id when unfiltered — so the same unfiltered response was fetched and stored twice, under
 * two keys, and Refresh on one screen left the other stale. The key is built here now, from the
 * same argument that builds the URL.
 *
 * `throwOnError` was on `overview` and missing on `analytics`. Adding it is behaviour-preserving:
 * that page already routes `data == null` to its error branch, so a refusal reached the right
 * screen by accident rather than by contract. Now it reaches it because it was asked to.
 */
export function useRagAnalytics(collectionID = '') {
  return useQuery({
    queryKey: [...analyticsQueryKey, collectionID] as const,
    queryFn: () =>
      cloudFetch<RagAnalytics>(
        collectionID
          ? `/v1/dashboard/rag/analytics?collection_id=${encodeURIComponent(collectionID)}`
          : '/v1/dashboard/rag/analytics',
        {},
        { throwOnError: true },
      ),
  });
}

/**
 * The Refresh button's action.
 *
 * Invalidates by prefix, so every collection's slice refreshes rather than only the one currently
 * on screen. A caller repeating the key tuple by hand is a caller that can get it wrong — which is
 * exactly how the two keys above came to disagree.
 */
export function useRefreshRagAnalytics() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: analyticsQueryKey });
  };
}
