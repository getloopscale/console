import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useQueryState, parseAsStringEnum } from 'nuqs';
import { RefreshCw, type LucideIcon } from 'lucide-react';
import { Button, Card, PageShell, Select, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { LENS_EXPLORE_CARDS } from '@/components/layout/lens-capabilities';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';
import { formatCost, formatDuration, formatNumber } from '@/lib/formatting/format';
import { TrendChart, type TrendSeries } from '@usetheo/ui';
import {
  throughputSeries,
  errorRateSeries,
  latencySeries,
  costByModelSeries,
  type TrafficBucket,
  type LatencyBucket,
  type ModelBucket,
} from '@/pages/lens/components/lens-series';
import { OverviewKpiStrip, type KpiTile, type OverviewMetric } from '@/pages/lens/components/overview-kpi-strip';
import { costByPeriod, errorRateValues, p95Values, tracesValues } from '@/pages/lens/components/overview-metrics';

/**
 * @overview-answers: kpi
 *
 * B-126, decisão D1 de `capability-overviews-answer-a-question-plan.md` — a forma segue a existência de uma REGRA, não a maioria.
 *
 * Volume de atividade: traces, latência e tokens. Não existe um "deveria" contra o qual julgar
 * 8.400 traces — o número é o dado, e a leitura é de quem opera.
 *
 * O marcador é lido por `lib/capability-overview.test.ts`, que reprova a tela que não
 * declarar nenhuma forma — foi assim que `skills` ficou mudo entre sete telas.
 */

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

const RANGES = ['1h', '24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];
const RANGE_LABEL: Record<Range, string> = { '1h': 'Last hour', '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' };

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

// M60 — the four KPI metrics also key the ONE shared trend chart (click a tile → the chart swaps).
const METRICS = ['throughput', 'errorRate', 'latency', 'cost'] as const;
const METRIC_TITLE: Record<OverviewMetric, string> = {
  throughput: 'Throughput (traces)',
  errorRate: 'Error rate (%)',
  latency: 'Latency (ms)',
  cost: 'Cost by model (USD)',
};
const METRIC_YFMT: Record<OverviewMetric, ((v: number) => string) | undefined> = {
  throughput: undefined,
  errorRate: (v) => `${v}%`,
  latency: (v) => `${v} ms`,
  cost: (v) => `$${v}`,
};
/** The series the shared chart plots for the selected metric — reuses the M51 series helpers (D1). */
function metricToSeries(m: OverviewMetric, obs: ObservabilityResult | undefined): TrendSeries[] {
  switch (m) {
    case 'errorRate':
      return errorRateSeries(obs?.traffic ?? []);
    case 'latency':
      return latencySeries(obs?.latency ?? []);
    case 'cost':
      return costByModelSeries(obs?.tokensByModel ?? []);
    case 'throughput':
    default:
      return throughputSeries(obs?.traffic ?? []);
  }
}

export function LensOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  // M51 — URL-persisted range; drives the server-side bucketing (theo-lens truncs per range).
  const [range, setRange] = useQueryState('range', parseAsStringEnum([...RANGES]).withDefault('24h'));
  // M60 — URL-persisted selected metric: which series the ONE shared trend chart plots (a KPI-tile click swaps it).
  const [selectedMetric, setSelectedMetric] = useQueryState(
    'metric',
    parseAsStringEnum([...METRICS]).withDefault('throughput'),
  );

  const obsKey = ['cloud', '/v1/dashboard/lens/observability', range] as const;
  const obs = useQuery({
    queryKey: obsKey,
    queryFn: () =>
      cloudFetch<ObservabilityResult>(`/v1/dashboard/lens/observability?range=${range}`, {}, { throwOnError: true }),
  });

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/lens/observability'] });
  };

  const isError = obs.isError;
  const isPending = obs.isPending;
  const isFetching = obs.isFetching;

  const traffic = obs.data?.traffic ?? [];
  const latency = obs.data?.latency ?? [];
  const tokensByModel = obs.data?.tokensByModel ?? [];
  const traces = sum(traffic.map((t) => t.traceCount));
  const errors = sum(traffic.map((t) => t.errorCount));
  // A rate (errors/traffic) and a percentile (p95) over an EMPTY window are mathematically undefined
  // → render an em-dash, NOT a fabricated `0%` / `0ms` that falsely implies a perfect-and-quiet tenant.
  // A count/sum (traces, cost) over an empty window is a defined, honest measurement → `0` / `$0.0000`.
  const errorRateValue = traces > 0 ? `${Math.round((errors / traces) * 100)}%` : '—';
  const p95Value = latency.length > 0 ? formatDuration(Math.round(Math.max(0, ...latency.map((l) => l.p95Ms), 0))) : '—';
  // Cost is range-scoped from the SAME observability fetch (`tokensByModel`) as the cost-by-model chart,
  // so the KPI tile and the chart agree on the window (no separate all-time `/cost` fetch).
  const costSeries = costByPeriod(tokensByModel);
  const totalCost = sum(costSeries);

  // M60 — the four KPI tiles: value via M57 formatters; delta from the fetched window via `periodDelta`
  // (invertTrend on the "up is bad" metrics). The tile keys also select which series the shared chart plots.
  const tiles: KpiTile[] = [
    { key: 'throughput', title: 'Traces', value: formatNumber(traces, 'grouped'), series: tracesValues(traffic), agg: 'sum', invert: false },
    { key: 'errorRate', title: 'Error rate %', value: errorRateValue, series: errorRateValues(traffic), agg: 'mean', invert: true },
    { key: 'latency', title: 'Latency p95 (ms)', value: p95Value, series: p95Values(latency), agg: 'mean', invert: true },
    { key: 'cost', title: 'Cost (USD)', value: formatCost(totalCost), series: costSeries, agg: 'sum', invert: true },
  ];

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

        {/* M60 — KPI strip: MetricCard tiles with a period-over-period delta + width-adaptive degradation;
            clicking a tile swaps the ONE shared trend chart below. */}
        {!isPending && !isError ? (
          <OverviewKpiStrip
            tiles={tiles}
            onSelectMetric={(m) => void setSelectedMetric(m)}
            selected={selectedMetric}
          />
        ) : null}

        {/* M60 — ONE shared trend chart (reuses the pure-SVG MetricTrendChart, D1) plotting the selected
            metric; a tile click swaps it — no new fetch (D4). The chart carries its own a11y table + empty-state. */}
        {!isPending && !isError ? (
          <Card>
            <Card.Body>
              <TrendChart
                title={METRIC_TITLE[selectedMetric]}
                series={metricToSeries(selectedMetric, obs.data ?? undefined)}
                valueFormatter={METRIC_YFMT[selectedMetric]}
              />
            </Card.Body>
          </Card>
        ) : null}

        <Card>
          <Card.Body className="space-y-2">
            <h2 className="text-base font-semibold">Getting started</h2>
            <p className="text-sm text-muted-foreground">
              Instrument an agent with the SDK and send OTLP spans to see executions here, then curate
              datasets, score them with evaluators, and monitor the scores.
            </p>
            <Button asChild variant="ghost">
              <Link to="/observability/traces">Browse traces →</Link>
            </Button>
          </Card.Body>
        </Card>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Explore</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* M70 — the Explore grid is generated from the ONE LENS_CAPABILITIES registry (same source
                as the sidebar), so the two product maps can never drift. */}
            {LENS_EXPLORE_CARDS.map((c) => (
              <ExploreCard key={c.path} icon={c.icon} title={c.label} description={c.description} href={c.path} />
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

interface ExploreCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
}

/** Single Explore card — icon + title + 1-line description + a destination link.
 * Uses a router `<Link>` (SPA nav) — not `window.location.href` (which forced a full reload). */
function ExploreCard({ icon: Icon, title, description, href }: ExploreCardProps) {
  return (
    <Card>
      <Card.Body className="space-y-2">
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Button asChild variant="ghost" size="sm">
          <Link to={href}>Open →</Link>
        </Button>
      </Card.Body>
    </Card>
  );
}
