import { describe, it, expect } from 'vitest';

import { BFF_NAVIGATION_DENYLIST, isBffNavigationPath } from './sw-bff-paths';

const denied = (p: string) => BFF_NAVIGATION_DENYLIST.some((re) => re.test(p));

describe('SW BFF navigation denylist — the service worker must NOT shadow BFF navigations', () => {
  it('denies /v1/rag-connect authorize AND callback (theo-cloud#203 — OAuth "Connect with X")', () => {
    // Both are top-level browser navigations by design; without the denylist the
    // Workbox navigateFallback serves the SPA shell → React Router "Page not found".
    expect(denied('/v1/rag-connect/google-drive/authorize')).toBe(true);
    expect(denied('/v1/rag-connect/google-drive/callback')).toBe(true);
    expect(isBffNavigationPath('/v1/rag-connect/dropbox/authorize')).toBe(true);
  });

  it('still denies the Hydra/Kratos auth-broker navigations (theo-cloud#112 regression)', () => {
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
