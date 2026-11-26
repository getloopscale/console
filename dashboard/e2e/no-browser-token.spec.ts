/**
 * getloopscale/loopscale#477 step 3 — the dashboard holds NO token.
 *
 * loop-console is the dashboard's Backend for Frontend: the browser keeps only the Kratos session
 * cookie, and every call is authenticated from it server-side. This spec checks the browser end
 * of that contract in a real engine: after walking a few screens, nothing token-shaped sits in
 * web storage, no request asks for the old HS256 exchange, and no request carries a bearer or a
 * credential in its URL.
 *
 * Limit, stated so the green is not read as more than it is: the suite runs with
 * VITE_USE_MOCKS=true, and the mock layer answers most API calls inside the page, where
 * `page.on('request')` cannot see them. The transport itself — headers, credentials mode, the
 * 401 → session-probe decision — is proven against the real client in `src/lib/http/api.test.ts`.
 */

import { expect, test } from '@playwright/test';

const JWT_SHAPE = /eyJ[\w-]{8,}\.[\w-]{8,}\./;

test.describe('the dashboard holds no token (getloopscale/loopscale#477)', () => {
  test('walking the dashboard stores no token and sends none', async ({ page }) => {
    const offending: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      const authorization = req.headers()['authorization'] ?? '';
      if (url.includes('/v1/auth/session/token')) offending.push(`exchange: ${req.method()} ${url}`);
      if (/^bearer /i.test(authorization)) offending.push(`bearer: ${req.method()} ${url}`);
      if (/[?&](token|access_token)=/.test(url)) offending.push(`query credential: ${url}`);
    });

    for (const path of ['/', '/projects', '/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    const stored = await page.evaluate(() =>
      [...Object.entries(window.localStorage), ...Object.entries(window.sessionStorage)].map(
        ([name, value]) => `${name}=${String(value)}`,
      ),
    );

    expect(offending).toEqual([]);
    expect(stored.filter((entry) => JWT_SHAPE.test(entry) || /access_token|jwt/i.test(entry))).toEqual([]);
  });
});
