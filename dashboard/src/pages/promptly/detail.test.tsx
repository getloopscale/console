import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';

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
const mockPrompt = vi.fn();
const mockRollback = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return {
    ...actual,
    fetchRevisions: (...a: unknown[]) => mockRevisions(...a),
    fetchLabels: (...a: unknown[]) => mockLabels(...a),
    fetchPolicy: (...a: unknown[]) => mockPolicy(...a),
    fetchPrompt: (...a: unknown[]) => mockPrompt(...a),
    promoteLabel: (...a: unknown[]) => mockPromote(...a),
    rollbackPrompt: (...a: unknown[]) => mockRollback(...a),
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
  mockRollback.mockReset();
  mockPrompt.mockReset();
  mockRevisions.mockResolvedValue(REVISOES);
  mockLabels.mockResolvedValue(LABELS);
  mockPrompt.mockResolvedValue({ version: 3 });
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

  it('num prompt com 30 revisões, pede a JANELA FINAL — não as 10 primeiras (#364)', async () => {
    // O defeito que este teste tranca: a rota ordena da mais ANTIGA para a mais nova e corta com
    // `limit`. Sem cursor, `limit=10` devolve v1..v10 — e esta é a tela de onde sai a promoção.
    // Quem promovesse "a mais recente da lista" reapontaria produção para uma revisão velha.
    mockPrompt.mockResolvedValue({ version: 30 });
    mockRevisions.mockResolvedValue([{ version: 30, content: 'atual', createdAt: '' }]);

    render(<PromptDetailPage />);

    await screen.findByText('v30');
    const [, limite, after] = mockRevisions.mock.calls[0];
    expect(limite).toBe(10);
    expect(after).toBe(20); // 30 − 10: a janela termina na última revisão
  });

  it('num prompt que cabe na página, NÃO usa cursor — senão cortaria linhas que cabiam', async () => {
    // O par que discrimina: um cursor incondicional esconderia o começo do histórico de prompts
    // pequenos, que é justamente onde ele cabe inteiro.
    mockPrompt.mockResolvedValue({ version: 3 });

    render(<PromptDetailPage />);

    await screen.findByText('v3');
    expect(mockRevisions.mock.calls[0][2]).toBe(0);
  });

  it('a legenda declara ATÉ QUAL revisão a página vai, em vez de prometer "as mais recentes"', async () => {
    // A frase agora é verificável contra o dado: se a janela estiver errada, o número exibido
    // denuncia. "As 10 mais recentes" era inauditável — e era falso.
    mockPrompt.mockResolvedValue({ version: 30 });
    mockRevisions.mockResolvedValue([{ version: 30, content: 'atual', createdAt: '' }]);

    render(<PromptDetailPage />);

    expect(await screen.findByText(/até a v30/i)).toBeInTheDocument();
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


/**
 * M12 — os dois BLOCKERs que o /review encontrou, e a prova de que fecharam.
 *
 * Ambos tinham a mesma forma: eu verifiquei a metade que controlava e assumi a outra. A lógica
 * de reverter tinha nove testes e nenhum botão; o conteúdo integral tinha um bullet na DoD e uma
 * coluna que truncava. Testes de função não pegam nenhum dos dois — só o que renderiza a tela.
 */
describe('M12 — ler a revisão INTEIRA (BLOCKER 3)', () => {
  it('detail_renders_the_full_content_not_an_excerpt', async () => {
    const longo = 'A'.repeat(400) + ' FIM-DO-CORPO';
    mockRevisions.mockResolvedValue([{ version: 1, content: longo, createdAt: '2026-07-28T10:00:00Z', variables: ['nome'] }]);
    render(<PromptDetailPage />);

    // O par: o fim do corpo só aparece se NADA foi truncado. Asserção sobre o começo passaria
    // com um trecho — que era exatamente o defeito.
    expect(await screen.findByText(/FIM-DO-CORPO/)).toBeInTheDocument();
  });

  it('detail_shows_the_variables_the_service_declares', async () => {
    mockRevisions.mockResolvedValue([{ version: 1, content: 'Olá {{nome}}', createdAt: '2026-07-28T10:00:00Z', variables: ['nome'] }]);
    render(<PromptDetailPage />);

    expect(await screen.findByText('nome')).toBeInTheDocument();
  });

  it('detail_shows_no_variables_when_the_service_declares_none', async () => {
    // A metade que dá valor à anterior: sem `variables` no corpo, a tela não inventa nenhuma —
    // é a invariante central do M12 ("nunca adivinhadas do texto"), e o texto TEM {{nome}}.
    mockRevisions.mockResolvedValue([{ version: 1, content: 'Olá {{nome}}', createdAt: '2026-07-28T10:00:00Z' }]);
    render(<PromptDetailPage />);

    expect(await screen.findByText(/Olá \{\{nome\}\}/)).toBeInTheDocument();
    expect(screen.queryByText('nome')).not.toBeInTheDocument();
  });
});

describe('M12 — reverter pela tela (BLOCKER 2)', () => {
  it('rollback_dialog_names_the_new_revision_it_creates', async () => {
    render(<PromptDetailPage />);
    await userEvent.click(await screen.findByLabelText('Reverter para a revisão v1'));

    // O diálogo nomeia a revisão CRIADA (v4 = última v3 + 1) e não diz "volta para".
    expect(await screen.findByText(/cria a revisão v4/i)).toBeInTheDocument();
    expect(screen.queryByText(/volta para/i)).not.toBeInTheDocument();
  });

  it('rollback_result_comes_from_labelsMoved_not_from_the_status', async () => {
    // O caso medido contra a API: 201 com labelsMoved vazio. A revisão é criada e NADA em
    // produção muda. Uma tela que lê "revertido" do status daria falsa segurança num incidente.
    mockLabels.mockResolvedValue([]);
    mockRollback.mockResolvedValue({ version: 4, labelsMoved: [], currentLabels: [] });
    render(<PromptDetailPage />);

    await userEvent.click(await screen.findByLabelText('Reverter para a revisão v1'));
    await userEvent.type(await screen.findByRole('textbox'), 'saudacao');
    await userEvent.click(screen.getByRole('button', { name: /^reverter$/i }));

    expect(await screen.findByText(/nenhum label foi movido/i)).toBeInTheDocument();
    expect(screen.queryByText(/revertido com sucesso/i)).not.toBeInTheDocument();
  });

  it('rollback_that_moved_a_label_says_so', async () => {
    // A metade oposta: quando um label DE FATO se moveu, a tela afirma. Sem este caso, uma tela
    // que sempre dissesse "nada mudou" passaria no teste acima.
    mockRollback.mockResolvedValue({ version: 4, labelsMoved: ['prod'], currentLabels: [{ label: 'prod', version: 4 }] });
    render(<PromptDetailPage />);

    await userEvent.click(await screen.findByLabelText('Reverter para a revisão v1'));
    await userEvent.type(await screen.findByRole('textbox'), 'saudacao');
    await userEvent.click(screen.getByRole('button', { name: /^reverter$/i }));

    expect(await screen.findByText(/prod passou a apontar/i)).toBeInTheDocument();
  });
});


describe('M12 — a promoção também não vaza detalhe interno (F-arch-3)', () => {
  it('promotion_5xx_does_not_leak_the_upstream_body', async () => {
    // O controle negativo que existia só no caminho novo. A regra de recusa tinha DUAS cópias e
    // a antiga — a da promoção — não tinha a guarda de 5xx: o corpo de uma falha de
    // infraestrutura sairia literal na tela do cliente.
    mockPromote.mockRejectedValue(
      new ApiError(502, { message: 'dial tcp 10.0.0.4:8080: connect: refused' }),
    );
    render(<PromptDetailPage />);

    await userEvent.click(await screen.findByLabelText('Promover prod para a revisão v3'));
    await userEvent.type(await screen.findByRole('textbox'), 'prod');
    await userEvent.click(screen.getByRole('button', { name: /^promover$/i }));

    expect(await screen.findByText(/não respondeu/i)).toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.4/)).not.toBeInTheDocument();
  });

  it('promotion_4xx_still_renders_the_service_reason', async () => {
    // A metade que dá valor à anterior: sem ela, um "sempre genérico" passaria acima e o
    // operador perderia o motivo que consegue atender.
    mockPromote.mockRejectedValue(
      new ApiError(409, { message: 'a promoção exige score ≥ 0.8 no dataset qa' }),
    );
    render(<PromptDetailPage />);

    await userEvent.click(await screen.findByLabelText('Promover prod para a revisão v3'));
    await userEvent.type(await screen.findByRole('textbox'), 'prod');
    await userEvent.click(screen.getByRole('button', { name: /^promover$/i }));

    expect(await screen.findByText(/score ≥ 0.8/)).toBeInTheDocument();
  });
});
