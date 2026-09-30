/**
 * Playwright browser-runtime E2E for Journey J-09 Project Connect.
 *
 * Plan: .claude/knowledge-base/plans/2026-06-05-dashboard-journey-j09-project-connect-plan.md
 * Task: T6.1 — 4 cenários driving the install/picker/connect FSM through
 *              page.route() stubs (EC-5 strategy).
 *
 * CRITICAL: route() MUST be set BEFORE goto() — otherwise the first
 * request bypasses the stub (Playwright does NOT queue handlers).
 * Cenário comments call this out explicitly per EC-18 of the plan.
 */

import { expect, test } from '@playwright/test';

/**
 * O PROJETO PRECISA EXISTIR **E** ESTAR DESCONECTADO — a premissa deste arquivo.
 *
 * Era `'demo'`, que não existe em fixture nenhum: o `ProjectGuard` renderizava
 * *"Project not found"* e o Cenário 1 procurava o botão de instalar numa tela que nunca foi a
 * de conexão. Os outros três casos não notaram porque **substituem** a chamada de conexão por
 * um dublê próprio — o único que depende do estado real do fixture é justamente o que falhava.
 *
 * `acme-ml-pipeline` é o projeto que `makeProjectConnection` devolve como `{ connected: false }`
 * (`src/lib/mocks/fixtures.ts`). Ele existe, então o guard deixa a tela montar, e está
 * desconectado, então a tela oferece instalar. Escolhido por medição, não por parecer plausível.
 */
const PROJECT = 'acme-ml-pipeline';
const CONNECT_PATH = `/projects/${PROJECT}/connect`;

// JWT_COOKIE is a no-op session cookie that keeps useRequireAuth from
// punting us to /login. The dashboard does not validate this cookie in
// dev mode — its presence alone is enough to keep the page mounted.
const JWT_COOKIE = {
  name: 'theo_session',
  value: 'pw-mock-session',
  url: 'http://localhost:5174',
};

