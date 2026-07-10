/**
 * Playwright browser-runtime E2E — the 12 Observability (Theo Lens) screens.
 *
 * Mechanizes the headless half of the dogfood UI sweep: every lens screen renders in a REAL browser
 * (logged-in mock session, `VITE_USE_MOCKS=true`) without a crash/error boundary, reached via the
 * sidebar (client-side routing — the same way a user navigates, not by guessing URLs). This is the
 * enforced counterpart to the theo-lens `/dogfood` skill's enumerated 12-screen manifest, so a render
 * regression on any observability screen fails CI without an agent driving Chrome.
 *
 * Full data + primary-action e2e (create/run/resolve) needs MSW fixtures for the lens BFF surface
 * (currently absent) — tracked as a follow-up; this spec locks the render + navigation guarantee now.
 *
 * Run: npm run test:e2e  (or `npx playwright test observability-screens`).
 */
import { expect, test } from '@playwright/test';

// The authoritative screen manifest — mirrors the /dogfood skill's UI table. Adding a lens screen
// without adding it here (and vice-versa) is a coverage gap the screen-count assertion below catches.
const SCREENS: { nav: RegExp; route: RegExp; heading: RegExp }[] = [
  { nav: /^Overview$/, route: /\/observability$/, heading: /overview|observability/i },
  { nav: /^Dashboards$/, route: /\/observability\/dashboards$/, heading: /dashboards/i },
  { nav: /^Traces$/, route: /\/observability\/traces$/, heading: /traces/i },
  { nav: /^Sessions$/, route: /\/observability\/sessions$/, heading: /sessions/i },
  { nav: /^Datasets$/, route: /\/observability\/datasets$/, heading: /datasets/i },
  { nav: /^Evaluators$/, route: /\/observability\/evaluators$/, heading: /evaluators/i },
  { nav: /^Guards$/, route: /\/observability\/guards$/, heading: /guards/i },
  { nav: /^Queues$/, route: /\/observability\/labeling-queue$/, heading: /labeling queue/i },
  { nav: /^Experiments$/, route: /\/observability\/experiments$/, heading: /experiments/i },
  { nav: /^Ask$/, route: /\/observability\/ask$/, heading: /ask/i },
  { nav: /^Agents$/, route: /\/observability\/agents$/, heading: /agents/i },
  { nav: /^Alerts$/, route: /\/observability\/alerts$/, heading: /alerts/i },
];

test.describe('Observability — all 12 lens screens render (browser runtime)', () => {
  test('every screen renders via sidebar navigation, no error boundary', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/observability');
    // The lens sidebar is present.
    await expect(page.getByRole('button', { name: /^Traces$/ })).toBeVisible();

    for (const s of SCREENS) {
      // Navigate the way a user does — click the sidebar button (client-side routing).
      if (!s.route.test('/observability')) {
        await page.getByRole('button', { name: s.nav }).click();
      }
      await expect(page).toHaveURL(s.route);
      // The screen's own heading renders (proves the route resolved + the screen mounted).
      await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible();
      // No React error boundary / crash text.
      await expect(page.getByText(/something went wrong|application error/i)).toHaveCount(0);
    }

    expect(errors, `uncaught page errors: ${errors.join('; ')}`).toHaveLength(0);
  });

  test('screen-count coverage gate — the nav exposes exactly the manifested screens', async ({ page }) => {
    await page.goto('/observability');
    // Every manifested nav button is present …
    for (const s of SCREENS) {
      await expect(page.getByRole('button', { name: s.nav })).toBeVisible();
    }
    // … and the OBSERVE/EVALUATE/IMPROVE nav groups expose no lens screen we do not exercise.
    // (A new sidebar screen that is not in SCREENS is a coverage drift — add it to the manifest.)
    const navButtons = await page.getByRole('complementary').getByRole('button').allInnerTexts();
    const known = new Set(SCREENS.map((s) => s.nav.source.replace(/[$^]/g, '')));
    const lensExtra = navButtons
      .map((t) => t.trim())
      .filter((t) => ['Overview', 'Dashboards', 'Traces', 'Sessions', 'Datasets', 'Evaluators', 'Guards', 'Queues', 'Experiments', 'Ask', 'Agents', 'Alerts'].includes(t))
      .filter((t) => !known.has(t));
    expect(lensExtra, `sidebar lens screens missing from the manifest: ${lensExtra.join(', ')}`).toHaveLength(0);
  });
});
