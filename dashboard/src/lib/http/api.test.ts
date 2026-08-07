// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { engineFetch, exchangeSessionToken, cloudFetch, ApiError, sessionDefinitivelyExpired } from './api';

// B-049 — `mocksEnabled` passou a morar em ./config (era ./dev-mocks), para que
// api.ts — o modulo mais importado do repo — nao dependa do modulo de fixtures.
// O mock precisa declarar o valor: sem mocks de dev, e sempre false.
vi.mock('./http/config', () => ({ API_URL: 'http://test.local', mocksEnabled: () => false }));

// ---------------------------------------------------------------------------
// T6.1 / find_sec_004 — the JWT must NEVER transit the BroadcastChannel.
// ---------------------------------------------------------------------------

const posted: unknown[] = [];
beforeAll(() => {
  vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(
    (msg: unknown) => { posted.push(msg); },
  );
});

describe('dashboard auth cross-tab coordination', () => {
  it('never broadcasts the JWT over BroadcastChannel (find_sec_004)', async () => {
    const api = await import('./api');
    // B-042 — o canal deixou de ser aberto como efeito colateral de import e
    // passou a ter ciclo de vida explicito, entao o teste instala antes de
    // exercitar o logout. A asserção de seguranca abaixo e a mesma: nenhum
    // segredo pode transitar pelo canal.
    const disposeChannel = api.installAuthChannel();
    posted.length = 0;

    api.logout(); // the only path that broadcasts

    expect(posted.length).toBeGreaterThan(0);
    for (const msg of posted) {
      // No secret may transit the channel — neither a `token` field nor any
      // JWT-looking string.
      expect(msg).not.toHaveProperty('token');
      expect(JSON.stringify(msg)).not.toContain('token');
    }
    // Logout coordination (carries no secret) is still present.
    expect(posted.some((m) => (m as { type?: string }).type === 'logged-out')).toBe(true);
    disposeChannel();
  });
});

// ---------------------------------------------------------------------------
// EC-03 — engineFetch propagates AbortController signal to the underlying fetch.
// ---------------------------------------------------------------------------

describe('engineFetch — signal propagation (EC-03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('test_engineFetch_propagates_signal_to_fetch', async () => {
    // First mock: token exchange returns valid JWT shape
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Token exchange
        return new Response(
          JSON.stringify({ access_token: 'tk', expires_in: 3600 }),
          { status: 200 },
        );
      }
      // Actual data call
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // Prime the token cache so the actual data call uses our signal
    await exchangeSessionToken();

    const controller = new AbortController();
    await engineFetch('/foo', { signal: controller.signal });

    // The last fetch call is the data call (after token cache primed)
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const dataCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    const init = dataCall[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// T5.0 / EC-09 — fetchWithAuth auto-generates an Idempotency-Key for mutating
// methods (POST/PATCH/PUT/DELETE) unless the caller already provided one.
// ---------------------------------------------------------------------------

describe('fetchWithAuth — Idempotency-Key auto-gen (T5.0 / EC-09)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function primeTokenAndCapture(method: string, explicitKey?: string): Promise<Record<string, string>> {
    let callCount = 0;
    const captured: Record<string, string> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      }
      Object.assign(captured, (init as RequestInit).headers as Record<string, string>);
      return new Response(JSON.stringify({}), { status: 200 });
    });
    await exchangeSessionToken();
    const requestInit: RequestInit = { method };
    if (explicitKey) (requestInit.headers as Record<string, string>) = { 'Idempotency-Key': explicitKey };
    await engineFetch('/foo', requestInit);
    return captured;
  }

  it('test_POST_request_gets_auto_generated_uuid_idempotency_key', async () => {
    const headers = await primeTokenAndCapture('POST');
    expect(headers['Idempotency-Key']).toBeDefined();
    // RFC 4122 UUID v4-ish shape (relaxed: 36 chars with 4 hyphens).
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('test_PATCH_and_DELETE_and_PUT_also_get_keys', async () => {
    for (const method of ['PATCH', 'DELETE', 'PUT']) {
      const h = await primeTokenAndCapture(method);
      expect(h['Idempotency-Key'], `method=${method}`).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('test_GET_request_gets_no_idempotency_key', async () => {
    const headers = await primeTokenAndCapture('GET');
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('test_caller_explicit_key_wins_over_auto_gen', async () => {
    const headers = await primeTokenAndCapture('POST', 'caller-deliberate-replay-key-001');
    expect(headers['Idempotency-Key']).toBe('caller-deliberate-replay-key-001');
  });
});

// ---------------------------------------------------------------------------
// dashboard-memory-error-surfacing T1.1 — opt-in throwOnError + ApiError.
// Root cause of the live-test silent failure: cloudFetch swallowed non-2xx into
// null, so React Query reported success. The opt-in throws a typed ApiError so
// isError fires; the DEFAULT path stays `T | null` (49 callers unchanged).
// ---------------------------------------------------------------------------

describe('cloudFetch — opt-in throwOnError (dashboard-memory-error-surfacing T1.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function mockStatus(status: number): Promise<void> {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ code: 'X', message: 'no' }), { status });
    });
    await exchangeSessionToken();
  }

  it('throwOnError throws ApiError carrying the status on a 404', async () => {
    await mockStatus(404);
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'ApiError', status: 404 });
  });

  it('throwOnError throws ApiError(500) on a server error', async () => {
    await mockStatus(500);
    let caught: unknown;
    try {
      await cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
  });

  it('default (no flag) STILL returns null on a 404 — the T|null contract is unchanged', async () => {
    await mockStatus(404);
    const r = await cloudFetch('/v1/x', { method: 'POST', body: '{}' });
    expect(r).toBeNull();
  });

  it('throwOnError re-throws a network rejection as an ApiError (not silent null)', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      throw new Error('network down');
    });
    await exchangeSessionToken();
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// dashboard-memory-error-surfacing /review fixes — regression guards for the
// branches the throwOnError insertion touched but the slice left untested:
//   - 402 PLAN_LIMIT emit MUST still fire on the same !resp.ok branch that now
//     throws (F-tests-1, HIGH).
//   - the 401-refresh-retry dual path (F-tests-2, MEDIUM): retry success,
//     retry-still-failing, and refresh-FAILED (F-dom-1 / F-api-1 contract fix).
// ---------------------------------------------------------------------------

describe('cloudFetch — 402 PLAN_LIMIT side-effect survives throwOnError (F-tests-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function mock402(): Promise<void> {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ code: 'PLAN_LIMIT_EXCEEDED', message: 'upgrade' }), { status: 402 });
    });
    await exchangeSessionToken();
  }

  it('emits theo:plan-limit AND throws ApiError(402) under throwOnError', async () => {
    await mock402();
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('theo:plan-limit', handler);
    try {
      await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
        .rejects.toMatchObject({ name: 'ApiError', status: 402 });
      expect(events.length).toBe(1);
      expect((events[0].detail as { code: string }).code).toBe('PLAN_LIMIT_EXCEEDED');
    } finally {
      window.removeEventListener('theo:plan-limit', handler);
    }
  });

  it('emits theo:plan-limit AND returns null under the default contract', async () => {
    await mock402();
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('theo:plan-limit', handler);
    try {
      const r = await cloudFetch('/v1/x', { method: 'POST', body: '{}' });
      expect(r).toBeNull();
      expect(events.length).toBe(1);
    } finally {
      window.removeEventListener('theo:plan-limit', handler);
    }
  });
});

