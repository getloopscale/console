import type { AnnotationConfig } from '@usetheo/ui';

/**
 * M12 — score-configs for the labeling-queue resolve form.
 *
 * These are the named "score types" the human-in-the-loop review form composes
 * `@usetheo/ui` `AnnotationInput`s over. Per the M12 discovery, theo-cloud has
 * NO backend score-config store yet, so these live CLIENT-SIDE as a FIXTURE —
 * the ROADMAP-sanctioned mitigation (not a workaround). When a backend store
 * lands, this array becomes the seed/default and the page reads the store
 * instead; the resolve submission body ({label, score?, note?}) is unchanged.
 *
 * Each config carries a stable `key` so the resolve form can hold one value per
 * config and `to-resolve-body` can assemble the submission deterministically.
 * The union of configs must be able to produce a non-empty `label` (the resolve
 * endpoint requires it):
 *   - "Label"   freeform, REQUIRED — the free-text label (preserves the prior
 *               free-text capability; users are not forced into fixed buckets).
 *   - "Quality" categorical — maps a named choice to a numeric `score`
 *               (good→1, ok→0.5, bad→0) and, when no free-text Label is typed,
 *               also supplies the `label`.
 *   - "Note"    freeform — the optional reviewer note.
 */
export interface ScoreConfig {
  /** Stable identifier — the key under which the resolve form holds this config's value. */
  key: string;
  /** The score name, rendered as the AnnotationInput label / radiogroup accessible name. */
  name: string;
  /** Which field of the resolve body this config feeds. */
  target: 'label' | 'score' | 'note';
  config: AnnotationConfig;
  required?: boolean;
  description?: string;
}

export const SCORE_CONFIGS: ScoreConfig[] = [
  {
    key: 'label',
    name: 'Label',
    target: 'label',
    required: true,
    description: 'A short free-text verdict for this span (e.g. good / bad / needs-fix).',
    config: { type: 'freeform', maxLength: 120 },
  },
  {
    key: 'quality',
    name: 'Quality',
    target: 'score',
    description: 'A named quality bucket; sets the numeric score for this item.',
    config: {
      type: 'categorical',
      options: [
        { label: 'good', score: 1 },
        { label: 'ok', score: 0.5 },
        { label: 'bad', score: 0 },
      ],
    },
  },
  {
    key: 'note',
    name: 'Note',
    target: 'note',
    config: { type: 'freeform', maxLength: 2000 },
  },
];