test.describe('J-09 Project Connect — install + picker + connect flow', () => {
  // Cenários share network stubs that mutate per-test (e.g. Cenário 2's
  // getCalls counter). Running serially against the same dev server
  // avoids cross-test stub races; the suite still completes in <20s.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context, page }) => {
    await context.addCookies([JWT_COOKIE]);

    // EC-18: ALL auth + install stubs MUST be registered before any goto().
    // useRequireAuth asks the BFF for the session: GET /v1/auth/session. No token is
    // exchanged (usetheoai/theo#477) — the browser keeps only the session cookie.
    // Without this stub the dashboard immediately redirects to /login and the
    // connect page never mounts. We also stub the install endpoint so the popup
    // that handleInstallClick opens does NOT 404 (which would trigger the
    // same-tab fallback and navigate the test page away).
    await page.route('**/v1/auth/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ identity: { id: 'pw-id', email: 'pw@theo.test' } }),
      }),
    );
    await context.route('**/v1/integrations/github/install*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>install-stub</body></html>',
      }),
    );
  });

  test('Cenário 1 (T1.2): clicking "Install GitHub App" opens a new tab', async ({
    page,
    context,
  }) => {
    // EC-18: route MUST be registered before goto.
    await page.route('**/engine/api/v1/projects/*/connect', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ connected: false }) }),
    );
    // Stub the install endpoint so the popup that opens has something to
    // render (the dashboard would normally let it 302 to github.com).
    // We return a 200 with a minimal HTML body -- enough for Playwright
    // to receive the 'page' event without the network round trip.
    await context.route('**/v1/integrations/github/install*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>install-stub</body></html>',
      }),
    );

    await page.goto(CONNECT_PATH);
    const installButton = page.getByRole('button', { name: /install github app/i });
    await expect(installButton).toBeVisible();

    const popupPromise = context.waitForEvent('page', { timeout: 5_000 });
    await installButton.click();
    const popup = await popupPromise;
    const requestedURL = popup.url();
    expect(requestedURL).toMatch(
      /\/v1\/integrations\/github\/install\?return_to=/,
    );
  });

  test('Cenário 2 (T1.2): polling flips state to has_installation when GET returns installation_id', async ({
    page,
  }) => {
    // A SEQUÊNCIA VEM DA CAMADA DE DUBLÊ, NÃO DA REDE (issue #378).
    //
    // A versão anterior usava `page.route('**/projects/*/connect')`, e ele NUNCA disparava:
    // sob `VITE_USE_MOCKS=true` essa rota é servida em processo, sem tocar a rede. O cenário
    // parecia montar três respostas encadeadas e na verdade recebia sempre a estática do
    // fixture — e como o arquivo é serial e o Cenário 1 falhava antes, este aqui ficou PULADO,
    // nunca executado, então ninguém viu.
    //
    // `addInitScript` planta a sequência antes de qualquer script da aplicação. As duas
    // primeiras leituras dizem "sem instalação"; a terceira traz o `installation_id`, que é o
    // que a máquina de estados espera para avançar. Esgotada, a última se repete.
    await page.addInitScript(() => {
      (
        window as unknown as { __THEO_MOCK_CONNECT_SEQUENCE?: unknown[] }
      ).__THEO_MOCK_CONNECT_SEQUENCE = [
        { connected: false },
        { connected: false },
        { connected: false, installation_id: 777 },
      ];
    });
    await page.route(
      '**/engine/api/v1/integrations/github/installations/*/repositories',
      (route) =>
        route.fulfill({
          status: 200,
          body: JSON.stringify({ repositories: [] }), // empty list keeps the FSM in has_installation
        }),
    );

    await page.goto(CONNECT_PATH);
    await page.getByRole('button', { name: /install github app/i }).click();

    // FSM should reach has_installation -- either the picker label appears
    // OR the empty-state configure-link is rendered (repos returned []).
    // Polling fires every 2s; need at least 3 ticks (6s) for installation_id
    // to arrive + 1 tick for the engine repositories fetch to settle.
    await expect(
      page.getByRole('link', { name: /configure app access/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Cenário 3 (T2.2): repo picker filter narrows the option list', async ({
    page,
  }) => {
    // Estado inicial: app instalado, sem repositório escolhido. Vem pela ALAVANCA do dublê —
    // `/connect` é servida em processo e `page.route` não a alcança (issue #378).
    await page.addInitScript(() => {
      (
        window as unknown as { __THEO_MOCK_CONNECT_SEQUENCE?: unknown[] }
      ).__THEO_MOCK_CONNECT_SEQUENCE = [{ connected: false, installation_id: 555 }];
    });
    // A listagem de repositórios NÃO está no mapa do dublê, então ela sai pela rede de verdade
    // e o `page.route` funciona. Os dois mecanismos convivem, e a diferença não é arbitrária:
    // é o mapa que decide, não o teste.
    await page.route(
      '**/engine/api/v1/integrations/github/installations/*/repositories',
      (route) =>
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            repositories: [
              { full_name: 'owner/api', default_branch: 'main', private: false },
              { full_name: 'owner/web', default_branch: 'develop', private: true },
              { full_name: 'owner/cli', default_branch: 'main', private: false },
            ],
          }),
        }),
    );

    await page.goto(CONNECT_PATH);
    const repoSelect = page.getByLabel(/^repository$/i);
    await expect(repoSelect).toBeVisible();
    // 3 repo options + "Pick a repository..." default => 4 children.
    await expect(repoSelect.locator('option')).toHaveCount(4);

    await page.getByLabel(/filter/i).fill('web');
    // Filtering reduces options to {default, owner/web}. Options inside a
    // collapsed <select> are reported as hidden by Playwright, so we
    // assert via the value list rather than visibility.
    await expect(repoSelect.locator('option')).toHaveCount(2);
    const optionValues = await repoSelect.locator('option').evaluateAll((els) =>
      (els as HTMLOptionElement[]).map((o) => o.value),
    );
    expect(optionValues).toContain('owner/web');
  });

  test('Cenário 4 (T3.1): connect POST body shape is {repo, installation_id, branch, auto_deploy}', async ({
    page,
  }) => {
    // Estado inicial pela alavanca; o CORPO DO POST é lido de
    // `window.__THEO_MOCK_LAST_CONNECT_POST`, que o dublê registra. Não há alternativa:
    // `/connect` é servida em processo, então `page.route` não vê o pedido (issue #378).
    await page.addInitScript(() => {
      (
        window as unknown as { __THEO_MOCK_CONNECT_SEQUENCE?: unknown[] }
      ).__THEO_MOCK_CONNECT_SEQUENCE = [{ connected: false, installation_id: 42 }];
    });
    await page.route(
      '**/engine/api/v1/integrations/github/installations/*/repositories',
      (route) =>
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            repositories: [
              { full_name: 'owner/api', default_branch: 'main', private: false },
            ],
          }),
        }),
    );

    await page.goto(CONNECT_PATH);
    await page.getByLabel(/^repository$/i).selectOption('owner/api');
    await page.getByRole('button', { name: /connect repository/i }).click();

    // Poll until the POST has been observed -- avoids depending on
    // rendered-state heuristics like "Connected" text which depends on
    // Card.Title rendering + casing.
    const lerPost = () =>
      page.evaluate(
        () =>
          (window as unknown as { __THEO_MOCK_LAST_CONNECT_POST?: Record<string, unknown> })
            .__THEO_MOCK_LAST_CONNECT_POST ?? null,
      );
    await expect.poll(lerPost, { timeout: 5_000 }).not.toBeNull();
    const postBody = await lerPost();
    expect(postBody).toMatchObject({
      repo: 'owner/api',
      installation_id: 42,
      branch: 'main',
      auto_deploy: true,
    });
    // O campo legado NÃO pode ser enviado — e desde o #377 ele nem existe mais no tipo. A
    // asserção fica: é ela que trava a remoção, e foi por não haver quem a executasse (este
    // cenário estava pulado) que o dublê seguiu exigindo `repo_url` e QUEBRANDO a conexão em
    // todo ambiente mockado, sem ninguém notar.
    expect(postBody).not.toHaveProperty('repo_url');
  });
});
