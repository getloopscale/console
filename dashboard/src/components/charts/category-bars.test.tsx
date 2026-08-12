import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@/test/render';
import { CategoryBars, barWidths } from './category-bars';

/**
 * B-129 — the bar chart the four chartless overviews put under their counts.
 *
 * ## Why a new primitive, and only after checking
 *
 * The design system ships two chart composites and neither fits. `TrendChart` plots a TIME series
 * (`x` in epoch-ms or bucket index) and `Histogram` bins NUMBERS into `[lo, hi)` ranges. What the
 * four screens have is a categorical distribution — `high | medium | low`, one count per
 * environment, one per lifecycle. Feeding either primitive would mean inventing an axis the data
 * does not have.
 *
 * ## Why a table and not SVG
 *
 * `TrendChart` is SVG and carries a SEPARATE accessible table underneath, because a path element
 * says nothing to a screen reader. A categorical distribution IS a table of label/value pairs — so
 * the table is the chart here, with the bar drawn inside the value cell. One structure instead of
 * two, and the accessible reading is the primary one rather than a parallel copy that can drift
 * from what is drawn.
 *
 * ## Widths are pure arithmetic, on purpose
 *
 * Isolated arithmetic is arithmetic a mutation test can reach — the same reason `linScale`,
 * `niceMax` and `markedPoints` live outside the JSX in `TrendChart`.
 */

describe('barWidths', () => {
  it('scales against the largest value, not the total', () => {
    // Against the total, a dominant category compresses everything else into invisibility: with
    // [90, 5, 5] the two small bars would be 5% wide and read as zero. Against the max, the shape
    // of the distribution stays legible — which is the entire reason to draw it rather than list it.
    expect(barWidths([90, 5, 5])).toEqual([100, 100 * 5 / 90, 100 * 5 / 90]);
  });

  it('all zeros produce zero-width bars, never NaN', () => {
    // `value / max` with max 0 is NaN, and `width: NaN%` silently drops the style — the bar renders
    // full-width in some engines and absent in others. A fresh workspace is exactly the case where
    // every count is zero, so this is the common path, not an edge.
    expect(barWidths([0, 0])).toEqual([0, 0]);
  });

  it('an empty distribution yields no widths', () => {
    expect(barWidths([])).toEqual([]);
  });

  it('a non-finite or negative value is read as zero, not as a bar', () => {
    // A negative count is not a count. Drawing it — as a reversed bar, or as an absolute value —
    // would present broken data as a reading. Zero is visible as "nothing here" and does not lie.
    expect(barWidths([10, -3, Number.NaN, Number.POSITIVE_INFINITY])).toEqual([100, 0, 0, 0]);
  });

  it('a single category fills the track', () => {
    expect(barWidths([7])).toEqual([100]);
  });
});

describe('CategoryBars', () => {
  const BARS = [
    { label: 'high', value: 12 },
    { label: 'medium', value: 6 },
    { label: 'low', value: 0 },
  ];

  it('reads as a table of label and value', () => {
    // The accessible reading is the primary one. A screen reader gets the numbers from the same
    // structure the eye gets the bars from, so the two cannot drift apart.
    render(<CategoryBars title="Answer confidence" bars={BARS} />);

    const table = screen.getByRole('table', { name: /answer confidence/i });
    expect(within(table).getByRole('row', { name: /high\s*12/i })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /low\s*0/i })).toBeInTheDocument();
  });

  it('a category with zero still gets a row', () => {
    // Dropping empty categories would make "no low-confidence answers" indistinguishable from "low
    // confidence is not measured". The zero is a reading; the absence is not.
    render(<CategoryBars title="Answer confidence" bars={BARS} />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('formats values through the caller, since the unit is the caller\'s', () => {
    render(
      <CategoryBars title="Latency" bars={[{ label: 'p95', value: 120 }]} valueFormatter={(v) => `${v}ms`} />,
    );
    expect(screen.getByText('120ms')).toBeInTheDocument();
  });

  it('an empty distribution says so instead of rendering an empty frame', () => {
    // A chart with no bars is indistinguishable from a chart that failed to draw. Saying it in
    // words is the difference between "nothing was recorded" and "something is broken".
    render(<CategoryBars title="Answer confidence" bars={[]} />);
    expect(screen.getByText(/nothing recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
