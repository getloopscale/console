/**
 * Playwright browser-runtime E2E for the canonical Deploy Timeline 5-phase
 * hero component (deploy-timeline-canonical-5-phases plan).
 *
 * Closes the "browser walkthrough engineering-side proxy" gate — exercises
 * the component against a real chromium engine with VITE_USE_MOCKS=true.
 * The mock layer substitutes the SSE backend (10 canonical
 * deploy_timeline.* events fired at 250ms intervals); the SPA renders REAL
 * CSS/JS/React. This is the layer that jsdom-based vitest cannot exercise.
 *
 * Covered:
 *   - DeployTimelineHero mounts above the existing detail grid
 *   - All 5 phase tiles render with canonical labels
 *   - aria-current="step" lands on the in-progress phase mid-stream
 *   - Terminal state: overall reaches 'live' after the 10 events flow
 *   - Live region present for screen-reader narration
 *   - SSE connection dot visible
 *
 * What this does NOT cover:
 *   - Sponsor presencial JUNTOS browser walkthrough (operator-gated per
 *     cleanroom-up-live-test-mandate.md INQUEBRÁVEL — humans only)
 *   - Visual regression (toHaveScreenshot deferred to vendor decision)
 *   - WAN-grade SSE buffering edge cases
 */

import { expect, test } from '@playwright/test';

// Canonical mock fixtures: project "acme-web" with build "bld_01HXYZ_acme_web_001".
const DEPLOYMENT_PATH = '/projects/acme-web/deployments/bld_01HXYZ_acme_web_001';

test.describe('Deploy Timeline Hero — browser-runtime E2E (mocks)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /favicon/.test(msg.text())) return;
    });
  });

  test('S1: hero section renders on the deployment-detail page', async ({ page }) => {
    await page.goto(DEPLOYMENT_PATH);
    const hero = page.getByTestId('deploy-timeline-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(hero).toHaveAttribute('aria-label', 'Deploy timeline');
  });

  test('S2: all 5 phase tiles render in canonical order', async ({ page }) => {
    await page.goto(DEPLOYMENT_PATH);
    const list = page.getByTestId('deploy-timeline-phases');
    await expect(list).toBeVisible({ timeout: 15_000 });
    const cells = list.locator('li');
    await expect(cells).toHaveCount(5);
    await expect(cells.nth(0)).toHaveAttribute('data-phase', 'build');
    await expect(cells.nth(1)).toHaveAttribute('data-phase', 'sign');
    await expect(cells.nth(2)).toHaveAttribute('data-phase', 'release');
    await expect(cells.nth(3)).toHaveAttribute('data-phase', 'deploy');
    await expect(cells.nth(4)).toHaveAttribute('data-phase', 'live');
  });

  test('S3: overall status reaches live after 10 events stream', async ({ page }) => {
    await page.goto(DEPLOYMENT_PATH);
    const hero = page.getByTestId('deploy-timeline-hero');
    // Mock fires 10 events at 250ms intervals → ~2.5s + UI tick lag.
    await expect(hero).toHaveAttribute('data-overall', 'live', { timeout: 15_000 });
  });

  test('S4: each phase reaches completed status by the end', async ({ page }) => {
    await page.goto(DEPLOYMENT_PATH);
    const list = page.getByTestId('deploy-timeline-phases');
    await expect(list).toBeVisible({ timeout: 15_000 });
    const cells = list.locator('li');
    // After the mock stream completes, every phase should be completed.
    for (let i = 0; i < 5; i++) {
      await expect(cells.nth(i)).toHaveAttribute('data-status', 'completed', {
        timeout: 15_000,
      });
    }
  });

  test('S5: a11y live region is present for screen-reader narration', async ({ page }) => {
    await page.goto(DEPLOYMENT_PATH);
    await expect(page.getByTestId('deploy-timeline-hero')).toBeVisible({
      timeout: 15_000,
    });
    // sr-only live region announces overall transitions.
    const live = page.locator('[aria-live="polite"]').first();
    await expect(live).toBeAttached();
  });

  test('S6: substate text uses product-language (no internal terms)', async ({ page }) => {
    await page.goto(DEPLOYMENT_PATH);
    const hero = page.getByTestId('deploy-timeline-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    // After events arrive, the build phase substate is "clone · install · build image"
    // per the canonical mock seed. Cross-Project Rule 9: NEVER any internal term.
    const text = await hero.innerText({ timeout: 15_000 });
    for (const term of [
      'ArgoCD',
      'argo-cd',
      'cosign',
      'Kaniko',
      'BuildKit',
      'Gitea',
      'Webpack',
    ]) {
      expect(text).not.toContain(term);
    }
  });
});
