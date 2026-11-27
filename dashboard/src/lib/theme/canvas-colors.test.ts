import { afterEach, describe, it, expect } from 'vitest';
import { themeColor, withAlpha } from './canvas-colors';

describe('theme colors for a canvas', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--muted-foreground');
  });

  it('reads the token as the complete color it is', () => {
    // The tokens used to be HSL triples and were wrapped in `hsl(...)`. They are complete colors
    // now, and `hsl(#9BA29F)` is not a color: the canvas kept its previous fill.
    document.documentElement.style.setProperty('--muted-foreground', '#9BA29F');
    expect(themeColor('--muted-foreground', '#000000')).toBe('#9BA29F');
  });

  it('falls back when the token is not set', () => {
    expect(themeColor('--muted-foreground', '#8a8a8a')).toBe('#8a8a8a');
  });

  it('applies alpha to a hex color', () => {
    expect(withAlpha('#9BA29F', 0.28)).toBe('rgba(155, 162, 159, 0.28)');
  });

  it('applies alpha to any other color through color-mix', () => {
    expect(withAlpha('oklch(0.7 0.1 150)', 0.5)).toBe(
      'color-mix(in srgb, oklch(0.7 0.1 150) 50%, transparent)',
    );
  });
});
