/**
 * M51 — MetricTrendChart: a pure-SVG, dependency-free multi-line trend chart. Follows the
 * `@usetheo/ui` `TokenUsageChart` idiom (pure SVG, no charting library — ADR D1: the four SOTA peers
 * use Recharts only to power configurable chart builders; theo-lens's fixed metric set stays below that
 * threshold). Renders one `<path>` per series over a shared linear X/Y, a color legend, a native
 * `<title>` tooltip, and a visually-hidden a11y `<table>` of the values (screen-reader parity). An
 * empty/all-empty input renders an explicit empty-state (never a fabricated zero line — the peer
 * convergence). Styles + text only; never `dangerouslySetInnerHTML` (the XSS guard).
 */

export interface TrendPoint {
  /** X in the series' own units (bucket index or epoch-ms); scaled linearly. */
  x: number;
  /** Y value for this point. */
  y: number;
}
export interface TrendSeries {
  name: string;
  /** CSS color for the line + legend swatch. */
  color: string;
  points: TrendPoint[];
}

// ---- pure helpers (exported for unit tests) ----

/** Linear scale mapping a value in `domain` to `range`. A zero-width domain maps everything to r0. */
export function linScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

/** A clean upper Y bound ≥ max(values). Returns 0 when there is no positive value. */
export function niceMax(values: number[]): number {
  const m = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (m <= 0) return 0;
  const pow = 10 ** Math.floor(Math.log10(m));
  return Math.ceil(m / pow) * pow;
}

/** SVG path `d` for a polyline over the given scales. Empty string when there are no points. */
export function seriesPath(
  points: TrendPoint[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(2)},${yScale(p.y).toFixed(2)}`)
    .join(' ');
}

// ---- component ----

const VIEW_W = 600;
const PAD = { top: 8, right: 8, bottom: 4, left: 40 };
// O-2: series with fewer than this many points draw a marker at each point (a 2-4 point line reads as a
// cliff without them); a denser series draws the line only.
const SPARSE_MARKER_MAX = 5;

export function MetricTrendChart({
  title,
  series,
  height = 180,
  yFormat = (v: number) => String(v),
}: {
  title: string;
  series: TrendSeries[];
  height?: number;
  yFormat?: (v: number) => string;
}) {
  const allPoints = series.flatMap((s) => s.points);
  const hasData = allPoints.some((p) => Number.isFinite(p.y));

  if (!hasData) {
    return (
      <figure className="space-y-1" aria-label={`${title} — no data`}>
        <figcaption className="text-xs font-semibold uppercase text-muted-foreground">{title}</figcaption>
        <div
          data-testid="trend-empty"
          className="flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground"
          style={{ height }}
        >
          No data in this time range.
        </div>
      </figure>
    );
  }

  const xs = allPoints.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = niceMax(allPoints.map((p) => p.y)) || 1;
  const xScale = linScale([xMin, xMax], [PAD.left, VIEW_W - PAD.right]);
  const yScale = linScale([0, yMax], [height - PAD.bottom, PAD.top]); // inverted (SVG y grows down)

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-semibold uppercase text-muted-foreground">{title}</figcaption>
      <svg
        data-testid="trend-chart"
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title} trend`}
        className="w-full"
        style={{ height }}
      >
        {/* baseline + top gridline */}
        <line x1={PAD.left} y1={height - PAD.bottom} x2={VIEW_W - PAD.right} y2={height - PAD.bottom} className="stroke-border" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top} x2={VIEW_W - PAD.right} y2={PAD.top} className="stroke-border/50" strokeWidth={1} strokeDasharray="2 3" />
        <text x={4} y={PAD.top + 8} className="fill-muted-foreground text-[10px]">{yFormat(yMax)}</text>
        <text x={4} y={height - PAD.bottom} className="fill-muted-foreground text-[10px]">0</text>
        {series.map((s) => (
          <g key={s.name}>
            <path
              data-testid="trend-line"
              data-series={s.name}
              d={seriesPath(s.points, xScale, yScale)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
            >
              <title>{s.name}</title>
            </path>
            {/* O-2: a sparse series (1-4 buckets) reads as a dramatic slope — anchor the reader to the
                actual few data points with a marker at each. A single-bucket range also collapses the
                polyline to a point, so a dot keeps real data from rendering as an invisible line. A dense
                series (≥ 5) draws the line only, unchanged. */}
            {s.points.length < SPARSE_MARKER_MAX
              ? s.points.map((p, i) => (
                  <circle
                    key={`${s.name}-${i}`}
                    data-testid="trend-dot"
                    cx={xScale(p.x)}
                    cy={yScale(p.y)}
                    r={2.5}
                    fill={s.color}
                  >
                    <title>{s.name}</title>
                  </circle>
                ))
              : null}
          </g>
        ))}
      </svg>

      {/* color legend */}
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.name}
          </li>
        ))}
      </ul>

      {/* visually-hidden a11y table — screen-reader parity for the SVG */}
      <table className="sr-only" data-testid="trend-table">
        <caption>{title} — data table</caption>
        <thead>
          <tr>
            <th>Point</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(series[0]?.points ?? []).map((_, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {series.map((s) => (
                <td key={s.name}>{s.points[i] ? yFormat(s.points[i].y) : '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
