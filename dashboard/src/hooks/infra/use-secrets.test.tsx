import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

import { useSecrets } from './use-secrets';
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

/** The project's environments as GET /api/v1/environments lists them on staging. */
const PROJECT_ENVIRONMENTS = {
  environments: [
    { name: 'production', project: 'teste' },
    { name: 'preview', project: 'teste' },
  ],
};

/** Answers the environments read with `environments` and each secrets read with `secretsFor(env)`. */
function answer(secretsFor: (env: string) => unknown = () => ({ secrets: [] }), environments: unknown = PROJECT_ENVIRONMENTS) {
  mockedEngineFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/environments')) return environments;
    const env = new URL(path, 'http://x').searchParams.get('env') ?? '';
    return secretsFor(env);
  });
}

function secretsCalls(): string[] {
  return mockedEngineFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/v1/secrets'));
}

beforeEach(() => {
  vi.clearAllMocks();
  answer();
});

describe('useSecrets — J-22 T2.1 + 2026-06-10 LIVE shape fixes', () => {
  it('test_passes_project_and_single_env_when_filter_set', async () => {
    const { result } = renderHook(
      () => useSecrets({ project: 'teste', env: 'production' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(secretsCalls()).toEqual(['/api/v1/secrets?project=teste&env=production']);
  });

  it('fans out over the project environments the API lists when no filter is set', async () => {
    const { result } = renderHook(
      () => useSecrets({ project: 'teste' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(secretsCalls()).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(secretsCalls().sort()).toEqual([
      '/api/v1/secrets?project=teste&env=preview',
      '/api/v1/secrets?project=teste&env=production',
    ]);
  });

  it('test_groups_rows_by_name_so_multi_env_secrets_collapse_to_one_row', async () => {
    // Backend emits one row per (key × env); UI groups by name.
    answer((env) =>
      env === 'production'
        ? {
            secrets: [
              { name: 'DATABASE_URL', environment: 'production', app: '' },
              { name: 'API_KEY', environment: 'production', app: '' },
            ],
          }
        : { secrets: [{ name: 'API_KEY', environment: 'preview', app: '' }] },
    );
    const { result } = renderHook(
      () => useSecrets({ project: 'teste' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.secrets).toHaveLength(2));
    const dbUrl = result.current.secrets.find((s) => s.name === 'DATABASE_URL');
    const apiKey = result.current.secrets.find((s) => s.name === 'API_KEY');
    expect(dbUrl?.environments).toEqual(['production']);
    expect(apiKey?.environments.sort()).toEqual(['preview', 'production']);
  });
});
