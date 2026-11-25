/**
 * Playwright browser-runtime E2E for the project connect page.
 *
 * The page lists the GitHub App installations GitHub confirmed for the team and shows the
 * authorization button, the account picker or the repository picker from that list.
 *
 * Two kinds of test double are in play, and which one applies is decided by the mock layer:
 * - `/connect` and the installations list are served in process (`src/lib/mocks/handlers.ts`),
 *   so `page.route` never sees them. A test sets the installations with
 *   `window.__LOOPSCALE_MOCK_GITHUB_INSTALLATIONS` through `addInitScript`.
 * - The repository list of an installation is not in the mock map and goes to the network, so
 *   `page.route` answers it. Routes must be registered before `goto`.
 */

import { expect, test, type Page } from '@playwright/test';

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

const ACME = { id: 42, account_login: 'acme', account_type: 'Organization' };
const DEV = { id: 77, account_login: 'dev', account_type: 'User' };

const REPOSITORIES_ROUTE = '**/engine/api/v1/integrations/github/installations/*/repositories';

test.describe('Project connect: authorize, pick the account, pick the repository', () => {
  test.describe.configure({ mode: 'serial' });

  /** Sets the installations the in-process mock lists. Must run before `goto`. */
  async function setInstallations(page: Page, installations: unknown[]) {
    await page.addInitScript((list) => {
      (
        window as unknown as { __LOOPSCALE_MOCK_GITHUB_INSTALLATIONS?: unknown[] }
      ).__LOOPSCALE_MOCK_GITHUB_INSTALLATIONS = list;
    }, installations);
  }

  /** Answers the repository list and records which installation ids were asked for. */
  async function stubRepositories(page: Page, repositories: unknown[]): Promise<string[]> {
    const requested: string[] = [];
    await page.route(REPOSITORIES_ROUTE, (route) => {
      const id = route.request().url().match(/installations\/(\d+)\/repositories/)?.[1];
      if (id) requested.push(id);
      return route.fulfill({ status: 200, body: JSON.stringify({ repositories }) });
    });
    return requested;
  }

  test.beforeEach(async ({ context, page }) => {
    await context.addCookies([JWT_COOKIE]);
    // useRequireAuth asks the BFF for the session. Without this stub the dashboard redirects to
    // /login and the connect page never mounts.
    await page.route('**/v1/auth/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ identity: { id: 'pw-id', email: 'pw@loopscale.test' } }),
      }),
    );
    // The button navigates this tab to the control plane, which would 302 to github.com.
    await context.route('**/v1/integrations/github/install*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>install-stub</body></html>',
      }),
    );
  });

  test('with no installation, the one button starts the authorization in this tab', async ({
    page,
    context,
  }) => {
    const repositoriesRequested = await stubRepositories(page, []);
    // An installation id in the URL must not put the page in the picker.
    await page.goto(`${CONNECT_PATH}?installed=1&installation_id=999`);

    const button = page.getByRole('button', { name: /continue to github/i });
    await expect(button).toBeVisible();
    await expect(page.getByLabel(/^repository$/i)).toHaveCount(0);
    await expect(page.getByText(/waiting for the github install/i)).toHaveCount(0);
    expect(repositoriesRequested).toEqual([]);

    await button.click();
    await page.waitForURL(/\/v1\/integrations\/github\/install\?return_to=/);
    expect(new URL(page.url()).searchParams.get('return_to')).toBe(CONNECT_PATH);
    await expect(page.getByText('install-stub')).toBeVisible();
    expect(context.pages()).toHaveLength(1);
  });

  test('with one installation, the repository picker opens and the filter narrows it', async ({
    page,
  }) => {
    await setInstallations(page, [ACME]);
    const repositoriesRequested = await stubRepositories(page, [
      { full_name: 'owner/api', default_branch: 'main', private: false },
      { full_name: 'owner/web', default_branch: 'develop', private: true },
      { full_name: 'owner/cli', default_branch: 'main', private: false },
    ]);

    await page.goto(CONNECT_PATH);
    const repoSelect = page.getByLabel(/^repository$/i);
    await expect(repoSelect).toBeVisible();
    await expect(page.getByLabel(/github account/i)).toHaveCount(0);
    expect(repositoriesRequested).toEqual(['42']);
    // 3 repositories plus the "Pick a repository…" placeholder.
    await expect(repoSelect.locator('option')).toHaveCount(4);

    await page.getByLabel(/filter/i).fill('web');
    // Options inside a collapsed <select> are reported as hidden, so the assertion reads values.
    await expect(repoSelect.locator('option')).toHaveCount(2);
    const optionValues = await repoSelect
      .locator('option')
      .evaluateAll((els) => (els as HTMLOptionElement[]).map((o) => o.value));
    expect(optionValues).toContain('owner/web');
  });

  test('with several installations, the user picks the account first', async ({ page }) => {
    await setInstallations(page, [ACME, DEV]);
    const repositoriesRequested = await stubRepositories(page, [
      { full_name: 'dev/site', default_branch: 'main', private: false },
    ]);

    await page.goto(CONNECT_PATH);
    const account = page.getByLabel(/github account/i);
    await expect(account).toBeVisible();
    await expect(page.getByLabel(/^repository$/i)).toHaveCount(0);
    expect(repositoriesRequested).toEqual([]);

    await account.selectOption({ label: 'dev (User)' });
    await expect(page.getByLabel(/^repository$/i)).toBeVisible();
    expect(repositoriesRequested).toEqual(['77']);
  });

  test('connect sends {repo, installation_id, branch, auto_deploy} with the listed installation', async ({
    page,
  }) => {
    await setInstallations(page, [ACME]);
    await stubRepositories(page, [
      { full_name: 'owner/api', default_branch: 'main', private: false },
    ]);

    // The id in the URL is not the listed one, and must not be the one sent.
    await page.goto(`${CONNECT_PATH}?installation_id=999`);
    await page.getByLabel(/^repository$/i).selectOption('owner/api');
    await page.getByRole('button', { name: /connect repository/i }).click();

    // `/connect` is served in process, so the body is read from the lever the mock fills.
    const readPost = () =>
      page.evaluate(
        () =>
          (window as unknown as { __LOOPSCALE_MOCK_LAST_CONNECT_POST?: Record<string, unknown> })
            .__LOOPSCALE_MOCK_LAST_CONNECT_POST ?? null,
      );
    await expect.poll(readPost, { timeout: 5_000 }).not.toBeNull();
    const postBody = await readPost();
    expect(postBody).toMatchObject({
      repo: 'owner/api',
      installation_id: 42,
      branch: 'main',
      auto_deploy: true,
    });
    // The legacy field left the type in #377 and must not come back.
    expect(postBody).not.toHaveProperty('repo_url');
  });

  test('a github_error in the URL is shown as a sentence, with the button to try again', async ({
    page,
  }) => {
    await page.goto(`${CONNECT_PATH}?github_error=GITHUB_CODE_REJECTED`);
    await expect(page.getByText(/authorization expired before it could be used/i)).toBeVisible();
    await expect(page.getByText('GITHUB_CODE_REJECTED')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /continue to github/i })).toBeVisible();
  });

  test('a 403 from the repository list offers the authorization', async ({ page }) => {
    await setInstallations(page, [ACME]);
    await page.route(REPOSITORIES_ROUTE, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'FORBIDDEN',
          message: 'You do not have access to this installation.',
        }),
      }),
    );

    await page.goto(CONNECT_PATH);
    await expect(page.getByText(/installation needs authorization/i)).toBeVisible();
    await page.getByRole('button', { name: /authorize on github/i }).click();
    await page.waitForURL(/\/v1\/integrations\/github\/install\?return_to=/);
  });
});
