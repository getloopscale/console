// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  engineFetch,
  cloudFetch,
  cloudFetchRaw,
  fetchSessionIdentity,
  ApiError,
  sessionDefinitivelyExpired,
} from './api';

// B-049 — `mocksEnabled` lives in ./config; without dev mocks it is always false.
vi.mock('./http/config', () => ({ API_URL: 'http://test.local', mocksEnabled: () => false }));

const SESSION = '/v1/auth/session';
const isSessionProbe = (url: string | URL | Request) => String(url).endsWith(SESSION);
const okSession = () =>
  new Response(JSON.stringify({ identity: { id: 'id-1', email: 'u@example.com' } }), { status: 200 });

/** Stubs `fetch`: the session probe answers `probe()`, every data call answers `data(n)`. */
function stubNetwork(opts: { probe?: () => Response | Promise<Response>; data: (n: number) => Response | Promise<Response> }) {
  let n = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (isSessionProbe(url)) return (opts.probe ?? okSession)();
    n += 1;
    return opts.data(n);
  });
}

beforeEach(() => {
  // A repeated `vi.spyOn(globalThis, 'fetch')` returns the SAME spy, so call history would leak
  // from case to case and `mock.calls[0]` would name another test's request.
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// usetheoai/theo#477 step 3 — the dashboard holds NO token. theo-cloud is its Backend for
// Frontend and authenticates every call from the Kratos session cookie.
// ---------------------------------------------------------------------------

describe('the dashboard holds no token (usetheoai/theo#477)', () => {
  it('a data call carries no Authorization header and sends the session cookie to its own origin', async () => {
    const spy = stubNetwork({ data: () => new Response(JSON.stringify({ ok: true }), { status: 200 }) });

    await cloudFetch('/v1/billing');

    const dataCall = spy.mock.calls.find(([url]) => String(url).endsWith('/v1/billing'));
    expect(dataCall).toBeDefined();
    const init = (dataCall as [string, RequestInit])[1];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.credentials).toBe('same-origin');
  });

  it('never calls the HS256 session-token endpoint', async () => {
    const spy = stubNetwork({ data: () => new Response('', { status: 401 }) });

    await cloudFetch('/v1/billing').catch(() => undefined);
    await engineFetch('/api/v1/projects').catch(() => undefined);

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of spy.mock.calls) expect(String(url)).not.toContain('/v1/auth/session/token');
  });

  it('stores nothing in localStorage or sessionStorage, even when the server answers with a token', async () => {
    // A response still shaped like the old exchange must not be kept anywhere.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ access_token: 'leaked-jwt', identity: { id: 'id-1', email: 'u@example.com' } }), { status: 200 }),
    );

    await cloudFetch('/v1/billing');

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('a raw download carries no Authorization header either', async () => {
    const spy = stubNetwork({ data: () => new Response('bytes', { status: 200 }) });

    await cloudFetchRaw('/v1/dashboard/storage/objects/a.txt');

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.credentials).toBe('same-origin');
  });
});

