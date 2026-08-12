// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-126 — every capability overview answers a question before it lists.
 *
 * ## The defect, measured
 *
 * On 2026-08-11, of the seven capability overviews, `skills` opened in a `<Card>` with
 * `<h2>Published skills</h2>` and a `DataTable`. No summary, no number, no verdict — whoever
 * arrived saw a LIST. It is the same class of defect `B-125` fixed one level up, on the platform
 * Overview.
 *
 * ## Why quantify instead of fixing the seven
 *
 * Fixing `skills` does not stop the eighth screen from being born without an answer — and it would
 * be born the same way this one was: somebody needs a listing, creates the screen, and the question
 * is never asked because nothing asks it. This file is what asks it.
 *
 * ## The marker is EXPLICIT on purpose
 *
 * The screen declares its form in a marker comment instead of the test guessing by heuristic. A
 * heuristic ("has a MetricCard? then it's KPI") would be wrong in both directions — a `MetricCard`
 * used inside a table would be a false positive, and a verdict built by a dedicated component would
 * be a false negative. Worse: it would let the new screen pass by accident, which is exactly what
 * this guard exists to prevent.
 *
 * Declaring costs one line and forces the question at the moment it is still cheap to answer.
 */

/**
 * The capability overviews, and what each one declares.
 *
 * `workspace` is OUT, and the exclusion answers a question the plan left open:
 * `workspace/overview.tsx` is a file browser, not a capability panel — it opens on a tree the user
 * walks, and "how is this capability doing?" is not the question anyone brings there. Being out by
 * declaration is different from being out by omission: if it ever becomes a panel, this line is
 * where the change shows up.
 */
const CAPABILITY_OVERVIEWS = [
  'pages/lens/overview.tsx',
  'pages/memory/overview.tsx',
  'pages/rag/overview.tsx',
  'pages/promptly/overview.tsx',
  'pages/trust/overview.tsx',
  'pages/skills/overview.tsx',
] as const;

/** The forms a screen declares. */
const MARKERS = {
  kpi: '@overview-answers: kpi',
  verdict: '@overview-answers: verdict',
} as const;

/**
 * The chart primitives an overview may plot with (B-129).
 *
 * Named rather than detected by a generic `Chart` substring: a heuristic would count a chart
 * imported for a modal, or miss one wrapped in a local component. The list is the contract, and a
 * new primitive is added here deliberately — which is also the moment somebody asks whether it
 * should exist at all.
 *
 * `TokenUsageChart` was in this list for one commit and is NOT a component: it was removed from
 * `memory/overview.tsx` on 2026-07-22 for plotting memory counts under token-labelled axes, and
 * only the comment explaining the removal survived. The first version of this guard matched plain
 * substrings, so that COMMENT satisfied it — the screen passed a chart check while rendering no
 * chart. Matching the JSX open tag is what closes it.
 */
const CHART_PRIMITIVES = ['TrendChart', 'CategoryBars', 'Histogram'] as const;

/** `<Name` or `<Name/>` — a component being RENDERED, not a name mentioned in prose. */
const rendered = (src: string, name: string) => new RegExp(`<${name}[\\s/>]`).test(src);

function read(rel: string): string {
  const path = resolve(SRC, rel);
  if (!existsSync(path)) throw new Error(`overview declared and missing from disk: ${rel}`);
  return readFileSync(path, 'utf8');
}

describe('every capability overview answers a question', () => {
  it('ALL of them open with the KPI dashboard', () => {
    // AMENDMENT D1-bis (2026-08-11, owner's decision). This guard's original rule accepted KPI OR
    // verdict, on the argument that a verdict answers better where a rule exists. The owner decided
    // that every capability opens with the same dashboard `memory` opens with: consistency of
    // surface is a property of the product, and whoever operates eight capabilities should not
    // learn eight ways to read the first screen.
    //
    // The `verdict` marker is still valid — it went from ALTERNATIVE to ADDITION. See the case
    // below, which today asserts the opposite of what it used to.
    const noDashboard = CAPABILITY_OVERVIEWS.filter((rel) => !read(rel).includes(MARKERS.kpi));

    expect(
      [...noDashboard],
      'Capability overview with no KPI dashboard.\n\n' +
        'Every capability opens with the same small dashboard `memory/overview.tsx` opens with —\n' +
        'four `MetricCard`s derived from what the screen already fetches, rendered ONLY on settled\n' +
        'success (four zeros over a failure are fabricated numbers standing where an error belongs).\n\n' +
        `Declare it in the file: ${MARKERS.kpi}\n\n` +
        `And add ${MARKERS.verdict} when the capability has a RULE to judge the state against —\n` +
        'the verdict sits ABOVE the numbers, because a number says `3` and the sentence says what\n' +
        'to do about the `3`.\n',
    ).toEqual([]);
  });

  it('both forms coexist — the verdict adds, it does not replace', () => {
    // This case asserted the OPPOSITE until amendment D1-bis: it failed any screen declaring both,
    // on the argument that rendering both was deferring the choice. With the amendment the choice
    // stopped existing — the dashboard is mandatory and the verdict is the addition of whoever has
    // a rule.
    //
    // It stays here inverted, rather than deleted, because a guard that changes its mind without
    // leaving a trace makes the next reader believe there was never another rule.
    const withVerdict = CAPABILITY_OVERVIEWS.filter((rel) => read(rel).includes(MARKERS.verdict));

    expect(
      withVerdict.length,
      'no screen declares a verdict — trust and skills have a rule and should',
    ).toBeGreaterThanOrEqual(2);

    for (const rel of withVerdict) {
      expect(read(rel).includes(MARKERS.kpi), `${rel} has a verdict and no dashboard`).toBe(true);
    }
  });

  it('every overview plots something under its counts', () => {
    // B-129, owner's decision: counts alone say HOW MUCH and never WHAT KIND. `3 answers` reads the
    // same whether all three were confident or none were; `2 environments` never says which one
    // serves everything. `/observability` had the chart from the start and the other five were
    // catching up one screen at a time.
    //
    // What form is NOT dictated here, and that is deliberate. A line needs a trustworthy time
    // series, and four of the six do not have one — `trust` is the sharpest case, where
    // `PolicyViolation` declares `detectedAt` and the real deploy does not send it. Forcing a time
    // axis would produce a chart that is empty in production and correct against the mock.
    const chartless = CAPABILITY_OVERVIEWS.filter(
      (rel) => !CHART_PRIMITIVES.some((c) => rendered(read(rel), c)),
    );

    expect(
      [...chartless],
      'Capability overview with counts and no chart.\n\n' +
        'Plot the distribution the screen already has, under the KPI cards, using one of:\n' +
        `  ${CHART_PRIMITIVES.join(', ')}\n\n` +
        'Pick the form from what the DATA supports — bars for a categorical distribution, a line\n' +
        'only where there is a timestamp you trust in production. A chart form the data cannot\n' +
        'feed is fabrication with axes on it.\n\n' +
        'And render it only on settled success: an empty chart over a failed read is a fabricated\n' +
        'distribution standing where an error belongs.\n',
    ).toEqual([]);
  });

  it('the declared set matches what exists on disk', () => {
    // Guards against the list ageing silently: a renamed or removed capability would make both
    // cases above pass over a file that no longer exists.
    for (const rel of CAPABILITY_OVERVIEWS) {
      expect(() => read(rel), `${rel} disappeared from disk`).not.toThrow();
    }
    expect(CAPABILITY_OVERVIEWS.length).toBeGreaterThanOrEqual(6);
  });
});
