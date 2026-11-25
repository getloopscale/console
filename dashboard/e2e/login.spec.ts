/**
 * Playwright browser-runtime E2E for Journey J-01 Login polish (OIDC error states).
 *
 * Plan: .claude/knowledge-base/plans/2026-06-16-m0-j01-login-polish-plan.md (DoD T4.3).
 * Matches the delivered-journey bar (J-04 recovery.spec.ts, J-05 device-*.spec.ts).
 *
 * Scenario A (OAuth denial): the login flow carries a ui.messages error → the page
 *   renders the honest "We couldn't sign you in." Alert (login.tsx:373), does NOT
 *   silently redirect, and keeps the OIDC buttons for a retry.
 * Scenario B/C (?provider= autofocus): /login?provider=github|google autofocuses
 *   the matching OIDC button + gives it the visual ring (login.tsx:382/393).
 *
 * Hermetic harness note: the global webServer runs with VITE_USE_MOCKS=true and a
 * mock session logged-IN (so dashboard specs work). The dev-mocks fetch wrapper
 * (src/lib/dev-mocks.ts) intercepts EVERY /self-service/* request at the JS layer,
 * so Playwright page.route() can never reach the Kratos flow endpoints. Auth-page
 * e2e therefore drives the mock layer via two dev-only per-page runtime flags set
 * before app load: `__LOOPSCALE_MOCK_LOGGED_OUT` (render logged-out, not redirect to /)
 * and `__LOOPSCALE_MOCK_FLOW_ERROR` (inject a ui.messages error into the mocked login
 * flow). Both are dead-code-eliminated in production (gated by mocksEnabled()).
 */

import { expect, test } from '@playwright/test';

/**
 * Render the login page logged-out (and optionally with an injected flow error).
 * addInitScript runs before any app script, so the flags are visible the first
 * time getSession()/the flow mock evaluate them.
 */
async function setupLoginPage(page: import('@playwright/test').Page, opts: { error?: string } = {}) {
  await page.addInitScript((error: string | null) => {
    (window as unknown as { __LOOPSCALE_MOCK_LOGGED_OUT?: boolean }).__LOOPSCALE_MOCK_LOGGED_OUT = true;
    if (error) {
      (window as unknown as { __LOOPSCALE_MOCK_FLOW_ERROR?: string }).__LOOPSCALE_MOCK_FLOW_ERROR = error;
    }
  }, opts.error ?? null);
}

test.describe('J-01 Login polish — OIDC error states (DOM-driven)', () => {
  test('Scenario A: OAuth denial renders the honest "We couldn\'t sign you in." Alert, not a silent redirect', async ({ page }) => {
    await setupLoginPage(page, { error: 'The provider denied the request or the login could not be completed.' });
    await page.goto('/login?flow=login-denied-1');

    await expect(page.getByText(/we couldn't sign you in/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /continue with github/i })).toBeVisible();
  });

  test('Scenario B: /login?provider=github autofocuses the GitHub button with a visual ring', async ({ page }) => {
    await setupLoginPage(page);
    await page.goto('/login?provider=github');

    const gh = page.getByRole('button', { name: /continue with github/i });
    await expect(gh).toBeVisible();
    await expect(gh).toBeFocused();
    expect(await gh.getAttribute('class')).toContain('ring-2');
  });

  test('Scenario C: /login?provider=google autofocuses the Google button with a visual ring', async ({ page }) => {
    await setupLoginPage(page);
    await page.goto('/login?provider=google');

    const gg = page.getByRole('button', { name: /continue with google/i });
    await expect(gg).toBeVisible();
    await expect(gg).toBeFocused();
    expect(await gg.getAttribute('class')).toContain('ring-2');
  });
});
