import { describe, it, expect } from 'vitest';

import { SCORE_CONFIGS } from './score-configs';
import { prefillValues, toResolveBody, type AnnotationValues } from './to-resolve-body';

/**
 * M12 — the pure "annotation values → resolve body" boundary. Mirrors the prior
 * inline assembly semantics: `label` is trimmed & required; `score` is included
 * only when a finite number is selected; `note` only when non-empty after trim.
 */
describe('toResolveBody', () => {
  it('maps a selected categorical Quality option to its numeric score', () => {
    const values: AnnotationValues = { label: 'good', quality: 'good' };
    expect(toResolveBody(SCORE_CONFIGS, values)).toEqual({ label: 'good', score: 1 });
  });

  it('maps the "ok" bucket to score 0.5 and "bad" to 0 (not omitted — 0 is finite)', () => {
    expect(toResolveBody(SCORE_CONFIGS, { label: 'meh', quality: 'ok' })).toEqual({ label: 'meh', score: 0.5 });
    expect(toResolveBody(SCORE_CONFIGS, { label: 'nope', quality: 'bad' })).toEqual({ label: 'nope', score: 0 });
  });

  it('maps a freeform Note to the note field', () => {
    const values: AnnotationValues = { label: 'good', note: 'looks fine' };
    expect(toResolveBody(SCORE_CONFIGS, values)).toEqual({ label: 'good', note: 'looks fine' });
  });

  it('omits score when no Quality option is selected (null)', () => {
    expect(toResolveBody(SCORE_CONFIGS, { label: 'good', quality: null })).toEqual({ label: 'good' });
  });

  it('omits note when empty / whitespace-only (matches the prior note.trim() semantics)', () => {
    expect(toResolveBody(SCORE_CONFIGS, { label: 'good', note: '   ' })).toEqual({ label: 'good' });
    expect(toResolveBody(SCORE_CONFIGS, { label: 'good', note: '' })).toEqual({ label: 'good' });
    expect(toResolveBody(SCORE_CONFIGS, { label: 'good', note: null })).toEqual({ label: 'good' });
  });

  it('trims the label (matches the prior label.trim() semantics)', () => {
    expect(toResolveBody(SCORE_CONFIGS, { label: '  good  ' })).toEqual({ label: 'good' });
  });

  it('falls back to the selected Quality label when no free-text label is typed', () => {
    // The categorical option label supplies `label` when the freeform Label is empty,
    // so a reviewer who only picks a bucket still produces a non-empty required label.
    expect(toResolveBody(SCORE_CONFIGS, { label: '', quality: 'good' })).toEqual({ label: 'good', score: 1 });
  });

  it('assembles all three when all are present', () => {
    const values: AnnotationValues = { label: 'good', quality: 'ok', note: 'borderline' };
    expect(toResolveBody(SCORE_CONFIGS, values)).toEqual({ label: 'good', score: 0.5, note: 'borderline' });
  });

  it('round-trips through prefillValues → toResolveBody for a fully-resolved item', () => {
    // A persisted item with a bucket-matching score seeds the form, and re-assembling
    // reproduces the same body (edit path is lossless when the score maps to a bucket).
    const seeded = prefillValues(SCORE_CONFIGS, { label: 'good', score: 0.5, note: 'hi' });
    expect(seeded).toMatchObject({ label: 'good', quality: 'ok', note: 'hi' });
    expect(toResolveBody(SCORE_CONFIGS, seeded)).toEqual({ label: 'good', score: 0.5, note: 'hi' });
  });

  it('prefillValues leaves the categorical unset when a persisted score matches no bucket', () => {
    // 0.42 is not a Quality bucket — we never fabricate a selection the reviewer did not make.
    const seeded = prefillValues(SCORE_CONFIGS, { label: 'x', score: 0.42 });
    expect(seeded.quality).toBeNull();
    // and with no bucket selected, re-assembly omits the score (honest — no fabricated 0.42).
    expect(toResolveBody(SCORE_CONFIGS, seeded)).toEqual({ label: 'x' });
  });

  it('prefillValues seeds empty label / null quality / null note for a pending item', () => {
    expect(prefillValues(SCORE_CONFIGS, {})).toEqual({ label: '', quality: null, note: null });
  });

  it('includes a continuous config value as the numeric score when present', () => {
    const configs = [
      { key: 'label', name: 'Label', target: 'label' as const, required: true, config: { type: 'freeform' as const } },
      { key: 'rating', name: 'Rating', target: 'score' as const, config: { type: 'continuous' as const, min: 0, max: 1 } },
    ];
    expect(toResolveBody(configs, { label: 'good', rating: 0.75 })).toEqual({ label: 'good', score: 0.75 });
    // an unset continuous score is omitted
    expect(toResolveBody(configs, { label: 'good', rating: null })).toEqual({ label: 'good' });
  });
});
