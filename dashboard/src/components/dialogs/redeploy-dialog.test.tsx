import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Build } from '@/lib/api/types';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

import { RedeployDialog } from './redeploy-dialog';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

function makeBuild(overrides: Partial<Build> = {}): Build {
  return {
    build_id: 'b-source',
    project_id: 'p-1',
    environment: 'production',
    status: 'succeeded',
    commit_sha: 'abcdef1234567890',
    created_by: 'paulo@loopscale.test',
    created_at: '2026-06-06T00:00:00Z',
    ...overrides,
  };
}

function renderDialog(build: Build = makeBuild(), onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RedeployDialog
          open
          onOpenChange={onOpenChange}
          projectName="teste"
          sourceBuild={build}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedeployDialog', () => {
  it('test_shows_sha_and_environment', () => {
    renderDialog(makeBuild({ commit_sha: 'abcdef1234567890', environment: 'staging' }));
    // "Redeploy abcdef1" appears in BOTH dialog title and confirm button —
    // use getAllByText to assert presence rather than uniqueness.
    expect(screen.getAllByText(/abcdef1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/staging/i)).toBeInTheDocument();
  });

  it('test_confirm_posts_redeploy_of_to_builds', async () => {
    mockedEngineFetch.mockResolvedValue({
      build_id: 'b-new',
      stream_url: '/api/v1/builds/b-new/stream',
    });
    renderDialog();

    const confirmBtn = screen.getByRole('button', { name: /redeploy abcdef1/i });
    await act(async () => {
      await userEvent.click(confirmBtn);
    });

    await waitFor(() => {
      const [path, options] = mockedEngineFetch.mock.calls[0];
      expect(path).toBe('/api/v1/builds');
      expect(options?.method).toBe('POST');
      expect(JSON.parse(options?.body as string)).toEqual({ redeploy_of: 'b-source' });
    });
  });

  it('test_renders_error_when_request_fails', async () => {
    mockedEngineFetch.mockRejectedValue(new Error('BUILD_NOT_TERMINAL'));
    renderDialog();

    const confirmBtn = screen.getByRole('button', { name: /redeploy abcdef1/i });
    await act(async () => {
      await userEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/BUILD_NOT_TERMINAL/i)).toBeInTheDocument();
    });
  });
});

// Plano modal-primitive-consolidation T1.1 — a rede de FECHAMENTO antes da troca
// de primitivo. Ver o mesmo bloco em `confirm-dialog.test.tsx`: os três
// compartilhados não tinham teste de fechar, e é o que mais muda ao trocar
// `ui/dialog` por `AppModal`.
describe('RedeployDialog: a refused redeploy', () => {
  it('shows the reason the API gives, not only the status code', async () => {
    mockedEngineFetch.mockRejectedValue(
      Object.assign(new Error('API request failed with status 422'), {
        status: 422,
        body: { code: 'SCALING_AMBIGUOUS', detail: "App 'app': replicas and autoscaling are mutually exclusive" },
      }),
    );
    renderDialog();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /redeploy abcdef1/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/replicas and autoscaling are mutually exclusive/)).toBeInTheDocument();
    });
    expect(screen.queryAllByText(/API request failed with status/)).toEqual([]);
  });
});

describe('RedeployDialog — fechamento (T1.1)', () => {
  it('ESC pede o fechamento', async () => {
    const onOpenChange = vi.fn();
    renderDialog(makeBuild(), onOpenChange);
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('o botão de fechar pede o fechamento', async () => {
    const onOpenChange = vi.fn();
    renderDialog(makeBuild(), onOpenChange);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
