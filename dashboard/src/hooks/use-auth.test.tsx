import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}));

const mockHasValidToken = vi.fn();
const mockExchangeSessionToken = vi.fn();
vi.mock('@/lib/api', () => ({
  hasValidToken: () => mockHasValidToken(),
  exchangeSessionToken: () => mockExchangeSessionToken(),
}));

import { useRequireAuth } from './use-auth';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useRequireAuth — Red Team theo-cloud#50 LCP closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasValidToken.mockReturnValue(false);
    mockExchangeSessionToken.mockResolvedValue(true);
  });

  // Red Team theo-cloud#50: the prior behavior awaited TWO sequential
  // blocking network calls (Kratos /sessions/whoami + the BFF token
  // exchange) before the page shell was allowed to render — adding the
  // BFF call's latency to LCP on every cold load. The new behavior
  // flips `checked` to true as soon as the session is detected; the
  // exchange runs in the background (data fetchers lazy-await it via
  // ensureToken() inside cloudFetch/engineFetch).
  it('flips checked to true immediately after session is detected (does not await JWT exchange)', async () => {
    let resolveExchange!: (v: boolean) => void;
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    mockExchangeSessionToken.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveExchange = resolve;
      }),
    );
    const { result } = renderHook(() => useRequireAuth(), { wrapper });

    // Wait for the session-detect path. The exchange promise is still
    // pending — yet `useRequireAuth` MUST have flipped to "checked"
    // (i.e. the page shell can paint).
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    // The exchange was kicked off…
    expect(mockExchangeSessionToken).toHaveBeenCalledTimes(1);
    // …without being awaited (the hook returned the session before
    // the exchange could resolve).
    resolveExchange(true);
  });

  it('skips the JWT exchange when a valid token is already cached', async () => {
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    mockHasValidToken.mockReturnValue(true);
    const { result } = renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(mockExchangeSessionToken).not.toHaveBeenCalled();
  });
});
