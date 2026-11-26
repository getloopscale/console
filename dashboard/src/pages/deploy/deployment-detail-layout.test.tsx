import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@getloopscale/ui';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
  cloudFetch: vi.fn(),
  signOutIfSessionEnded: vi.fn(async () => false),
}));
vi.mock('@/lib/http/config', () => ({ API_URL: '' }));
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => undefined }));

import { DeploymentDetailLayout } from './deployment-detail-layout';
import { engineFetch } from '@/lib/http/api';
import { queryClient } from '@/lib/http/query-client';
import { __setTransporte, __resetSharedEventSources } from '@/hooks/deploy/shared-event-source';

const mockedEngineFetch = vi.mocked(engineFetch);

/** A stream that opens and sends nothing: the page is under test, not the timeline. */
class SilentEventSource {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function statusOf(environment: string, commit: string | null) {
  return {
    project: 'app',
    environment,
    active_release: commit
      ? { id: `rel-${environment}`, build_id: `build-${environment}`, status: 'ACTIVE', git_commit: commit, created_at: '2026-11-25T21:09:03Z' }
      : null,
    url: commit ? `https://${environment}.example.test` : '',
  };
}

function renderBuildOf(environment: string) {
  mockedEngineFetch.mockImplementation(async (path: string) => {
    if (path.includes('/status')) {
      if (path.endsWith(`env=${environment}`)) return statusOf(environment, null);
      return statusOf('production', 'f35d9b7aaaa');
    }
    if (path.endsWith('/rollbacks')) return { rollbacks: [] };
    if (path.includes('/builds/')) {
      return {
        build_id: 'build-1',
        project_id: 'app',
        environment,
        status: 'succeeded',
        commit_sha: 'ch-890f2e4f',
        created_by: 'u-1',
        created_at: '2026-11-25T21:10:18Z',
      };
    }
    return null;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <MemoryRouter initialEntries={['/projects/app/deployments/build-1']}>
          <Routes>
            <Route path="/projects/:name/deployments/:id" element={<DeploymentDetailLayout />} />
          </Routes>
        </MemoryRouter>
      </Toaster>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  __resetSharedEventSources();
  mockedEngineFetch.mockReset();
  __setTransporte(() => new SilentEventSource() as unknown as EventSource);
});

describe('DeploymentDetailLayout', () => {
  // The strip ends with the release being served. For a build of another
  // environment it named the production release and its URL (#565).
  it('reads the live release of the build own environment, not of production', async () => {
    renderBuildOf('qa-env');

    await screen.findByTestId('deploy-timeline-hero');
    await waitFor(() =>
      expect(mockedEngineFetch.mock.calls.map((c) => c[0])).toContain('/api/v1/projects/app/status?env=qa-env'),
    );
    expect(mockedEngineFetch.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/status'))).toEqual([]);
    expect(screen.getByTestId('deploy-timeline-hero')).not.toHaveTextContent('f35d9b7');
  });
});
