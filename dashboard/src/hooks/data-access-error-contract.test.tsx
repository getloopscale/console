// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/http/config', () => ({ API_URL: 'http://test.local', mocksEnabled: () => false }));

import { useBuildSBOM, useBuildAttestation } from '@/hooks/deploy/use-build-artifacts';
import { useDomains } from '@/hooks/infra/use-domains';
import { useCreateProject } from '@/hooks/projects/use-create-project';
import { useDeleteTenant } from '@/hooks/settings/use-delete-tenant';
import {
  useCreateWorkspaceWebhook,
  useRevokeWorkspaceWebhook,
} from '@/hooks/settings/use-workspace-webhooks';
import { useCreateMemoryExport } from '@/hooks/memory/use-memory-exports';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * B-244/B-264 — the error contract of the data-access hooks, exercised through the REAL transport.
 *
 * ## Why this file exists, in the words of the mutation that produced it
 *
 * The first round of tests for these hooks mocked `engineFetch` itself. That made them blind to
 * the one thing the migration was for: removing `{ throwOnError: true }` from `use-build-artifacts`
 * and from `use-domains` left 99 tests green. The option is the entire error contract, and nothing
 * held the hooks to it.
 *
 * Worse, the B-264 regression test mocked the failure as a REJECTION — while the defect was that
 * the request RESOLVED `null`. It was shaped like the fix, not like the bug: it passed against the
 * pre-fix code. Per `rules/testing.md` § 3, a bug fix starts with a test that fails on the current
 * state; that one never could.
 *
 * So these cases stub `globalThis.fetch` and let the real `cloudFetch` run. With the contract, a
 * 403 REJECTS and the query reports `isError`. Without it, `cloudFetch` RESOLVES `null` — which is
 * indistinguishable from "this build has no SBOM" (B-235), and is exactly how a refused delete came
 * to report success.
 */

