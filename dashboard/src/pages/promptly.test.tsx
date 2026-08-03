import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockPage = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return { ...actual, fetchCatalogPage: (...a: unknown[]) => mockPage(...a) };
});

import { PromptlyOverviewPage } from './promptly';

/**
 * M13 — `/promptly` deixou de ser a lista e virou o painel.
 *
 * O que este arquivo trava não é a aparência: é o que a tela tem PERMISSÃO de afirmar.
 *
 *   - Falha de leitura NUNCA vira zeros. "0 não promovidos" durante uma queda diz "não há nada
 *     para promover" exatamente quando a tela não sabe de nada.
 *   - Um número só é total quando o serviço disse que a página é a última. Com continuação ele é
 *     limite inferior, e a tela precisa dizer isso.
 *   - E o oposto também: um catálogo de EXATAMENTE `limit` prompts sem continuação NÃO é parcial.
 *     Marcar de parcial um número correto ensina o operador a desconfiar dele.
 *
 * Os testes da LISTA vivem agora em `pages/promptly/catalogo.test.tsx` — a tela mudou de endereço
 * no M13, e os casos foram migrados junto, não descartados.
 */

const CATALOGO = [
  // escrito e no ar: a última revisão é a que prod serve
  { name: 'saudacao', latestVersion: 3, labels: [{ label: 'prod', version: 3 }], updatedAt: '2026-08-01T10:00:00Z' },
  // escrito e NÃO no ar: v2 existe, prod ainda serve v1
  { name: 'despedida', latestVersion: 2, labels: [{ label: 'prod', version: 1 }], updatedAt: '2026-07-30T09:00:00Z' },
  // nunca promovido
  { name: 'rascunho', latestVersion: 1, labels: [], updatedAt: '2026-07-29T09:00:00Z' },
];

beforeEach(() => {
  mockPage.mockReset();
});

describe('PromptlyOverviewPage', () => {
  it('mostra quantos prompts o workspace tem', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByTestId('kpi-prompts')).toHaveTextContent('3');
  });

  it('responde "o que escrevi e não está no ar" — o número que traz o operador ao painel', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    // `despedida` (v2 escrita, prod em v1) e `rascunho` (nunca promovido) = 2.
    expect(await screen.findByTestId('kpi-nao-promovidos')).toHaveTextContent('2');
  });

  it('marca os números como parciais quando o serviço sinaliza continuação', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: true });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/parcia/i)).toBeInTheDocument();
  });

  // O PAR QUE DISCRIMINA, ponta a ponta: página cheia SEM continuação não é parcial.
  it('NÃO marca parcial num catálogo cheio sem continuação', async () => {
    const cheio = Array.from({ length: 100 }, (_, i) => ({
      name: `p${String(i)}`,
      latestVersion: 1,
      labels: [{ label: 'prod', version: 1 }],
      updatedAt: '2026-08-01T10:00:00Z',
    }));
    mockPage.mockResolvedValue({ data: cheio, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByTestId('kpi-prompts')).toHaveTextContent('100');
    expect(screen.queryByText(/parcia/i)).not.toBeInTheDocument();
  });

  it('falha de leitura renderiza o alerta e NÃO zeros', async () => {
    mockPage.mockRejectedValue(new Error('502'));

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument();
    // Zeros aqui afirmariam "não há nada para promover" durante uma queda.
    expect(screen.queryByTestId('kpi-nao-promovidos')).not.toBeInTheDocument();
  });

  it('enquanto carrega, anuncia o carregamento a quem usa leitor de tela', () => {
    mockPage.mockReturnValue(
      new Promise(() => {
        /* pendente de propósito */
      }),
    );

    render(<PromptlyOverviewPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // EC-8 — zeros aqui são a VERDADE (leu e não há), ao contrário do caso de falha acima. A
  // distinção só fica visível com os dois testes lado a lado.
  it('catálogo vazio mostra zeros E oferece criar', async () => {
    mockPage.mockResolvedValue({ data: [], temContinuacao: false });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByTestId('kpi-nao-promovidos')).toHaveTextContent('0');
    expect(screen.getByRole('link', { name: /criar o primeiro/i })).toBeInTheDocument();
  });

  it('leva ao catálogo em um clique', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    const link = await screen.findByRole('link', { name: /ver o catálogo/i });
    expect(link).toHaveAttribute('href', '/promptly/catalogo');
  });
});
