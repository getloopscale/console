/**
 * Playwright browser-runtime E2E for Journey J-03 Verification (code entry + resend).
 *
 * Plan: .claude/knowledge-base/plans/2026-06-06-dashboard-journey-j03-verification-plan.md.
 * Matches the delivered-journey bar (J-04 recovery.spec.ts, J-05 device-*.spec.ts).
 *
 * Uses the dev-mocks per-page runtime override `__LOOPSCALE_MOCK_LOGGED_OUT` (see
 * login.spec.ts header + dev-mocks.ts) so the verification page renders its
 * form logged-out instead of redirecting to the mock dashboard.
 *
 * Scenario A: the input state renders the 6-digit PinInput + the resend cooldown
 *   button (T1.1 ResendCooldownButton, T1.3 auto-submit-capable PinInput).
 * Scenario B: a localStorage-persisted cooldown deadline (as if a prior resend
 *   happened, then the page reloaded) renders the resend button DISABLED with a
 *   live countdown — the anti-spam persistence that is J-03 T1.1's whole point.
 */

import { expect, test } from '@playwright/test';

test.describe('J-03 Verification — code entry + resend cooldown (DOM-driven)', () => {
  test('Scenario A: input state renders the 6-digit code field + enabled resend button', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __LOOPSCALE_MOCK_LOGGED_OUT?: boolean }).__LOOPSCALE_MOCK_LOGGED_OUT = true;
    });
    await page.goto('/verification?flow=verify-1');

    await expect(page.getByRole('heading', { name: /enter verification code/i })).toBeVisible();
    await expect(page.getByLabel('Verification code')).toBeVisible();
    await expect(page.getByRole('button', { name: /didn't receive the email\? resend/i })).toBeEnabled();
  });

  test('Scenario B: a persisted cooldown deadline renders the resend button disabled with a countdown', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __LOOPSCALE_MOCK_LOGGED_OUT?: boolean }).__LOOPSCALE_MOCK_LOGGED_OUT = true;
      // Simulate a resend that happened ~45s ago on a prior page load. The
      // deadline (epoch ms) survives the reload in localStorage — proving the
      // cooldown is not just in-memory component state.
      localStorage.setItem('loopscale-verify-resend-until', String(Date.now() + 45_000));
    });
    await page.goto('/verification?flow=verify-2');

    const resend = page.getByRole('button', { name: /resend available in/i });
    await expect(resend).toBeVisible();
    await expect(resend).toBeDisabled();
  });
});
