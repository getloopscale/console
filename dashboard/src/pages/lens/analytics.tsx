import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, PageShell, Skeleton } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/analytics. Read-only observability + cost summary via the BFF
 * (`GET /v1/dashboard/lens/observability` + `/cost`). Thin proxy — theo-lens's shape is
 * rendered as returned.
 */

interface Observability {
  traces?: number;
  errorRate?: number;
}
interface Cost {
  totalUsd?: number;
  total_usd?: number;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <Card.Body>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </Card.Body>
    </Card>
  );
}

export function LensAnalyticsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Lens · Analytics'), [setPageTitle]);
  useRequireAuth();

  const obs = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/observability'] as const,
    queryFn: () => cloudFetch<Observability>('/v1/dashboard/lens/observability'),
  });
  const cost = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/cost'] as const,
    queryFn: () => cloudFetch<Cost>('/v1/dashboard/lens/cost'),
  });

  const totalUsd = cost.data?.totalUsd ?? cost.data?.total_usd ?? 0;

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Traces" value={String(obs.data?.traces ?? 0)} />
            <Metric label="Error rate" value={`${((obs.data?.errorRate ?? 0) * 100).toFixed(1)}%`} />
            <Metric label="Cost (USD)" value={`$${Number(totalUsd).toFixed(2)}`} />
          </div>
        )}
      </div>
    </PageShell>
  );
}
