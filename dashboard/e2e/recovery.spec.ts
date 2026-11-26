/**
 * Playwright browser-runtime E2E for Journey J-04 Recovery (dogfood Cenários B + F).
 *
 * Plan: .claude/knowledge-base/plans/2026-06-05-dashboard-journey-j04-recovery-plan.md
 * Task: T5.3 — DOM-driven cenários that require browser state mutation (B + F).
 * Cenários A, C, C2, D, E live in T5.1 bash (HTTP + kubectl).
 *
 * Cenário B (OIDC educational link autofocus):
 *   /recovery → click "Sign in with GitHub" educational link
 *   → /login?provider=github → GitHub button receives autofocus + ring
 *
 * Cenário F (EC-4 retry currying — input mutation between fail and retry):
 *   /recovery → submit email "a@x.com" → mock network fail
 *   → user corrects to "b@x.com" → click Retry
 *   → assert submitFlow body contains CURRENT input "b@x.com"
 *
 * Mocked Kratos endpoints via page.route() — hermetic, runs in CI without
 * dev-public DNS dependency.
 */

import { expect, test } from '@playwright/test';

test.describe('J-04 Recovery — dogfood Cenários B + F (DOM-driven)', () => {
  /**
   * A PREMISSA DESTE ARQUIVO É "VISITANTE SEM SESSÃO", e até 2026-08-02 ela nunca foi
   * estabelecida.
   *
   * Os três casos falhavam procurando o campo de e-mail. Não era defeito de produto: com uma
   * sessão ativa, `/recovery` mostra de propósito *"You're already signed in"* e dois botões, e
   * essa tela existe por um achado de Red Team (`loop-console#54`) — antes havia um desvio
   * silencioso para `/`, que fazia o "Forgot password?" parecer quebrado. O dublê autentica por
   * padrão, então o teste pedia o formulário de recuperação a uma tela que, corretamente, não o
   * oferece.
   *
   * A alavanca já existia e é a mesma que o `login.spec.ts` usa: `__LOOPSCALE_MOCK_LOGGED_OUT`,
   * plantado por `addInitScript` — que roda ANTES de qualquer script da aplicação, então a
   * bandeira já está visível na primeira vez que `getSession()` a consulta. Um `page.evaluate`
   * depois do `goto` chegaria tarde: a verificação de sessão acontece na montagem.
   */
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __LOOPSCALE_MOCK_LOGGED_OUT?: boolean }).__LOOPSCALE_MOCK_LOGGED_OUT = true;
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Cenário B — OIDC educational link autofocus on /login?provider=
  // ────────────────────────────────────────────────────────────────────────
  test('Cenário B: educational link to /login?provider=github focuses GitHub button', async ({ page }) => {
    // Bootstrap a mocked recovery flow so /recovery renders without errors.
    await page.route('**/self-service/recovery/flows*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'rec-flow-1',
          ui: {
            action: '/self-service/recovery?flow=rec-flow-1',
            method: 'POST',
            nodes: [
              { attributes: { name: 'csrf_token', value: 'csrf-test' }, messages: [] },
              { attributes: { name: 'email', type: 'email' }, messages: [] },
            ],
            messages: [],
          },
        }),
      });
    });

    await page.goto('/recovery?flow=rec-flow-1');
    await expect(page.getByLabel('Email')).toBeVisible();

    // Click educational GitHub link
    await page.getByRole('link', { name: /sign in with github/i }).click();
    await expect(page).toHaveURL(/\/login\?provider=github/);

    // GitHub button on /login should be autofocused + have visual ring
    const ghButton = page.getByRole('button', { name: /continue with github/i });
    await expect(ghButton).toBeVisible();
    await expect(ghButton).toBeFocused();
    const cls = await ghButton.getAttribute('class');
    expect(cls).toContain('ring-2');
  });

  test('Cenário B (Google): educational link to /login?provider=google focuses Google button', async ({ page }) => {
    await page.route('**/self-service/recovery/flows*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'rec-flow-1',
          ui: {
            action: '/self-service/recovery?flow=rec-flow-1',
            method: 'POST',
            nodes: [
              { attributes: { name: 'csrf_token', value: 'csrf-test' }, messages: [] },
              { attributes: { name: 'email', type: 'email' }, messages: [] },
            ],
            messages: [],
          },
        }),
      });
    });

    await page.goto('/recovery?flow=rec-flow-1');
    await expect(page.getByLabel('Email')).toBeVisible();

    await page.getByRole('link', { name: /sign in with google/i }).click();
    await expect(page).toHaveURL(/\/login\?provider=google/);

    const googleButton = page.getByRole('button', { name: /continue with google/i });
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toBeFocused();
    const cls = await googleButton.getAttribute('class');
    expect(cls).toContain('ring-2');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Cenário F — EC-4 currying: Retry must read CURRENT input, not stale closure
  // ────────────────────────────────────────────────────────────────────────
  test('Cenário F (EC-4): Retry uses CURRENT email input, not snapshot from first submit', async ({ page }) => {
    // First mock the flow GET
    await page.route('**/self-service/recovery/flows*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'rec-flow-1',
          ui: {
            action: '/self-service/recovery?flow=rec-flow-1',
            method: 'POST',
            nodes: [
              { attributes: { name: 'csrf_token', value: 'csrf-test' }, messages: [] },
              { attributes: { name: 'email', type: 'email' }, messages: [] },
            ],
            messages: [],
          },
        }),
      });
    });

    // Track submitFlow request bodies
    // Holder pelo mesmo motivo de `device-verify.spec.ts`: atribuição só dentro do
    // callback de rota faz o TS estreitar a leitura para `never`.
    const enviado: {
      primeiro: Record<string, string> | null;
      segundo: Record<string, string> | null;
    } = { primeiro: null, segundo: null };
    let submitCount = 0;

    // O ALVO DO POST É A PRÓPRIA URL DA PÁGINA, e isso foi MEDIDO, não deduzido.
    //
    // Sob `VITE_USE_MOCKS=true` o flow não vem da rede: a camada de dublê o entrega com
    // `ui.action = '#mock-submit-recovery'`, um sentinela. `submitFlow` faz `fetch(action)` sem
    // ramo para mocks, e o navegador resolve um fragmento contra o documento atual — então o
    // POST sai para `/recovery?flow=rec-flow-1`. O padrão anterior (`/self-service/recovery?…`)
    // nunca casava, o pedido escapava para o servidor de desenvolvimento, voltava HTML, e o
    // `resp.json()` estourava. O botão "Retry" aparecia por esse erro, e não pelo erro que o
    // teste queria simular — então a asserção sobre o corpo media `undefined` para sempre.
    //
    // Interceptar o que a aplicação FAZ, não o que o teste gostaria que ela fizesse.
    await page.route(/\/recovery\?flow=rec-flow-1/, async (route) => {
      if (route.request().method() === 'POST') {
        // Playwright postDataJSON returns parsed JSON if content-type is JSON
        let body: Record<string, string> = {};
        try {
          body = (route.request().postDataJSON() as Record<string, string>) ?? {};
        } catch {
          // Fallback: parse raw post data
          const raw = route.request().postData();
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              body = {};
            }
          }
        }
        submitCount += 1;
        if (submitCount === 1) {
          enviado.primeiro = body;
          // First attempt: simulate network failure
          await route.abort('failed');
        } else {
          enviado.segundo = body;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'rec-flow-1',
              ui: {
                action: '/self-service/recovery?flow=rec-flow-1',
                method: 'POST',
                nodes: [
                  { attributes: { name: 'csrf_token', value: 'csrf-test' }, messages: [] },
                  { attributes: { name: 'code', type: 'text' }, messages: [] },
                ],
                messages: [],
              },
            }),
          });
        }
      } else {
        await route.continue();
      }
    });

    await page.goto('/recovery?flow=rec-flow-1');
    await expect(page.getByLabel('Email')).toBeVisible();

    // First submission with "a@x.com" → fails
    await page.getByLabel('Email').fill('a@x.com');
    await page.getByRole('button', { name: /send recovery code/i }).click();
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    expect(enviado.primeiro?.email).toBe('a@x.com');

    // User corrects email to "b@x.com" and clicks Retry
    await page.getByLabel('Email').fill('b@x.com');
    await page.getByRole('button', { name: /retry/i }).click();

    // Second submission should carry CURRENT input "b@x.com" (EC-4)
    await expect.poll(() => enviado.segundo?.email, { timeout: 5000 }).toBe('b@x.com');
  });
});
