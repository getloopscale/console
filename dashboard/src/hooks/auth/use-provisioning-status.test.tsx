import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({ cloudFetch: vi.fn() }));

import {
  useProvisioningStatus,
  provisioningRefetchInterval,
  __test_POLL_INTERVAL_MS,
} from './use-provisioning-status';
import { cloudFetch } from '@/lib/http/api';

const mockedCloudFetch = vi.mocked(cloudFetch);

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// M0 J-02 T2.1 — useProvisioningStatus polls the BFF /v1/auth/me while the new
// tenant's after-registration bootstrap is still running, and STOPS once it is
// active (or a terminal unknown). It consumes the `provisioning` snapshot the
// backend T1.2 slice added to /me.
describe('useProvisioningStatus (M0 J-02 T2.1)', () => {
  it('test_poll_interval_canonical_2_seconds', () => {
    expect(__test_POLL_INTERVAL_MS).toBe(2000);
  });

  it('test_polls_only_while_pending_or_not_yet_loaded', () => {
    // Pure decision function — deterministic, no timers.
    expect(provisioningRefetchInterval(null)).toBe(2000); // not loaded → keep trying
    expect(provisioningRefetchInterval(undefined)).toBe(2000);
    expect(provisioningRefetchInterval({ provisioning: 'pending' })).toBe(2000);
    expect(provisioningRefetchInterval({ provisioning: 'active' })).toBe(false);
    expect(provisioningRefetchInterval({ provisioning: 'unknown' })).toBe(false);
    // Field absent (old backend / nil-db) → do not poll forever.
    expect(provisioningRefetchInterval({})).toBe(false);
  });

  it('test_initial_load_fires_cloudFetch_and_exposes_active_status', async () => {
    mockedCloudFetch.mockResolvedValue({
      provisioning: 'active',
      plan: 'starter',
      subscription_status: 'active',
    });
    const { result } = renderHook(() => useProvisioningStatus(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.status).toBe('active'));
    expect(mockedCloudFetch).toHaveBeenCalledWith('/v1/auth/me');
    expect(result.current.plan).toBe('starter');
    expect(result.current.subscriptionStatus).toBe('active');
  });

  it('test_pending_status_exposed', async () => {
    mockedCloudFetch.mockResolvedValue({ provisioning: 'pending' });
    const { result } = renderHook(() => useProvisioningStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe('pending'));
  });

  it('test_disabled_does_not_fetch', () => {
    renderHook(() => useProvisioningStatus(false), { wrapper: wrapper() });
    expect(mockedCloudFetch).not.toHaveBeenCalled();
  });
});
