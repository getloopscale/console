import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGetSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSession: () => mockGetSession(),
}));

const mockHasValidToken = vi.fn();
const mockExchangeSessionToken = vi.fn();
const mockSessionDefinitivelyExpired = vi.fn();
vi.mock('@/lib/http/api', () => ({
  hasValidToken: () => mockHasValidToken(),
  exchangeSessionToken: () => mockExchangeSessionToken(),
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
import { recordAttempt } from '@/lib/auth/auth-attempt';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useRequireAuth — Red Team theo-cloud#50 LCP closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasValidToken.mockReturnValue(false);
    mockExchangeSessionToken.mockResolvedValue(true);
    mockSessionDefinitivelyExpired.mockReturnValue(false);
  });

  // Red Team theo-cloud#50: the prior behavior awaited TWO sequential
  // blocking network calls (Kratos /sessions/whoami + the BFF token
  // exchange) before the page shell was allowed to render — adding the
  // BFF call's latency to LCP on every cold load. The new behavior
  // flips `checked` to true as soon as the session is detected; the
  // exchange runs in the background (data fetchers lazy-await it via
  // ensureToken() inside cloudFetch/engineFetch).
  it('flips checked to true immediately after session is detected (does not await JWT exchange)', async () => {
    let resolveExchange!: (v: boolean) => void;
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    mockExchangeSessionToken.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveExchange = resolve;
      }),
    );
    const { result } = renderHook(() => useRequireAuth(), { wrapper });

    // Wait for the session-detect path. The exchange promise is still
    // pending — yet `useRequireAuth` MUST have flipped to "checked"
    // (i.e. the page shell can paint).
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    // The exchange was kicked off…
    expect(mockExchangeSessionToken).toHaveBeenCalledTimes(1);
    // …without being awaited (the hook returned the session before
    // the exchange could resolve).
    resolveExchange(true);
  });

  it('skips the JWT exchange when a valid token is already cached', async () => {
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    mockHasValidToken.mockReturnValue(true);
    const { result } = renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(mockExchangeSessionToken).not.toHaveBeenCalled();
  });

  // Red Team theo-cloud#110: a stale Kratos session cookie returns active
  // from /sessions/whoami but the BFF cannot mint a JWT — the exchange
  // resolves to `false`. The prior fire-and-forget `void exchangeSessionToken()`
  // ignored the result, so the shell kept rendering, every cloudFetch/
  // engineFetch retried 401 forever, and the dashboard hung in "Loading".
  // The hook MUST navigate to /login when the deferred exchange fails.
  it('navigates to /login when the deferred JWT exchange resolves to false (stale Kratos cookie)', async () => {
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    mockExchangeSessionToken.mockResolvedValue(false);
    // Cookie velho => o whoami do Kratos nega => o handler responde 401. Este
    // e o UNICO caso terminal, e o #110 existe justamente por causa dele.
    mockSessionDefinitivelyExpired.mockReturnValue(true);
    renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  // #324, forma final. O contrato DESTE hook e o booleano: falhou a troca e a
  // sessao NAO acabou => fica onde esta. Quais status significam "nao acabou"
  // (429 / 500 / 502 / rejeicao de rede) e contrato do `lib/api.ts`, e a
  // enumeracao vive la, contra respostas HTTP de verdade — enumerar aqui, com
  // o booleano mockado, seriam quatro copias do mesmo caminho: teatro, nao
  // cobertura.
  it('nao navega para /login quando a troca falha sem a sessao ter acabado', async () => {
    mockGetSession.mockResolvedValue({
      active: true,
      identity: { id: 'u', traits: { email: 'u@x.com' } },
    });
    mockExchangeSessionToken.mockResolvedValue(false);
    mockSessionDefinitivelyExpired.mockReturnValue(false);
    const { result } = renderHook(() => useRequireAuth(), { wrapper });

    // Espera o shell pintar E a troca diferida resolver — sem isso a assercao
    // negativa passaria por so ter chegado cedo demais.
    await waitFor(() => expect(result.current).not.toBeNull());
    await waitFor(() => expect(mockExchangeSessionToken).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNavigate).not.toHaveBeenCalledWith('/login', { replace: true });
  });
});

describe('B-096 — o desfecho de SUCESSO da tentativa de login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockHasValidToken.mockReturnValue(true);
    mockExchangeSessionToken.mockResolvedValue(true);
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

  it('uma sessao ausente manda para /login e NAO emite sucesso', async () => {
    recordAttempt({ method: 'password', correlation_id: 'c-9', started_at: Date.now() });
    mockGetSession.mockResolvedValue(null);

    renderHook(() => useRequireAuth(), { wrapper });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    // O caminho de sucesso vem DEPOIS do `if (!s) return`. Se a emissao subisse
    // para antes dessa guarda num refactor, uma sessao invalida contaria como
    // login bem-sucedido — o pior erro possivel nesta metrica.
    expect(mockReportEvent.mock.calls.filter((c) => c[0] === 'auth.method.success')).toEqual([]);
  });
});
