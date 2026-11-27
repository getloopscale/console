/**
 * The arithmetic of the resource charts, apart from the markup so it can be tested without a DOM.
 */
import { niceMax } from '@getloopscale/ui';
import { byteUnit } from './resource-format';

export interface ChartPoint {
  /** Unix seconds. */
  t: number;
  v: number;
}

/** The points a chart can draw: finite, at or above zero, in time order. */
export function drawablePoints(points: readonly ChartPoint[]): ChartPoint[] {
  return points
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v >= 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * The top of the y-axis. The limit joins the axis once usage passes half of it: below that, an
 * axis that reaches the limit flattens the line into the baseline and shows nothing.
 */
export function axisTop(maxValue: number, limit: number | null, nice: (v: number) => number): number {
  const reachesLimit = limit !== null && limit > 0 && maxValue >= limit / 2;
  const top = nice(reachesLimit ? Math.max(maxValue, limit) : maxValue);
  return top > 0 ? top : 1;
}

/** A round number at or above the value, in decimal steps. */
export function niceDecimal(value: number): number {
  return niceMax([value]);
}

/** A round number at or above a byte count, in steps of its own binary unit (16 MiB, not 20 MB). */
export function niceBytes(value: number): number {
  if (!(value > 0)) return 0;
  const { size } = byteUnit(value);
  return niceMax([value / size]) * size;
}

/** SVG path of the line through the points. */
export function linePath(points: readonly ChartPoint[], x: (t: number) => number, y: (v: number) => number): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
}

/** SVG path of the area between the line and the baseline. Empty with fewer than two points. */
export function areaPath(
  points: readonly ChartPoint[],
  x: (t: number) => number,
  y: (v: number) => number,
  baselineY: number,
): string {
  if (points.length < 2) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points, x, y)} L${x(last.t).toFixed(2)},${baselineY.toFixed(2)} L${x(first.t).toFixed(2)},${baselineY.toFixed(2)} Z`;
}

/** Index of the point whose time is nearest to `t`, or -1 with no points. */
export function nearestIndex(points: readonly ChartPoint[], t: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((p, i) => {
    const distance = Math.abs(p.t - t);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

const DAY_SECONDS = 24 * 60 * 60;

/** A time on the x-axis: the hour inside a day, the date across days. */
export function formatAxisTime(unixSeconds: number, spanSeconds: number, locale?: string): string {
  const date = new Date(unixSeconds * 1000);
  return spanSeconds > DAY_SECONDS
    ? date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** The full moment of a point, for the tooltip and the table. */
export function formatPointTime(unixSeconds: number, locale?: string): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