describe('cloudFetch — 401-refresh-retry path under throwOnError (F-tests-2 / F-api-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('401 then a refreshed 200 resolves with the retried body', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      n++;
      const isTokenExchange = String(url).includes('/v1/auth/session/token');
      if (isTokenExchange) {
        return new Response(JSON.stringify({ access_token: `tk-${n}`, expires_in: 3600 }), { status: 200 });
      }
      // First data call 401 (forces refresh); the retried data call 200.
      if (n <= 2) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await exchangeSessionToken();
    const r = await cloudFetch<{ ok: boolean }>('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true });
    expect(r).toEqual({ ok: true });
  });

  it('401 then a refreshed-but-still-500 throws ApiError(500) under throwOnError', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      n++;
      if (String(url).includes('/v1/auth/session/token')) {
        return new Response(JSON.stringify({ access_token: `tk-${n}`, expires_in: 3600 }), { status: 200 });
      }
      if (n <= 2) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ code: 'X', message: 'boom' }), { status: 500 });
    });
    await exchangeSessionToken();
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'ApiError', status: 500 });
  });

  it('401 with a FAILED refresh throws ApiError(401) under throwOnError (F-api-1: no silent null on auth expiry)', async () => {
    let primed = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const isTokenExchange = String(url).includes('/v1/auth/session/token');
      if (isTokenExchange) {
        // First exchange (prime) succeeds; the in-flow refresh fails (401).
        if (!primed) { primed = true; return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 }); }
        return new Response('', { status: 401 });
      }
      return new Response('', { status: 401 }); // data call always 401 → triggers refresh
    });
    await exchangeSessionToken();
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'ApiError', status: 401 });
  });
});

// ---------------------------------------------------------------------------
// M75 — a 204 No Content success (e.g. DELETE) must resolve, not be mistaken
// for a failure. Regression: `resp.json()` threw on the empty body and the
// catch-all re-threw it as ApiError(0) under throwOnError, so a successful
// delete surfaced as "Could not delete". (Caught by live dogfood.)
// ---------------------------------------------------------------------------

describe('cloudFetch — 204 No Content is a success (M75)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('resolves to null on a 204 DELETE under throwOnError (does not throw)', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      return new Response(null, { status: 204 }); // No Content (a 204 must have a null body)
    });
    await exchangeSessionToken();
    await expect(cloudFetch('/v1/dashboard/lens/dashboards/abc', { method: 'DELETE' }, { throwOnError: true }))
      .resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LT/#324 — um 429 na troca de sessão NÃO é sessão expirada.
