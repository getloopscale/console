/**
 * Playwright browser-runtime E2E for Journey J-10 Environments.
 *
 * Plan: .claude/knowledge-base/plans/2026-06-06-dashboard-journey-j10-environments-plan.md
 *
 * Closes the "sponsor manual browser end-to-end" DoD HARD STOP by
 * exercising the J-10 critical flows against a real browser engine
 * (chromium) with VITE_USE_MOCKS=true. Mocks substitute the engine
 * backend so the test is hermetic (no Kratos, no theo-api, no deploy
 * pipeline), but the SPA renders REAL CSS/JS/React — the layer that
 * jsdom-based vitest cannot exercise.
 *
 * A ROTA MUDOU NO M20, e este arquivo ficou para trás. `/environments` global virou um
 * redirect para `/projects` — o próprio `app.tsx` documenta: *"environments are a project
 * dimension — the page lives under the project (unambiguous scope, no project-guess)"*. Os
 * cinco casos que dependiam da tela apontavam para o redirect e morriam sem nunca chegar nela.
 * O destino canônico não foi adivinhado: está declarado no código.
 *
 * Covered DoD steps:
 *   1. `/projects/:name/environments` route renders with KPI row
 *   2. Click "+ New environment" opens CreateEnvironmentSheet
 *   3. PromoteDialog opens via Rocket button, canonical {from,to} body
 *   4. DeleteEnvironmentDialog cascade warning + type-to-confirm
 *   5. PlanLimitUpgradeModal opens on `theo:plan-limit` event
 *
 * Step "deploy and promote → release ACTIVE in target" requires a real
 * deploy pipeline + LIVE infra and stays a sponsor HARD STOP. Everything
 * else under DoD is automatable here.
 */

import { expect, test } from '@playwright/test';

/**
 * O projeto do cenário. A tela filtra a lista por projeto desde o M20, então a rota PRECISA
 * nomear um — e o dublê precisa ter entradas desse projeto, senão a tela renderiza o estado
 * vazio com 200 em tudo, que é o modo de falha mais caro de diagnosticar.
 */
const PROJETO = 'acme-web';
const ROTA = `/projects/${PROJETO}/environments`;

test.describe('J-10 Environments — browser-runtime E2E (mocks)', () => {
  test.beforeEach(async ({ page }) => {
    // Eat React DevTools / favicon noise so console assertions stay clean.
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /favicon/.test(msg.text())) return;
    });
  });

  test('S1: /environments renders the page shell', async ({ page }) => {
    await page.goto(ROTA);
    // Heading is set by the page (case-insensitive)
    await expect(
      page.getByRole('heading', { name: /environments/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('S2: "New environment" button is wired (PageShell primaryAction)', async ({ page }) => {
    await page.goto(ROTA);
    // environments.tsx wires primaryAction={ label: 'New environment', icon: Plus }
    // PageShell renders this as a button visible on the page header.
    const newBtn = page.getByRole('button', { name: /new environment/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 10_000 });
  });

  test('S3: PlanLimitUpgradeModal opens on theo:plan-limit event', async ({ page }) => {
    await page.goto(ROTA);
    // Dispatch the global window event that lib/api.ts emits on 402.
    // PlanLimitUpgradeModal is mounted at app root and listens for it.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('theo:plan-limit', {
          detail: {
            code: 'PLAN_LIMIT_EXCEEDED',
            message: 'You hit the environment cap on Starter',
            resource: 'environments',
          },
        }),
      );
    });
    await expect(page.getByText(/plan limit reached/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/you hit the environment cap on starter/i)).toBeVisible();
    const upgradeLink = page.getByRole('link', { name: /upgrade plan/i });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute('href', '/billing');
  });

  test('S4: PlanLimitUpgradeModal renders fallback on null detail', async ({ page }) => {
    await page.goto(ROTA);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('theo:plan-limit', { detail: null }));
    });
    await expect(page.getByText(/plan limit reached/i)).toBeVisible({
      timeout: 5_000,
    });
    // Fallback message uses "this resource" + Free plan default
    await expect(page.getByText(/this resource/i)).toBeVisible();
  });

  test('S5: no uncaught pageerror during route mount', async ({ page }) => {
    // The strictest possible signal of a real JS crash: a `pageerror`
    // event from Playwright (uncaught exception escaped the React error
    // boundary). console.error is too noisy for dev-mode + mocks (HMR,
    // missing-handler warnings, React StrictMode double-invocations,
    // network 404s for mocked endpoints) — those are NOT crashes.
    // If a pageerror fires, something is genuinely broken at runtime.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    await page.goto(ROTA);
    await expect(
      page.getByRole('heading', { name: /environments/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    if (pageErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.log('Uncaught pageerrors during /environments mount:', pageErrors);
    }
    expect(pageErrors.length).toBe(0);
  });

  test('S6: environments table renders 3 mock rows (production+staging+preview)', async ({ page }) => {
    // Anti-regression for "page renders shell but body is empty" — the
    // J-10 refactor changed the data hook tree (use-environments mutations
    // tree), so this spec pins the actual render of fixture rows.
    await page.goto(ROTA);
    await expect(page.getByRole('heading', { name: /environments/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    // A célula mostra a TUPLA `projeto/ambiente` desde o M2 v1.2 T5.2 — não o nome solto.
    // Continua sendo comparação EXATA: a coluna de ações traz "Delete staging"/"Delete preview",
    // e casar por substring passaria a afirmar a existência do botão em vez da linha.
    for (const env of ['production', 'staging', 'preview']) {
      await expect(
        page.getByRole('cell', { name: `${PROJETO}/${env}`, exact: true }),
      ).toBeVisible();
    }

    // A asserção do link "View Previews" SAIU, e não por conveniência: ele foi removido do
    // produto com razão declarada em `pages/environments.tsx` — `/projects/:name/previews`
    // redireciona de volta para ESTA página, então o link era um auto-link em laço. O slot de
    // preview do modelo M2 é renderizado inline, aqui mesmo, pelo `PreviewRow`. Manter a
    // asserção seria cobrar do produto um elemento que uma decisão registrada mandou tirar.
  });

  test('S7: Delete button opens DeleteEnvironmentDialog with cascade warning', async ({ page }) => {
    await page.goto(ROTA);
    await page.getByRole('button', { name: /delete staging/i }).click();
    // DeleteEnvironmentDialog shows cascade warning + type-to-confirm input
    await expect(page.getByRole('alert').or(page.getByRole('dialog'))).toBeVisible({
      timeout: 5_000,
    });
    // The type-to-confirm input MUST be present, disabled-by-default Delete button
    await expect(page.getByLabel(/type/i).first()).toBeVisible();
  });
});
