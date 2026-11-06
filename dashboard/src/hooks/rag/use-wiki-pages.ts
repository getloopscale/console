import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

interface OkfMeta {
  type?: string;
  tags?: string[];
  description?: string;
}

export interface WikiPageDetail {
  id: string;
  name: string;
  content: string;
  status: string;
  okf?: OkfMeta;
}

const BASE = '/v1/dashboard/rag/wiki/pages';

const keys = {
  list: (collectionID: string) => ['cloud', BASE, collectionID] as const,
  one: (pageID: string) => ['cloud', BASE, 'one', pageID] as const,
};

/**
 * The wiki pages of one collection.
 *
 * B-244 — `enabled` matters here and is easy to lose in a move: without a collection the URL would
 * carry `collection_id=` and the endpoint would answer for a collection that does not exist.
 */
export function useWikiPages<T>(collectionID: string) {
  return useQuery({
    queryKey: keys.list(collectionID),
    queryFn: () =>
      cloudFetch<{ items: T[] }>(
        `${BASE}?collection_id=${encodeURIComponent(collectionID)}`,
        {},
        { throwOnError: true },
      ),
    enabled: collectionID !== '',
  });
}

export function useInvalidateWikiPages(collectionID: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: keys.list(collectionID) });
  };
}

/**
 * Create a page.
 *
 * B-235 — no error contract on either creation path, and the two failed differently. The folder
 * marker closed its dialog and refreshed the list, so a refused creation looked exactly like a
 * folder that had been created and then filtered out. The page creation read `res?.id`, so a
 * refusal simply did nothing: the modal stayed open with the user's text in it and no explanation,
 * which reads as the button being broken rather than the server saying no.
 */
export function useCreateWikiPage(collectionID: string) {
  return useMutation({
    mutationFn: (page: { name: string; content: string }) =>
      cloudFetch<{ id: string }>(
        BASE,
        {
          method: 'POST',
          body: JSON.stringify({ collection_id: collectionID, ...page }),
        },
        { throwOnError: true },
      ),
  });
}

/**
 * Save a page's content.
 *
 * B-235 — the worst reading of the three. A refused PUT resolved `null`, `onSuccess` fired, the
 * editor closed and the invalidation refetched the page — so the user watched their edit be
 * replaced by the old text, with no error, and no way to tell a rejected save from a save that
 * round-tripped.
 */
export function useSaveWikiPage(pageID: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (page: { name?: string; content: string }) =>
      cloudFetch(
        `${BASE}/${encodeURIComponent(pageID)}`,
        { method: 'PUT', body: JSON.stringify(page) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.one(pageID) });
    },
  });
}

export function useWikiPage(pageID: string) {
  return useQuery({
    queryKey: keys.one(pageID),
    queryFn: () =>
      cloudFetch<WikiPageDetail>(`${BASE}/${encodeURIComponent(pageID)}`, {}, { throwOnError: true }),
    enabled: pageID !== '',
  });
}
