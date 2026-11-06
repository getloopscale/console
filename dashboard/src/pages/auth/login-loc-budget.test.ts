// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// M0 J-01 T3.1 (EC-4) — login.tsx LoC budget guard. After the Phase-2 component
// extraction (LoginErrorBanner / CookieBlockedAlert / NetworkRetryButton +
// return-to / safe-redirect helpers), the page must stay thin. A refactor that
// re-inflates it — inlining error rendering or redirect logic back into the page
// instead of a component — fails here and forces the split to be kept.
const BUDGET = 500;

describe('login.tsx LoC budget', () => {
  it('test_login_tsx_within_500_line_budget', () => {
    // vitest cwd is the dashboard package root; resolve the page from there
    // (import.meta.url is not a file:// scheme under jsdom).
    const path = resolve(process.cwd(), 'src/pages/auth/login.tsx');
    const content = readFileSync(path, 'utf8');
    // wc -l semantics: count newlines (a trailing newline is the line terminator,
    // not an extra line).
    const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    expect(lineCount).toBeLessThanOrEqual(BUDGET);
  });
});
