import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

// A classe REAL, não um dublê: a página faz `err instanceof ApiError`, e uma cópia local com o
// mesmo formato falha nesse teste sem que o defeito seja da página. Foi o que aconteceu na
// primeira rodada — quatro casos vermelhos por um erro meu de instrumentação, não de produto.
import { ApiError } from '@/lib/api';

import { LensUsageByUserPage } from './usage-by-user';

/** A resposta do BFF com os números REAIS medidos no app-dev em 2026-08-03. */
const RESPOSTA_REAL = {
  users: [
    {
      userId: '90fff249680448f8c01bee8af21dd40dd76fe8fbd603e53e3513448581165bbe',
      spans: 49373,
      inputTokens: 3261202,
      outputTokens: 12590407,
      cacheReadTokens: 6405653920,
      cacheCreationTokens: 111933070,
      costUsd: 4179.475464,
    },
    { userId: 'unattributed', spans: 3, inputTokens: 11716, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
    { userId: 'agent-builder-qa', spans: 1, inputTokens: 5725, outputTokens: 133, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
    { userId: 'b08873a43f7f5e970e401997b0c4da819142b89cfd318938de18affa44d00321', spans: 2, inputTokens: 10, outputTokens: 57, cacheReadTokens: 17585, cacheCreationTokens: 25583, costUsd: 0.034032 },
  ],
  unpricedSpans: 17,
  totalUsers: 4,
  windowDays: 30,
};

describe('LensUsageByUserPage (/observability/usage-by-user)', () => {
  beforeEach(() => vi.clearAllMocks());

  // DoD-2 — o e2e derivado do registro prova que a tela MONTA (heading, sem error boundary). Uma
  // tabela vazia por erro de mapeamento de campo passaria por ele. Este teste é o que afirma
  // CONTEÚDO: números que vieram do serviço, renderizados.
  it('mostra os números que vieram do serviço', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);

    // contagem de spans, agrupada
    expect(await screen.findByText('49,373')).toBeInTheDocument();
    // custo com 2 casas acima de 1¢
    expect(screen.getByText('$4179.48')).toBeInTheDocument();
    expect(screen.getByText('$0.03')).toBeInTheDocument();
    // …e 4 casas abaixo de 1¢. O run do agent-builder custou EXATAMENTE zero (modelo sem preço na
    // tabela), e `$0.0000` diz isso; um `$0.00` de duas casas seria indistinguível de um custo
    // real arredondado para baixo, que é a leitura perigosa numa tela de consumo.
    expect(screen.getAllByText('$0.0000').length).toBeGreaterThan(0);
  });

  // DoD-3 — a lacuna de preço na TELA, não só no JSON. O campo existe para impedir que um total
  // silenciosamente baixo seja lido como o gasto real, e documentação não é lida por quem olha
  // uma tabela.
  it('declara a lacuna de preço quando há spans sem preço', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const aviso = await screen.findByTestId('usage-unpriced-notice');
    expect(aviso).toHaveTextContent('17');
    // não basta mostrar o número: tem de dizer o que ele significa para o custo
    expect(aviso.textContent ?? '').toMatch(/maior|menor|incomplet/i);
  });

  it('NÃO declara lacuna de preço quando não há spans sem preço', async () => {
    mockCloudFetch.mockResolvedValue({ ...RESPOSTA_REAL, unpricedSpans: 0 });
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    expect(screen.queryByTestId('usage-unpriced-notice')).not.toBeInTheDocument();
  });

  // DoD-4 — "não sabemos de quem foi" e "ninguém consumiu" são fatos diferentes que levam a
  // decisões diferentes. O balde é linha ordinária (ADR do M140), então o rótulo é o que os separa.
  it('rotula o balde unattributed como consumo NÃO ATRIBUÍDO, não como ausência', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const rotulo = await screen.findByText(/não atribuído/i);
    // e continua sendo uma LINHA da tabela, com seus números — não um aviso à parte
    const linha = rotulo.closest('tr');
    expect(linha).not.toBeNull();
    expect(linha).toHaveTextContent('11,716');
  });

  // DoD-5 — a M140 pagou para recusar com 400 tipado e a M141 para esse 400 atravessar o BFF
  // verbatim. Um "ocorreu um erro" aqui joga as duas conquistas fora no último metro.
  it('mostra a MENSAGEM do serviço quando ele recusa', async () => {
    mockCloudFetch.mockRejectedValue(
      new ApiError(400, { code: 'INVALID_QUERY', message: 'limit must be at most 500' }),
    );
    render(<LensUsageByUserPage />);
    expect(await screen.findByText(/limit must be at most 500/i)).toBeInTheDocument();
  });

  it('cai na cópia genérica quando o erro não traz mensagem acionável', async () => {
    mockCloudFetch.mockRejectedValue(new ApiError(503));
    render(<LensUsageByUserPage />);
    // `findByText`, não `findByRole('heading')`: o Alert do design-system não expõe o título como
    // heading, e é assim que todas as telas irmãs o asseram (alerts, datasets, monitors, ask).
    expect(await screen.findByText(/não foi possível carregar o consumo/i)).toBeInTheDocument();
    // e não inventa uma mensagem específica que o serviço não deu
    expect(screen.queryByText(/limit must be/i)).not.toBeInTheDocument();
  });

  it('explica o vazio em vez de mostrar uma tabela sem linhas', async () => {
    mockCloudFetch.mockResolvedValue({ users: [], unpricedSpans: 0, totalUsers: 0, windowDays: 30 });
    render(<LensUsageByUserPage />);
    // a cópia nomeia o pré-requisito (a identidade do end user), como a tela de Agents faz
    expect(await screen.findByText(/user\.id/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /instrument/i })).toBeInTheDocument();
  });

  // Acceptance criterion de T1.2 — sem `days` na queryKey o cache devolve a resposta da janela
  // anterior, e a tela mente sobre o período que está mostrando.
  it('trocar a janela refaz a busca com o novo days na URL', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    const chamadasAntes = mockCloudFetch.mock.calls.length;

    await userEvent.selectOptions(screen.getByLabelText(/janela|window|período|periodo/i), '7');

    await vi.waitFor(() => {
      expect(mockCloudFetch.mock.calls.length).toBeGreaterThan(chamadasAntes);
    });
    const ultimaUrl = String(mockCloudFetch.mock.calls.at(-1)?.[0] ?? '');
    expect(ultimaUrl).toMatch(/days=7/);
  });
});
