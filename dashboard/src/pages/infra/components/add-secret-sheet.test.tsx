import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

import { AddSecretSheet } from './add-secret-sheet';
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
  mockedEngineFetch.mockResolvedValue({});
});

describe('AddSecretSheet — J-22 T3.2', () => {
  it('test_default_envs_preselected_d4', () => {
    // Canonical PaaS lexicon (ADR-Q6 of qa-dogfood-cleanup-2026-06-21):
    // preview + production are the two permanent envs (legacy `staging`
    // was off-model per #127).
    render(
      <Wrapper>
        <AddSecretSheet open onOpenChange={vi.fn()} defaultEnvs={['preview', 'production']} />
      </Wrapper>,
    );
    const prod = screen.getByLabelText('Scope to production') as HTMLInputElement;
    const prev = screen.getByLabelText('Scope to preview') as HTMLInputElement;
    expect(prod.checked).toBe(true);
    expect(prev.checked).toBe(true);
  });

  it('test_invalid_key_shows_error_no_post', async () => {
    render(
      <Wrapper>
        <AddSecretSheet open onOpenChange={vi.fn()} />
      </Wrapper>,
    );
    // Single-char name fails the pattern (needs 2-64 chars). Auto-uppercase
    // means we can't test lowercase; use char count instead.
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));
    await screen.findAllByText(/SCREAMING_SNAKE_CASE/i);
    expect(mockedEngineFetch).not.toHaveBeenCalled();
  });

  it('test_valid_submit_posts_canonical_payload_with_selected_envs', async () => {
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <Wrapper>
        <AddSecretSheet
          open
          onOpenChange={onOpenChange}
          defaultEnvs={['production']}
          availableEnvs={['preview', 'production']}
          project="teste"
          onCreated={onCreated}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'API_KEY' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'sk_live_x' } });
    fireEvent.click(screen.getByLabelText('Scope to preview')); // add preview too

    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    const [url, init] = mockedEngineFetch.mock.calls[0];
    // Routes through /bulk to avoid the singular-`environment` schema
    // mismatch on /api/v1/secrets POST (LIVE catch 2026-06-10).
    expect(url).toBe('/api/v1/secrets/bulk');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.project).toBe('teste');
    expect(body.secrets).toHaveLength(1);
    expect(body.secrets[0].name).toBe('API_KEY');
    expect(body.secrets[0].value).toBe('sk_live_x');
    expect(body.secrets[0].envs).toEqual(['production', 'preview']);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalled();
  });

  it('keeps the sheet open and shows the API error when the secret failed to save', async () => {
    // POST /secrets/bulk answers 200 and reports the failure per item (seen on staging).
    mockedEngineFetch.mockResolvedValue({
      results: [
        {
          name: 'GREETING',
          status: 'failed',
          error: 'The secrets backend is not available for this project right now, so the value was not saved.',
          error_code: 'STORE_SET_FAILED',
          sync_status: 'failed',
        },
      ],
    });
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <Wrapper>
        <AddSecretSheet open onOpenChange={onOpenChange} project="hello" onCreated={onCreated} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'GREETING' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    expect(await screen.findByText(/secrets backend is not available/i)).toBeInTheDocument();
    expect(screen.getByText(/GREETING/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('keeps the sheet open when the request itself fails', async () => {
    mockedEngineFetch.mockRejectedValue(new Error('API request failed with status 503'));
    const onOpenChange = vi.fn();
    render(
      <Wrapper>
        <AddSecretSheet open onOpenChange={onOpenChange} project="hello" />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'GREETING' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    expect(await screen.findByText(/status 503/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
  it('asks before it replaces a key that already exists in a chosen environment', async () => {
    const onOpenChange = vi.fn();
    render(
      <Wrapper>
        <AddSecretSheet
          open
          onOpenChange={onOpenChange}
          project="hello"
          defaultEnvs={['production']}
          availableEnvs={['preview', 'production']}
          existingSecrets={[{ name: 'API_KEY', environments: ['production'] }]}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'API_KEY' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'new-value' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    expect(
      await screen.findByText(/API_KEY already exists in production\. Replacing it changes the value/i),
    ).toBeInTheDocument();
    expect(mockedEngineFetch).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: /replace value/i }));

    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('asks again when the key changes after the warning', async () => {
    render(
      <Wrapper>
        <AddSecretSheet
          open
          onOpenChange={vi.fn()}
          project="hello"
          defaultEnvs={['production']}
          existingSecrets={[
            { name: 'API_KEY', environments: ['production'] },
            { name: 'DB_URL', environments: ['production'] },
          ]}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'API_KEY' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'v' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));
    await screen.findByRole('button', { name: /replace value/i });

    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'DB_URL' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    expect(await screen.findByText(/DB_URL already exists in production/i)).toBeInTheDocument();
    expect(mockedEngineFetch).not.toHaveBeenCalled();
  });

  it('does not ask when the key exists only in an environment that is not chosen', async () => {
    render(
      <Wrapper>
        <AddSecretSheet
          open
          onOpenChange={vi.fn()}
          project="hello"
          defaultEnvs={['production']}
          availableEnvs={['preview', 'production']}
          existingSecrets={[{ name: 'API_KEY', environments: ['preview'] }]}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Key$/i), { target: { value: 'API_KEY' } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: 'v' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalledTimes(1));
  });
});
