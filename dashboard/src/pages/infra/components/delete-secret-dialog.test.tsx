import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

import { DeleteSecretDialog } from './delete-secret-dialog';
import type { Secret } from '@/lib/api/types';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SECRET: Secret = {
  name: 'DATABASE_URL',
  environments: ['production'],
} as Secret;

beforeEach(() => {
  vi.clearAllMocks();
  mockedEngineFetch.mockResolvedValue({});
});

describe('DeleteSecretDialog — J-22 T3.4', () => {
  it('test_delete_button_disabled_until_exact_match_d3', () => {
    render(
      <Wrapper>
        <DeleteSecretDialog open onOpenChange={vi.fn()} secret={SECRET} />
      </Wrapper>,
    );
    const del = screen.getByRole('button', { name: /^Delete$/i });
    expect(del).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type.*to confirm/), {
      target: { value: 'DATABASE_URL' },
    });
    expect(del).not.toBeDisabled();
  });

  it('test_case_mismatch_keeps_button_disabled_ec19', () => {
    render(
      <Wrapper>
        <DeleteSecretDialog open onOpenChange={vi.fn()} secret={SECRET} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/Type.*to confirm/), {
      target: { value: 'database_url' },
    });
    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeDisabled();
  });

  it('test_confirmed_delete_invokes_engine_delete_with_env_and_project', async () => {
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    render(
      <Wrapper>
        <DeleteSecretDialog
          open
          onOpenChange={onOpenChange}
          secret={SECRET}
          environment="staging"
          project="teste"
          onDeleted={onDeleted}
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/Type.*to confirm/), {
      target: { value: 'DATABASE_URL' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    const [url, init] = mockedEngineFetch.mock.calls[0];
    expect(url).toBe('/api/v1/secrets/DATABASE_URL?environment=staging&project=teste');
    expect(init?.method).toBe('DELETE');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDeleted).toHaveBeenCalled();
  });
});

describe('DeleteSecretDialog — app-scoped secrets', () => {
  it('deletes the secret of the row app', async () => {
    render(
      <Wrapper>
        <DeleteSecretDialog
          open
          onOpenChange={vi.fn()}
          secret={{ name: 'PROBE_SECRET', environments: ['production'], app: 'app' }}
          environment="production"
          project="loop-app"
        />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/Type.*to confirm/), { target: { value: 'PROBE_SECRET' } });
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => expect(mockedEngineFetch).toHaveBeenCalled());
    expect(mockedEngineFetch.mock.calls[0][0]).toBe(
      '/api/v1/secrets/PROBE_SECRET?environment=production&project=loop-app&app=app',
    );
  });
});

describe('B-195 — o que a migração para ConfirmDialog trouxe', () => {
  it('uma exclusão que FALHA mantém o diálogo aberto e diz que o segredo continua lá', async () => {
    // A cópia anterior tinha um `catch` próprio que exibia a mensagem; o que ela NÃO tinha era a
    // correção do B-105, e o risco era o inverso do que parece: fechar o diálogo em cima de um
    // erro faz quem clicou "Delete" acreditar que excluiu.
    mockedEngineFetch.mockRejectedValue(new Error('403 forbidden'));
    const aoFechar = vi.fn();
    render(
      <Wrapper>
        <DeleteSecretDialog open onOpenChange={aoFechar} secret={SECRET} environment="production" />
      </Wrapper>,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DATABASE_URL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/The secret was NOT removed/)).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalledWith(false);
  });

  it('o foco inicial é o CANCELAR, nunca a ação destrutiva', async () => {
    // Deliberado: um Enter apressado não pode executar uma exclusão. A cópia anterior dava
    // `autoFocus` ao campo de texto — mais cômodo, e uma tecla mais perto do irreversível.
    render(
      <Wrapper>
        <DeleteSecretDialog open onOpenChange={vi.fn()} secret={SECRET} environment="production" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
  });
});
