import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, MetricCard, PageShell, Skeleton } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/analytics. Read-only observability + cost summary via the BFF
 * (`GET /v1/dashboard/lens/observability` + `/cost`). Thin proxy — theo-lens returns bucketed
 * arrays (traffic / latency / tokensByModel; cost buckets), aggregated here for the KPI tiles.
 * M46 — uses `MetricCard` from `@usetheo/ui` (Rule 9) instead of a hand-rolled card.
 */

interface TrafficBucket {
  traceCount: number;
  errorCount: number;
}
interface LatencyBucket {
  p95Ms: number;
}
interface Observability {
  traffic?: TrafficBucket[];
  latency?: LatencyBucket[];
}
interface CostBucket {
  costUsd: number;
}
interface Cost {
  buckets?: CostBucket[];
}

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

export function LensAnalyticsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Analytics'), [setPageTitle]);
  useRequireAuth();

  const obs = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/observability'] as const,
    queryFn: () => cloudFetch<Observability>('/v1/dashboard/lens/observability'),
  });
  const cost = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/cost'] as const,
    queryFn: () => cloudFetch<Cost>('/v1/dashboard/lens/cost'),
  });

  const traffic = obs.data?.traffic ?? [];
  const traces = sum(traffic.map((t) => t.traceCount));
  const errors = sum(traffic.map((t) => t.errorCount));
  const errorRatePct = traces > 0 ? (errors / traces) * 100 : 0;
  const p95 = Math.round(Math.max(0, ...(obs.data?.latency ?? []).map((l) => l.p95Ms), 0));
  const totalUsd = sum((cost.data?.buckets ?? []).map((b) => b.costUsd));

  return (
    <PageShell title="Analytics" description="Observability and cost for your workspace.">
      <div className="space-y-6">
        {obs.isError || cost.isError ? (
          <Alert intent="warning" title="Could not load analytics">
            The lens service is unavailable. Try again shortly.
          </Alert>
        ) : obs.isLoading || cost.isLoading ? (
          <Skeleton />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard title="Traces" value={String(traces)} />
            <MetricCard title="Error rate" value={`${errorRatePct.toFixed(1)}%`} />
            <MetricCard title="Latency p95" value={`${p95} ms`} />
            <MetricCard title="Cost (USD)" value={`$${totalUsd.toFixed(2)}`} />
          </div>
        )}
      </div>
    </PageShell>
  );
}
