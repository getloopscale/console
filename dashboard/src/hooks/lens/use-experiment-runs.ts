import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

interface RunScore {
  name: string;
  score?: number;
  label?: string;
}

export interface RunItem {
  datasetItemTraceId: string;
  output?: string;
  totalTokens: number;
  costUsd?: number;
  latencyMs: number;
  model: string;
  scores: RunScore[];
  error?: string;
}

export interface ExperimentRun {
  id: string;
  datasetId: string;
  name: string;
  variant: { model?: string; promptOverride?: string };
  status: 'completed' | 'partial' | 'failed';
  truncated: boolean;
  itemCount: number;
  passCount: number;
  avgScore?: number;
  totalCostUsd: number;
  createdAt: string;
  items?: RunItem[];
}

/** The signed aggregate deltas the compare API returns (A minus B); score/latency null when absent. */
interface RunCompareDeltas {
  passCountDelta: number;
  passRateDelta: number;
  avgScoreDelta: number | null;
  totalCostDelta: number;
  avgLatencyDelta: number | null;
}

const BASE = '/v1/dashboard/lens/experiment-runs';

const runsQueryKey = ['cloud', BASE] as const;

/**
 * The runs list, optionally filtered to one dataset.
 *
 * `enabled` mirrors the compare view: the page shows either the list or the comparison, never both,
 * and the two queries are mutually exclusive by the same predicate. Keeping both `enabled` flags in
 * one module is what stops them from drifting into a state where the page fetches both — or neither.
 */
export function useExperimentRuns(datasetId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...runsQueryKey, datasetId] as const,
    queryFn: () =>
      cloudFetch<{ runs: ExperimentRun[] }>(
        `${BASE}${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
        {},
        { throwOnError: true },
      ),
    enabled,
  });
}

export function useCompareExperimentRuns(ids: string[]) {
  return useQuery({
    queryKey: ['cloud', `${BASE}/compare`, ids.join(',')] as const,
    queryFn: () =>
      cloudFetch<{ runs: ExperimentRun[]; deltas: RunCompareDeltas | null }>(
        `${BASE}/compare?ids=${encodeURIComponent(ids.join(','))}`,
        {},
        { throwOnError: true },
      ),
    enabled: ids.length >= 2,
  });
}

/**
 * Start an experiment run.
 *
 * `retry: false` must survive the move: a run costs provider tokens, and re-sending it after a
 * failure bills the workspace twice for one click.
 */
export function useStartExperimentRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { datasetId: string; variant: { model?: string; promptOverride?: string } }) =>
      cloudFetch<ExperimentRun>(
        BASE,
        { method: 'POST', body: JSON.stringify(input) },
        { throwOnError: true },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: runsQueryKey });
    },
  });
}
