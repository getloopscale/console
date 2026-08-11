// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineFetch, exchangeSessionToken, cloudFetch, ApiError, sessionDefinitivelyExpired, installAuthChannel } from './api';

// B-049 — `mocksEnabled` passou a morar em ./config (era ./dev-mocks), para que
// api.ts — o modulo mais importado do repo — nao dependa do modulo de fixtures.
// O mock precisa declarar o valor: sem mocks de dev, e sempre false.
vi.mock('./http/config', () => ({ API_URL: 'http://test.local', mocksEnabled: () => false }));

// ---------------------------------------------------------------------------
// T6.1 / find_sec_004 — the JWT must NEVER transit the BroadcastChannel.
// ---------------------------------------------------------------------------

const posted: unknown[] = [];
// B-197 — este espião morava num `beforeAll`, e qualquer `restoreAllMocks` de outro arquivo o
// derrubava para todos os casos seguintes. Em ordem fixa isso nunca acontecia; sob
// `--sequence.shuffle` a asserção de SEGURANÇA abaixo passava a não capturar nada. Reinstalar a
// cada caso custa nada e não depende de quem rodou antes.
beforeEach(() => {
  vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(
    (msg: unknown) => { posted.push(msg); },
  );
});

describe('dashboard auth cross-tab coordination', () => {
  it('never broadcasts the JWT over BroadcastChannel (find_sec_004)', async () => {
    // B-197 — este caso FALHAVA sob `--sequence.shuffle`, e é o achado mais caro daquela medição:
    // uma asserção de SEGURANÇA que só passava quando rodava na posição certa. Um gate que depende
    // da ordem de execução não é um gate.
    //
    // A causa é estado de MÓDULO. `installAuthChannel` é idempotente de propósito (B-042), e outro
    // caso deste arquivo faz `vi.resetModules()` — então, dependendo da ordem, este `import`
    // resolvia para uma instância cujo canal já estava aberto por outro teste, e a instalação daqui
    // virava no-op sobre um canal que não era o dele.
    //
    // Ele passa a criar a própria instância. Um teste que afirma "nenhum segredo atravessa o canal"
    // precisa ser verdadeiro sozinho, não em companhia.
    vi.resetModules();
    const api = await import('./api');
    // B-042 — o canal deixou de ser aberto como efeito colateral de import e
    // passou a ter ciclo de vida explicito, entao o teste instala antes de
    // exercitar o logout. A asserção de seguranca abaixo e a mesma: nenhum
    // segredo pode transitar pelo canal.
    const disposeChannel = api.installAuthChannel();
    posted.length = 0;

    api.clearTokenAcrossTabs(); // the only path that broadcasts

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

// ---------------------------------------------------------------------------
// B-142 — the client threw a status it never received.
//
// On the transient-auth path `cloudFetch` threw `ApiError(429, 'Too many requests')` for EVERY
// failure of the token exchange: a 500, a 502 whose own message says "Try again", or a network
// rejection with no response at all. `lastExchangeStatus` already held the truth and was read by
// nothing but `sessionDefinitivelyExpired()`.
//
// It is not a cosmetic lie. `retryGuard` keys on the status and refuses to retry any 4xx, so the
// one failure class that most deserves a retry was guaranteed never to get one.
// ---------------------------------------------------------------------------

describe('B-142 — the thrown error carries the status that actually happened', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a 502 from the exchange is not reported as a rate limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) {
        return new Response(JSON.stringify({ code: 'AUTH_SERVICE_UNAVAILABLE' }), { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const erro = await cloudFetch('/foo', {}, { throwOnError: true }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(502);
    expect((erro as ApiError).message).not.toMatch(/too many requests/i);
  });

  it('a network rejection from the exchange surfaces as status 0, the value that means "no response"', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) throw new TypeError('network down');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const erro = await cloudFetch('/foo', {}, { throwOnError: true }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(0);
  });

  it('a genuine 429 from the exchange still says 429', async () => {
    // The fix must not overshoot: when the exchange really WAS rate limited, that is the status.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) {
        return new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const erro = await cloudFetch('/foo', {}, { throwOnError: true }).catch((e: unknown) => e);

    expect((erro as ApiError).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// B-231 — a 401 that arrives late destroys the token the refresh just minted.
//
// `refreshPromise` dedups the EXCHANGE, not the eager `accessToken = null` that precedes it. With
// two requests in flight: A gets 401, nulls the token, starts the exchange; the exchange succeeds
// and sets a fresh token; B then gets its own 401 and nulls THAT fresh token, so its `ensureToken`
// finds nothing valid and starts a second exchange — against the endpoint whose quota #324
// records as already blown once. The loop feeds itself with a perfectly valid Kratos session.
//
// The race is between continuations on one thread, across an await. That is why the fix is a
// generation counter (compare-and-swap) and not a lock.
// ---------------------------------------------------------------------------

describe('B-231 — concurrent 401s do not each invalidate the token', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a 401 that arrives AFTER the refresh does not throw away the fresh token', async () => {
    // The interleaving is the defect, so the interleaving is controlled rather than hoped for.
    // Request B's first attempt is held open until A has finished refreshing; B's 401 therefore
    // lands on a token that is already fresh, which is exactly the case where nulling it is wrong.
    let exchanges = 0;
    // `!` (definite assignment): o executor do Promise roda sincronamente, entao a atribuicao
    // aconteceu antes de qualquer uso — o que o fluxo de controle do TS nao consegue ver.
    let soltarB!: () => void;
    const bSegurado = new Promise<void>((r) => { soltarB = r; });
    let bJaFalhou = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/v1/auth/session/token')) {
        exchanges += 1;
        return new Response(
          JSON.stringify({ access_token: `tk-${String(exchanges)}`, expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (u.includes('/b') && !bJaFalhou) {
        bJaFalhou = true;
        await bSegurado; // held until A's refresh has completed
        return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 });
      }
      if (u.includes('/a')) return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await exchangeSessionToken();
    const antes = exchanges;

    const b = cloudFetch('/b');
    await cloudFetch('/a'); // A: 401 -> refresh -> retry, all while B is held
    const aposA = exchanges;
    expect(aposA - antes).toBe(1); // A refreshed once, as it should

    soltarB();
    await b;

    // B's late 401 must NOT null the token A just minted. If it does, B's ensureToken finds
    // nothing valid and runs a SECOND exchange — the self-feeding loop #324 is about.
    expect(exchanges - aposA).toBe(0);
  });

  it('a 401 on the CURRENT token still refreshes — the guard must not disable the mechanism', async () => {
    let exchanges = 0;
    let dataCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/v1/auth/session/token')) {
        exchanges += 1;
        return new Response(
          JSON.stringify({ access_token: `tk-${String(exchanges)}`, expires_in: 3600 }),
          { status: 200 },
        );
      }
      dataCalls += 1;
      if (dataCalls === 1) return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await exchangeSessionToken();
    const antes = exchanges;

    await expect(cloudFetch('/a')).resolves.toEqual({ ok: true });
    expect(exchanges - antes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B-234 / B-218 — what crosses an event boundary, and what the transport is allowed to build.
// ---------------------------------------------------------------------------

describe('B-234 — a malformed cross-tab message is not a logout', () => {
  it('a null broadcast neither throws nor clears the token', async () => {
    // `MessageEvent<AuthMessage>` was a compile-time claim about a runtime payload from another
    // tab. `msg.type` on null threw a TypeError INSIDE the handler, where nothing catches it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) {
        return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const dispose = installAuthChannel();
    await exchangeSessionToken();

    const canal = new BroadcastChannel('theo-auth');
    canal.postMessage(null);
    await new Promise((r) => setTimeout(r, 20));

    // The token survives, and a subsequent call does not have to re-exchange.
    await expect(cloudFetch('/foo')).resolves.toEqual({ ok: true });
    canal.close();
    dispose();
  });

  it('a message with an unknown type does not force a logout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/auth/session/token')) {
        return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const dispose = installAuthChannel();
    await exchangeSessionToken();

    const canal = new BroadcastChannel('theo-auth');
    canal.postMessage({ type: 'hello' });
    await new Promise((r) => setTimeout(r, 20));

    await expect(cloudFetch('/foo')).resolves.toEqual({ ok: true });
    canal.close();
    dispose();
  });
});

describe('B-218 — the client announces the expiry instead of building DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('injects no node of its own and fires an event a component can render', async () => {
    // `redirecting` is a module-level latch: once any test in this file has triggered a redirect,
    // every later one returns early. That is a real property of the module (it stops a redirect
    // loop) and it makes the behaviour untestable in place — so this case gets a FRESH module.
    // The alternative was asserting nothing, which is how the toast went four years unasserted.
    vi.resetModules();
    const fresh = await import('./api');

    const ouvidos: string[] = [];
    const ouvinte = () => ouvidos.push('expired');
    window.addEventListener('theo:session-expired', ouvinte);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 }),
    );

    await fresh.cloudFetch('/foo').catch(() => undefined);

    // The old implementation appended a styled <div> straight into document.body.
    expect(document.body.querySelector('div[style]')).toBeNull();
    expect(ouvidos).toContain('expired');

    window.removeEventListener('theo:session-expired', ouvinte);
  });
});
