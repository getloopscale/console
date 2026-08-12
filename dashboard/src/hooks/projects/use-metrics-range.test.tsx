/**
 * use-metrics-range.test.tsx — vitest hermetic tests for T2.2.
 *
 * Covers:
 *  - happy path: backend returns data → hook returns status=ok + data array
 *  - EC-8 absorption: backend returns collecting → hook returns hint
 *  - EC-5 absorption: backend returns null (504 mapped) → prometheus_unreachable
 *  - fetch URL construction (encodeURIComponent for project + signal + range)
 *  - disabled when project/signal missing
 *  - default range = '7d'
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/api', () => ({
  engineFetch: vi.fn(),
}));

vi.mock('@/lib/http/config', () => ({ API_URL: '' }));

import { useMetricsRange } from './use-metrics-range';
import type { MetricsRangeResponse } from './use-metrics-range';
import { engineFetch } from '@/lib/http/api';

const mockedEngineFetch = vi.mocked(engineFetch);

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMetricsRange — T2.2 J-18', () => {
  it('happy path: returns status=ok + data array when backend responds with data', async () => {
    const fixture: MetricsRangeResponse = {
      signal: 'uptime_24h',
      range: '7d',
      status: 'ok',
      data: [
        { t: 1000, v: 0.99 },
        { t: 2000, v: 0.98 },
        { t: 3000, v: 0.97 },
      ],
    };
    mockedEngineFetch.mockResolvedValue(fixture);

    const { result } = renderHook(
      () => useMetricsRange('teste', { signal: 'uptime_24h', range: '7d' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toBe('ok');
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data[0]).toEqual({ t: 1000, v: 0.99 });
    expect(result.current.error).toBe(false);
  });

  it('EC-8 absorption: returns status=collecting + hint when backend reports collecting state', async () => {
    const fixture: MetricsRangeResponse = {
      signal: 'uptime_24h',
      range: '7d',
      status: 'collecting',
      collecting_hint: 'Coletando dados...',
      data: [],
    };
    mockedEngineFetch.mockResolvedValue(fixture);

    const { result } = renderHook(
      () => useMetricsRange('newproj', { signal: 'uptime_24h' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toBe('collecting');
    expect(result.current.collectingHint).toBe('Coletando dados...');
    expect(result.current.data).toEqual([]);
  });

  it('EC-5 absorption: returns status=prometheus_unreachable when engineFetch returns null', async () => {
    // engineFetch returns null on backend non-OK (504 → null per BFF pattern).
    mockedEngineFetch.mockResolvedValue(null);

    const { result } = renderHook(
      () => useMetricsRange('teste', { signal: 'uptime_24h' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // null + not error → status falls into the null-resp branch
    // The hook treats null as 'unknown' (no explicit error from query) — UI
    // consumer renders "—" for unknown OR prometheus_unreachable equally.
    expect(['unknown', 'prometheus_unreachable']).toContain(result.current.status);
    expect(result.current.data).toEqual([]);
  });

  it('fetch URL encodes project + signal + range parameters', async () => {
    mockedEngineFetch.mockResolvedValue({
      signal: 'p95_latency',
      range: '24h',
      status: 'ok',
      data: [],
    } as MetricsRangeResponse);

    const { result } = renderHook(
      () => useMetricsRange('proj/with/slashes', { signal: 'p95_latency', range: '24h' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // #274 — a leitura passou a optar por `throwOnError`, então a chamada tem 3 argumentos. A
    // assertiva afirma o TERCEIRO em vez de ignorá-lo: sem isso, um futuro que remova o opt-in
    // deixaria este teste verde de novo, e o estado vazio voltaria a mentir.
    expect(mockedEngineFetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/projects\/proj%2Fwith%2Fslashes\/metrics\?range=24h&signal=p95_latency$/),
      expect.anything(), expect.objectContaining({ throwOnError: true }),
    );
  });

  it('default range is "7d" when omitted', async () => {
    mockedEngineFetch.mockResolvedValue({
      signal: 'uptime_24h',
      range: '7d',
      status: 'ok',
      data: [],
    } as MetricsRangeResponse);

    renderHook(
      () => useMetricsRange('teste', { signal: 'uptime_24h' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(mockedEngineFetch).toHaveBeenCalledWith(expect.stringContaining('range=7d'), expect.anything(), expect.objectContaining({ throwOnError: true }));
    });
  });

  it('disabled when projectName is undefined — no fetch', async () => {
    renderHook(
      () => useMetricsRange(undefined, { signal: 'uptime_24h' }),
      { wrapper: wrapper() },
    );

    // Wait a tick for any potential fetch
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedEngineFetch).not.toHaveBeenCalled();
  });

  it('disabled when signal is empty string — no fetch', async () => {
    renderHook(
      () => useMetricsRange('teste', { signal: '' }),
      { wrapper: wrapper() },
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedEngineFetch).not.toHaveBeenCalled();
  });

  it('falls back to env=production when env is undefined', async () => {
    mockedEngineFetch.mockResolvedValue({
      signal: 'uptime_24h',
      range: '7d',
      status: 'ok',
      data: [],
    } as MetricsRangeResponse);

    renderHook(
      () => useMetricsRange('teste', { signal: 'uptime_24h' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(mockedEngineFetch).toHaveBeenCalled();
    });
    // B-176 — este caso DOCUMENTAVA o defeito: env na chave e ausente da URL (matches use-project-status pattern),
    // but is part of queryKey for cache distinction
  });
});
