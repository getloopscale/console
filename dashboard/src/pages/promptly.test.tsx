import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCatalog = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return { ...actual, fetchCatalog: (...a: unknown[]) => mockCatalog(...a) };
});

import { PromptlyOverviewPage } from './promptly';

/**
 * O catálogo tem dois estados que produzem telas parecidas e significam coisas OPOSTAS:
 *
 *   1. leu e não há prompt algum → pode afirmar ausência ("crie o primeiro");
 *   2. NÃO conseguiu ler        → não pode afirmar nada; o vazio é ignorância.
 *
 * Renderizar o segundo como o primeiro manda o operador criar algo que talvez já exista — e
 * esconde uma queda do serviço atrás de uma tela que parece saudável.
 */

const CATALOGO = [
  { name: 'saudacao', latestVersion: 3, labels: [{ label: 'prod', version: 1 }], updatedAt: '2026-08-01T10:00:00Z' },
  { name: 'despedida', latestVersion: 1, labels: [], updatedAt: '2026-07-30T09:00:00Z' },
];

beforeEach(() => {
  mockCatalog.mockReset();
});

describe('PromptlyOverviewPage', () => {
  it('lista os prompts do workspace pelo NOME', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyOverviewPage />);

    // O oráculo é o CONTEÚDO — um 200 com corpo vazio passaria num teste de status.
    expect(await screen.findByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('despedida')).toBeInTheDocument();
  });

  it('diz para onde cada ambiente aponta, que é a pergunta que traz o operador aqui', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText('prod → v1')).toBeInTheDocument();
  });

  it('descreve como "nenhum" o prompt que não serve ambiente algum', async () => {
    // Estado normal do dado, distinto de "não sei": o prompt existe e nenhum label o aponta.
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText('nenhum')).toBeInTheDocument();
  });

  it('pede um limite EXPLÍCITO ao servidor em vez de herdar o teto dele', async () => {
    mockCatalog.mockResolvedValue([]);

    render(<PromptlyOverviewPage />);

    await screen.findByText(/Nenhum prompt neste workspace/i);
    expect(mockCatalog).toHaveBeenCalledWith(expect.any(Number));
    expect(mockCatalog.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('quando a leitura FALHA, diz que falhou — e não que o workspace está vazio', async () => {
    mockCatalog.mockRejectedValue(new Error('upstream down'));

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/Não foi possível carregar o catálogo/i)).toBeInTheDocument();
    // O par que discrimina: a frase de "não há prompts" NÃO pode aparecer numa falha de leitura.
    expect(screen.queryByText(/Crie a primeira revisão/i)).not.toBeInTheDocument();
  });

  it('quando leu e não há nada, afirma a ausência com todas as letras', async () => {
    mockCatalog.mockResolvedValue([]);

    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/Nenhum prompt neste workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar o catálogo/i)).not.toBeInTheDocument();
  });
});

/**
 * M12 — o par que decide se a tela pode CONVIDAR a criar.
 *
 * Este par vivia no e2e e voltou para cá por medição: os mocks deste repositório interceptam no
 * `fetch` da aplicação, antes da camada de rede, então `page.route` do Playwright nunca vê a
 * chamada — o teste ficaria verde sem exercitar a falha. Um guard que não distingue os dois
 * estados é pior que nenhum, porque ensina a confiar nele.
 */
describe('M12 — a ação de criar depende de a leitura ter acontecido', () => {
  it('empty_catalog_offers_the_create_action', async () => {
    mockCatalog.mockResolvedValue([]);
    render(<PromptlyOverviewPage />);

    expect(await screen.findByText(/nenhum prompt neste workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /criar o primeiro/i })).toBeInTheDocument();
  });

  it('empty_catalog_that_FAILED_offers_no_action', async () => {
    // A metade que dá valor à primeira. "Crie o primeiro" sobre uma lista que não foi lida
    // AFIRMA que o workspace está vazio — e ele pode estar cheio. Vazio e não-consegui-ler
    // levam a decisões opostas.
    mockCatalog.mockRejectedValue(new Error('upstream'));
    render(<PromptlyOverviewPage />);

    // Duas frases dizem "a leitura falhou" — o alerta no topo e o estado vazio da tabela —, e
    // isso é intencional: quem olha a tabela pode não ter lido o alerta. A asserção mira a da
    // TABELA, que é a que o operador lê no lugar onde esperaria os dados.
    expect(await screen.findByText(/sem dados — a leitura falhou/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /criar o primeiro/i })).not.toBeInTheDocument();
  });
});
