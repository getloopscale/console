import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/render';

/**
 * As três faixas que fazem a Overview MOSTRAR a plataforma, não apenas anunciá-la (B-125).
 *
 * ## O defeito que elas fecham
 *
 * Medido em 2026-08-11 no navegador: a faixa `PLATFORM` (entregue pelo `B-112`) diz quais
 * capacidades existem, e abaixo dela a página dedicava quatro painéis a UMA delas mais cobrança.
 * A tela não respondia "tem algo errado agora?", não mostrava o que rodou além de deploys, e o
 * único valor em dinheiro era `USD 20/mo` — o preço do plano.
 *
 * `Quick actions` ocupava 51 das 365 linhas do arquivo para produzir três links que a barra
 * lateral já tem, sempre visível.
 *
 * ## O que estes casos travam
 *
 * Que a faixa de atenção nasce de MAIS DE UMA capacidade, que ela distingue não-ler de
 * está-tudo-bem, e que o custo exibido vem de custo medido. Um teste que afirmasse só "a faixa
 * existe" passaria verde sobre uma faixa alimentada por uma capacidade só — que é a tela do Lens
 * com outro título.
 */

const respostas = new Map<string, { data: unknown; loading: boolean; error: boolean }>();
const VAZIO = { data: null, loading: false, error: false, isSuccess: true };

vi.mock('@/hooks/use-api', () => ({
  useCloudApi: (path: string, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return VAZIO;
    return respostas.get(path) ?? VAZIO;
  },
}));

const mockTrust = vi.fn();
vi.mock('@/hooks/trust/use-trust', () => ({
  useTrustEnforcement: () => mockTrust(),
}));

import { PlatformSignals } from './platform-signals';

const OBS = '/v1/dashboard/lens/observability';
const RAG = '/v1/dashboard/rag/analytics';

function trafego(total: number, erros: number) {
  return {
    traffic: [{ periodStart: '2026-08-11T00:00:00Z', traceCount: total, errorCount: erros, errorRate: erros / total }],
    tokensByModel: [
      { periodStart: '2026-08-11T00:00:00Z', model: 'claude-opus-5', totalTokens: 9000, costUsd: 271.9 },
      { periodStart: '2026-08-11T00:00:00Z', model: 'claude-haiku-4-5', totalTokens: 3000, costUsd: 8.42 },
    ],
    unpricedSpans: 17,
  };
}

beforeEach(() => {
  respostas.clear();
  vi.clearAllMocks();
  mockTrust.mockReturnValue({ data: undefined, loading: false, error: false });
});

describe('a faixa de atenção junta capacidades', () => {
  it('mostra sinais de MAIS DE UMA capacidade ao mesmo tempo', async () => {
    // O critério central da DoD. Uma faixa alimentada por uma capacidade só continuaria sem
    // enxergar a plataforma — que é o defeito inteiro deste item.
    respostas.set(OBS, { data: trafego(1000, 120), loading: false, error: false });
    respostas.set(RAG, {
      data: { totals: { retrievals: 4000, answers: 3800, empty_retrieval_rate: 0.12 } },
      loading: false,
      error: false,
    });
    mockTrust.mockReturnValue({
      data: { events: [{ decision: 'block', validatorName: 'pii-email' }] },
      loading: false,
      error: false,
    });

    render(<PlatformSignals />);

    const faixa = await screen.findByRole('region', { name: /needs attention/i });
    expect(within(faixa).getByText(/agent runs failed/i)).toBeInTheDocument();
    expect(within(faixa).getByText(/retrievals came back empty/i)).toBeInTheDocument();
    expect(within(faixa).getByText(/requests blocked/i)).toBeInTheDocument();
  });

  it('diz que está calmo quando leu tudo e não há nada', async () => {
    // Só é dizível porque as leituras chegaram. É a metade que torna a faixa confiável: sem ela,
    // uma faixa vazia significaria as duas coisas ao mesmo tempo.
    respostas.set(OBS, { data: trafego(1000, 1), loading: false, error: false });
    respostas.set(RAG, {
      data: { totals: { retrievals: 100, answers: 100, empty_retrieval_rate: 0 } },
      loading: false,
      error: false,
    });
    mockTrust.mockReturnValue({ data: { events: [] }, loading: false, error: false, isSuccess: true });

    render(<PlatformSignals />);

    const faixa = await screen.findByRole('region', { name: /needs attention/i });
    expect(within(faixa).getByText(/nothing needs you/i)).toBeInTheDocument();
  });

  it('NÃO diz que está calmo quando uma leitura falhou', async () => {
    // A distinção que este repositório defende em toda superfície de leitura. Uma tela que afirma
    // "nada precisa de você" a partir de uma leitura que caiu é a pior linha possível: ela
    // tranquiliza sobre o que não olhou.
    respostas.set(OBS, { data: null, loading: false, error: true });
    respostas.set(RAG, {
      data: { totals: { retrievals: 100, answers: 100, empty_retrieval_rate: 0 } },
      loading: false,
      error: false,
    });
    mockTrust.mockReturnValue({ data: { events: [] }, loading: false, error: false, isSuccess: true });

    render(<PlatformSignals />);

    const faixa = await screen.findByRole('region', { name: /needs attention/i });
    expect(within(faixa).queryByText(/nothing needs you/i)).not.toBeInTheDocument();
    expect(within(faixa).getByText(/couldn't read/i)).toBeInTheDocument();
  });

  it('cada linha leva a capacidade que a resolve', async () => {
    respostas.set(OBS, { data: trafego(1000, 120), loading: false, error: false });

    render(<PlatformSignals />);

    const link = await screen.findByRole('link', { name: /open observability/i });
    expect(link).toHaveAttribute('href', '/observability');
  });
});

describe('o custo vem de custo medido', () => {
  it('mostra o gasto por modelo, e não o preço do plano', async () => {
    respostas.set(OBS, { data: trafego(1000, 1), loading: false, error: false });

    render(<PlatformSignals />);

    const custo = await screen.findByRole('region', { name: /what your agents cost/i });
    expect(within(custo).getByText(/280\.32|280,32/)).toBeInTheDocument();
    expect(within(custo).getByText(/claude-opus-5/)).toBeInTheDocument();
  });

  it('nunca esconde os spans sem preço', async () => {
    // Um total que os ignora em silêncio é menor que a verdade, apresentado como a verdade.
    respostas.set(OBS, { data: trafego(1000, 1), loading: false, error: false });

    render(<PlatformSignals />);

    const custo = await screen.findByRole('region', { name: /what your agents cost/i });
    expect(within(custo).getByText(/17 spans/i)).toBeInTheDocument();
  });

  it('leitura que falhou não vira gasto zero', async () => {
    respostas.set(OBS, { data: null, loading: false, error: true });

    render(<PlatformSignals />);

    const custo = await screen.findByRole('region', { name: /what your agents cost/i });
    expect(within(custo).queryByText(/\$\s*0/)).not.toBeInTheDocument();
    expect(within(custo).getByText(/couldn't read/i)).toBeInTheDocument();
  });
});

describe('a tela é útil antes da rede', () => {
  it('as três faixas existem com tudo pendente', async () => {
    for (const p of [OBS, RAG]) respostas.set(p, { data: null, loading: true, error: false });
    mockTrust.mockReturnValue({ data: undefined, loading: true, error: false, isSuccess: false });

    render(<PlatformSignals />);

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /needs attention/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('region', { name: /what your agents cost/i })).toBeInTheDocument();
    // E nada é afirmado enquanto carrega: nem calmaria, nem falha.
    expect(screen.queryByText(/nothing needs you/i)).not.toBeInTheDocument();
  });
});