/** Every call answers with `status` — the session cookie needs no priming (getloopscale/loopscale#477). */
function serverAnswers(status: number, body: unknown = { code: 'X', message: 'no' }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(body === null ? null : JSON.stringify(body), { status }),
  );
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a refused read reports an ERROR, never an empty artifact (B-244)', () => {
  it('useBuildSBOM: a 403 makes the query fail instead of resolving null', async () => {
    serverAnswers(403);
    const { result } = renderHook(() => useBuildSBOM('bld-1'), { wrapper: wrapper(testClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // The distinction the tab renders on. Without `throwOnError` this is `false` and `data` is
    // `null`, which the tab shows as "this build shipped without an SBOM" — the opposite claim.
    expect(result.current.data).toBeUndefined();
  });

  it('useBuildAttestation: a 500 makes the query fail instead of resolving null', async () => {
    serverAnswers(500);
    const { result } = renderHook(() => useBuildAttestation('bld-1'), { wrapper: wrapper(testClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('useDomains: a 500 makes the query fail instead of resolving an empty domain list', async () => {
    serverAnswers(500);
    const { result } = renderHook(() => useDomains(), { wrapper: wrapper(testClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('useCreateProject: a 409 rejects with the status, so the form can say WHY', async () => {
    serverAnswers(409, { code: 'ALREADY_EXISTS', message: 'name taken' });
    const { result } = renderHook(() => useCreateProject(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync({ name: 'taken' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
    });
  });

  it('useDeleteTenant: a 403 rejects — the caller must not report a deletion it did not observe', async () => {
    // B-264 in one line. Before the fix this RESOLVED, and both screens read a resolve as success:
    // the confirmation closed and the user was signed out over a request that was refused.
    serverAnswers(403);
    const { result } = renderHook(() => useDeleteTenant(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync('tnt-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
    });
  });

  it('useDeleteTenant: a 204 with no body RESOLVES — for a DELETE that is the success', async () => {
    // The one `null` the contract leaves, and the endpoint where reading it wrongly costs the most.
    serverAnswers(204, null);
    const { result } = renderHook(() => useDeleteTenant(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync('tnt-1')).resolves.toBeUndefined();
  });
});

describe('what each hook decides on the caller\'s behalf (B-244)', () => {
  it('useCreateProject refuses a 2xx with no body instead of inventing a project', async () => {
    serverAnswers(204, null);
    const { result } = renderHook(() => useCreateProject(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync({ name: 'p' })).rejects.toThrow(/returned no body/);
  });

  it('useCreateProject invalidates the projects list, so no caller has to remember to', async () => {
    // Removing the `onSuccess` invalidation left every test green — one of the three reasons the
    // hook exists, unguarded. This is the guard.
    serverAnswers(201, { id: 'p1', name: 'p' });
    const client = testClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateProject(), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ name: 'p' });

    await waitFor(() =>
      expect(invalidated).toHaveBeenCalledWith({ queryKey: queryKeys.projects.all }),
    );
  });

  it('the SBOM cache key varies with the build id — one build never answers for another', async () => {
    // A build id is immutable, so caching per id is right and caching across ids is a wrong answer
    // shown with confidence. Nothing detected a key that stopped varying.
    serverAnswers(200, { format: 'spdx', components: [] });
    const client = testClient();

    const a = renderHook(() => useBuildSBOM('bld-a'), { wrapper: wrapper(client) });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));

    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual([...queryKeys.builds.detail('bld-a'), 'sbom']);
    expect(keys).not.toContainEqual([...queryKeys.builds.detail('bld-b'), 'sbom']);
  });

  it('an empty build id issues NO request — the route has nothing to ask about yet', async () => {
    const asked: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      asked.push(String(input));
      return new Response('{}', { status: 200 });
    });

    const { result } = renderHook(() => useBuildSBOM(''), { wrapper: wrapper(testClient()) });

    // `enabled: buildId !== ''` is what the old `if (!id) { setLoading(false); return; }` did by
    // hand. Drop it and the hook asks for `/builds//sbom`.
    expect(result.current.fetchStatus).toBe('idle');
    await waitFor(() => expect(asked.filter((u) => u.includes('/sbom'))).toEqual([]));
  });
});

describe('registering and revoking a webhook cannot report success it did not observe (B-244)', () => {
  it('create: a 422 rejects instead of resolving null', async () => {
    // Before this, a refused registration resolved `null`, the page closed the dialog and
    // refreshed the list, and the user left believing events would arrive at a URL the server
    // never accepted.
    serverAnswers(422, { code: 'INVALID_URL', message: 'not reachable' });
    const { result } = renderHook(() => useCreateWorkspaceWebhook(), { wrapper: wrapper(testClient()) });

    await expect(
      result.current.mutateAsync({ url: 'https://x', label: 'l', events: ['deploy.failed'] }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 422 });
  });

  it('create: a 2xx with no body rejects — the secret is shown once or never', async () => {
    serverAnswers(204, null);
    const { result } = renderHook(() => useCreateWorkspaceWebhook(), { wrapper: wrapper(testClient()) });

    await expect(
      result.current.mutateAsync({ url: 'https://x', label: 'l', events: ['deploy.failed'] }),
    ).rejects.toThrow(/signing secret/);
  });

  it('revoke: a 403 rejects — an endpoint the user cut off must not look cut off', async () => {
    // The worst reading of the old behaviour: the dialog closed, the list refreshed, and the
    // webhook kept receiving the workspace's payloads.
    serverAnswers(403);
    const { result } = renderHook(() => useRevokeWorkspaceWebhook(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync('wwh-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
    });
  });

  it('revoke: a 204 resolves — for a DELETE that is the success', async () => {
    serverAnswers(204, null);
    const { result } = renderHook(() => useRevokeWorkspaceWebhook(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync('wwh-1')).resolves.toBeUndefined();
  });
});

describe('starting a memory export cannot report a job that was never created (B-244)', () => {
  // A review caught me repeating the exact mistake this file was written to fix. The page-level
  // test I added mocks the failure as a REJECTION — and a rejection already set `isError` in the
  // OLD code, so that test passes unchanged against the pre-migration page. The defect was that a
  // refusal RESOLVED `null` and `if (!row?.id) return` swallowed it, and nothing exercised that.
  //
  // These go through the real transport, where the difference is observable.

  it('a 403 rejects instead of resolving null', async () => {
    serverAnswers(403);
    const { result } = renderHook(() => useCreateMemoryExport(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
    });
  });

  it('a 2xx with no body rejects — an export nobody can identify is not an export', async () => {
    // The `created === null` branch. Without a case that RESOLVES null, this line was untested.
    serverAnswers(204, null);
    const { result } = renderHook(() => useCreateMemoryExport(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync()).rejects.toThrow(/did not say which one/);
  });

  it('a 201 with a body resolves the job', async () => {
    serverAnswers(201, { id: 'export-1', status: 'pending' });
    const { result } = renderHook(() => useCreateMemoryExport(), { wrapper: wrapper(testClient()) });

    await expect(result.current.mutateAsync()).resolves.toMatchObject({ id: 'export-1' });
  });
});
