import { isCategoricalConfig, isContinuousConfig } from '@usetheo/ui';

import type { ScoreConfig } from './score-configs';

/** The controlled value held per config, keyed by `ScoreConfig.key`. */
type AnnotationValue = string | number | null | undefined;
export type AnnotationValues = Record<string, AnnotationValue>;

/** The resolve endpoint body — unchanged backend contract ({label, score?, note?}). */
export interface ResolveBody {
  label: string;
  score?: number;
  note?: string;
}

/**
 * M12 — pure assembly of AnnotationInput values into the resolve submission body.
 *
 * Keeps the prior inline semantics exactly:
 *   - `label` is trimmed and always present (the endpoint requires it). When no
 *     free-text label is typed, a selected categorical option's label is the
 *     fallback so a bucket-only review still yields a non-empty label.
 *   - `score` is included ONLY when a finite number is derivable — from the
 *     selected categorical option's `score` mapping, or a continuous value.
 *   - `note` is included ONLY when non-empty after trim.
 *
 * Pure: no I/O, no React — unit-tested in isolation from the form.
 */
/** The persisted fields of a queue item that seed the resolve form when editing. */
export interface ResolvedFields {
  label?: string;
  score?: number;
  note?: string;
}

/**
 * Seed the controlled AnnotationInput value-map from an item's persisted fields
 * (edit path). The free-text `label`/`note` map to their configs by target; a
 * persisted numeric `score` is mapped back onto a categorical option ONLY when
 * a bucket's `score` matches exactly (else the categorical stays unset — we
 * never fabricate a bucket the reviewer did not pick). Continuous score targets
 * take the number directly.
 */
export function prefillValues(configs: ScoreConfig[], item: ResolvedFields): AnnotationValues {
  const values: AnnotationValues = {};
  for (const sc of configs) {
    if (sc.target === 'label') values[sc.key] = item.label ?? '';
    else if (sc.target === 'note') values[sc.key] = item.note ?? null;
    else if (sc.target === 'score') {
      if (item.score === undefined) values[sc.key] = null;
      else if (isCategoricalConfig(sc.config)) {
        const match = sc.config.options.find((o) => o.score === item.score);
        values[sc.key] = match ? match.label : null;
      } else if (isContinuousConfig(sc.config)) values[sc.key] = item.score;
      else values[sc.key] = null;
    }
  }
  return values;
}

export function toResolveBody(configs: ScoreConfig[], values: AnnotationValues): ResolveBody {
  let label = '';
  let categoricalLabelFallback = '';
  let score: number | undefined;
  let note: string | undefined;

  for (const sc of configs) {
    const value = values[sc.key];

    if (sc.target === 'label') {
      if (typeof value === 'string') label = value.trim();
      continue;
    }

    if (sc.target === 'note') {
      if (typeof value === 'string' && value.trim() !== '') note = value.trim();
      continue;
    }

    if (sc.target === 'score') {
      if (isCategoricalConfig(sc.config)) {
        // The categorical value is the selected option's label; find its score.
        const selected = sc.config.options.find((o) => o.label === value);
        if (selected) {
          if (!categoricalLabelFallback) categoricalLabelFallback = selected.label;
          if (typeof selected.score === 'number' && Number.isFinite(selected.score)) score = selected.score;
        }
      } else if (isContinuousConfig(sc.config)) {
        if (typeof value === 'number' && Number.isFinite(value)) score = value;
      }
    }
  }

  if (label === '') label = categoricalLabelFallback;

  return {
    label,
    ...(score !== undefined ? { score } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}
