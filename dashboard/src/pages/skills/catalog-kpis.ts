/**
 * The four numbers of the skill registry (B-126, amendment D1-bis).
 *
 * ## Where this comes from
 *
 * I had decided, in the plan's `D1`, that this screen would answer with a verdict rather than
 * KPIs. The owner decided that every capability opens with the same dashboard `memory` opens with,
 * and that call is theirs: consistency of surface is a property of the product, and whoever
 * operates eight capabilities should not learn eight ways to read the first screen.
 *
 * The verdict STAYS, above these numbers. The amendment adds; it does not replace.
 *
 * ## Why these four
 *
 * All of them derive from the catalogue the screen already fetches — no new request. And the
 * choice avoided the temptation of completing the grid with something like "distinct categories":
 * a number nobody asked for occupies the slot of one somebody would have needed.
 *
 * `deprecated` is a CUT, not a slice: a deprecated skill with a revision is still loadable and
 * appears in both cards. Adding the four up expecting the total is a misreading, which is why the
 * card is called "Deprecated" and not "Other".
 */

export interface CatalogKpis {
  readonly total: number;
  /** Has a current revision — an agent can load it. */
  readonly loadable: number;
  /** Published with no revision: it sits in the registry and nobody can use it. */
  readonly notLoadable: number;
  /** Marked deprecated. A cut, not a slice: it may be loadable too. */
  readonly deprecated: number;
}

interface SkillRow {
  readonly latest_revision_id?: string | null;
  readonly lifecycle?: string;
}

export function catalogKpis(skills: readonly SkillRow[]): CatalogKpis {
  let loadable = 0;
  let deprecated = 0;

  for (const s of skills) {
    // `undefined` counts as not-loadable alongside `null`: the field is optional in the payload,
    // and treating its absence as success would make the screen claim a skill works based on a
    // field the service never sent.
    if (s.latest_revision_id !== null && s.latest_revision_id !== undefined) loadable += 1;
    if (s.lifecycle === 'deprecated') deprecated += 1;
  }

  return { total: skills.length, loadable, notLoadable: skills.length - loadable, deprecated };
}
