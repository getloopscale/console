import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ promptName: 'saudacao' }) };
});

const mockRevisions = vi.fn();
const mockLabels = vi.fn();
const mockPolicy = vi.fn();
const mockPromote = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return {
    ...actual,
    fetchRevisions: (...a: unknown[]) => mockRevisions(...a),
    fetchLabels: (...a: unknown[]) => mockLabels(...a),
    fetchPolicy: (...a: unknown[]) => mockPolicy(...a),
    promoteLabel: (...a: unknown[]) => mockPromote(...a),
  };
});

import { PromptDetailPage } from './detail';

/**
 * Esta tela executa o ato mais perigoso do produto: repontar um label troca, SEM redeploy, o
 * prompt que agentes em execução resolvem. Um clique errado não derruba nada — muda comportamento
 * em silêncio.
 *
 * O que precisa de proteção, então, não é "o botão chama a API": é o que a confirmação AFIRMA
 * antes do ato, e se o que ela afirma é dado que a API de fato devolve.
 */

const REVISOES = [
  { version: 1, content: 'Olá, {{nome}}.', createdAt: '2026-07-28T10:00:00Z' },
  { version: 3, content: 'Olá {{nome}}, sou o assistente.', createdAt: '2026-08-01T10:00:00Z' },
];
const LABELS = [{ label: 'prod', version: 1 }];

beforeEach(() => {
  mockRevisions.mockReset();
  mockLabels.mockReset();
  mockPolicy.mockReset();
  mockPromote.mockReset();
  mockRevisions.mockResolvedValue(REVISOES);
  mockLabels.mockResolvedValue(LABELS);
  mockPolicy.mockResolvedValue(null);
  mockPromote.mockResolvedValue({ name: 'saudacao', label: 'prod', version: 3 });
});

describe('PromptDetailPage', () => {
  it('pede as revisões ao servidor com limite pequeno e explícito', async () => {
    // A restrição MEDIDA que governa esta tela: cada revisão carrega o `content` integral, e o
    // serviço aplica default 100. Paginar no cliente arrastaria o histórico inteiro para o browser.
    render(<PromptDetailPage />);

    await screen.findByText('v3');
    const [, limite] = mockRevisions.mock.calls[0];
    expect(limite).toBeGreaterThan(0);
    expect(limite).toBeLessThanOrEqual(20);
  });

  it('mostra a revisão que cada ambiente serve HOJE', async () => {
    render(<PromptDetailPage />);

    expect(await screen.findByText('prod → v1')).toBeInTheDocument();
  });

  it('a confirmação NOMEIA a revisão que deixa de servir o label', async () => {
    // O critério do milestone, literal: não "o item será alterado", mas qual versão sai de
    // produção. `v1` vem de `/labels`; `v3` é a linha clicada. Nada inferido.
    const user = userEvent.setup();
    render(<PromptDetailPage />);

    await user.click(await screen.findByRole('button', { name: /Promover prod para a revisão v3/i }));

    expect(await screen.findByText(/deixa de servir a v1/i)).toBeInTheDocument();
    expect(screen.getByText(/passa a servir a v3/i)).toBeInTheDocument();
  });

  it('mostra a POLÍTICA vigente antes do ato — e "livre" quando não há regra', async () => {
    // Sem política o serviço responde 404 tipado, que o cliente traduz para `null`. A tela declara
    // promoção livre; renderizá-lo como falha faria o operador procurar defeito onde não há.
    const user = userEvent.setup();
    render(<PromptDetailPage />);

    await user.click(await screen.findByRole('button', { name: /Promover prod para a revisão v3/i }));

    expect(await screen.findByText(/promoção é livre/i)).toBeInTheDocument();
  });

  it('quando HÁ política, a confirmação exibe a regra que pode barrar a promoção', async () => {
    const user = userEvent.setup();
    mockPolicy.mockResolvedValue({ datasetId: 'ds-1', minScore: 0.8 });
    render(<PromptDetailPage />);

    await user.click(await screen.findByRole('button', { name: /Promover prod para a revisão v3/i }));

    expect(await screen.findByText(/score mínimo de 0\.8/i)).toBeInTheDocument();
  });

  it('a recusa da política chega à tela com a MENSAGEM do serviço, não "erro genérico"', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    mockPromote.mockRejectedValue(
      new ApiError(409, {
        error: 'promotion_blocked',
        message: 'a promoção exige score ≥ 0.8; a melhor execução obteve 0.41',
        required: 0.8,
        actual: 0.41,
      }),
    );
    render(<PromptDetailPage />);

    await user.click(await screen.findByRole('button', { name: /Promover prod para a revisão v3/i }));
    await user.type(await screen.findByRole('textbox'), 'prod');
    await user.click(screen.getByRole('button', { name: /^Promover$/i }));

    expect(await screen.findByText(/melhor execução obteve 0\.41/i)).toBeInTheDocument();
  });

  it('a promoção só é emitida depois da confirmação digitada', async () => {
    // O gate type-to-confirm é o que separa um clique acidental de uma decisão. Sem esta prova,
    // o diálogo poderia estar renderizando o campo e confirmando mesmo assim.
    const user = userEvent.setup();
    render(<PromptDetailPage />);

    await user.click(await screen.findByRole('button', { name: /Promover prod para a revisão v3/i }));
    expect(mockPromote).not.toHaveBeenCalled();

    await user.type(await screen.findByRole('textbox'), 'prod');
    await user.click(screen.getByRole('button', { name: /^Promover$/i }));

    expect(mockPromote).toHaveBeenCalledWith('saudacao', 'prod', 3);
  });

  it('falha ao ler as revisões NÃO é renderizada como "este prompt não tem revisões"', async () => {
    mockRevisions.mockRejectedValue(new Error('upstream down'));

    render(<PromptDetailPage />);

    expect(await screen.findByText(/Não foi possível carregar as revisões/i)).toBeInTheDocument();
    expect(screen.queryByText(/ainda não tem revisões publicadas/i)).not.toBeInTheDocument();
  });

  it('sem os labels, a tela diz que a leitura falhou em vez de oferecer promoção às cegas', async () => {
    // Promover sem saber para onde o label aponta hoje impediria a confirmação de nomear a
    // revisão que sai — a garantia central desta tela.
    mockLabels.mockRejectedValue(new Error('upstream down'));

    render(<PromptDetailPage />);

    expect(await screen.findByText(/Não foi possível carregar os labels/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Promover prod/i })).not.toBeInTheDocument();
  });
});
