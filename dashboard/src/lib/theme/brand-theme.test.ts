// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { BRAND_PRIMARY, TEMA_LOOPSCALE } from './loopscale-theme';

const require_ = createRequire(import.meta.url);
const DASHBOARD = resolve(__dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(resolve(DASHBOARD, path), 'utf8');

/** WCAG 2 relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The console renders in the LoopScale brand: ink, bone and one lime, Hanken Grotesk and JetBrains
 * Mono served by the console itself. These checks read the files that decide it, so a leftover of
 * the violet theme or of the Google Fonts CDN fails here before it reaches a browser.
 */
describe('brand theme', () => {
  const theme = TEMA_LOOPSCALE.themes[0];

  it('uses the brand lime as primary, per mode', () => {
    expect(theme.name).toBe('loopscale');
    expect(theme.dark?.primary).toBe(BRAND_PRIMARY.dark);
    expect(theme.light?.primary).toBe(BRAND_PRIMARY.light);
    expect(BRAND_PRIMARY).toEqual({ dark: '#C4E34F', light: '#556B00' });
  });

  it('keeps text on a primary fill readable in both modes (WCAG 1.4.3)', () => {
    for (const mode of ['dark', 'light'] as const) {
      const tokens = theme[mode] as unknown as Record<string, string>;
      expect(
        contrast(tokens.primary, tokens['primary-foreground']),
        `${mode}: primary-foreground on primary`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens.background, tokens.foreground),
        `${mode}: foreground on background`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('names the brand typefaces', () => {
    expect(theme.fonts?.body).toMatch(/^"Hanken Grotesk"/);
    expect(theme.fonts?.display).toMatch(/^"Hanken Grotesk"/);
    expect(theme.fonts?.mono).toMatch(/^"JetBrains Mono"/);
  });

  it('paints the same primary before React mounts as after', () => {
    // Until the provider mounts, the page is painted by the token file of the package. A different
    // primary there is a flash of another color on every load.
    const tokens = readFileSync(require_.resolve('@getloopscale/ui/tokens.css'), 'utf8');
    const declared = [...tokens.matchAll(/^\s*--primary:\s*(#[0-9a-fA-F]{6})\b/gm)].map((m) =>
      m[1].toUpperCase(),
    );

    expect(declared).toContain(BRAND_PRIMARY.dark);
    expect(declared).toContain(BRAND_PRIMARY.light);
  });

  it('leaves the primary to the theme: index.css declares none', () => {
    const declarations = [...read('src/index.css').matchAll(/^\s*--(primary|ring):/gm)];
    expect(declarations.map((m) => m[0].trim())).toEqual([]);
  });

  it('carries no copy of the design system tokens', () => {
    expect(existsSync(resolve(DASHBOARD, 'src/vendor/loopscale-ui'))).toBe(false);
    expect(read('src/index.css')).toMatch(/@import '@getloopscale\/ui\/tokens\.css' layer\(theme\);/);
  });

  it('asks no other host for fonts', () => {
    const googleFonts = /fonts\.(googleapis|gstatic)\.com/;
    expect(read('index.html')).not.toMatch(googleFonts);
    expect(read('src/index.css')).not.toMatch(googleFonts);

    const csp = read('nginx-security-headers.conf')
      .split('\n')
      .filter((line) => line.startsWith('add_header Content-Security-Policy'));
    expect(csp.length).toBeGreaterThan(0);
    for (const header of csp) expect(header).not.toMatch(googleFonts);

    expect(read('src/index.css')).toMatch(/@import '@getloopscale\/ui\/fonts\.css';/);
  });
});
