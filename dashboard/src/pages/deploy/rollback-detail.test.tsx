import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollbackRecord } from '@/lib/api/types';

vi.mock('@/lib/http/api', () => ({ engineFetch: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => undefined }));

import { engineFetch } from '@/lib/http/api';
import { RollbackDetailPage } from './rollback-detail';
import { BuildRollbacks } from './components/build-rollbacks';

const mockedEngineFetch = vi.mocked(engineFetch);

function record(overrides: Partial<RollbackRecord> = {}): RollbackRecord {
  return {
    id: 'rb-1',
    environment: 'production',
    status: 'failed',
    failure_reason: 'sync timeout: the service did not become healthy',
    from: { release_id: 'rel-new', build_id: 'build-new' },
    to: { release_id: 'rel-old', build_id: 'build-old' },
    created_by: 'paulo@loopscale.test',
    created_at: '2026-11-25T19:43:42Z',
    finished_at: '2026-11-25T19:44:53Z',
    ...overrides,
  };
}

function renderAt(path: string, element: React.ReactNode, route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDetail(id = 'rb-1') {
  return renderAt(
    `/projects/app/deployments/rollbacks/${id}`,
    <RollbackDetailPage />,
    '/projects/:name/deployments/rollbacks/:rollbackId',
  );
}

beforeEach(() => {
  mockedEngineFetch.mockReset();
});

describe('RollbackDetailPage', () => {
  it('shows a failed rollback with its reason, both builds and the phase that failed', async () => {
    mockedEngineFetch.mockResolvedValue({ rollbacks: [record()] });

    renderDetail();

    expect(await screen.findByText('Rollback failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('sync timeout: the service did not become healthy');
    expect(screen.getByRole('link', { name: 'build-new' })).toHaveAttribute('href', '/projects/app/deployments/build-new');
    expect(screen.getByRole('link', { name: 'build-old' })).toHaveAttribute('href', '/projects/app/deployments/build-old');
    expect(screen.getByText('took 1m 11s')).toBeInTheDocument();
    const phases = within(screen.getByRole('list', { name: 'Rollback phases' })).getAllByRole('listitem');
    expect(phases.map((p) => p.getAttribute('data-state'))).toEqual(['failed', 'not_reached']);
    expect(mockedEngineFetch).toHaveBeenCalledWith('/api/v1/projects/app/rollbacks', undefined, { throwOnError: true });
  });

  it('shows a rollback that succeeded with no alert and both phases completed', async () => {
    mockedEngineFetch.mockResolvedValue({ rollbacks: [record({ status: 'succeeded', failure_reason: undefined })] });

    renderDetail();

    expect(await screen.findByText('Rolled back')).toBeInTheDocument();
    // The failed case above renders the alert, so its absence here says something.
    expect(screen.queryAllByRole('alert')).toEqual([]);
    const phases = within(screen.getByRole('list', { name: 'Rollback phases' })).getAllByRole('listitem');
    expect(phases.map((p) => p.getAttribute('data-state'))).toEqual(['completed', 'completed']);
  });

  it('says so when the id is not among the rollbacks of the project', async () => {
    mockedEngineFetch.mockResolvedValue({ rollbacks: [record()] });

    renderDetail('rb-unknown');

    expect(await screen.findByText('No rollback with id "rb-unknown"')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to deployments/i })).toHaveAttribute('href', '/projects/app/deployments');
  });

  it('says the list could not be read when the API does not answer it', async () => {
    mockedEngineFetch.mockRejectedValue(new Error('500'));

    renderDetail();

    expect(await screen.findByText('The rollbacks of this project could not be read')).toBeInTheDocument();
  });
});

describe('BuildRollbacks', () => {
  function renderFor(buildId: string) {
    return renderAt('/b', <BuildRollbacks projectName="app" buildId={buildId} />, '/b');
  }

  it('links a build to the rollbacks that left it and that aimed at it', async () => {
    mockedEngineFetch.mockResolvedValue({
      rollbacks: [
        record({ id: 'rb-2', status: 'succeeded', from: { release_id: 'r', build_id: 'build-old' }, to: { release_id: 'r0', build_id: 'build-older' } }),
        record({ id: 'rb-1' }),
      ],
    });

    renderFor('build-old');

    const list = await screen.findByTestId('build-rollbacks');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Rolled back from this build');
    expect(items[1]).toHaveTextContent('Rollback to this build');
    expect(within(items[1]).getByRole('link', { name: 'Rollback failed' })).toHaveAttribute(
      'href',
      '/projects/app/deployments/rollbacks/rb-1',
    );
  });

  it('renders nothing for a build no rollback touched', async () => {
    mockedEngineFetch.mockResolvedValue({ rollbacks: [record()] });

    const { container } = renderFor('build-untouched');

    await vi.waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="build-rollbacks"]')).toBeNull();
  });
});
