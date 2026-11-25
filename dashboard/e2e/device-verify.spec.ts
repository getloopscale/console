/**
 * Playwright browser-runtime E2E for Journey J-05 Device Verify page.
 *
 * Plan: .claude/knowledge-base/plans/2026-06-05-dashboard-journey-j05-device-success-plan.md
 *       (iter 3 amendment — Hydra v2.6 requires operator-hosted device-verify UI;
 *        Hydra's built-in /oauth2/fallbacks/device is the "config missing" error page)
 *
 * Cenário 1 (canonical happy path):
 *   page.goto('/device-verify?device_challenge=X&user_code=Y') →
 *   user_code input pre-filled → click Authorize → wait for fetch to
 *   /v1/auth/device/accept → assert window.location.href followed redirect_to.
 *
 * Cenário 2 (missing device_challenge):
 *   page.goto('/device-verify?user_code=Y') (no challenge) → error visible.
 *
 * Cenário 3 (Hydra rejects user_code):
 *   page.goto('/device-verify?device_challenge=X&user_code=BAD') → submit →
 *   mocked 400 response with actionable message → error visible.
 */

import { expect, test } from '@playwright/test';

test.describe('J-05 Device Verify — dogfood Cenários (DOM-driven)', () => {
  test('Cenário 1: device-verify pre-fills user_code and follows redirect_to on submit', async ({ page, context }) => {
    // Holder, e não `let … = null`. O TS estreita uma variável atribuída SÓ dentro de um
    // callback para o tipo do inicializador — ele não prova que a rota roda —, e no ponto
    // de leitura `observedBody?.x` vira acesso a `never`. A propriedade de um objeto não
    // sofre esse estreitamento. Ficou invisível por meses porque `e2e/` estava fora do
    // escopo do `npm run typecheck`.
    const observado: { body: { device_challenge: string; user_code: string } | null } = { body: null };

    await context.route('**/v1/auth/device/accept', async (route) => {
      const raw = route.request().postData();
      if (raw) {
        try {
          observado.body = JSON.parse(raw);
        } catch {
          observado.body = null;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          redirect_to: '/device-success?simulated=1',
        }),
      });
    });

    await page.goto('/device-verify?device_challenge=chal-abc&user_code=YC7V3TSE');

    const input = page.getByTestId('device-verify-user-code');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('YC7V3TSE');

    await page.getByTestId('device-verify-submit').click();

    await expect.poll(() => observado.body?.user_code, { timeout: 5000 }).toBe('YC7V3TSE');
    expect(observado.body?.device_challenge).toBe('chal-abc');

    // Submitting redirects to /device-success (mocked path).
    await expect(page).toHaveURL(/\/device-success/);
  });

  test('Cenário 2: missing device_challenge shows actionable error', async ({ page }) => {
    await page.goto('/device-verify?user_code=YC7V3TSE');
    await expect(page.getByTestId('device-verify-error')).toBeVisible();
    await expect(page.getByTestId('device-verify-error')).toContainText(/run.+loopscale login/i);
    // Submit button stays disabled — no fetch should fire.
    await expect(page.getByTestId('device-verify-submit')).toBeDisabled();
  });

  test('Cenário 3: bad user_code surfaces server message', async ({ page, context }) => {
    await context.route('**/v1/auth/device/accept', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'INVALID_REQUEST',
          message: 'Invalid user code.',
        }),
      });
    });

    await page.goto('/device-verify?device_challenge=chal-abc&user_code=BADCODE');
    await page.getByTestId('device-verify-submit').click();
    await expect(page.getByTestId('device-verify-error')).toContainText(/Invalid user code/i);
  });
});

/**
 * Cenário 4 — a propriedade de segurança, ponta a ponta.
 *
 * Os unitários ja cobrem a DECISAO (`safe-redirect.test.ts`) e o uso dela na
 * pagina (`device-verify.test.tsx`). Este caso cobre a FIACAO: que a decisao de
 * fato governa a navegacao do browser.
 *
 * Vale escrever porque o e2e ja provou pegar o que os unitarios nao pegaram —
 * o guard rejeitava `/device-success`, um caminho relativo de mesma origem, e
 * nenhum unitario acusou porque todos exercitavam URL absoluta. Um guard testado
 * so na forma que o autor imaginou e um guard testado pela metade.
 */
test('Cenário 4: um redirect_to hostil NAO move a pagina', async ({ page, context }) => {
  await context.route('**/v1/auth/device/accept', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Origem fora da allowlist: o caso do servico de auth mal configurado ou
      // de uma resposta injetada.
      body: JSON.stringify({ redirect_to: 'https://phishing.example.com/login' }),
    });
  });

  await page.goto('/device-verify?device_challenge=chal-abc&user_code=YC7V3TSE');
  await page.getByTestId('device-verify-submit').click();

  // O erro aparece...
  await expect(page.getByTestId('device-verify-error')).toBeVisible();
  // ...e, o que importa de verdade: a pagina NAO saiu do lugar.
  await expect(page).toHaveURL(/\/device-verify/);
  expect(page.url()).not.toContain('phishing.example.com');
});
