import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsStringEnum } from 'nuqs';
import {
  Activity,
  BellRing,
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
import { Alert, Button, Card, PageShell, Select, Skeleton, StatTile } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import { MetricTrendChart } from '@/components/lens/metric-trend-chart';
import {
  throughputSeries,
  errorRateSeries,
  latencySeries,
  costByModelSeries,
  type TrafficBucket,
  type LatencyBucket,
  type ModelBucket,
} from '@/components/lens/lens-series';

/**
 * M46 — /lens landing (Overview). The first customer-visible Lens surface, mirroring the Memory /
 * RAG Overview (`pages/memory.tsx` / `pages/rag.tsx`, Rule 9): a KPI strip aggregated from the lens
 * observability + cost summaries + a Getting-started card + an Explore grid to the sub-pages. Every
 * capability section opens on an Overview; Lens now does too.
 */

// The full observability time-series (already bucketed server-side by theo-lens; M51 plots it — the
// KPI tiles reduce it to current values). `tokensByModel` carries the by-model cost breakdown.
interface ObservabilityResult {
  range?: string;
  traffic: TrafficBucket[];
  latency: LatencyBucket[];
  tokensByModel: ModelBucket[];
}
interface CostBucket {
  costUsd: number;
}
interface CostResult {
  buckets: CostBucket[];
}

const RANGES = ['1h', '24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];
const RANGE_LABEL: Record<Range, string> = { '1h': 'Last hour', '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' };

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

export function LensOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  // M51 — URL-persisted range; drives the server-side bucketing (theo-lens truncs per range).
  const [range, setRange] = useQueryState('range', parseAsStringEnum([...RANGES]).withDefault('24h'));

  const obsKey = ['cloud', '/v1/dashboard/lens/observability', range] as const;
  const obs = useQuery({
    queryKey: obsKey,
    queryFn: () =>
      cloudFetch<ObservabilityResult>(`/v1/dashboard/lens/observability?range=${range}`, {}, { throwOnError: true }),
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

  // M51 — trend-chart series from the already-bucketed observability response.
  const throughput = throughputSeries(traffic);
  const errRate = errorRateSeries(traffic);
  const latency = latencySeries(obs.data?.latency ?? []);
  const costByModel = costByModelSeries(obs.data?.tokensByModel ?? []);

  return (
    <PageShell
      title="Observability"
      description="Explore what your AI agents actually did — traces, sessions, evaluations, and cost."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh, loading: isFetching }}
    >
      <div className="space-y-6">
        {isError ? (
          <Alert intent="warning" title="Could not load Observability metrics">
            The lens service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : null}

        {isPending ? (
          <div
            data-testid="lens-metrics-loading"
            role="status"
            aria-label="Loading Observability metrics"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Metrics</h2>
          <div>
            <span className="sr-only" id="range-label">
              Time range
            </span>
            <Select value={range} onValueChange={(v) => void setRange(v as Range)}>
              <Select.Trigger className="w-[150px]" aria-label="Time range">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {RANGES.map((r) => (
                  <Select.Item key={r} value={r}>
                    {RANGE_LABEL[r]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>

        {!isPending && !isError ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile value={traces} label="Traces" icon={Network} />
            <StatTile value={errorRatePct} label="Error rate %" icon={Activity} />
            <StatTile value={p95} label="Latency p95 (ms)" icon={Timer} />
            <StatTile value={Number(totalCost.toFixed(2))} label="Cost (USD)" icon={DollarSign} />
          </div>
        ) : null}

        {!isPending && !isError ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <Card.Body>
                <MetricTrendChart title="Throughput (traces)" series={throughput} />
              </Card.Body>
            </Card>
            <Card>
              <Card.Body>
                <MetricTrendChart title="Error rate (%)" series={errRate} yFormat={(v) => `${v}%`} />
              </Card.Body>
            </Card>
            <Card>
              <Card.Body>
                <MetricTrendChart title="Latency (ms)" series={latency} yFormat={(v) => `${v} ms`} />
              </Card.Body>
            </Card>
            <Card>
              <Card.Body>
                <MetricTrendChart title="Cost by model (USD)" series={costByModel} yFormat={(v) => `$${v}`} />
              </Card.Body>
            </Card>
          </div>
        ) : null}

        <Card>
          <Card.Body className="space-y-2">
            <h2 className="text-base font-semibold">Getting started</h2>
            <p className="text-sm text-muted-foreground">
              Instrument an agent with the SDK and send OTLP spans to see executions here, then curate
              datasets, score them with evaluators, and gate on guards.
            </p>
            <Button variant="ghost" onClick={() => (window.location.href = '/observability/traces')}>
              Browse traces →
            </Button>
          </Card.Body>
        </Card>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Explore</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ExploreCard icon={Network} title="Traces" description="Explore executions and manage their tags & annotations." href="/observability/traces" />
            <ExploreCard icon={ListChecks} title="Sessions" description="Replay grouped executions." href="/observability/sessions" />
            <ExploreCard icon={Database} title="Datasets" description="Curate trace datasets for evaluation." href="/observability/datasets" />
            <ExploreCard icon={FlaskConical} title="Evaluators" description="Score traces with rule or LLM-judge evaluators." href="/observability/evaluators" />
            <ExploreCard icon={ShieldCheck} title="Guards" description="Gate traces on evaluator thresholds." href="/observability/guards" />
            <ExploreCard icon={BellRing} title="Alerts" description="Get notified when a metric crosses a threshold." href="/observability/alerts" />
            <ExploreCard icon={Bot} title="Agents" description="The derived catalog of instrumented agents." href="/observability/agents" />
            <ExploreCard icon={Search} title="Ask" description="Ask the copilot about a trace." href="/observability/ask" />
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
