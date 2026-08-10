// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// M12 T2.1 (plan m12-dashboard-validation) — accessibility assertions by REAL DOM
// + axe-core scan, replacing the engine's `dev-public-dashboard-*.sh` bundle-grep
// scripts (which asserted these fixes by grepping minified literals like
// `role:"progressbar"` in the served JS chunk — the D1 anti-pattern).
//
// Hermetic: runs against the local Vite dev server with VITE_USE_MOCKS=true
// (playwright.config.ts webServer), no k3d / no dev-public. Covers the a11y issues
// #71 / #79 / #80 / #81 / #83 against the real rendered accessibility tree.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Dashboard a11y — DOM + axe (replaces bundle-grep)', () => {
  // #79 — heading hierarchy: no h1→h3 skip. axe `heading-order` is the WCAG oracle.
  // #71 — profile display name is layout-bounded (max-w-[28ch] break-words), asserted
  //       by the rendered node existing + not overflowing the viewport horizontally.
  test('#79/#71 profile: heading order valid + name node is layout-bounded', async ({ page }) => {
    await page.goto('/profile');

    const account = page.getByRole('heading', { name: /account/i });
    await expect(account).toBeVisible();

    const results = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
    expect(results.violations, 'axe heading-order violations on /profile').toEqual([]);

    // #71 — the name node exists and does not blow out horizontal layout.
    const name = page.getByTestId('profile-name');
    await expect(name).toBeVisible();
    const box = await name.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'profile-name has a bounding box').not.toBeNull();
    if (box && viewport) {
      expect(box.width, 'profile-name width must not exceed the viewport').toBeLessThanOrEqual(viewport.width);
    }
  });

  // #81 — a barra ARIA do onboarding NÃO é coberta aqui. Ela é coberta em
  // `src/components/onboarding/onboarding-panel.test.tsx:118`, que assere o mesmo
  // contrato (`role=progressbar`, `aria-valuenow`, `aria-valuemax=100`, nome acessível
  // "onboarding progress").
  //
  // Por que saiu daqui, com a medição: o painel só existe enquanto o onboarding está
  // INCOMPLETO (`use-onboarding-state.ts:159` — `completed < total`), e os cinco passos
  // derivam de dados: whoami, projetos, um deploy bem-sucedido, um domínio. A conta mockada
  // satisfaz os cinco, então o painel corretamente não renderiza e o caso reprovava um
  // produto CERTO.
  //
  // Ele nunca esteve sólido: passava enquanto os dados do mock estivessem incompletos, e
  // quebrou quando eles ficaram completos. Interceptar a rota de domínios para forçar a
  // pré-condição não funciona — a camada de mocks intercepta o `fetch` DENTRO da página, e
  // o `page.route` do Playwright nunca vê a requisição (medido: zero requisições de
  // `domains` observadas).
  //
  // Cobertura de runtime de navegador para o painel exige uma fixture com onboarding
  // incompleto, e isso é trabalho próprio: registrado como **B-107**. Fingir cobertura com
  // um caso vermelho permanente, ou com uma asserção condicional que passa vazia, seria
  // pior que declarar a lacuna.
  //
  // O que SOBRA aqui é verdadeiro e vale proteger: uma conta estabelecida não é cobrada por
  // um onboarding que ela já terminou.
  test('#81/M57 — conta com onboarding completo não recebe o painel de cobrança', async ({ page }) => {
    await page.goto('/');
    // A âncora positiva: a página carregou de fato (senão a ausência abaixo é vácuo).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /get your app live/i }),
      'o painel de onboarding apareceu para uma conta que já tem projeto, deploy e domínio',
    ).toHaveCount(0);
  });

  // #80 — the recovery code field is an OTP-friendly numeric input (inputmode +
  // one-time-code autofill), asserted on the real input, not grepped from the bundle.
  // The JS-layer dev-mock (src/lib/dev-mocks.ts) advances recovery email→code on the
  // POST submit, so we drive the real (mocked) flow to render the `#recovery-code` input.
  test('#80 recovery: code input is OTP-friendly (inputmode numeric + one-time-code)', async ({ page }) => {
    // Recovery hides its form when a session exists; the dev-mock honors this global
    // to render the signed-out flow (src/lib/dev-mocks.ts § mocksLoggedOut).
    await page.addInitScript(() => {
      (window as unknown as { __THEO_MOCK_LOGGED_OUT: boolean }).__THEO_MOCK_LOGGED_OUT = true;
    });
    // The mocked email-phase flow's ui.action is a fragment (`#mock-submit-recovery`),
    // so the email-submit POST resolves to /recovery?... and escapes the dev-mock's
    // /self-service/* fetch wrapper — which lets page.route() answer it with the
    // code-phase flow (state sent_email + a `name:"code"` node → setPhase('code')).
    await page.route('**/recovery?**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'sent_email',
          ui: { messages: [], nodes: [{ type: 'input', group: 'code', attributes: { name: 'code', type: 'text' }, messages: [], meta: {} }] },
        }),
      });
    });
    // A ?flow= id keeps the page in-SPA (it loads the mocked flow instead of doing a
    // top-level redirect to the Kratos browser-init endpoint).
    await page.goto('/recovery?flow=mock-recovery-flow');
    const email = page.locator('#recovery-email');
    await expect(email).toBeVisible();
    await email.fill('user@example.com');
    await page.getByRole('button', { name: /send recovery code/i }).click();

    const code = page.locator('#recovery-code');
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  });

  // #83 — the New Project name field is programmatically linked to its validation
  // error (aria-invalid + aria-describedby → the error region), so AT users hear it.
  test('#83 create-project: name input links to its error via aria-invalid + describedby', async ({ page }) => {
    await page.goto('/projects');
    // Open the New Project sheet (PageShell primaryAction).
    await page.getByRole('button', { name: /new project/i }).first().click();
    const nameInput = page.locator('#project-name');
    await expect(nameInput).toBeVisible();
    // Trigger the validation error with an invalid slug.
    await nameInput.fill('Invalid Name With Spaces!');
    await page.getByRole('button', { name: /create/i }).first().click();
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'name input is described by the error region').toContain('project-name-error');
    await expect(page.locator('#project-name-error')).toBeVisible();
  });
});
