// @vitest-environment node
// index.theme-border.test.ts — regression guard for the global themed-border rule.
//
// The design tokens are oklch (`--border: oklch(0.28 0 0)`), so wrapping them in
// hsl() (`border-color: hsl(var(--border))`) produces an invalid color and the
// border falls back to currentColor — a near-white border on the dark theme
// (the "All Projects" dropdown white border, and every lib component that uses a
// bare `border` utility). The global default MUST reference the token directly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs with cwd = dashboard/; the stylesheet lives at src/index.css.
// Strip block comments first — the guard checks RULES, not explanatory prose
// (comments here legitimately quote the forbidden `hsl(var(--…))` pattern).
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('global themed base layer — no oklch token wrapped in hsl()', () => {
  // The oklch tokens (--border, --primary, --foreground, --background, --input)
  // must NEVER be wrapped in hsl(): that produces an invalid color, so the
  // declaration is dropped and the property falls back — a white border, an
  // invisible text-selection highlight, an unstyled scrollbar, etc.
  // (--ring is intentionally an HSL triplet in :root for light-mode focus
  //  contrast, so hsl(var(--ring)) is allowed and not asserted here.)
  it.each(['border', 'primary', 'foreground', 'background', 'input'])(
    'never wraps --%s in hsl()',
    (token) => {
      expect(css).not.toMatch(new RegExp(`hsl\\(var\\(--${token}\\)`));
    },
  );

  it('sets the global element border-color from the --border token directly', () => {
    expect(css).toMatch(/border-color:\s*var\(--border\)/);
  });

  it('gives ::selection a visible highlight via color-mix on the oklch primary', () => {
    expect(css).toMatch(/color-mix\(in oklch, var\(--primary\) 25%, transparent\)/);
  });
});
