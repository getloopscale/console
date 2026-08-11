/**
 * CategoryBars — a distribution over LABELS, drawn as horizontal bars (B-129).
 *
 * ## Why this exists next to two chart composites that do not fit
 *
 * `@usetheo/ui` ships `TrendChart` (a TIME series — `x` is epoch-ms or a bucket index) and
 * `Histogram` (NUMBERS binned into `[lo, hi)` ranges). The four overviews that needed a chart have
 * neither shape: `high | medium | low`, counts per environment, counts per lifecycle. Measured
 * before writing this — see B-129 — none of them carries a trustworthy timestamp, and `trust` is
 * the sharpest case: `PolicyViolation` DECLARES `detectedAt` and the real deploy does not send it
 * (`hooks/trust/trust-payloads.ts:26`). A time axis there would be empty in production while
 * looking correct against the mock.
 *
 * Reaching for a chart form the data cannot feed is fabrication with axes on it.
 *
 * ## Why a table rather than SVG
 *
 * `TrendChart` is SVG and carries a SEPARATE accessible table underneath, because a `<path>` says
 * nothing to a screen reader. A categorical distribution IS a table of label/value pairs, so here
 * the table is the chart and the bar is drawn inside the value cell. One structure instead of two,
 * and the accessible reading is the primary one rather than a parallel copy free to drift from
 * what is drawn.
 *
 * It is also the smaller thing: no scales, no viewBox, no ResizeObserver.
 */

export interface CategoryBar {
  readonly label: string;
  readonly value: number;
  /** Optional accent. `muted` is for a category that is present but not the point of the chart. */
  readonly tone?: 'default' | 'positive' | 'warning' | 'muted';
}

/**
 * Bar widths in percent, scaled against the LARGEST value rather than the total.
 *
 * Against the total, one dominant category compresses the rest into invisibility — with
 * `[90, 5, 5]` the small bars would be 5% wide and read as zero. Against the max, the shape of the
 * distribution stays legible, which is the whole reason to draw it instead of listing it.
 *
 * Outside the JSX on purpose: it is the arithmetic of the decision, and isolated arithmetic is
 * arithmetic a mutation test can reach — the same reason `linScale` / `niceMax` / `markedPoints`
 * live outside `TrendChart`'s JSX.
 */
export function barWidths(values: readonly number[]): number[] {
  // A negative or non-finite count is not a count. Reading it as zero keeps broken data visible as
  // "nothing here" instead of drawing it as a reversed or absolute-valued bar that reads as fact.
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...clean);
  // `v / 0` is NaN, and `width: NaN%` drops the declaration — the bar renders full-width in some
  // engines and absent in others. A fresh workspace has every count at zero, so this is the common
  // path rather than an edge.
  if (max === 0) return clean.map(() => 0);
  return clean.map((v) => (v / max) * 100);
}

const TONE: Record<NonNullable<CategoryBar['tone']>, string> = {
  default: 'bg-primary/70',
  positive: 'bg-emerald-500/70',
  warning: 'bg-amber-500/70',
  muted: 'bg-muted-foreground/40',
};

export interface CategoryBarsProps {
  readonly title: string;
  readonly bars: readonly CategoryBar[];
  /** The unit belongs to the caller — `12` may be answers, milliseconds or prompts. */
  readonly valueFormatter?: (v: number) => string;
}

export function CategoryBars({ title, bars, valueFormatter }: CategoryBarsProps) {
  // An empty frame is indistinguishable from a chart that failed to draw. Saying it in words is the
  // difference between "nothing was recorded" and "something is broken".
  if (bars.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing recorded in this window.</p>;
  }

  const widths = barWidths(bars.map((b) => b.value));
  const format = valueFormatter ?? ((v: number) => String(v));

  return (
    <table className="w-full border-separate border-spacing-y-2 text-sm">
      <caption className="sr-only">{title}</caption>
      <tbody>
        {bars.map((bar, i) => (
          <tr key={bar.label}>
            <th scope="row" className="w-[28%] pr-3 text-left font-normal text-muted-foreground">
              {bar.label}
            </th>
            <td className="w-full">
              {/* The track is what makes a short bar readable as a proportion rather than as a
                  stub. Presentational: the row's own cells already carry the reading. */}
              <div className="h-2 w-full rounded-full bg-muted" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-[width] ${TONE[bar.tone ?? 'default']}`}
                  style={{ width: `${widths[i]}%` }}
                />
              </div>
            </td>
            <td className="pl-3 text-right tabular-nums font-medium">{format(bar.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
