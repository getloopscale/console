import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@/test/render';
import { CategoryBars, barGeometry, MIN_VISIBLE_PCT } from './category-bars';

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

describe('barGeometry', () => {
  it('scales against the largest value, not the total', () => {
    // Against the total, a dominant category compresses everything else into invisibility: with
    // [90, 5, 5] the two small bars would be 5% wide and read as zero. Against the max, the shape
    // of the distribution stays legible — which is the entire reason to draw it rather than list it.
    expect(barGeometry([90, 5, 5])).toEqual([
      { value: 90, widthPct: 100 },
      { value: 5, widthPct: (100 * 5) / 90 },
      { value: 5, widthPct: (100 * 5) / 90 },
    ]);
  });

  it('all zeros produce zero-width bars, never NaN', () => {
    // `value / max` with max 0 is NaN, and `width: NaN%` silently drops the style — the bar renders
    // full-width in some engines and absent in others. A fresh workspace is exactly the case where
    // every count is zero, so this is the common path, not an edge.
    expect(barGeometry([0, 0])).toEqual([
      { value: 0, widthPct: 0 },
      { value: 0, widthPct: 0 },
    ]);
  });

  it('an empty distribution yields no geometry', () => {
    expect(barGeometry([])).toEqual([]);
  });

  it('a non-finite or negative value is read as zero, not as a bar', () => {
    // A negative count is not a count. Drawing it — as a reversed bar, or as an absolute value —
    // would present broken data as a reading. Zero is visible as "nothing here" and does not lie.
    expect(barGeometry([10, -3, Number.NaN, Number.POSITIVE_INFINITY])).toEqual([
      { value: 10, widthPct: 100 },
      { value: 0, widthPct: 0 },
      { value: 0, widthPct: 0 },
      { value: 0, widthPct: 0 },
    ]);
  });

  it('a single category fills the track', () => {
    expect(barGeometry([7])).toEqual([{ value: 7, widthPct: 100 }]);
  });

  // B-185 — a real count that renders as nothing.
  it('a small non-zero value still draws a visible bar', () => {
    // (3 / 9000) * 100 is 0.0333%, which is not drawable. A category that EXISTS and cannot be
    // seen is exactly the misreading the chart is drawn to prevent.
    const [small] = barGeometry([3, 9000]);
    expect(small.widthPct).toBeGreaterThanOrEqual(MIN_VISIBLE_PCT);
    expect(small.value).toBe(3);
  });

  // B-188 — the inverse of B-185, and the reason the floor must be conditional. An earlier
  // unconditional `Math.max(2, …)` made a genuine zero draw a sliver, so a workspace with nothing
  // in it looked like a workspace with almost something.
  it('a genuine zero draws nothing even beside a large max', () => {
    expect(barGeometry([0, 9000])[0]).toEqual({ value: 0, widthPct: 0 });
  });

  it('a negative value draws nothing rather than being floored into visibility', () => {
    // The floor lifts small REAL counts. Applying it to a value that was rejected as not-a-count
    // would draw broken data as a reading, which is what `barGeometry` sanitises to prevent.
    expect(barGeometry([-5, 9000])[0]).toEqual({ value: 0, widthPct: 0 });
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

  // B-148 — the bar refused to draw the value and the cell printed it anyway.
  it('the number cell prints the sanitised value, not the raw one', () => {
    render(
      <CategoryBars
        title="Answer confidence"
        bars={[{ label: 'broken', value: Number.NaN }, { label: 'ok', value: 10 }]}
      />,
    );

    const row = screen.getByRole('row', { name: /broken/i });
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/NaN/);
  });

  // B-186 — a three-column table whose middle column was permanently aria-hidden.
  it('exposes column headers so the reading is not a bare grid of numbers', () => {
    render(<CategoryBars title="Answer confidence" bars={BARS} />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent(/category/i);
    expect(headers[1]).toHaveTextContent(/value/i);
  });

  it('draws the bar inside the value cell rather than in a column of its own', () => {
    // The module docblock has claimed this since it was written; until B-186 the bar sat in a
    // separate <td> whose only content was aria-hidden, so assistive tech read an empty column.
    render(<CategoryBars title="Answer confidence" bars={[{ label: 'high', value: 12 }]} />);

    const row = screen.getByRole('row', { name: /high\s*12/i });
    expect(within(row).getAllByRole('rowheader')).toHaveLength(1);
    expect(within(row).getAllByRole('cell')).toHaveLength(1);
    expect(within(row).getByRole('cell').querySelector('[data-testid="bar-track"]')).not.toBeNull();
  });

  // B-187 — four tone variants reaching the user through background colour alone, inside an
  // aria-hidden element. On `trust/overview.tsx` the `warning` tone is the ONLY carrier of
  // "this policy is not enforced".
  it('announces a warning tone to assistive technology, not only in colour', () => {
    render(
      <CategoryBars title="Coverage" bars={[{ label: 'pii-redaction', value: 4, tone: 'warning' }]} />,
    );

    const row = screen.getByRole('row', { name: /pii-redaction/i });
    expect(row.textContent).toMatch(/warning/i);
  });

  it.each(['positive', 'warning', 'muted'] as const)('announces the %s tone', (tone) => {
    render(<CategoryBars title="Coverage" bars={[{ label: 'zeta', value: 1, tone }]} />);
    expect(screen.getByRole('row', { name: /zeta/i }).textContent).toMatch(new RegExp(tone, 'i'));
  });

  it('lets the caller name what the tone MEANS on its screen', () => {
    // The primitive cannot know that `warning` means "not enforced" on the trust screen and "low
    // confidence" on the RAG one. Falling back to the variant name keeps it honest when the caller
    // says nothing; `toneLabel` is how a caller says something better.
    render(
      <CategoryBars
        title="Coverage"
        bars={[{ label: 'pii-redaction', value: 4, tone: 'warning', toneLabel: 'not enforced' }]}
      />,
    );

    const row = screen.getByRole('row', { name: /pii-redaction/i });
    expect(row.textContent).toMatch(/not enforced/i);
    expect(row.textContent).not.toMatch(/warning/i);
  });

  it('the default tone announces nothing', () => {
    // `default` is the absence of a signal. Announcing it would add noise to every untoned row in
    // five overviews.
    render(<CategoryBars title="Coverage" bars={[{ label: 'zeta', value: 1 }]} />);

    const row = screen.getByRole('row', { name: /zeta/i });
    expect(row.textContent).toBe('zeta1');
  });
});
