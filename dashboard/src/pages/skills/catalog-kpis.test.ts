// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { catalogKpis, catalogByCategory, colecaoDescrita } from './catalog-kpis';

/**
 * The registry's KPI dashboard (B-126, amendment D1-bis).
 *
 * ## Where this screen comes from
 *
 * I had decided, in `D1`, that `skills` would answer with a verdict rather than KPIs — the
 * argument being that a number demands interpretation and a verdict already carries it. The owner
 * decided that every capability opens with the same dashboard `memory` opens with, and that call
 * is theirs: consistency of surface is a property of the product, and whoever operates eight
 * capabilities should not learn eight ways to read the first screen.
 *
 * The verdict STAYS, above the KPIs. The amendment adds; it does not replace.
 *
 * ## The four numbers are derived, not invented
 *
 * All of them come out of the catalogue the screen already fetches. The temptation would be to
 * fill a fourth card with something like "distinct categories" just to complete the grid — and a
 * number nobody asked for occupies the slot of one somebody would have needed.
 */

function skill(over: Record<string, unknown> = {}) {
  return { skill_id: 's', name: 'n', description: '', state: 'published', latest_revision_id: 'r', ...over };
}

describe("the registry's four numbers", () => {
  it('counts the registry, what loads, what does not, and what is deprecated', () => {
    const k = catalogKpis([
      skill({ skill_id: 'a' }),
      skill({ skill_id: 'b', latest_revision_id: null }),
      skill({ skill_id: 'c', lifecycle: 'deprecated' }),
      skill({ skill_id: 'd', lifecycle: 'deprecated', latest_revision_id: null }),
    ]);

    expect(k.total).toBe(4);
    expect(k.loadable, 'loadable means having a current revision, whatever the lifecycle').toBe(2);
    expect(k.notLoadable).toBe(2);
    expect(k.deprecated).toBe(2);
  });

  it('loadable and deprecated are not mutually exclusive', () => {
    // A deprecated skill WITH a revision is still loaded by whoever already references it. Adding
    // the four cards up and expecting the total would be a misreading, which is why `deprecated` is
    // a cut and not a slice — the card says "deprecated", not "other".
    const k = catalogKpis([skill({ lifecycle: 'deprecated' })]);
    expect(k.total).toBe(1);
    expect(k.loadable).toBe(1);
    expect(k.deprecated).toBe(1);
  });

  it('an empty registry is four zeros, not absence', () => {
    // `memory` documents this choice in the file itself: whoever arrives for the first time sees
    // four "0"s explaining what is coming, not broken cards. Zero is a valid reading.
    expect(catalogKpis([])).toEqual({ total: 0, loadable: 0, notLoadable: 0, deprecated: 0 });
  });

  it('a missing `latest_revision_id` counts as not-loadable, same as null', () => {
    // The field is optional in the payload. Treating `undefined` as loadable would make the screen
    // claim a skill works based on a field the service never sent.
    const k = catalogKpis([skill({ latest_revision_id: undefined })]);
    expect(k.notLoadable).toBe(1);
    expect(k.loadable).toBe(0);
  });
});

describe('the registry by category (B-129)', () => {
  it('counts each category, largest first', () => {
    // Largest first because the chart answers "what is this registry made of?" — and that question
    // is answered by the top of the list. Alphabetical would bury the answer under whatever happens
    // to start with 'a'.
    const bars = catalogByCategory([
      skill({ skill_id: 'a', category: 'engineering' }),
      skill({ skill_id: 'b', category: 'finance' }),
      skill({ skill_id: 'c', category: 'engineering' }),
    ]);

    expect(bars).toEqual([
      { label: 'engineering', value: 2 },
      { label: 'finance', value: 1 },
    ]);
  });

  it('a skill with no category is counted, not dropped', () => {
    // Dropping it would make the bars add up to less than the "In registry" card right above, and a
    // reader who notices has no way to tell whether the gap is uncategorised skills or a bug.
    const bars = catalogByCategory([skill({ category: undefined }), skill({ skill_id: 'b', category: '' })]);
    expect(bars).toEqual([{ label: 'uncategorised', value: 2 }]);
  });

  it('ties break alphabetically so the order is stable across reads', () => {
    // Without a tiebreak the bars reshuffle between refreshes on equal counts, which reads as data
    // changing when nothing changed.
    const bars = catalogByCategory([
      skill({ skill_id: 'a', category: 'zeta' }),
      skill({ skill_id: 'b', category: 'alpha' }),
    ]);
    expect(bars.map((b) => b.label)).toEqual(['alpha', 'zeta']);
  });

  it('an empty registry yields no bars', () => {
    expect(catalogByCategory([])).toEqual([]);
  });
});

describe('colecaoDescrita (B-149)', () => {
  it('describes the page in hand while the accumulated registry is still empty', () => {
    // The first frame after a successful read: the merge effect has not run yet, so the
    // accumulated array is empty while the page already has rows. Reading the accumulated one here
    // is what made the chart say "Nothing recorded" over a populated table.
    expect(colecaoDescrita([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('describes the accumulated registry once it has anything', () => {
    // After the merge, the accumulated array is the whole registry across pages; the page in hand
    // is only the last slice, and describing THAT would undercount every screen past page one.
    expect(colecaoDescrita(['a', 'b', 'c'], ['c'])).toEqual(['a', 'b', 'c']);
  });

  it('an empty registry with an empty page describes nothing', () => {
    expect(colecaoDescrita([], [])).toEqual([]);
  });
});
