import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockPage = vi.fn();
vi.mock('@/hooks/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/promptly/promptly-api')>();
  return { ...actual, fetchCatalogPage: (...a: unknown[]) => mockPage(...a) };
});

import { PromptlyOverviewPage } from './overview';

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
 * Os testes da LISTA vivem agora em `pages/promptly/catalog.test.tsx` — a tela mudou de endereço
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
  // O assert é do conteúdo INTEIRO do cartão (rótulo + valor), não substring: `toHaveTextContent('0')`
  // passaria com 10, 100 ou "0 de 40" — e no teste cuja razão de existir é distinguir zero
  // verdadeiro de zero fabricado, o assert mais frouxo possível é o errado (TA-08).
  it('mostra quantos prompts o workspace tem', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByTestId('kpi-prompts')).toHaveTextContent(/^Prompts3$/);
  });

  it('responde "o que escrevi e não está no ar" — o número que traz o operador ao painel', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    // `despedida` (v2 escrita, prod em v1) e `rascunho` (nunca promovido) = 2.
    expect(await screen.findByTestId('kpi-nao-promovidos')).toHaveTextContent(/^Not promoted2$/);
  });

  it('marca os números como parciais quando o serviço sinaliza continuação', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: true });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/partial/i)).toBeInTheDocument();
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

    expect(await screen.findByTestId('kpi-prompts')).toHaveTextContent(/^Prompts100$/);
    expect(screen.queryByText(/partial/i)).not.toBeInTheDocument();
  });

  it('falha de leitura renderiza o alerta e NÃO zeros', async () => {
    mockPage.mockRejectedValue(new Error('502'));

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
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

    expect(await screen.findByTestId('kpi-nao-promovidos')).toHaveTextContent(/^Not promoted0$/);
    expect(screen.getByRole('link', { name: /create the first/i })).toBeInTheDocument();
  });

  // FE-03 — num workspace vazio, `naoPromovidos` também é 0, e a tela afirmava "toda última
  // revisão está servindo pelo menos um ambiente" sobre revisões que não existem.
  it('workspace vazio NÃO afirma nada sobre revisões que não existem', async () => {
    mockPage.mockResolvedValue({ data: [], temContinuacao: false });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/no prompts yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/toda última revisão está servindo/i)).not.toBeInTheDocument();
  });

  // FE-04 — três caminhos de erro e nenhuma saída; o mecanismo já existia e não era usado.
  it('a falha de leitura oferece tentar novamente', async () => {
    mockPage.mockRejectedValue(new Error('502'));

    render(<PromptlyOverviewPage />);

    expect(await screen.findByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  // ARCH-08 — o KPI somava TODAS as revisões escritas, inclusive as que o cartão vizinho
  // classifica como não promovidas. Dois números lado a lado se contradiziam.
  it('nomeia o KPI pelo que ele de fato conta', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/revisions written/i)).toBeInTheDocument();
    expect(screen.queryByText(/revisões publicadas/i)).not.toBeInTheDocument();
  });

  it('leva ao catálogo em um clique', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    const link = await screen.findByRole('link', { name: /see the catalog/i });
    expect(link).toHaveAttribute('href', '/promptly/catalog');
  });
});

/**
 * B2 — a outra metade: o número LEVA à lista. Sem este caso, o painel voltaria a exibir um KPI
 * mudo e a Coverage Matrix voltaria a afirmar "linkados" sem sustentação.
 */
describe('PromptlyOverviewPage — cada número leva à lista', () => {
  it('o KPI de total leva ao catálogo inteiro', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    const link = await screen.findByRole('link', { name: /see all prompts in the catalog/i });
    expect(link).toHaveAttribute('href', '/promptly/catalog');
  });

  // Os outros dois KPIs são agregados sem subconjunto correspondente — uma soma e uma contagem de
  // distintos. Inventar destino para eles seria pior que a ausência, e este teste trava a decisão
  // para que ela não vire esquecimento.
  it('os KPIs agregados NÃO fingem ter uma lista correspondente', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    await screen.findByTestId('kpi-revisoes');
    expect(screen.getByTestId('kpi-revisoes').closest('a')).toBeNull();
    expect(screen.getByTestId('kpi-ambientes').closest('a')).toBeNull();
  });

  it('o KPI de não promovidos leva ao catálogo já recortado', async () => {
    mockPage.mockResolvedValue({ data: CATALOGO, temContinuacao: false });

    render(<PromptlyOverviewPage />);

    const link = await screen.findByRole('link', { name: /see the prompts that were never promoted/i });
    expect(link).toHaveAttribute('href', '/promptly/catalog?recorte=not-promoted');
  });
});
