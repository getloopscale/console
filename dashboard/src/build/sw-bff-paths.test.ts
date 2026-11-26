// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { BFF_NAVIGATION_DENYLIST, BFF_NAVIGATION_REGEXP, isBffNavigationPath } from './sw-bff-paths';

const denied = (p: string) => BFF_NAVIGATION_DENYLIST.some((re) => re.test(p));

describe('SW BFF navigation denylist — the service worker must NOT shadow BFF navigations', () => {
  it('denies /v1/rag-connect authorize AND callback (loop-console#203 — OAuth "Connect with X")', () => {
    // Both are top-level browser navigations by design; without the denylist the
    // Workbox navigateFallback serves the SPA shell → React Router "Page not found".
    expect(denied('/v1/rag-connect/google-drive/authorize')).toBe(true);
    expect(denied('/v1/rag-connect/google-drive/callback')).toBe(true);
    expect(isBffNavigationPath('/v1/rag-connect/dropbox/authorize')).toBe(true);
  });

  it('denies the GitHub App install and callback, which redirect the browser to and from GitHub', () => {
    // "Install GitHub App" opens /v1/integrations/github/install in a tab; the BFF answers
    // 302 to github.com. Shadowed, the tab shows the SPA's "Page not found".
    expect(denied('/v1/integrations/github/install')).toBe(true);
    expect(denied('/v1/integrations/github/callback')).toBe(true);
    expect(BFF_NAVIGATION_REGEXP.test('https://app.example.test/v1/integrations/github/install?return_to=%2F')).toBe(true);
  });

  it('still denies the Hydra/Kratos auth-broker navigations (loop-console#112 regression)', () => {
    for (const p of [
      '/auth/login',
      '/auth/login/complete',
      '/auth/consent',
      '/auth/device',
      '/api/v1/auth/session/token',
      '/sessions/whoami',
      '/self-service/login/browser',
      '/oauth2/auth',
    ]) {
      expect(isBffNavigationPath(p)).toBe(true);
    }
  });

  it('does NOT deny real SPA routes — the SPA fallback must still serve them', () => {
    for (const p of ['/', '/rag/connectors', '/projects/teste', '/rag/graphrag', '/v1x/not-a-bff']) {
      expect(isBffNavigationPath(p)).toBe(false);
    }
  });
});

describe('SW runtimeCaching urlPattern must be a self-contained RegExp value', () => {
  // Regression: the NetworkOnly runtimeCaching entry used a FUNCTION urlPattern
  // `({ url }) => isBffNavigationPath(url.pathname)`. Workbox generateSW stringifies
  // the urlPattern into sw.js, but does NOT bundle the imported helper — so the SW
  // threw `ReferenceError: isBffNavigationPath is not defined` inside findMatchingRoute
  // for EVERY request, breaking all SW routing (file uploads included). A RegExp VALUE
  // serializes to a self-contained `/.../` literal with no free identifier.
  it('BFF_NAVIGATION_REGEXP is a RegExp whose source references no external identifier', () => {
    expect(BFF_NAVIGATION_REGEXP).toBeInstanceOf(RegExp);
    expect(BFF_NAVIGATION_REGEXP.source).not.toContain('isBffNavigationPath');
  });

  it('matches BFF navigations inside a full request URL (Workbox tests urlPattern against url.href)', () => {
    for (const p of [
      '/v1/rag-connect/google-drive/authorize',
      '/auth/login',
      '/api/v1/auth/session/token',
      '/sessions/whoami',
      '/self-service/login/browser',
      '/oauth2/auth',
    ]) {
      expect(BFF_NAVIGATION_REGEXP.test(`https://app-dev.getloopscale.com${p}`)).toBe(true);
    }
  });

  it('does NOT match SPA navigations nor the file-upload POST path (they must reach the network un-shadowed)', () => {
    for (const p of ['/', '/rag/documents', '/projects/teste', '/v1/dashboard/rag/documents/doc_x/file']) {
      expect(BFF_NAVIGATION_REGEXP.test(`https://app-dev.getloopscale.com${p}`)).toBe(false);
    }
  });
});
