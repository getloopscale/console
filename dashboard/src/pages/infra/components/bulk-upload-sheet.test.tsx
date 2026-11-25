import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

import { BulkUploadSheet } from './bulk-upload-sheet';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEngineFetch.mockResolvedValue({
    results: [
      { name: 'KEY_A', status: 'created', sync_status: 'pending' },
      { name: 'KEY_B', status: 'created', sync_status: 'pending' },
    ],
  });
});

describe('BulkUploadSheet — J-22 T3.5', () => {
  it('test_preview_5_valid_1_malformed_plan_invariant', () => {
    render(
      <Wrapper>
        <BulkUploadSheet open onOpenChange={vi.fn()} project="teste" />
      </Wrapper>,
    );
    const src = [
      'KEY_A=a',
      'KEY_B=b',
      'this-is-malformed',
      'KEY_C=c',
      'KEY_D=d',
      'KEY_E=e',
    ].join('\n');
    fireEvent.change(screen.getByLabelText(/.env content/), { target: { value: src } });
    // Plan T3.5 TDD: "preview MUST show 5 entries + 1 warning"
    expect(screen.getByText(/Preview: 5 entries · 1 warnings/)).toBeInTheDocument();
  });

  it('test_value_column_masked_d1', () => {
    render(
      <Wrapper>
        <BulkUploadSheet open onOpenChange={vi.fn()} project="teste" />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/.env content/), {
      target: { value: 'DATABASE_URL=secret-postgres-url' },
    });
    // Preview row MUST mask the value (D1); the raw value lives in the
    // textarea legitimately (user typed it). We only check the preview.
    expect(screen.getByText(/DATABASE_URL=••••••••/)).toBeInTheDocument();
  });

  it('test_submit_posts_to_bulk_endpoint_only_valid_entries', async () => {
    const onOpenChange = vi.fn();
    const onUploaded = vi.fn();
    render(
      <Wrapper>
        <BulkUploadSheet
          open
          onOpenChange={onOpenChange}
          project="teste"
          defaultEnvs={['production']}
          availableEnvs={['preview', 'production']}
          onUploaded={onUploaded}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/.env content/), {
      target: { value: ['KEY_A=a', 'malformed', 'KEY_B=b'].join('\n') },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload 2 secret/i }));

    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    const [url, init] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/bulk');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.project).toBe('teste');
    expect(body.secrets).toEqual([
      { name: 'KEY_A', value: 'a', envs: ['production'] },
      { name: 'KEY_B', value: 'b', envs: ['production'] },
    ]);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onUploaded).toHaveBeenCalledWith(2);
  });
});

describe('BulkUploadSheet — keys the API did not save', () => {
  const partialFailure = {
    results: [
      { name: 'KEY_A', status: 'created', sync_status: 'pending' },
      {
        name: 'KEY_B',
        status: 'failed',
        error: 'The secrets backend is not available for this project right now, so the value was not saved.',
        sync_status: 'failed',
      },
    ],
  };

  function renderAndUpload(onOpenChange = vi.fn(), onUploaded = vi.fn()) {
    render(
      <Wrapper>
        <BulkUploadSheet
          open
          onOpenChange={onOpenChange}
          project="teste"
          defaultEnvs={['production']}
          onUploaded={onUploaded}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/.env content/), {
      target: { value: ['KEY_A=a', 'KEY_B=b'].join('\n') },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload 2 secret/i }));
    return { onOpenChange, onUploaded };
  }

  it('keeps the sheet open and shows each key as saved or failed with the API reason', async () => {
    mockedEngineFetch.mockResolvedValueOnce(partialFailure);
    const { onOpenChange, onUploaded } = renderAndUpload();

    const results = await screen.findByRole('list', { name: /upload results/i });
    expect(results).toHaveTextContent(/KEY_A.*saved/i);
    expect(results).toHaveTextContent(/KEY_B.*failed.*secrets backend is not available/i);
    expect(screen.getByRole('button', { name: /retry failed/i })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('retries only the failed keys and closes once every key is saved', async () => {
    mockedEngineFetch.mockResolvedValueOnce(partialFailure).mockResolvedValueOnce({
      results: [{ name: 'KEY_B', status: 'created', sync_status: 'pending' }],
    });
    const { onOpenChange, onUploaded } = renderAndUpload();

    fireEvent.click(await screen.findByRole('button', { name: /retry failed/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedEngineFetch).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(mockedEngineFetch.mock.calls[1][1]?.body as string);
    expect(retryBody.secrets).toEqual([{ name: 'KEY_B', value: 'b', envs: ['production'] }]);
    expect(onUploaded).toHaveBeenCalledWith(2);
  });

  it('treats a key missing from the API answer as failed instead of saved', async () => {
    mockedEngineFetch.mockResolvedValueOnce({
      results: [{ name: 'KEY_A', status: 'created', sync_status: 'pending' }],
    });
    const { onOpenChange } = renderAndUpload();

    const results = await screen.findByRole('list', { name: /upload results/i });
    expect(results).toHaveTextContent(/KEY_B.*failed/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('asks the transport to reject a non-2xx answer instead of resolving null', async () => {
    renderAndUpload();
    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    expect(mockedEngineFetch.mock.calls[0][2]).toEqual({ throwOnError: true });
  });
});
