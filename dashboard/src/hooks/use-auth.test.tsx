import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGetSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSession: () => mockGetSession(),
}));

const mockSessionDefinitivelyExpired = vi.fn();
vi.mock('@/lib/http/api', () => ({
  sessionDefinitivelyExpired: () => mockSessionDefinitivelyExpired(),
}));

const mockReportEvent = vi.fn();
vi.mock('@/lib/telemetry/rum', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telemetry/rum')>('@/lib/telemetry/rum');
  return { ...actual, reportEvent: (...a: unknown[]) => mockReportEvent(...a) };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { useRequireAuth } from './use-auth';
import { recordAttempt } from '@/hooks/auth/auth-attempt';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useRequireAuth — one session check, no token (getloopscale/loopscale#477)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionDefinitivelyExpired.mockReturnValue(false);
  });

  // Red Team loop-console#50 asked for ONE round trip before the shell paints. With the BFF there is
  // exactly one: the session probe. There is no second, deferred token exchange to wait for.
  it('resolves the session from a single session check', async () => {
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    const { result } = renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('B-096 — o desfecho de SUCESSO da tentativa de login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockSessionDefinitivelyExpired.mockReturnValue(false);
    mockGetSession.mockResolvedValue({ id: 'i-1', email: 'a@b.c' });
  });

  it('a primeira renderizacao autenticada emite auth.method.success com o correlation_id da tentativa', async () => {
    recordAttempt({ method: 'password', correlation_id: 'c-42', started_at: Date.now() - 1500 });

    renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => {
      expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.success').length).toBe(1);
    });
    const payload = mockReportEvent.mock.calls.find((c) => c[0] === 'auth.method.success')![1] as Record<string, unknown>;
    // Este e o evento que nunca existiu: dava para contar quem TENTOU entrar e
    // ninguem que ENTROU. O correlation_id e o que fecha o funil com o
    // `auth.method.attempt` emitido na outra pagina, antes da navegacao.
    expect(payload.correlation_id).toBe('c-42');
    expect(payload.method).toBe('password');
    expect(payload.latency_ms).toBeGreaterThanOrEqual(1500);
  });

  it('sem tentativa pendente NAO emite sucesso — navegar dentro do app nao e um login', async () => {
    renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    // Todo render autenticado passa por aqui. Emitir sem tentativa transformaria
    // a metrica de logins numa contagem de navegacoes.
    expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.success')).toEqual([]);
  });

  it('a tentativa e consumida — um F5 no dashboard nao emite um segundo sucesso', async () => {
    recordAttempt({ method: 'github', correlation_id: 'c-7', started_at: Date.now() });
    const primeiro = renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => {
      expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.success').length).toBe(1);
    });
    primeiro.unmount();

    renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
    expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.success').length).toBe(1);
  });

  it('uma sessao EXPIRADA manda para /login e NAO emite sucesso', async () => {
    // B-140 — este caso mockava só `getSession -> null` e esperava o redirect, confundindo
    // "sem sessão" com "sessão acabou". São coisas diferentes: `getSession` devolve `null` por
    // três causas, e só um 401 na troca significa que ela terminou. A premissa agora é explícita.
    recordAttempt({ method: 'password', correlation_id: 'c-9', started_at: Date.now() });
    mockGetSession.mockResolvedValue(null);
    mockSessionDefinitivelyExpired.mockReturnValue(true);

    renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    // O caminho de sucesso vem DEPOIS do `if (!s) return`. Se a emissao subisse
    // para antes dessa guarda num refactor, uma sessao invalida contaria como
    // login bem-sucedido — o pior erro possivel nesta metrica.
    expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.success')).toEqual([]);
  });

  it('uma falha TRANSITORIA nao manda ninguem para /login', async () => {
    // A outra metade do B-140, e a que custava caro: um 502 ou uma queda de rede na troca também
    // produzem `getSession() === null`. Mandar para /login aí é falso E se realimenta — a
    // navegação remonta a árvore e refaz a troca contra o endpoint que acabou de falhar.
    recordAttempt({ method: 'password', correlation_id: 'c-10', started_at: Date.now() });
    mockGetSession.mockResolvedValue(null);
    mockSessionDefinitivelyExpired.mockReturnValue(false);

    renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => { expect(mockGetSession).toHaveBeenCalled(); });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
