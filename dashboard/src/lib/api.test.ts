// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { engineFetch, exchangeSessionToken, cloudFetch, ApiError } from './api';

vi.mock('./config', () => ({ API_URL: 'http://test.local' }));

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
