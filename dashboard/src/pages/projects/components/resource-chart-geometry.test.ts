// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  areaPath,
  axisLabels,
  axisTop,
  drawablePoints,
  linePath,
  nearestIndex,
  niceBytes,
  niceDecimal,
} from './resource-chart-geometry';

const identity = (v: number) => v;

describe('drawablePoints', () => {
  it('drops what cannot be drawn and orders by time', () => {
    expect(
      drawablePoints([
        { t: 30, v: 3 },
        { t: 10, v: 1 },
        { t: 20, v: Number.NaN },
        { t: 25, v: -1 },
      ]),
    ).toEqual([
      { t: 10, v: 1 },
      { t: 30, v: 3 },
    ]);
  });
});

describe('axisTop', () => {
  it('fits the data while usage is under half of the limit', () => {
    expect(axisTop(10, 512, identity)).toBe(10);
  });

  it('reaches the limit once usage passes half of it', () => {
    expect(axisTop(256, 512, identity)).toBe(512);
    expect(axisTop(600, 512, identity)).toBe(600);
  });

  it('fits the data without a limit and never collapses to zero', () => {
    expect(axisTop(10, null, identity)).toBe(10);
    expect(axisTop(0, null, identity)).toBe(1);
  });
});

describe('nice bounds', () => {
  it('rounds bytes in their own binary unit', () => {
    expect(niceBytes(11 * 1024 * 1024)).toBe(niceDecimal(11) * 1024 * 1024);
    expect(niceBytes(0)).toBe(0);
  });
});

describe('paths', () => {
  const points = [
    { t: 0, v: 1 },
    { t: 10, v: 3 },
  ];

  it('draws the line through every point', () => {
    expect(linePath(points, identity, identity)).toBe('M0.00,1.00 L10.00,3.00');
  });

  it('closes the area on the baseline', () => {
    expect(areaPath(points, identity, identity, 100)).toBe('M0.00,1.00 L10.00,3.00 L10.00,100.00 L0.00,100.00 Z');
  });

  it('has no area for a single point', () => {
    expect(areaPath([points[0]], identity, identity, 100)).toBe('');
  });
});

describe('nearestIndex', () => {
  const points = [
    { t: 0, v: 0 },
    { t: 60, v: 0 },
    { t: 120, v: 0 },
  ];

  it('finds the point under the pointer', () => {
    expect(nearestIndex(points, 70)).toBe(1);
    expect(nearestIndex(points, 500)).toBe(2);
    expect(nearestIndex(points, -5)).toBe(0);
  });

  it('is -1 with nothing to point at', () => {
    expect(nearestIndex([], 10)).toBe(-1);
  });
});

describe('axisLabels', () => {
  it('labels the top and the middle', () => {
    expect(axisLabels(40, (v) => `${v} MiB`)).toEqual([40, 20]);
  });

  it('leaves the middle out when it reads like the top', () => {
    expect(axisLabels(1, (v) => String(Math.round(v)))).toEqual([1]);
  });
});
