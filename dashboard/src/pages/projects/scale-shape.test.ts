// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { describeScaleChange, describeScaleShape, shapeOfStatus } from './scale-shape';

describe('shapeOfStatus', () => {
  it('reads a range as autoscaling', () => {
    expect(shapeOfStatus({ scaling: { replicas: 1, min: 1, max: 3, scaled_to_zero: false } })).toEqual({
      kind: 'auto',
      min: 1,
      max: 3,
    });
  });

  it('reads scale to zero as autoscaling from 0', () => {
    expect(shapeOfStatus({ scaling: { replicas: 0, min: 0, max: 4, scaled_to_zero: true } })).toEqual({
      kind: 'auto',
      min: 0,
      max: 4,
    });
  });

  it('reads equal bounds as a fixed count', () => {
    expect(shapeOfStatus({ scaling: { replicas: 3, min: 3, max: 3, scaled_to_zero: false } })).toEqual({
      kind: 'fixed',
      replicas: 3,
    });
  });

  it('falls back to the desired count when the response has no scaling block', () => {
    expect(shapeOfStatus({ replicas_desired: 2 })).toEqual({ kind: 'fixed', replicas: 2 });
  });

  it('reports nothing when the API reports nothing', () => {
    expect(shapeOfStatus({})).toBeNull();
    expect(shapeOfStatus(undefined)).toBeNull();
  });
});

describe('describeScaleShape', () => {
  it('names a fixed count and a range', () => {
    expect(describeScaleShape({ kind: 'fixed', replicas: 1 })).toBe('1 replica');
    expect(describeScaleShape({ kind: 'fixed', replicas: 3 })).toBe('3 replicas');
    expect(describeScaleShape({ kind: 'auto', min: 1, max: 3 })).toBe('autoscaling, 1 to 3 replicas');
  });
});

describe('describeScaleChange', () => {
  it('names the direction between two fixed counts', () => {
    expect(describeScaleChange({ kind: 'fixed', replicas: 1 }, { kind: 'fixed', replicas: 3 })).toBe(
      '1 → 3 replicas (increase).',
    );
    expect(describeScaleChange({ kind: 'fixed', replicas: 5 }, { kind: 'fixed', replicas: 2 })).toBe(
      '5 → 2 replicas (decrease).',
    );
    expect(describeScaleChange({ kind: 'fixed', replicas: 2 }, { kind: 'fixed', replicas: 2 })).toBe(
      '2 → 2 replicas (no change).',
    );
  });

  it('names both sides when the mode changes, and never "no change"', () => {
    expect(describeScaleChange({ kind: 'fixed', replicas: 3 }, { kind: 'auto', min: 1, max: 3 })).toBe(
      'from 3 replicas to autoscaling, 1 to 3 replicas.',
    );
  });

  it('says no change for the same range', () => {
    expect(describeScaleChange({ kind: 'auto', min: 1, max: 3 }, { kind: 'auto', min: 1, max: 3 })).toBe(
      'autoscaling, 1 to 3 replicas (no change).',
    );
  });

  it('names only the target when the API reported no current scale', () => {
    expect(describeScaleChange(null, { kind: 'fixed', replicas: 3 })).toBe('to 3 replicas.');
    expect(describeScaleChange(null, { kind: 'auto', min: 0, max: 2 })).toBe('to autoscaling, 0 to 2 replicas.');
  });
});
