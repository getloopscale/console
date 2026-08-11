import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/http/api', () => {
  class ApiError extends Error {
    readonly status: number;
    constructor(status: number, _body?: unknown, message?: string) {
      super(message ?? `API request failed with status ${status}`);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return {
    engineFetch: vi.fn(),
    ApiError,
  };
});

import { engineFetch, ApiError } from '@/lib/http/api';
import { useProjectStatus } from './use-project-status';

function makeWrapper() {
  // Disable the default jitter so the test can observe the retry count
  // deterministically without flake.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useProjectStatus — Red Team theo-cloud#96 closure', () => {
  // Pre-fix: cloudFetch's default `T | null` path turned a 404 into a
  // resolved null, which TanStack Query then retried 3-5 times because
  // the original failure was opaque. The Network panel showed 5 sequential
  // 404s within a couple of seconds. The fix opts into throwOnError so
  // the 404 surfaces as a typed ApiError + a custom `retry` predicate
  // short-circuits any 4xx.
  it('throws ApiError on 404 (does not silently return null)', async () => {
    const fetchMock = engineFetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new ApiError(404));
    const { result } = renderHook(
      () => useProjectStatus('does-not-exist'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.error).toBe(true);
    });
    // The opt-in is wired AND throwOnError was forwarded.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/does-not-exist/status'),
      undefined,
      expect.objectContaining({ throwOnError: true }),
    );
  });
});
