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
 *
 * ## What B-148 / B-185 / B-186 / B-187 changed, and why the shape is what it is
 *
 * The paragraph above claimed the bar was drawn inside the value cell from the day it was written.
 * It was not — the bar had a `<td>` of its own whose only content was `aria-hidden`, so assistive
 * technology read a three-column table with one permanently empty column (B-186). It does now, and
 * the table declares its two columns.
 *
 * The value cell used to print `bar.value` while the bar drew a SANITISED width, so the two were
 * free to disagree and did: a `NaN` printed as text beside a bar that refused to draw it (B-148).
 * `barGeometry` returns both numbers from one pass, which makes that disagreement unrepresentable
 * rather than merely fixed.
 */

export interface CategoryBar {
  readonly label: string;
  readonly value: number;
  /** Optional accent. `muted` is for a category that is present but not the point of the chart. */
  readonly tone?: 'default' | 'positive' | 'warning' | 'muted';
  /**
   * What this bar's `tone` MEANS on this screen, announced to assistive technology.
   *
   * B-187 — the tone reached the user through background colour alone, inside the `aria-hidden`
   * track. On `trust/overview.tsx` the `warning` tone is the only carrier of *"this policy is not
   * enforced"*, so colour-only made a compliance reading invisible to anyone not seeing it
   * (WCAG 2.2 SC 1.4.1).
   *
   * The primitive cannot know that `warning` means "not enforced" on one screen and "low
   * confidence" on another, so when a caller says nothing the variant name is announced instead.
   * That is honest rather than good — a caller with a better word should pass it.
   */
  readonly toneLabel?: string;
}

/**
 * The smallest width, in percent, at which a bar is actually visible.
 *
 * HEURISTIC, not a measurement: ~1.5% of a `w-full` track inside a card is 4-6 px at common
 * widths — enough to be seen, small enough that it cannot be misread as a meaningful proportion.
 */
export const MIN_VISIBLE_PCT = 1.5;

export interface BarGeometry {
  /** The value AFTER sanitisation — this is what the number cell prints. */
  readonly value: number;
  /** The bar's width in percent, scaled against the largest sanitised value. */
  readonly widthPct: number;
}

/**
 * The sanitised value and its bar width, from one pass over the input.
 *
 * ## Scaled against the largest value, not the total
 *
 * Against the total, one dominant category compresses the rest into invisibility — with
 * `[90, 5, 5]` the small bars would be 5% wide and read as zero. Against the max, the shape of the
 * distribution stays legible, which is the whole reason to draw it instead of listing it.
 *
 * ## Why it returns the value too (B-148)
 *
 * Because otherwise the caller sanitises again, or forgets to. The number cell used to print the
 * raw value beside a bar drawn from the sanitised one, so a `NaN` appeared as text next to a
 * 0%-wide bar. Two places deciding what a value is are two places free to disagree.
 *
 * ## Why the floor is conditional (B-185 / B-188)
 *
 * These two items are inverses and the history is the reason to be careful. An earlier
 * unconditional `Math.max(2, …)` drew a genuine zero as a visible sliver, so a workspace with
 * nothing in it looked like a workspace with almost something; removing it fixed that and made a
 * real count of 3 beside a max of 9000 render as nothing at all. Flooring only values that
 * survived sanitisation is the one form that satisfies both readings.
 *
 * Outside the JSX on purpose: it is the arithmetic of the decision, and isolated arithmetic is
 * arithmetic a mutation test can reach — the same reason `linScale` / `niceMax` / `markedPoints`
 * live outside `TrendChart`'s JSX.
 */
export function barGeometry(values: readonly number[]): BarGeometry[] {
  // A negative or non-finite count is not a count. Reading it as zero keeps broken data visible as
  // "nothing here" instead of drawing it as a reversed or absolute-valued bar that reads as fact.
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...clean);
  // `v / 0` is NaN, and `width: NaN%` drops the declaration — the bar renders full-width in some
  // engines and absent in others. A fresh workspace has every count at zero, so this is the common
  // path rather than an edge.
  if (max === 0) return clean.map((value) => ({ value, widthPct: 0 }));
  return clean.map((value) => ({
    value,
    widthPct: value === 0 ? 0 : Math.max(MIN_VISIBLE_PCT, (value / max) * 100),
  }));
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

/**
 * What a bar's tone should announce, or `null` when it should stay silent.
 *
 * `default` is the ABSENCE of a signal, so announcing it would add noise to every untoned row in
 * the five overviews that render this.
 */
function toneAnnouncement(bar: CategoryBar): string | null {
  if (bar.toneLabel !== undefined && bar.toneLabel !== '') return bar.toneLabel;
  if (bar.tone === undefined || bar.tone === 'default') return null;
  return bar.tone;
}

export function CategoryBars({ title, bars, valueFormatter }: CategoryBarsProps) {
  // An empty frame is indistinguishable from a chart that failed to draw. Saying it in words is the
  // difference between "nothing was recorded" and "something is broken".
  if (bars.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing recorded in this window.</p>;
  }

  const geometry = barGeometry(bars.map((b) => b.value));
  const format = valueFormatter ?? ((v: number) => String(v));

  return (
    <table className="w-full border-separate border-spacing-y-2 text-sm">
      <caption className="sr-only">{title}</caption>
      {/* B-186 — the table had a caption and row headers but no column headers, so the reading was
          a bare grid of numbers. The headers are visually hidden because the card already carries a
          visible heading; hiding them visually is not hiding them. */}
      <thead className="sr-only">
        <tr>
          <th scope="col">Category</th>
          {/* B-237 — havia um `valueHeader` opcional aqui e nenhum chamador o passava. Os quatro
              gráficos do produto plotam contagens, e "Value" serve a todos; um parâmetro que só o
              default exercita é generalidade especulativa (YAGNI). Volta no dia em que houver um
              gráfico cuja coluna não seja um valor. */}
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {bars.map((bar, i) => {
          const announcement = toneAnnouncement(bar);
          return (
            <tr key={bar.label}>
              <th scope="row" className="w-[28%] pr-3 text-left font-normal text-muted-foreground">
                {bar.label}
              </th>
              <td className="w-full">
                <div className="flex items-center gap-3">
                  {/* The track is what makes a short bar readable as a proportion rather than as a
                      stub. Presentational: the cell's own text carries the reading. */}
                  <div
                    className="h-2 w-full rounded-full bg-muted"
                    aria-hidden="true"
                    data-testid="bar-track"
                  >
                    <div
                      className={`h-full rounded-full transition-[width] ${TONE[bar.tone ?? 'default']}`}
                      style={{ width: `${geometry[i].widthPct}%` }}
                    />
                  </div>
                  <span className="shrink-0 pl-3 text-right tabular-nums font-medium">
                    {format(geometry[i].value)}
                  </span>
                  {announcement !== null ? <span className="sr-only">{announcement}</span> : null}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