//
// O defeito, medido ao vivo em 2026-08-01: `exchangeSessionToken` faz
// `if (!resp.ok) return false`, colapsando TODO erro num único booleano. Um
// `429` (cota de 10/min por IP, `internal/routes/session_token.go:29-30`) fica
// indistinguível de um `401`, e o chamador traduz isso em
// `redirectToLogin('expired')`. O redirect recarrega a página, zera o dedup de
// refresh e dispara nova troca — que consome mais da cota já estourada. O
// estado se auto-perpetua: o usuário fica preso num loop vendo "Session
// expired" com a sessão VÁLIDA (`/sessions/whoami` respondendo 200).
//
// A suíte cobria o caminho de `401` e não o de `429` — por isso passou.
// ---------------------------------------------------------------------------

describe('troca de sessão sob rate limit (#324)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('um 429 na troca de token não anuncia sessão expirada nem redireciona', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) {
        // O servidor diz "tente de novo em breve", com o instante de reset.
        return new Response(JSON.stringify({ code: 'RATE_LIMITED' }), {
          status: 429,
          headers: { 'Retry-After': '30' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await engineFetch('/foo').catch(() => undefined);

    // O sintoma que prende o usuário: o aviso de sessão expirada. Um 429 não
    // é logout — a sessão do Kratos segue válida.
    expect(document.body.textContent ?? '').not.toContain('Session expired');
  });
});

// ---------------------------------------------------------------------------
// #324, segunda rodada — a primeira correção cobriu UM caminho de três.
//
// `api.ts` chama `redirectToLogin('expired')` em três lugares, e só o de
// `cloudFetch` consultava a flag de rate limit. O caminho que o red team
// exercitou ao vivo é outro: uma chamada de dados devolve `401`, o
// `fetchWithAuth` tenta refrescar o token, o refresh bate na cota de 10/min —
// e redireciona. O loop persistiu com a correção no ar, comprovadamente.
//
// O teste anterior exercitava a troca DIRETA de sessão. Uma correção parcial
// passa nele: é a pergunta que esta corrida ensinou — existe uma implementação
// errada que passaria neste teste? Passava.
// ---------------------------------------------------------------------------

describe('rate limit no refresh apos 401 (#324, segunda rodada)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('um 401 seguido de 429 no refresh nao anuncia sessao expirada', async () => {
    let tokenCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) {
        tokenCalls += 1;
        // A primeira troca funciona (o usuario esta logado); o REFRESH bate na cota.
        if (tokenCalls === 1) {
          return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 });
      }
      // A chamada de dados expira: dispara o caminho de refresh.
      return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 });
    });

    await exchangeSessionToken();
    await cloudFetch('/foo').catch(() => undefined);

    expect(document.body.textContent ?? '').not.toContain('Session expired');
  });

  // #324, forma final — a enumeracao vive AQUI porque aqui ela discrimina:
  // cada caso e uma resposta HTTP diferente de verdade, nao o mesmo booleano
  // mockado quatro vezes. O handler do servidor
  // (internal/routes/session_token.go) tem SETE saidas de falha e so o 401
  // significa que a sessao acabou; as demais dizem "tente de novo". Enumerar o
  // lado transitorio caso a caso foi o que fez as tres rodadas anteriores
  // fecharem um caminho e deixarem os outros — este teste fixa o lado TERMINAL,
  // que tem um membro so, e deixa qualquer status futuro cair no lado seguro.
  it.each([
    { status: 429, code: 'RATE_LIMITED', label: 'cota estourada' },
    { status: 502, code: 'AUTH_SERVICE_UNAVAILABLE', label: 'servico de autenticacao fora' },
    { status: 500, code: 'INTERNAL_ERROR', label: 'erro interno' },
    { status: 500, code: 'TENANT_ERROR', label: 'falha de provisionamento' },
  ])('nao declara sessao encerrada quando a troca falha com $status $code ($label)', async ({ status, code }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code }), { status }),
    );

    const ok = await exchangeSessionToken();

    expect(ok).toBe(false);
    expect(sessionDefinitivelyExpired()).toBe(false);
  });

  it('nao declara sessao encerrada quando a rede rejeita (sem resposta)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const ok = await exchangeSessionToken();

    expect(ok).toBe(false);
    expect(sessionDefinitivelyExpired()).toBe(false);
  });

  // O par que impede a inversao de virar "nunca redireciona" — sem ele, uma
  // implementacao que sempre devolve false passaria em todos os casos acima e
  // reintroduziria o #110 (cookie Kratos velho prendendo o app em "Loading").
  it('declara sessao encerrada quando a troca falha com 401 (cookie Kratos velho)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 }),
    );

    const ok = await exchangeSessionToken();

    expect(ok).toBe(false);
    expect(sessionDefinitivelyExpired()).toBe(true);
  });
});
