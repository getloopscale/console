import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface QueueItem {
  id: string;
  traceId: string;
  spanId: string;
  status: 'pending' | 'resolved';
  label?: string;
  score?: number;
  note?: string;
  createdBy: string;
  resolvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface QueuePage {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

const BASE = '/v1/dashboard/lens/labeling-queue';

const queueQueryKey = ['cloud', BASE] as const;

export function useLabelingQueue(page: number) {
  return useQuery({
    queryKey: [...queueQueryKey, page] as const,
    queryFn: () => cloudFetch<QueuePage>(`${BASE}?page=${page}`, {}, { throwOnError: true }),
  });
}

function postJson(path: string, payload: unknown): Promise<unknown> {
  return cloudFetch(path, { method: 'POST', body: JSON.stringify(payload) }, { throwOnError: true });
}

/**
 * Resolve one queued item with the annotator's scores.
 *
 * `retry: false` is deliberate and must survive the move: this is a human's judgement being
 * recorded, and re-sending it after a failure could double-count an annotation. The invalidation
 * targets the queue PREFIX so every page refreshes — a resolved item leaving page 1 shifts the
 * items on every page after it.
 */
export function useResolveQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; body: unknown }) =>
      postJson(`${BASE}/${encodeURIComponent(input.id)}/resolve`, input.body),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queueQueryKey });
    },
  });
}

export function useExportQueueAsDataset() {
  return useMutation({
    mutationFn: (name: string) => postJson(`${BASE}/export-as-dataset`, { name }),
    retry: false,
  });
}
