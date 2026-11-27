import { describe, it, expect } from 'vitest';
import { render } from '@/test/render';
import { BRAND_PRIMARY, TEMA_LOOPSCALE } from './loopscale-theme';

/**
 * The test tree renders the theme the app renders.
 *
 * The provider injects a `<style>` with the selector `[data-theme="…"][data-mode="…"]` and sets
 * both attributes on `<html>`, so the value the suite paints can be read here without a browser.
 * It catches what a comparison of source files cannot: a test tree configured differently from
 * the app, or a package bump that changes who wins.
 */
describe('design system theme', () => {
  it('the test tree computes the primary of the app', () => {
    render(<div />);

    const sheet = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    const theme = document.documentElement.getAttribute('data-theme');
    const mode = document.documentElement.getAttribute('data-mode');
    const rule = new RegExp(
      `\\[data-theme="${theme}"\\]\\[data-mode="${mode}"\\][^{]*\\{[^}]*--primary:\\s*([^;]+);`,
    );

    expect(theme).toBe(TEMA_LOOPSCALE.defaultTheme);
    expect((sheet.match(rule)?.[1] ?? '').trim()).toBe(BRAND_PRIMARY.dark);
  });

  it('the test tree renders in dark mode, like the app', () => {
    // In jsdom `prefers-color-scheme` is light. The theme turns `respectSystemMode` off and
    // stores nothing, so the suite cannot drift into a mode the product does not have.
    render(<div />);

    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });
});
