import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bot,
  Database,
  DollarSign,
  FlaskConical,
  ListChecks,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { Alert, Button, Card, PageShell, Skeleton, StatTile } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M46 — /lens landing (Overview). The first customer-visible Lens surface, mirroring the Memory /
 * RAG Overview (`pages/memory.tsx` / `pages/rag.tsx`, Rule 9): a KPI strip aggregated from the lens
 * observability + cost summaries + a Getting-started card + an Explore grid to the sub-pages. Every
 * capability section opens on an Overview; Lens now does too.
 */

interface TrafficBucket {
  traceCount: number;
  errorCount: number;
}
interface LatencyBucket {
  p95Ms: number;
}
interface ObservabilityResult {
  traffic: TrafficBucket[];
  latency: LatencyBucket[];
}
interface CostBucket {
  costUsd: number;
}
interface CostResult {
  buckets: CostBucket[];
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

export function LensOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Lens'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const obs = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/observability'] as const,
    queryFn: () => cloudFetch<ObservabilityResult>('/v1/dashboard/lens/observability', {}, { throwOnError: true }),
  });
  const cost = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/cost'] as const,
    queryFn: () => cloudFetch<CostResult>('/v1/dashboard/lens/cost', {}, { throwOnError: true }),
  });

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/observability'] });
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/cost'] });
  };

  const isError = obs.isError || cost.isError;
  const isPending = obs.isPending || cost.isPending;
  const isFetching = obs.isFetching || cost.isFetching;

  const traffic = obs.data?.traffic ?? [];
  const traces = sum(traffic.map((t) => t.traceCount));
  const errors = sum(traffic.map((t) => t.errorCount));
  const errorRatePct = traces > 0 ? Math.round((errors / traces) * 100) : 0;
  const p95 = Math.round(Math.max(0, ...(obs.data?.latency ?? []).map((l) => l.p95Ms), 0));
  const totalCost = sum((cost.data?.buckets ?? []).map((b) => b.costUsd));

  return (
    <PageShell
      title="Lens"
      description="Explore what your AI agents actually did — traces, sessions, evaluations, and cost."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh, loading: isFetching }}
    >
      <div className="space-y-6">
        {isError ? (
          <Alert intent="warning" title="Could not load Lens metrics">
            The lens service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : null}

        {isPending ? (
          <div
            data-testid="lens-metrics-loading"
            role="status"
            aria-label="Loading Lens metrics"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        {!isPending && !isError ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile value={traces} label="Traces (24h)" icon={Network} />
            <StatTile value={errorRatePct} label="Error rate %" icon={Activity} />
            <StatTile value={p95} label="Latency p95 (ms)" icon={Timer} />
            <StatTile value={Number(totalCost.toFixed(2))} label="Cost (USD)" icon={DollarSign} />
          </div>
        ) : null}

        <Card>
          <Card.Body className="space-y-2">
            <h2 className="text-base font-semibold">Getting started</h2>
            <p className="text-sm text-muted-foreground">
              Instrument an agent with the SDK and send OTLP spans to see executions here, then curate
              datasets, score them with evaluators, and gate on guards.
            </p>
            <Button variant="ghost" onClick={() => (window.location.href = '/lens/traces')}>
              Browse traces →
            </Button>
          </Card.Body>
        </Card>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Explore</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ExploreCard icon={Network} title="Traces" description="Explore executions and manage their tags & annotations." href="/lens/traces" />
            <ExploreCard icon={ListChecks} title="Sessions" description="Replay grouped executions." href="/lens/sessions" />
            <ExploreCard icon={Database} title="Datasets" description="Curate trace datasets for evaluation." href="/lens/datasets" />
            <ExploreCard icon={FlaskConical} title="Evaluators" description="Score traces with rule or LLM-judge evaluators." href="/lens/evaluators" />
            <ExploreCard icon={ShieldCheck} title="Guards" description="Gate traces on evaluator thresholds." href="/lens/guards" />
            <ExploreCard icon={Bot} title="Agents" description="The derived catalog of instrumented agents." href="/lens/agents" />
            <ExploreCard icon={Search} title="Ask" description="Ask the copilot about a trace." href="/lens/ask" />
            <ExploreCard icon={Activity} title="Analytics" description="Observability and cost for this workspace." href="/lens/analytics" />
          </div>
        </section>
      </div>
    </PageShell>
  );
}

interface ExploreCardProps {
  icon: typeof Network;
  title: string;
  description: string;
  href: string;
}

/** Single Explore card — icon + title + 1-line description + a destination button.
 * Kept inline (mirrors `pages/rag.tsx`'s ExploreCard — Rule of 3 / YAGNI). */
function ExploreCard({ icon: Icon, title, description, href }: ExploreCardProps) {
  return (
    <Card>
      <Card.Body className="space-y-2">
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Button variant="ghost" size="sm" onClick={() => (window.location.href = href)}>
          Open →
        </Button>
      </Card.Body>
    </Card>
  );
}
