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

  /**
   * #81 — a barra de progresso do onboarding é uma `progressbar` ARIA de verdade, medida em
   * NAVEGADOR, não só em jsdom.
   *
   * ## Como este caso chegou aqui
   *
   * Ele existia, reprovava, e eu o tirei: o painel só renderiza enquanto o onboarding está
   * INCOMPLETO (`use-onboarding-state.ts:159` — `completed < total`), os cinco passos derivam
   * de dados, e a conta mockada satisfaz os cinco. O caso cobrava um painel que o produto
   * corretamente não mostra — ele nunca esteve sólido: passava enquanto os dados do mock
   * estivessem incompletos e quebrou quando ficaram completos, ou seja, media o ambiente.
   *
   * Forçar a pré-condição pela rede não funciona, e isso foi medido: a camada de mocks
   * intercepta o `fetch` DENTRO da página, então `page.route('**\/api/v1/domains*')` nunca vê
   * a requisição — zero requisições observadas.
   *
   * A alavanca ficou do lado certo: `window.__LOOPSCALE_MOCK_NO_DOMAINS`, quarta do mesmo idioma
   * que `__LOOPSCALE_MOCK_LOGGED_OUT` já usava. **O teste declara o estado que precisa** em vez de
   * herdar o que o mock por acaso tiver — que é o que o tornava frágil.
   *
   * ## Por que em navegador, se jsdom já cobre
   *
   * `onboarding-panel.test.tsx:118` assere os mesmos atributos, e para atributos estáticos
   * jsdom basta. O que ele NÃO prova é que o painel é ALCANÇÁVEL: que existe um estado real
   * do produto em que ele aparece, que o botão recolhido expande, e que a barra sobrevive à
   * árvore inteira do app. O caso anterior morreu exatamente aí — o contrato ARIA estava
   * certo o tempo todo, e o painel é que não vinha.
   */
  test('#81 onboarding: a barra é uma progressbar ARIA com aria-valuenow', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __LOOPSCALE_MOCK_NO_DOMAINS?: boolean }).__LOOPSCALE_MOCK_NO_DOMAINS = true;
    });
    await page.goto('/');

    // O painel nasce RECOLHIDO; a barra só existe expandido, e expandir é o que o usuário faz.
    await page.getByRole('button', { name: /get your app live/i }).click();

    const barra = page.getByRole('progressbar', { name: /onboarding progress/i });
    await expect(barra).toBeVisible();

    const agora = await barra.getAttribute('aria-valuenow');
    expect(agora, 'a progressbar não expõe `aria-valuenow`').not.toBeNull();
    expect(Number(agora), '`aria-valuenow` não é numérico').not.toBeNaN();
    expect(await barra.getAttribute('aria-valuemax'), 'a progressbar não expõe `aria-valuemax`').toBe('100');
  });

  test('#81/M57 — conta com onboarding completo não recebe o painel de cobrança', async ({ page }) => {
    // A contraparte, e ela é o que a alavanca acima torna afirmável: sem poder escolher o
    // estado, este caso e o de cima seriam mutuamente exclusivos.
    await page.goto('/');
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
      (window as unknown as { __LOOPSCALE_MOCK_LOGGED_OUT: boolean }).__LOOPSCALE_MOCK_LOGGED_OUT = true;
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