describe('fetchSessionIdentity — the identity comes from GET /v1/auth/session', () => {
  it('returns the identity the BFF answered', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okSession());

    const identity = await fetchSessionIdentity();

    expect(identity).toEqual({ id: 'id-1', email: 'u@example.com' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(SESSION);
    expect(init.credentials).toBe('same-origin');
  });

  it('concurrent callers share one request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okSession());

    await Promise.all([fetchSessionIdentity(), fetchSessionIdentity(), fetchSessionIdentity()]);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// EC-03 — engineFetch propagates AbortController signal to the underlying fetch.
// ---------------------------------------------------------------------------

describe('engineFetch — signal propagation (EC-03)', () => {
  it('test_engineFetch_propagates_signal_to_fetch', async () => {
    const spy = stubNetwork({ data: () => new Response(JSON.stringify({ ok: true }), { status: 200 }) });

    const controller = new AbortController();
    await engineFetch('/foo', { signal: controller.signal });

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// T5.0 / EC-09 — mutating methods get an Idempotency-Key unless the caller set one.
// ---------------------------------------------------------------------------

describe('Idempotency-Key auto-gen (T5.0 / EC-09)', () => {
  async function capture(method: string, explicitKey?: string): Promise<Record<string, string>> {
    const spy = stubNetwork({ data: () => new Response(JSON.stringify({}), { status: 200 }) });
    const requestInit: RequestInit = { method };
    if (explicitKey) requestInit.headers = { 'Idempotency-Key': explicitKey };
    await engineFetch('/foo', requestInit);
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    spy.mockRestore();
    return headers;
  }

  it('test_POST_request_gets_auto_generated_uuid_idempotency_key', async () => {
    const headers = await capture('POST');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('test_PATCH_and_DELETE_and_PUT_also_get_keys', async () => {
    for (const method of ['PATCH', 'DELETE', 'PUT']) {
      const h = await capture(method);
      expect(h['Idempotency-Key'], `method=${method}`).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('test_GET_request_gets_no_idempotency_key', async () => {
    const headers = await capture('GET');
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('test_caller_explicit_key_wins_over_auto_gen', async () => {
    const headers = await capture('POST', 'caller-deliberate-replay-key-001');
    expect(headers['Idempotency-Key']).toBe('caller-deliberate-replay-key-001');
  });
});

// ---------------------------------------------------------------------------
// dashboard-memory-error-surfacing T1.1 — opt-in throwOnError + ApiError.
// ---------------------------------------------------------------------------

describe('cloudFetch — opt-in throwOnError (dashboard-memory-error-surfacing T1.1)', () => {
  const answer = (status: number) =>
    stubNetwork({ data: () => new Response(JSON.stringify({ code: 'X', message: 'no' }), { status }) });

  it('throwOnError throws ApiError carrying the status on a 404', async () => {
    answer(404);
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'ApiError', status: 404 });
  });

  it('throwOnError throws ApiError(500) on a server error', async () => {
    answer(500);
    const caught = await cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
  });

  it('default (no flag) STILL returns null on a 404 — the T|null contract is unchanged', async () => {
    answer(404);
    expect(await cloudFetch('/v1/x', { method: 'POST', body: '{}' })).toBeNull();
  });

  it('throwOnError re-throws a network rejection as an ApiError (not silent null)', async () => {
    stubNetwork({ data: () => { throw new Error('network down'); } });
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toBeInstanceOf(ApiError);
  });

  it('a 502 from the BFF (session could not be checked) is an error, not a sign-out', async () => {
    stubNetwork({ data: () => new Response(JSON.stringify({ code: 'AUTH_SERVICE_UNAVAILABLE' }), { status: 502 }) });
    await expect(cloudFetch('/v1/x', {}, { throwOnError: true })).rejects.toMatchObject({ status: 502 });
    expect(document.body.textContent ?? '').not.toContain('Session expired');
  });
});

describe('cloudFetch — 402 PLAN_LIMIT side-effect survives throwOnError (F-tests-1)', () => {
  const mock402 = () =>
    stubNetwork({ data: () => new Response(JSON.stringify({ code: 'PLAN_LIMIT_EXCEEDED', message: 'upgrade' }), { status: 402 }) });

  it('emits loopscale:plan-limit AND throws ApiError(402) under throwOnError', async () => {
    mock402();
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('loopscale:plan-limit', handler);
    try {
      await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
        .rejects.toMatchObject({ name: 'ApiError', status: 402 });
      expect(events.length).toBe(1);
      expect((events[0].detail as { code: string }).code).toBe('PLAN_LIMIT_EXCEEDED');
    } finally {
      window.removeEventListener('loopscale:plan-limit', handler);
    }
  });

  it('emits loopscale:plan-limit AND returns null under the default contract', async () => {
    mock402();
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('loopscale:plan-limit', handler);
    try {
      expect(await cloudFetch('/v1/x', { method: 'POST', body: '{}' })).toBeNull();
      expect(events.length).toBe(1);
    } finally {
      window.removeEventListener('loopscale:plan-limit', handler);
    }
  });
});

describe('cloudFetch — 204 No Content is a success (M75)', () => {
  it('resolves to null on a 204 DELETE under throwOnError (does not throw)', async () => {
    stubNetwork({ data: () => new Response(null, { status: 204 }) });
    await expect(cloudFetch('/v1/dashboard/lens/dashboards/abc', { method: 'DELETE' }, { throwOnError: true }))
      .resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A 401 on a data call SUGGESTS the session ended; the session probe decides (#324, #110).
// ---------------------------------------------------------------------------

describe('a 401 on a data call — the session probe decides', () => {
  it('a live session: the call is retried once and resolves with the retried body', async () => {
    stubNetwork({
      data: (n) => (n === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ ok: true }), { status: 200 })),
    });
    await expect(cloudFetch<{ ok: boolean }>('/v1/x', {}, { throwOnError: true })).resolves.toEqual({ ok: true });
  });

  it('a live session and a retry that still fails throws that status', async () => {
    stubNetwork({
      data: (n) => (n === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ code: 'X' }), { status: 500 })),
    });
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'ApiError', status: 500 });
  });

  it('an ended session throws ApiError(401) under throwOnError (F-api-1: no silent null)', async () => {
    stubNetwork({ probe: () => new Response('', { status: 401 }), data: () => new Response('', { status: 401 }) });
    await expect(cloudFetch('/v1/x', { method: 'POST', body: '{}' }, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'ApiError', status: 401 });
    expect(sessionDefinitivelyExpired()).toBe(true);
  });

  it.each([
    { status: 429, code: 'RATE_LIMITED' },
    { status: 502, code: 'AUTH_SERVICE_UNAVAILABLE' },
    { status: 500, code: 'INTERNAL_ERROR' },
  ])('a probe that fails with $status $code is not a sign-out, and the error says $status (B-142)', async ({ status, code }) => {
    stubNetwork({
      probe: () => new Response(JSON.stringify({ code }), { status }),
      data: () => new Response('', { status: 401 }),
    });

    const erro = await cloudFetch('/foo', {}, { throwOnError: true }).catch((e: unknown) => e);

    expect(sessionDefinitivelyExpired()).toBe(false);
    expect((erro as ApiError).status).toBe(status);
    expect(document.body.textContent ?? '').not.toContain('Session expired');
  });

  it('a probe the network rejects is not a sign-out, and surfaces as status 0', async () => {
    stubNetwork({ probe: () => { throw new TypeError('Failed to fetch'); }, data: () => new Response('', { status: 401 }) });

    const erro = await cloudFetch('/foo', {}, { throwOnError: true }).catch((e: unknown) => e);

    expect(sessionDefinitivelyExpired()).toBe(false);
    expect((erro as ApiError).status).toBe(0);
  });

  it('concurrent 401s ask the session once', async () => {
    let probes = 0;
    let soltar!: () => void;
    const segurada = new Promise<void>((r) => { soltar = r; });
    stubNetwork({
      probe: async () => { probes += 1; await segurada; return okSession(); },
      data: (n) => (n <= 2 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ ok: true }), { status: 200 })),
    });

    const a = cloudFetch('/a');
    const b = cloudFetch('/b');
    await new Promise((r) => setTimeout(r, 10));
    soltar();
    await Promise.all([a, b]);

    expect(probes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B-234 / B-218 — what crosses an event boundary, and how an expiry is announced.
// Each case imports a FRESH module: `redirecting` is a module-level latch, and a case asserting
// "no redirect" would pass trivially after any earlier case had tripped it.
// ---------------------------------------------------------------------------

describe('cross-tab coordination (B-234, find_sec_004)', () => {
  async function freshWithChannel() {
    vi.resetModules();
    const api = await import('./api');
    const dispose = api.installAuthChannel();
    const expirados: string[] = [];
    const ouvinte = () => expirados.push('expired');
    window.addEventListener('loopscale:session-expired', ouvinte);
    return {
      api,
      expirados,
      cleanup: () => { dispose(); window.removeEventListener('loopscale:session-expired', ouvinte); },
    };
  }

  it('the logout broadcast carries no secret', async () => {
    const posted: unknown[] = [];
    const original = BroadcastChannel.prototype.postMessage;
    vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(function (this: BroadcastChannel, msg: unknown) {
      posted.push(msg);
      original.call(this, msg);
    });
    const { api, cleanup } = await freshWithChannel();

    api.announceLogoutAcrossTabs();

    expect(posted.some((m) => (m as { type?: string }).type === 'logged-out')).toBe(true);
    for (const msg of posted) expect(JSON.stringify(msg)).not.toContain('token');
    cleanup();
  });

  it('a null broadcast neither throws nor signs this tab out', async () => {
    const { expirados, cleanup } = await freshWithChannel();
    const canal = new BroadcastChannel('loopscale-auth');
    canal.postMessage(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(expirados).toEqual([]);
    canal.close();
    cleanup();
  });

  it('a message with an unknown type does not sign this tab out', async () => {
    const { expirados, cleanup } = await freshWithChannel();
    const canal = new BroadcastChannel('loopscale-auth');
    canal.postMessage({ type: 'hello' });
    await new Promise((r) => setTimeout(r, 20));
    expect(expirados).toEqual([]);
    canal.close();
    cleanup();
  });

  it('the message that IS a logout signs this tab out', async () => {
    // The counterpart without which the two cases above would pass with a handler that ignores all.
    const { expirados, cleanup } = await freshWithChannel();
    const canal = new BroadcastChannel('loopscale-auth');
    canal.postMessage({ type: 'logged-out' });
    await new Promise((r) => setTimeout(r, 20));
    expect(expirados).toEqual(['expired']);
    canal.close();
    cleanup();
  });
});

describe('B-218 — the client announces the expiry instead of building DOM', () => {
  it('injects no node of its own and fires an event a component can render', async () => {
    vi.resetModules();
    const fresh = await import('./api');
    const ouvidos: string[] = [];
    const ouvinte = () => ouvidos.push('expired');
    window.addEventListener('loopscale:session-expired', ouvinte);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 }),
    );

    await fresh.cloudFetch('/foo').catch(() => undefined);

    expect(document.body.querySelector('div[style]')).toBeNull();
    expect(ouvidos).toContain('expired');
    window.removeEventListener('loopscale:session-expired', ouvinte);
  });
});
