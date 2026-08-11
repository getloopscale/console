import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B-171 — the hook reported a SUCCESS as a failure.
 *
 * ## The defect
 *
 * `useCloudApi` derived its `error` flag from the resolved VALUE:
 * `query.isError || (query.isFetched && query.data === null)`. On the default contract
 * `cloudFetch` resolves `null` for five different outcomes (B-235) — and one of them is a
 * successful `204 No Content`, which `parseOkBody` maps to `null` deliberately so a successful
 * DELETE does not blow up on `resp.json()`.
 *
 * So a read that worked and legitimately carried no body painted an error state.
 *
 * ## Why this file did not exist
 *
 * Measured 2026-08-11: there was no `use-api.test.*` at all. The 14 test files that reference
 * `useCloudApi` all `vi.mock` it, so they assert what the mock returns — nothing pinned the
 * hook's own contract, which is how a boolean this wrong survived across 13 production consumers.
 */

vi.mock('@/lib/http/api', async (original) => {
  const real = await original<typeof import('@/lib/http/api')>();
  return { ...real, cloudFetch: vi.fn(), engineFetch: vi.fn() };
});

import { useCloudApi, useEngineApi } from './use-api';
import { cloudFetch, engineFetch, ApiError } from '@/lib/http/api';

const mockedCloudFetch = vi.mocked(cloudFetch);
const mockedEngineFetch = vi.mocked(engineFetch);

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  // `retry: false` so a rejection surfaces on the first attempt: this file is about how the hook
  // CLASSIFIES an outcome, not about the retry policy, which `query-client.ts` owns and tests.
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

describe('useCloudApi', () => {
  it('a successful empty response is not reported as an error', async () => {
    // The 204 path. `parseOkBody` returns null for 204/205 on purpose (M75 — a successful DELETE
    // carries no body and `resp.json()` throws on it).
    mockedCloudFetch.mockResolvedValue(null);

    const { result } = renderHook(() => useCloudApi<{ a: number }>('/v1/thing'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('a server error IS reported as an error', async () => {
    mockedCloudFetch.mockRejectedValue(new ApiError(500));

    const { result } = renderHook(() => useCloudApi<{ a: number }>('/v1/thing'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => { expect(result.current.error).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('a successful body is delivered with no error', async () => {
    mockedCloudFetch.mockResolvedValue({ a: 1 });

    const { result } = renderHook(() => useCloudApi<{ a: number }>('/v1/thing'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => { expect(result.current.data).toEqual({ a: 1 }); });
    expect(result.current.error).toBe(false);
  });

  it('opts into the typed error so the failure reaches the error channel at all', async () => {
    // The mechanism the fix rests on: without `{ throwOnError: true }` every failure resolves
    // `null`, `isError` is never true, and the hook has nothing but a value to judge by.
    mockedCloudFetch.mockResolvedValue({ a: 1 });

    renderHook(() => useCloudApi<{ a: number }>('/v1/thing'), { wrapper: makeWrapper() });

    await waitFor(() => { expect(mockedCloudFetch).toHaveBeenCalled(); });
    expect(mockedCloudFetch).toHaveBeenCalledWith('/v1/thing', {}, { throwOnError: true });
  });

  it('a disabled query reports neither loading nor error', () => {
    const { result } = renderHook(() => useCloudApi<{ a: number }>('/v1/thing', { enabled: false }), {
      wrapper: makeWrapper(),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(mockedCloudFetch).not.toHaveBeenCalled();
  });
});

describe('useEngineApi', () => {
  it('a successful empty response is not reported as an error', async () => {
    mockedEngineFetch.mockResolvedValue(null);

    const { result } = renderHook(() => useEngineApi<{ a: number }>('/api/v1/thing'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe(false);
  });

  it('a server error IS reported as an error', async () => {
    mockedEngineFetch.mockRejectedValue(new ApiError(503));

    const { result } = renderHook(() => useEngineApi<{ a: number }>('/api/v1/thing'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => { expect(result.current.error).toBe(true); });
  });
});
