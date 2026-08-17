import { useMutation } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

interface Source {
  document_id?: string;
  chunk_id?: string;
  score?: number;
}

export interface AnswerResult {
  answer: string;
  sources?: Source[];
  confidence?: string;
  /**
   * M9 — theo-rag may echo the strategy that actually answered plus a router trace (e.g. graph or
   * global fell back to vector). Surfaced when present — never fabricated.
   */
  strategy?: string;
  router?: { strategy?: string; fell_back?: boolean; reason?: string };
}

/**
 * Ask a question against a collection.
 *
 * Two screens make this exact request — the Ask page and the GraphRAG explorer — and each declared
 * its own `AnswerResult`. The copies had already lost the same field: neither had the contract, so
 * a refused ask resolved `null` and both screens simply showed no answer, which on a page whose
 * whole job is answering reads as "the model had nothing to say".
 *
 * The strategy is omitted for `vector` so the default request stays byte-identical to the pre-M9
 * shape; anything else is sent through, and `graph` / `global` reach GraphRAG upstream (which
 * fails closed to vector when the collection has no graph).
 */
export function useAskQuestion() {
  return useMutation({
    mutationFn: (input: { collectionID: string; question: string; strategy: string }) =>
      cloudFetch<AnswerResult>(
        '/v1/dashboard/rag/answers',
        {
          method: 'POST',
          body: JSON.stringify({
            collection_id: input.collectionID,
            question: input.question,
            ...(input.strategy !== 'vector' ? { strategy: input.strategy } : {}),
          }),
        },
        { throwOnError: true },
      ),
  });
}
