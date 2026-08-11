import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { capLogLines, MAX_LOG_LINES } from './use-log-stream';

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

/**
 * B-175 — o guarda de desmontagem NÃO tem teste, e a razão está aqui.
 *
 * Escrevi um: ele segurava o `engineFetch`, desmontava, soltava, e afirmava que `console.error`
 * não fora chamado. Passou — e passou TAMBÉM com o guarda removido. O React 18 deixou de avisar
 * sobre `setState` em componente desmontado, então a asserção media a ausência de um aviso que
 * não existe mais em versão nenhuma do código.
 *
 * Era a forma inerte que esta varredura inteira nomeia (B-152/B-189), escrita por mim dentro do
 * commit que a corrige em outro lugar. Deletei em vez de deixá-la verde.
 *
 * O que sobra: depois da desmontagem não há `result.current` para inspecionar e nenhuma saída
 * observável, então este harness não consegue distinguir "não escreveu" de "escreveu e ninguém
 * viu". A correção de produção fica — guardar escritas após desmontagem é certo, e o efeito de
 * carga inicial deste mesmo arquivo já o fazia; a assimetria era o defeito. Ela vai sem teste, e
 * isto é o registro de que a ausência é sabida e não esquecida.
 */

/**
 * B-180 — o teto passou a valer para a SAÍDA, e o caso de 2x não é observável neste harness.
 *
 * `historical` é capado por `aplicarSnapshot` e `stream.lines` pelo `maxEvents` do `useLogStream`.
 * Os dois lados acreditavam estar garantindo `MAX_LOG_LINES`, e a concatenação entregava até o
 * dobro: o teto era aplicado nas ENTRADAS e em nenhuma SAÍDA. A correção envolve a concatenação
 * em `capLogLines`.
 *
 * Tentei fixá-la por comportamento e não consegui: este arquivo mocka `useDeployment` para um
 * build TERMINAL — que é o cenário em que o snapshot REST decide sozinho o tamanho do buffer, e o
 * motivo de o mock existir —, então `streamPath` é nulo e o stream nunca contribui linhas. Um
 * teste que enche os dois lados passa verde com e sem a correção, porque um dos lados é sempre
 * vazio aqui.
 *
 * Escrevi esse teste, verifiquei por mutação que ele não reprovava, e o deletei em vez de
 * deixá-lo verde — é a forma inerte que esta varredura nomeia. A aritmética abaixo é o que resta
 * de conferível: ela reprova se `capLogLines` deixar de cortar. A LIGAÇÃO (que a concatenação
 * passa por ela) fica sem teste, e este bloco é o registro de que a ausência é sabida.
 */
describe('B-180 — a aritmética do teto sobre a concatenação', () => {
  it('duas metades cheias cortadas juntas cabem no teto', () => {
    const metade = (p: string) =>
      Array.from({ length: MAX_LOG_LINES }, (_, i) => ({
        ts: '2026-01-01T00:00:00Z', level: 'info' as const, msg: `${p}${String(i)}`,
      }));

    const juntas = capLogLines([...metade('h'), ...metade('s')]);

    expect(juntas).toHaveLength(MAX_LOG_LINES);
    // Corta a cauda ANTIGA: num visualizador de log as linhas novas são as que importam.
    expect(juntas[juntas.length - 1].msg).toBe(`s${String(MAX_LOG_LINES - 1)}`);
  });
});
