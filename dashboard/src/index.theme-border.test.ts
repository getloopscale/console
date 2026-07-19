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
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('global themed-border rule', () => {
  it('never wraps an oklch design token in hsl() (invalid → white fallback)', () => {
    // Tokens are oklch; hsl(var(--border)) / hsl(var(--input)) are invalid.
    expect(css).not.toMatch(/border-color:\s*hsl\(var\(--border\)\)/);
    expect(css).not.toMatch(/hsl\(var\(--input\)\)/);
  });

  it('sets the global element border-color from the --border token directly', () => {
    expect(css).toMatch(/border-color:\s*var\(--border\)/);
  });
});
