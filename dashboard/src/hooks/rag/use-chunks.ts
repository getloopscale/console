import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface Chunk {
  id: string;
  index: number;
  text: string;
}

const chunksQueryKey = (documentID: string) =>
  ['cloud', '/v1/dashboard/rag/chunks', documentID] as const;

export function useDocumentChunks(documentID: string) {
  return useQuery({
    queryKey: chunksQueryKey(documentID),
    queryFn: () =>
      cloudFetch<{ items: Chunk[] }>(
        `/v1/dashboard/rag/documents/${encodeURIComponent(documentID)}/chunks`,
        {},
        { throwOnError: true },
      ),
    enabled: documentID !== '',
  });
}

/**
 * Edit a chunk's text, re-embedding it upstream.
 *
 * B-235 — no error contract. A refused PATCH resolved `null`, the editor closed, the draft was
 * cleared and the list refetched the ORIGINAL text. The user watched their correction be replaced
 * by what they had just corrected, with nothing on screen saying why — and the response's
 * `reembedded` flag, the one thing that says whether the edit reached the index, was never
 * consulted because there was no successful response to read it from.
 */
export function useSaveChunk(documentID: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chunk: { id: string; text: string }) =>
      cloudFetch<{ id: string; reembedded: boolean }>(
        `/v1/dashboard/rag/chunks/${encodeURIComponent(chunk.id)}`,
        { method: 'PATCH', body: JSON.stringify({ text: chunk.text }) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chunksQueryKey(documentID) });
    },
  });
}
