import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

import {
  useCreateSecret,
  useRotateSecret,
  useDeleteSecret,
  useBulkUploadSecrets,
} from './use-secrets-mutations';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEngineFetch.mockResolvedValue({});
});

describe('useCreateSecret — J-22 T2.2', () => {
  it('test_routes_via_bulk_endpoint_with_one_key_per_env', async () => {
    // LIVE bug 2026-06-10: single-secret POST /api/v1/secrets expects
    // singular `environment` while the Add sheet sends multi-env. Routing
    // through /bulk (T1.1) keeps the canonical shape AND inherits audit
    // (T1.2) + plan-limit gate (T1.3).
    const { result } = renderHook(() => useCreateSecret(), { wrapper: wrapper() });
    await act(async () => {
      result.current.mutate({
        name: 'DATABASE_URL',
        value: 'postgres://x',
        environments: ['production', 'staging'],
        project: 'teste',
      });
    });
    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    const [url, init] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/bulk');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      project: 'teste',
      secrets: [{ name: 'DATABASE_URL', value: 'postgres://x', envs: ['production', 'staging'] }],
    });
  });
});

describe('useCreateSecret — a secret the API did not save is an error', () => {
  it('rejects with the per-item error when the API reports the secret failed', async () => {
    mockedEngineFetch.mockResolvedValue({
      results: [{ name: 'GREETING', status: 'failed', error: 'backend unavailable', sync_status: 'failed' }],
    });
    const { result } = renderHook(() => useCreateSecret(), { wrapper: wrapper() });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'GREETING', value: 'hi', environments: ['production'], project: 'hello' });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('GREETING: backend unavailable');
  });

  it('asks the transport to reject a non-2xx answer instead of resolving null', async () => {
    const { result } = renderHook(() => useCreateSecret(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ name: 'GREETING', value: 'hi', environments: ['production'] });
    });
    expect(mockedEngineFetch.mock.calls[0][2]).toEqual({ throwOnError: true });
  });
});

describe('useRotateSecret — writes through the endpoints the API serves', () => {
  // The API has no PUT /api/v1/secrets/{name}. POST /secrets upserts an app-scoped secret and
  // requires `app`; POST /secrets/bulk upserts a project-wide one (app "").
  it('rotates an app-scoped secret with POST /secrets, sending its app', async () => {
    const { result } = renderHook(() => useRotateSecret(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: 'PROBE_SECRET',
        newValue: 'new-secret',
        environment: 'production',
        app: 'app',
        project: 'loop-app',
      });
    });
    const [url, init, cfg] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets?project=loop-app');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'PROBE_SECRET',
      value: 'new-secret',
      environment: 'production',
      app: 'app',
    });
    expect(cfg).toEqual({ throwOnError: true });
  });

  it('rotates a project-wide secret with POST /secrets/bulk', async () => {
    mockedEngineFetch.mockResolvedValue({
      results: [{ name: 'API_KEY', status: 'created', sync_status: 'pending' }],
    });
    const { result } = renderHook(() => useRotateSecret(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: 'API_KEY',
        newValue: 'new-secret',
        environment: 'production',
        project: 'teste',
      });
    });
    const [url, init, cfg] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/bulk');
    expect(JSON.parse(init?.body as string)).toEqual({
      project: 'teste',
      secrets: [{ name: 'API_KEY', value: 'new-secret', envs: ['production'] }],
    });
    expect(cfg).toEqual({ throwOnError: true });
  });

  it('rejects when the bulk answer reports the secret failed', async () => {
    mockedEngineFetch.mockResolvedValue({
      results: [{ name: 'API_KEY', status: 'failed', error: 'backend unavailable', sync_status: 'failed' }],
    });
    const { result } = renderHook(() => useRotateSecret(), { wrapper: wrapper() });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'API_KEY', newValue: 'x', environment: 'production' });
      } catch (err) {
        caught = err;
      }
    });
    expect((caught as Error).message).toBe('API_KEY: backend unavailable');
  });
});

describe('useDeleteSecret — J-22 T2.2', () => {
  it('test_deletes_with_env_and_project_query_params', async () => {
    const { result } = renderHook(() => useDeleteSecret(), { wrapper: wrapper() });
    await act(async () => {
      result.current.mutate({ name: 'DEBUG_FLAG', environment: 'staging', project: 'teste' });
    });
    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    const [url, init] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/DEBUG_FLAG?environment=staging&project=teste');
    expect(init?.method).toBe('DELETE');
  });

  it('sends the app of an app-scoped secret, which the API matches exactly', async () => {
    // Staging: without `app` the API answered 404 SECRET_NOT_FOUND for PROBE_SECRET (#550).
    const { result } = renderHook(() => useDeleteSecret(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: 'PROBE_SECRET',
        environment: 'production',
        project: 'loop-app',
        app: 'app',
      });
    });
    const [url] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/PROBE_SECRET?environment=production&project=loop-app&app=app');
  });

  it('asks the transport to reject a non-2xx answer instead of resolving null', async () => {
    const { result } = renderHook(() => useDeleteSecret(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ name: 'DEBUG_FLAG', environment: 'staging' });
    });
    expect(mockedEngineFetch.mock.calls[0][2]).toEqual({ throwOnError: true });
  });
});

describe('useBulkUploadSecrets — J-22 T2.2 (T1.1 endpoint consumer)', () => {
  it('test_posts_bulk_payload_to_bulk_endpoint', async () => {
    const { result } = renderHook(() => useBulkUploadSecrets(), { wrapper: wrapper() });
    await act(async () => {
      result.current.mutate({
        project: 'teste',
        secrets: [
          { name: 'KEY_A', value: 'a', envs: ['production'] },
          { name: 'KEY_B', value: 'b', envs: ['production', 'staging'] },
        ],
      });
    });
    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    const [url, init] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/bulk');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.project).toBe('teste');
    expect(body.secrets).toHaveLength(2);
    expect(body.secrets[1].envs).toEqual(['production', 'staging']);
  });
});
