// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..');

/**
 * The brand has no purple: ink, bone and one lime, plus the status colors. A hex literal between
 * indigo and purple (hue 235 to 300 degrees, with enough saturation to read as a color) is a
 * leftover of the previous identity, wherever it is painted: a chart series, a canvas, an icon.
 */
const HEX = /#[0-9a-fA-F]{6}\b/g;

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation };
}

function isPurple(hex: string): boolean {
  const { hue, saturation } = hueAndSaturation(hex);
  return saturation >= 0.3 && hue >= 235 && hue <= 300;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('purple left over from the previous identity', () => {
  it('recognizes indigo and purple, and lets blue, lime and mauve through', () => {
    expect(['#6366f1', '#a855f7', '#a78bfa', '#c084fc'].map(isPurple)).toEqual([true, true, true, true]);
    expect(['#3987e5', '#C4E34F', '#9E5A80', '#94a3b8'].map(isPurple)).toEqual([false, false, false, false]);
  });

  it('no source file paints a purple hex', () => {
    const files = sourceFiles(SRC);
    expect(files.length, 'no source file found: the test read the wrong directory').toBeGreaterThan(100);
    const offenders = files.flatMap((file) => {
      const found = (readFileSync(file, 'utf8').match(HEX) ?? []).filter(isPurple);
      return found.length ? [`${relative(SRC, file)}: ${[...new Set(found)].join(' ')}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
