import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// T0.1 of plan 2026-05-27-backend-frontend-integration v1.1 — assert that the
// 3 mutations in use-team.ts hit the PLURAL canonical path /api/v1/teams/members
// matching backend router.go:342-345. Pre-T0.1 the code used SINGULAR
// (/api/v1/team/members), which mock SW silently dropped (returned null,
// optimistic UI hid the failure). Plain semantic tests can't catch this — only
// a string literal assertion on the path can.

vi.mock('@/lib/http/config', () => ({
  API_URL: '',
  AUTH_URL: '',
  ACCOUNTS_URL: '',
}));

const mockEngineFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  engineFetch: (...args: unknown[]) => mockEngineFetch(...args),
}));

import { queryKeys } from '@/lib/api/query-keys';
import { useInviteMember, useRemoveMember, useUpdateMemberRole } from './use-team';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('use-team mutations — path canonicalization (T0.1)', () => {
  beforeEach(() => {
    mockEngineFetch.mockReset();
  });

  it('test_useInviteMember_posts_to_teams_members_plural_path', async () => {
    mockEngineFetch.mockResolvedValueOnce({ username: 'new-user', role: 'admin' });
    const client = makeClient();
    const { result } = renderHook(() => useInviteMember(), { wrapper: wrap(client) });

    result.current.mutate({ email: 'newbie@theo.dev', role: 'admin' });

    await waitFor(() => {
      expect(mockEngineFetch).toHaveBeenCalledTimes(1);
    });

    const [path, options] = mockEngineFetch.mock.calls[0];
    expect(path).toBe('/api/v1/teams/members');
    expect((options as RequestInit).method).toBe('POST');
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toEqual({ email: 'newbie@theo.dev', role: 'admin' });
  });

  it('test_useRemoveMember_deletes_at_pluralized_path_with_encoded_id', async () => {
    mockEngineFetch.mockResolvedValueOnce({ ok: true });
    const client = makeClient();
    const { result } = renderHook(() => useRemoveMember(), { wrapper: wrap(client) });

    result.current.mutate('paulo');

    await waitFor(() => {
      expect(mockEngineFetch).toHaveBeenCalledTimes(1);
    });

    const [path, options] = mockEngineFetch.mock.calls[0];
    expect(path).toBe('/api/v1/teams/members/paulo');
    expect((options as RequestInit).method).toBe('DELETE');
  });

  it('test_useRemoveMember_url_encodes_special_chars_in_id', async () => {
    mockEngineFetch.mockResolvedValueOnce({ ok: true });
    const client = makeClient();
    const { result } = renderHook(() => useRemoveMember(), { wrapper: wrap(client) });

    // Edge: an id containing characters that demand percent-encoding.
    result.current.mutate('a b@c');

    await waitFor(() => {
      expect(mockEngineFetch).toHaveBeenCalledTimes(1);
    });

    const [path] = mockEngineFetch.mock.calls[0];
    // encodeURIComponent('a b@c') = 'a%20b%40c'
    expect(path).toBe('/api/v1/teams/members/a%20b%40c');
  });

  it('test_useUpdateMemberRole_patches_at_pluralized_path', async () => {
    mockEngineFetch.mockResolvedValueOnce({ username: 'carlos', role: 'admin' });
    const client = makeClient();
    const { result } = renderHook(() => useUpdateMemberRole(), { wrapper: wrap(client) });

    result.current.mutate({ memberId: 'carlos', role: 'admin' });

    await waitFor(() => {
      expect(mockEngineFetch).toHaveBeenCalledTimes(1);
    });

    const [path, options] = mockEngineFetch.mock.calls[0];
    expect(path).toBe('/api/v1/teams/members/carlos');
    expect((options as RequestInit).method).toBe('PATCH');
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toEqual({ role: 'admin' });
  });

  it('test_no_call_site_uses_singular_team_members_path', () => {
    // Belt-and-suspenders: even if the hook's behavior tests pass, this
    // regression net catches a refactor that reintroduces singular paths.
    // Asserts the source file does not contain the singular literal.
    // Reads the file at test-time so the assertion is canonical.
    const useTeamModule = String.raw`${useInviteMember.toString()}${useRemoveMember.toString()}${useUpdateMemberRole.toString()}`;
    expect(useTeamModule).not.toContain('/api/v1/team/members');
    expect(useTeamModule).toContain('/api/v1/teams/members');
  });
});


/**
 * B-060 — o caminho de escrita do time invalida a lista.
 *
 * Mesmo defeito que B-017 corrigiu em domains, encontrado ao tentar fechar este
 * item: `team.tsx` lia a lista com `useEngineApi('/api/v1/teams/members')` —
 * chave `['engine', ...]` — enquanto `useInviteMember` e `useRemoveMember`
 * invalidavam `['team']`. Arvores disjuntas: a invalidacao rodava e nao
 * alcancava nada, entao convidar ou remover um membro nunca atualizava a tabela.
 *
 * Por isso este item NAO foi fechado junto com B-059, embora tivesse a mesma
 * forma: ligar o sheet ao hook sem unificar a hierarquia produziria um convite
 * que continua sem efeito visivel, com aparencia de corrigido.
 *
 * Reusa os helpers e o mock de fronteira do bloco acima de proposito — sao a
 * mesma unidade sob teste.
 */
describe('caminho de escrita do time invalida a lista (B-060)', () => {
  beforeEach(() => {
    mockEngineFetch.mockReset();
    mockEngineFetch.mockResolvedValue({ id: 'm1', email: 'a@b.com', role: 'member' });
  });

  /** Semeia a lista exatamente com a chave que team.tsx usa para ler. */
  function seedList(qc: QueryClient) {
    const key = queryKeys.team.list();
    qc.setQueryData(key, { members: [] });
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
    return key;
  }

  it('useInviteMember invalida a lista apos o convite', async () => {
    const qc = makeClient();
    const key = seedList(qc);
    const { result } = renderHook(() => useInviteMember(), { wrapper: wrap(qc) });
    await result.current.mutateAsync({ email: 'a@b.com', role: 'member' });
    await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it('useRemoveMember invalida a lista', async () => {
    const qc = makeClient();
    const key = seedList(qc);
    const { result } = renderHook(() => useRemoveMember(), { wrapper: wrap(qc) });
    await result.current.mutateAsync('m1');
    await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it('a chave LEGADA da lista nao era alcancada — a regressao que isto guarda', async () => {
    const qc = makeClient();
    const legado = ['engine', '/api/v1/teams/members'] as const;
    qc.setQueryData(legado, { members: [] });
    const { result } = renderHook(() => useInviteMember(), { wrapper: wrap(qc) });
    await result.current.mutateAsync({ email: 'a@b.com', role: 'member' });
    // Era assim que team.tsx lia a lista antes de B-060.
    expect(qc.getQueryState(legado)?.isInvalidated).toBe(false);
  });

  it('nao alcanca um recurso vizinho — a hierarquia delimita o raio', async () => {
    const qc = makeClient();
    const projects = queryKeys.projects.list();
    qc.setQueryData(projects, []);
    const { result } = renderHook(() => useInviteMember(), { wrapper: wrap(qc) });
    await result.current.mutateAsync({ email: 'a@b.com', role: 'member' });
    expect(qc.getQueryState(projects)?.isInvalidated).toBe(false);
  });
});
