import type { PercentileBucket, TrendSeries } from '@usetheo/ui';
import {
  throughputSeries,
  errorRateSeries,
  latencyPercentileBuckets,
  costByModelSeries,
  tokensByModelSeries,
  type TrafficBucket,
  type LatencyBucket,
  type ModelBucket,
} from '@/components/lens/lens-series';
import { formatNumber, formatDuration, formatCost } from '@/lib/format';

/**
 * M66 — the pure widget model for custom dashboards. A board is an ordered list of widgets; each
 * widget's `type` (kpi/trend/topn) IS its query (D2), bound to one of the existing M51/M60 series.
 * Every function here is pure + synchronous (no I/O, no React) so the board's behavior is provable
 * without rendering; the React page (dashboards.tsx) consumes these. Binding reads the ONE shared
 * observability + cost fetch — no per-widget fetch (the fan-out fix, R5). Client-side validation
 * mirrors the Go boundary validation (`lens_dashboards.go validateDashboardConfig`) so a malformed
 * board is blocked before the PUT.
 */

export const WIDGET_TYPES = ['kpi', 'trend', 'topn'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_METRICS = ['traces', 'error_rate', 'p95_latency', 'cost', 'tokens_by_model'] as const;
export type WidgetMetric = (typeof WIDGET_METRICS)[number];

export const MAX_WIDGETS = 24;
const TITLE_MAX = 64;
const NAME_MAX = 64;

export interface Widget {
  type: WidgetType;
  metric: WidgetMetric;
  title?: string;
}

/** The observability + cost data the board fetches ONCE and every widget binds against. */
export interface BoardData {
  observability?: { traffic: TrafficBucket[]; latency: LatencyBucket[]; tokensByModel: ModelBucket[] };
}

export const METRIC_LABEL: Record<WidgetMetric, string> = {
  traces: 'Traces',
  error_rate: 'Error rate (%)',
  p95_latency: 'Latency p95 (ms)',
  cost: 'Cost (USD)',
  tokens_by_model: 'Tokens by model',
};

export const WIDGET_TYPE_LABEL: Record<WidgetType, string> = {
  kpi: 'KPI tile',
  trend: 'Trend chart',
  topn: 'Top-N table',
};

/** The code-defined "Tracing Overview" starter template (D3) — rendered when a workspace has no board. */
export const TRACING_OVERVIEW_TEMPLATE: Widget[] = [
  { type: 'kpi', metric: 'traces', title: 'Traces' },
  { type: 'kpi', metric: 'error_rate', title: 'Error rate' },
  { type: 'kpi', metric: 'p95_latency', title: 'Latency p95' },
  { type: 'kpi', metric: 'cost', title: 'Cost' },
  { type: 'trend', metric: 'traces', title: 'Traffic over time' },
  { type: 'topn', metric: 'tokens_by_model', title: 'Top models by cost' },
];

const isWidgetType = (t: unknown): t is WidgetType => typeof t === 'string' && (WIDGET_TYPES as readonly string[]).includes(t);
const isWidgetMetric = (m: unknown): m is WidgetMetric => typeof m === 'string' && (WIDGET_METRICS as readonly string[]).includes(m);

/**
 * Validate a board name + widget list at the client boundary (mirrors the Go `validateDashboardConfig`).
 * Returns an error message on the first violation, or null when valid.
 */
export function validateConfig(name: string, widgets: Widget[]): string | null {
  if (!name.trim()) return 'A dashboard name is required.';
  if (name.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`;
  if (widgets.length === 0) return 'Add at least one widget.';
  if (widgets.length > MAX_WIDGETS) return `A board may contain at most ${MAX_WIDGETS} widgets.`;
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i];
    if (!isWidgetType(w.type)) return `Widget ${i + 1}: unknown type.`;
    if (!isWidgetMetric(w.metric)) return `Widget ${i + 1}: unknown metric.`;
    if (w.title !== undefined && w.title.length > TITLE_MAX) return `Widget ${i + 1}: title too long.`;
  }
  return null;
}

// ── Pure ordered-list ops (D4 — no drag-grid) ────────────────────────────────

export function addWidget(widgets: Widget[], w: Widget): Widget[] {
  return [...widgets, w];
}

export function removeWidget(widgets: Widget[], index: number): Widget[] {
  if (index < 0 || index >= widgets.length) return widgets;
  return widgets.filter((_, i) => i !== index);
}

/** Move a widget one slot up (dir=-1) or down (dir=+1); a no-op at the bounds. */
export function moveWidget(widgets: Widget[], index: number, dir: -1 | 1): Widget[] {
  const target = index + dir;
  if (index < 0 || index >= widgets.length || target < 0 || target >= widgets.length) return widgets;
  const next = [...widgets];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── Binding: derive each widget's render input from the ONE shared fetch (never fabricate) ────────

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

/**
 * A KPI's display value for the shared board data. HONESTY (never a fabricated number):
 * - data fully absent (fetch failed / not loaded) → em-dash `—`.
 * - a **rate / percentile** over an EMPTY series (`error_rate`, `p95_latency`) is mathematically
 *   *undefined*, so it is `—` too — NOT `0%` / `0ms` (which would falsely imply "perfect").
 * - a **count / sum** (`traces`, `cost`, `tokens_by_model`) over an empty range is a defined,
 *   honest measurement, so `0` / `$0.0000` is shown (matches the M60 Overview).
 */
export function bindKpi(metric: WidgetMetric, data: BoardData): string {
  const obs = data.observability;
  if (!obs) return '—';
  const traffic = obs.traffic;
  switch (metric) {
    case 'cost':
      // Range-scoped from the SAME observability fetch as the cost trend/topn (#dashboards window
      // mismatch): a board's cost KPI and cost trend must agree on the window. `/analytics/cost` is
      // all-time (no window param), so sourcing it here would disagree with the range-scoped chart.
      return formatCost(sum(obs.tokensByModel.map((b) => b.costUsd))); // sum: $0.0000 is an honest "no spend"
    case 'traces':
      return formatNumber(sum(traffic.map((t) => t.traceCount)), 'grouped'); // count: 0 is an honest measurement
    case 'error_rate': {
      const traces = sum(traffic.map((t) => t.traceCount));
      // A rate over zero traffic is undefined — em-dash whether the window is empty OR present but
      // quiet (buckets exist but no traces). NEVER a fabricated 0% (matches the M60 Overview).
      if (traces === 0) return '—';
      const errors = sum(traffic.map((t) => t.errorCount));
      return `${Math.round((errors / traces) * 100)}%`;
    }
    case 'p95_latency':
      if (obs.latency.length === 0) return '—'; // a percentile over no data is undefined, not 0ms
      return formatDuration(Math.round(Math.max(0, ...obs.latency.map((l) => l.p95Ms), 0)));
    case 'tokens_by_model':
      return formatNumber(sum(obs.tokensByModel.map((m) => m.totalTokens)), 'grouped'); // sum: 0 is honest
    default:
      return '—';
  }
}

/**
 * The trend series for a metric (reuses the M51 helpers); absent obs → empty (no fabricated line).
 * NOTE (M11): `p95_latency` is NOT a `TrendSeries` metric — it renders as a banded `PercentileChart`
 * (see `bindLatencyBuckets`), so it is intentionally absent from this switch (it falls to `traces`
 * only if mis-routed; the page special-cases it before ever calling this).
 */
export function bindTrend(metric: WidgetMetric, data: BoardData): TrendSeries[] {
  const obs = data.observability;
  if (!obs) return [];
  switch (metric) {
    case 'error_rate':
      return errorRateSeries(obs.traffic);
    case 'cost':
      return costByModelSeries(obs.tokensByModel);
    case 'tokens_by_model':
      return tokensByModelSeries(obs.tokensByModel);
    case 'traces':
    default:
      return throughputSeries(obs.traffic);
  }
}

/**
 * M11 — the p50/p95/p99 latency BAND for the `p95_latency` trend widget (the upgrade over the old
 * three-line overlay). Absent obs → empty; the `PercentileChart` owns the empty state.
 */
export function bindLatencyBuckets(data: BoardData): PercentileBucket[] {
  const obs = data.observability;
  if (!obs) return [];
  return latencyPercentileBuckets(obs.latency);
}

export interface TopNRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}

/** Top-N models by total cost from the shared tokensByModel rows; absent → empty (never fabricated). */
export function bindTopN(data: BoardData, topN = 5): TopNRow[] {
  const rows = data.observability?.tokensByModel;
  if (!rows || rows.length === 0) return [];
  const byModel = new Map<string, TopNRow>();
  for (const r of rows) {
    const cur = byModel.get(r.model) ?? { model: r.model, totalTokens: 0, costUsd: 0 };
    cur.totalTokens += r.totalTokens;
    cur.costUsd += r.costUsd;
    byModel.set(r.model, cur);
  }
  return [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, topN);
}
