import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch, cloudFetchRaw } from '@/lib/http/api';

export interface RagDocument {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
}

const BASE = '/v1/dashboard/rag/documents';

const documentsQueryKey = (collectionID: string) => ['cloud', BASE, collectionID] as const;

/**
 * The documents of one collection, polled while any of them is still ingesting.
 *
 * B-244 — the poll predicate is the part that must not be lost in a move. looprag ingests
 * asynchronously and answers 202, so without the refetch the list would freeze on `processing`
 * and a document that finished — or failed — would look stuck until the user reloaded the page.
 */
export function useRagDocuments(collectionID: string) {
  return useQuery({
    queryKey: documentsQueryKey(collectionID),
    queryFn: () =>
      cloudFetch<{ items: RagDocument[] }>(
        `${BASE}?collection_id=${encodeURIComponent(collectionID)}`,
        {},
        { throwOnError: true },
      ),
    enabled: collectionID !== '',
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((d) => d.status !== 'ready' && d.status !== 'failed')
        ? 3000
        : false,
  });
}

export function useInvalidateRagDocuments(collectionID: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: documentsQueryKey(collectionID) });
  };
}

/**
 * Ingest a pasted document.
 *
 * B-235 — no error contract. A refused POST resolved `null`, the textarea was cleared and the list
 * refreshed, so the user's text vanished and no document appeared. The obvious reading is that the
 * document was accepted and is still processing — which is exactly what this screen shows for a
 * document that WAS accepted.
 */
export function useIngestDocument(collectionID: string) {
  return useMutation({
    mutationFn: (doc: { text: string; name?: string }) =>
      cloudFetch<{ id: string }>(
        BASE,
        { method: 'POST', body: JSON.stringify({ collection_id: collectionID, ...doc }) },
        { throwOnError: true },
      ),
  });
}

/**
 * Upload a file.
 *
 * Goes through `cloudFetchRaw` so the browser sets the multipart boundary itself — `cloudFetch`
 * would force `application/json`. That is why this one reads the response by hand instead of
 * taking the contract: `throwOnError` is a `cloudFetch` argument, and the raw variant is the whole
 * reason this call exists.
 *
 * The `resp === null` branch is a session expiry that `cloudFetchRaw` has already redirected for;
 * returning is correct there, since the page is on its way to the login screen.
 */
export function useUploadDocumentFile(collectionID: string) {
  return useMutation({
    mutationFn: async (upload: { file: File; mode: string; name?: string }): Promise<void> => {
      const form = new FormData();
      form.append('file', upload.file);
      form.append('collection_id', collectionID);
      form.append('mode', upload.mode);
      if (upload.name) form.append('name', upload.name);

      const resp = await cloudFetchRaw(`${BASE}/file`, { method: 'POST', body: form });
      if (resp === null) return;
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(detail || `upload failed (${resp.status})`);
      }
    },
  });
}

/**
 * Delete a document.
 *
 * B-235 — a refused DELETE resolved `null`, the confirmation closed and the row returned on the
 * next poll. Under a list that refreshes itself every 3 seconds, that reads as the product undoing
 * the deletion rather than as the server refusing it.
 */
export function useDeleteDocument() {
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await cloudFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true });
    },
  });
}
