import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { linScale } from '@getloopscale/ui';
import {
  areaPath,
  axisLabels,
  axisTop,
  drawablePoints,
  formatAxisTime,
  formatPointTime,
  linePath,
  nearestIndex,
  type ChartPoint,
} from './resource-chart-geometry';

/**
 * ResourceChart draws one series over time as a filled line, with the limit as a dashed rule once
 * usage comes near it. The pointer reads any point; the table under the drawing gives the same
 * values to a screen reader.
 *
 * `TrendChart` of `@getloopscale/ui` draws several bare lines and has no pointer reading and no
 * reference rule, which a usage-against-limit chart needs. The scale comes from that library.
 */
export interface ResourceChartProps {
  title: string;
  points: readonly ChartPoint[];
  /** Writes a value on the axis, in the tooltip and in the table. */
  format: (v: number) => string;
  /** The ceiling the series fills, in the unit of the series. */
  limit?: number | null;
  /** A round number at or above a value, for the top of the axis. */
  nice: (v: number) => number;
  height?: number;
}

const PAD = { top: 12, right: 8, bottom: 22, left: 8 };
const FALLBACK_WIDTH = 480;

/** The drawn width, so the text of the chart is never stretched. */
function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function ResourceChart({ title, points, format, limit = null, nice, height = 148 }: ResourceChartProps) {
  const gradientId = useId();
  const [containerRef, width] = useMeasuredWidth();
  const [hovered, setHovered] = useState<number | null>(null);

  const data = drawablePoints(points);
  const first = data[0];
  const last = data[data.length - 1];
  const span = data.length > 1 ? last.t - first.t : 0;
  const top = axisTop(Math.max(0, ...data.map((p) => p.v)), limit, nice);
  const baselineY = height - PAD.bottom;
  const x = linScale([first?.t ?? 0, (last?.t ?? 0) + (span === 0 ? 1 : 0)], [PAD.left, width - PAD.right]);
  const y = linScale([0, top], [baselineY, PAD.top]);
  const limitInView = limit !== null && limit > 0 && limit <= top;
  const active = hovered !== null ? data[hovered] : undefined;

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (data.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
    const t = first.t + (ratio * width - PAD.left) / Math.max(1, width - PAD.left - PAD.right) * Math.max(span, 1);
    const index = nearestIndex(data, t);
    setHovered(index >= 0 ? index : null);
  };

  return (
    <figure data-slot="resource-chart" className="m-0">
      <div ref={containerRef} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${title} over time`}
          className="block touch-none"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {axisLabels(top, format).map((value) => (
            <g key={value}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} className="stroke-border" strokeWidth={1} strokeDasharray="2 4" />
              <text x={PAD.left} y={y(value) - 4} className="fill-muted-foreground text-[10px] tabular-nums">
                {format(value)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={width - PAD.right} y1={baselineY} y2={baselineY} className="stroke-border" strokeWidth={1} />

          {limitInView ? (
            <g data-slot="resource-chart-limit">
              <line x1={PAD.left} x2={width - PAD.right} y1={y(limit)} y2={y(limit)} className="stroke-destructive" strokeWidth={1.5} strokeDasharray="6 4" />
              <text x={width - PAD.right} y={y(limit) - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
                Limit {format(limit)}
              </text>
            </g>
          ) : null}

          <path d={areaPath(data, x, y, baselineY)} fill={`url(#${gradientId})`} />
          <path d={linePath(data, x, y)} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.length === 1 ? <circle cx={x(first.t)} cy={y(first.v)} r={4} className="fill-primary" /> : null}

          {active ? (
            <g data-slot="resource-chart-cursor">
              <line x1={x(active.t)} x2={x(active.t)} y1={PAD.top} y2={baselineY} className="stroke-muted-foreground" strokeWidth={1} />
              <circle cx={x(active.t)} cy={y(active.v)} r={4.5} className="fill-primary stroke-card" strokeWidth={2} />
            </g>
          ) : null}

          {first ? (
            <text x={PAD.left} y={height - 6} className="fill-muted-foreground text-[10px] tabular-nums">
              {formatAxisTime(first.t, span)}
            </text>
          ) : null}
          {last && span > 0 ? (
            <text x={width - PAD.right} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {formatAxisTime(last.t, span)}
            </text>
          ) : null}
        </svg>

        {active ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-body-sm shadow-md"
            style={{ left: `${Math.min(Math.max((x(active.t) / width) * 100, 14), 86)}%` }}
          >
            <span className="font-mono font-semibold tabular-nums text-foreground">{format(active.v)}</span>
            <span className="ml-2 text-muted-foreground">{formatPointTime(active.t)}</span>
          </div>
        ) : null}
      </div>

      <table className="sr-only">
        <caption>{title} over time</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">{title}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.t}>
              <td>{formatPointTime(p.t)}</td>
              <td>{format(p.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
