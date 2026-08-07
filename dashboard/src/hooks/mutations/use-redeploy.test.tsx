import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

import { useRedeploy } from './use-redeploy';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

function makeWrapper(): {
  wrapper: (props: { children: ReactNode }) => ReactElement;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRedeploy', () => {
  it('test_posts_to_builds_endpoint_with_redeploy_of', async () => {
    mockedEngineFetch.mockResolvedValue({
      build_id: 'b-new',
      stream_url: '/api/v1/builds/b-new/stream',
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedeploy(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('b-source');
    });

    expect(mockedEngineFetch).toHaveBeenCalledOnce();
    const [path, options] = mockedEngineFetch.mock.calls[0];
    expect(path).toBe('/api/v1/builds');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual({ redeploy_of: 'b-source' });
  });

  it('test_returns_build_create_response', async () => {
    mockedEngineFetch.mockResolvedValue({
      build_id: 'b-new',
      stream_url: '/api/v1/builds/b-new/stream',
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedeploy(), { wrapper });

    await act(async () => {
      const resp = await result.current.mutateAsync('b-source');
      expect(resp?.build_id).toBe('b-new');
    });
  });

  it('test_invalidates_builds_cache_on_success', async () => {
    mockedEngineFetch.mockResolvedValue({
      build_id: 'b-new',
      stream_url: '/api/v1/builds/b-new/stream',
    });

    const { wrapper, client } = makeWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRedeploy(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('b-source');
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  // Red Team theo-cloud#122 surface 2 — the redeploy dialog SWALLOWED 4xx
  // errors silently because useRedeploy called engineFetch WITHOUT
  // { throwOnError: true }. Default behavior of engineFetch on 4xx is to
  // resolve `null` (not throw), so the mutation succeeded with null, the
  // dialog `if (!resp) return;` closed silently, and `redeploy.error`
  // stayed null — no Alert, no toast, console-only generic 400. Fix
  // surfaces 4xx as a typed ApiError via engineFetch's throwOnError opt-in.
  // Contract assertion: the hook MUST opt into throwOnError so the dialog
  // catches the rejection and renders the problem+json detail.
  it('Red Team theo-cloud#122 — passes { throwOnError: true } to engineFetch (4xx must reject, not return null)', async () => {
    mockedEngineFetch.mockResolvedValue({
      build_id: 'b-new',
      stream_url: '/api/v1/builds/b-new/stream',
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedeploy(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('b-source');
    });

    expect(mockedEngineFetch).toHaveBeenCalledOnce();
    // engineFetch(path, options, cfg) — cfg is the THIRD arg.
    const [, , cfg] = mockedEngineFetch.mock.calls[0];
    expect(cfg, '#122: useRedeploy must pass cfg.throwOnError so 4xx rejects instead of resolving null').toBeDefined();
    expect((cfg as { throwOnError?: boolean })?.throwOnError, '#122: throwOnError must be true so the dialog surfaces problem+json detail').toBe(true);
  });

  it('test_surfaces_typed_error_on_409', async () => {
    mockedEngineFetch.mockRejectedValue(new Error('BUILD_NOT_TERMINAL'));

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedeploy(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync('b-running');
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect((result.current.error as Error).message).toBe('BUILD_NOT_TERMINAL');
  });
});
