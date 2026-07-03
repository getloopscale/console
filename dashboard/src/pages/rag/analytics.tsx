import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, MetricCard, PageShell, Skeleton } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M21 — /rag/analytics. Read-only usage/cost/latency for the caller's workspace,
 * via the dashboard BFF `GET /v1/dashboard/rag/analytics` (the theo-rag M5 summary).
 * Mirrors the memory dashboard's read-only metric pages.
 */

interface AnalyticsResult {
  window: { since: string };
  totals: { retrievals: number; answers: number; empty_retrieval_rate: number };
  latency: { p50_ms: number; p95_ms: number };
  confidence: { high: number; medium: number; low: number };
}

export function RagAnalyticsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Analytics'), [setPageTitle]);
  useRequireAuth();

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/analytics'] as const,
    queryFn: () => cloudFetch<AnalyticsResult>('/v1/dashboard/rag/analytics'),
  });

  return (
    <PageShell title="Analytics" description="Retrieval + answer usage for this workspace.">
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError || query.data == null ? (
        <Alert intent="warning" title="Could not load analytics">
          The RAG analytics service is unavailable. Try again shortly.
        </Alert>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard title="Retrievals" value={String(query.data.totals.retrievals)} />
          <MetricCard title="Answers" value={String(query.data.totals.answers)} />
          <MetricCard
            title="Empty-retrieval rate"
            value={`${Math.round(query.data.totals.empty_retrieval_rate * 100)}%`}
          />
          <MetricCard title="Latency p50" value={`${Math.round(query.data.latency.p50_ms)} ms`} />
          <MetricCard title="Latency p95" value={`${Math.round(query.data.latency.p95_ms)} ms`} />
          <MetricCard
            title="Answer confidence (H/M/L)"
            value={`${query.data.confidence.high}/${query.data.confidence.medium}/${query.data.confidence.low}`}
          />
        </div>
      )}
    </PageShell>
  );
}
