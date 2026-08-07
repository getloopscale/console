import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { MAX_LOG_LINES } from './use-log-stream';

const mockEngineFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  engineFetch: (...args: unknown[]) => mockEngineFetch(...args),
}));

// Build terminal: o SSE fica no-op e o snapshot REST e a unica fonte — o cenario
// em que o teto do snapshot decide sozinho o tamanho do buffer.
vi.mock('./use-deployment', () => ({
  useDeployment: () => ({ build: { status: 'succeeded' }, loading: false }),
}));

vi.mock('./use-log-stream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-log-stream')>()),
  useLogStream: () => ({
    lines: [],
    connected: true,
    error: false,
    droppedCount: 0,
    clear: vi.fn(),
  }),
}));

import { useBuildLogs } from './use-build-logs';

/**
 * B-045 / B-016 — o teto FIFO vale nos DOIS caminhos que escrevem o snapshot.
 *
 * Este teste existe por causa de um escape concreto: B-016 aplicou o cap ao
 * snapshot inicial e NAO ao Refresh manual, porque eram dois `setHistorical(...)`
 * em lugares distintos do componente. A extracao do hook (B-045) deu um dono
 * unico a escrita; o segundo caso abaixo e o que prova que o esquecimento nao
 * pode se repetir.
 */
describe('useBuildLogs — teto do snapshot (B-045 / B-016)', () => {
  const respostaCom = (n: number) => ({
    build_id: 'b1',
    status: 'succeeded',
    total_lines: n,
    entries: Array.from({ length: n }, (_, i) => ({
      content: `linha ${i}`,
      timestamp: '2026-08-06T00:00:00Z',
      step: 'build',
    })),
  });

  beforeEach(() => vi.clearAllMocks());

  it('a carga inicial respeita o teto', async () => {
    mockEngineFetch.mockResolvedValue(respostaCom(MAX_LOG_LINES + 5));

    const { result } = renderHook(() => useBuildLogs('b1', false));

    await waitFor(() => expect(result.current.lines.length).toBeGreaterThan(0));
    expect(result.current.lines).toHaveLength(MAX_LOG_LINES);
    // Mantem o FIM: a ultima linha do build sobrevive.
    expect(result.current.lines.at(-1)?.msg).toBe(`linha ${MAX_LOG_LINES + 4}`);
  });

  it('o REFRESH manual respeita o mesmo teto — o escape que B-016 deixou', async () => {
    mockEngineFetch.mockResolvedValue(respostaCom(10));

    const { result } = renderHook(() => useBuildLogs('b1', false));
    await waitFor(() => expect(result.current.lines).toHaveLength(10));

    // O refresh traz um snapshot muito maior (o build cresceu / chunks tardios
    // chegaram ao Loki). Antes da extracao, este caminho escrevia sem cap.
    mockEngineFetch.mockResolvedValue(respostaCom(MAX_LOG_LINES + 42));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.lines).toHaveLength(MAX_LOG_LINES);
    expect(result.current.lines.at(-1)?.msg).toBe(`linha ${MAX_LOG_LINES + 41}`);
  });

  it('refresh nao reentra enquanto ja esta em voo', async () => {
    mockEngineFetch.mockResolvedValue(respostaCom(1));
    const { result } = renderHook(() => useBuildLogs('b1', false));
    await waitFor(() => expect(result.current.lines).toHaveLength(1));

    const antes = mockEngineFetch.mock.calls.length;
    await act(async () => {
      await Promise.all([result.current.refresh(), result.current.refresh()]);
    });
    // Duas chamadas simultaneas, uma request — o guard de click-storm.
    expect(mockEngineFetch.mock.calls.length - antes).toBe(1);
  });

  it('erro na carga inicial vira estado de erro, nao lista vazia silenciosa', async () => {
    mockEngineFetch.mockRejectedValue(new Error('loki fora do ar'));

    const { result } = renderHook(() => useBuildLogs('b1', false));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.lines).toEqual([]);
  });

  it('clear esvazia o historico', async () => {
    mockEngineFetch.mockResolvedValue(respostaCom(3));
    const { result } = renderHook(() => useBuildLogs('b1', false));
    await waitFor(() => expect(result.current.lines).toHaveLength(3));

    act(() => result.current.clear());
    expect(result.current.lines).toEqual([]);
  });
});
