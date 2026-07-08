import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MetricCard } from '@usetheo/ui';
import { Activity, DollarSign, Network, Timer } from 'lucide-react';

import { cardMode, deltaTooSparse, periodDelta, type Delta } from './overview-metrics';

/**
 * M60 P1 — the observability KPI strip (blueprint §5; ADR D2/D3/D5). Four `@usetheo/ui` `MetricCard`s
 * (Traces / Error rate / Latency p95 / Cost) each carrying a **period-over-period delta** from the pure
 * `periodDelta` (half-vs-half of the fetched M51 window — no BFF change), with `invertTrend` on the
 * "up is bad" metrics (cost/latency/error-rate) and an honest **"N/A"** when the window is too sparse to
 * split. A `ResizeObserver` drives **width-adaptive degradation** (`cardMode`): below the full threshold
 * the delta is dropped. Clicking a tile selects which metric the shared trend chart plots (`onSelectMetric`).
 */

export type OverviewMetric = 'throughput' | 'errorRate' | 'latency' | 'cost';

export interface KpiTile {
  key: OverviewMetric;
  title: string;
  value: ReactNode;
  /** The per-bucket values `periodDelta` splits into halves. */
  series: number[];
  agg: 'sum' | 'mean';
  /** true when "up is bad" (cost / latency / error-rate) — flips the delta color. */
  invert: boolean;
}

const ICONS: Record<OverviewMetric, typeof Network> = {
  throughput: Network,
  errorRate: Activity,
  latency: Timer,
  cost: DollarSign,
};

/** Format a delta percent as a signed, whole-percent string ("+12%", "-100%"). */
function fmtPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

export function OverviewKpiStrip({
  tiles,
  onSelectMetric,
  selected,
}: {
  tiles: KpiTile[];
  onSelectMetric: (m: OverviewMetric) => void;
  selected?: OverviewMetric;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Default to the widest mode pre-measurement so the delta shows until we know the real width (R5).
  const [perCardWidth, setPerCardWidth] = useState(240);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setPerCardWidth(w / Math.max(1, tiles.length));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tiles.length]);

  const mode = cardMode(perCardWidth);

  return (
    <div ref={ref} className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-card-mode={mode}>
      {tiles.map((t) => {
        const d: Delta = periodDelta(t.series, t.agg);
        // O-1: suppress the delta on a small sample (too few buckets to trust a ±%) — treat it as another
        // "too sparse" reason, so the honest em-dash / hint shows instead of a bold arrow over 3-4 buckets.
        const tooSparse = d.na || deltaTooSparse(t.series.length);
        const showDelta = mode === 'full' && !tooSparse;
        const Icon = ICONS[t.key];
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelectMetric(t.key)}
            aria-pressed={selected === t.key}
            aria-label={`Show ${t.title} trend`}
            className={`rounded-lg text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected === t.key ? 'ring-1 ring-primary' : ''
            }`}
          >
            <MetricCard
              title={t.title}
              value={t.value}
              icon={<Icon className="h-4 w-4" aria-hidden="true" />}
              delta={showDelta ? { value: fmtPct(d.pct), trend: d.trend } : undefined}
              invertTrend={t.invert}
              hint={tooSparse ? 'N/A — window too sparse' : mode === 'full' ? 'vs first half of window' : undefined}
            />
          </button>
        );
      })}
    </div>
  );
}
