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
const mockUsage = vi.fn();
const mockSetTags = vi.fn();
const mockCatalog = vi.fn();
const mockComments = vi.fn();
const mockAddComment = vi.fn();
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
    fetchPromptUsage: (...a: unknown[]) => mockUsage(...a),
    setTags: (...a: unknown[]) => mockSetTags(...a),
    fetchCatalogPage: (...a: unknown[]) => mockCatalog(...a),
    fetchComments: (...a: unknown[]) => mockComments(...a),
    addComment: (...a: unknown[]) => mockAddComment(...a),
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
  mockUsage.mockReset();
  mockRevisions.mockResolvedValue(REVISOES);
  mockLabels.mockResolvedValue(LABELS);
  mockPrompt.mockResolvedValue({ version: 3 });
  mockPolicy.mockResolvedValue(null);
  mockPromote.mockResolvedValue({ name: 'saudacao', label: 'prod', version: 3 });
  mockUsage.mockResolvedValue({
    promptName: 'saudacao',
    windowDays: 7,
    rows: [{ revision: 3, resolutions: 12, totalTokens: 1500, costUsd: 0.031, p50LatencyMs: 4.2 }],
  });
});

describe('PromptDetailPage — a intenção da revisão (M17)', () => {
  it('a descricao aparece na linha da revisao', async () => {
    mockRevisions.mockResolvedValue([
      { version: 3, content: 'texto', createdAt: 'd', changeDescription: 'encurtei o preambulo' },
    ]);

    render(<PromptDetailPage />);

    expect(await screen.findByText(/encurtei o preambulo/)).toBeInTheDocument();
  });

  it('revisao ANTERIOR ao milestone diz "sem descricao" — nunca texto inventado', async () => {
    mockRevisions.mockResolvedValue([{ version: 3, content: 'texto', createdAt: 'd' }]);

    render(<PromptDetailPage />);

    await screen.findByText('v3');
    expect(screen.getByText(/sem descrição/i)).toBeInTheDocument();
  });

  it('a config aparece, e temperature 0 e mostrada como 0', async () => {
    mockRevisions.mockResolvedValue([
      { version: 3, content: 'texto', createdAt: 'd', modelConfig: { temperature: 0 } },
    ]);

    render(<PromptDetailPage />);

    expect(await screen.findByText(/temperature 0/i)).toBeInTheDocument();
  });
});

describe('PromptDetailPage — uso por revisão (M15)', () => {
  it('a linha da revisao mostra as chamadas do periodo', async () => {
    render(<PromptDetailPage />);

    // O oráculo é o NÚMERO na tela, não a chamada à API: um fetch bem-sucedido cujo
    // resultado ninguém renderiza é exatamente o defeito que o M13 deixou passar.
    expect(await screen.findByText('12')).toBeInTheDocument();
  });

  it('a linha mostra os QUATRO numeros que o DoD pede, nao dois', async () => {
    render(<PromptDetailPage />);

    // chamadas · latência mediana · tokens · custo — o bullet do ROADMAP enumera os quatro.
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(await screen.findByText(/4\.2\s*ms/i)).toBeInTheDocument();
    expect(await screen.findByText(/1500|1\.500/)).toBeInTheDocument();
    expect(await screen.findByText(/0\.0310/)).toBeInTheDocument();
  });

  it('a janela do agregado aparece na tela, nunca implicita', async () => {
    render(<PromptDetailPage />);

    await screen.findByText('v3');
    expect(await screen.findByText(/7 dias/i)).toBeInTheDocument();
  });

  it('leitura que FALHA nao vira zero — diz que nao conseguiu ler (DoD-3)', async () => {
    // A distinção inteira do milestone: "não consegui ler" ≠ "ninguém usou". Um zero
    // aqui é uma afirmação que ninguém mediu, e leva o operador à conclusão oposta.
    mockUsage.mockRejectedValue(new ApiError(502, 'PROMPTLY_USAGE_UNAVAILABLE', 'não consegui ler'));

    render(<PromptDetailPage />);

    await screen.findByText('v3');
    // Uma mensagem por revisão — a falha é da leitura inteira, não de uma linha.
    expect((await screen.findAllByText(/não consegui ler o uso/i)).length).toBe(2);
    // O oráculo que importa: nenhum zero renderizado sobre a falha.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('revisao sem trafego diz "sem chamadas", que e diferente de zero', async () => {
    mockUsage.mockResolvedValue({ promptName: 'saudacao', windowDays: 7, rows: [] });

    render(<PromptDetailPage />);

    await screen.findByText('v3');
    expect((await screen.findAllByText(/sem chamadas/i)).length).toBeGreaterThan(0);
  });

  it('custo ausente fica vazio COM RAZAO, nunca estimado (DoD-4)', async () => {
    mockUsage.mockResolvedValue({
      promptName: 'saudacao',
      windowDays: 7,
      rows: [{ revision: 3, resolutions: 5, totalTokens: 100, costUsd: null }],
    });

    render(<PromptDetailPage />);

    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(await screen.findByText(/não reportou custo/i)).toBeInTheDocument();
  });

  it('declara a condicao de atribuicao por trace (ADR-1) em vez de deixar inferir', async () => {
    // O limite honesto: uma app que resolve o prompt fora do trace em que chama o
    // modelo não correlaciona. Sem dizer isso, o operador lê o vazio como "sem custo".
    mockUsage.mockResolvedValue({
      promptName: 'saudacao',
      windowDays: 7,
      rows: [{ revision: 3, resolutions: 9, totalTokens: 0, costUsd: null }],
    });

    render(<PromptDetailPage />);

    await screen.findByText('9');
    expect(await screen.findByText(/mesmo trace/i)).toBeInTheDocument();
  });
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

/**
 * M14 T4.2 — o caminho até o playground.
 *
 * O `theo-promptly/CLAUDE.md` documenta o defeito que custou quatro telas
 * invisíveis no `theo-trust`: submenu declarado, resolução de menu esquecida, e
 * três rodadas de validação que passaram por cima porque quem validava digitava a
 * URL — o único caminho que o usuário real não tem.
 */
describe('M14 — a entrada do playground', () => {
  it('o detalhe do prompt oferece um link para o playground DAQUELE prompt', async () => {
    render(<PromptDetailPage />);

    const link = await screen.findByRole('link', { name: 'Playground' });
    expect(link).toHaveAttribute('href', '/promptly/saudacao/playground');
  });
});

/**
 * M16 — as tags no DETALHE, e a marcação pela tela.
 *
 * O DoD do milestone pede as duas coisas pelo nome: *"tags criadas e filtradas na tela"* e *"a tag
 * aparece na linha do catálogo E no detalhe"*. A primeira entrega fez só a leitura no catálogo — o
 * `PUT /prompts/:name/tags` existia na API e parava no BFF, e a tela não tinha como marcar nada.
 * Um produto onde só a API sabe marcar não tem a jornada que o milestone promete.
 */
describe('PromptDetailPage — tags (M16)', () => {
  function comCatalogo(tags: readonly string[]): void {
    // As tags do prompt vêm do catálogo, que já é a projeção que as carrega. Um endpoint novo
    // seria trabalho antes da necessidade — o dado já está a um `search` de distância.
    mockCatalog.mockResolvedValue({
      data: [{ name: 'saudacao', latestVersion: 3, labels: [], tags, updatedAt: 'd' }],
      temContinuacao: false,
    });
  }

  it('a tag do prompt aparece no detalhe', async () => {
    comCatalogo(['suporte', 'campanha']);

    render(<PromptDetailPage />);

    expect(await screen.findByText('suporte')).toBeInTheDocument();
    expect(screen.getByText('campanha')).toBeInTheDocument();
  });

  it('prompt sem tag DIZ que não tem, em vez de deixar o espaço em branco', async () => {
    // Um espaço vazio lê como "não carregou". A ausência é um fato sobre o prompt e tem de ser
    // dita — mesma razão do "sem descrição" do M17 e do "nenhum" dos labels.
    comCatalogo([]);

    render(<PromptDetailPage />);

    expect(await screen.findByText(/nenhuma tag/i)).toBeInTheDocument();
  });

  it('marcar uma tag pela tela chama o servico com o conjunto INTEIRO', async () => {
    // O contrato é substituição, não delta: mandar só a tag nova apagaria as antigas no servidor.
    comCatalogo(['suporte']);
    mockSetTags.mockResolvedValue({ name: 'saudacao', tags: ['campanha', 'suporte'] });
    render(<PromptDetailPage />);
    await screen.findByText('suporte');

    await userEvent.type(screen.getByLabelText(/nova tag/i), 'campanha');
    await userEvent.click(screen.getByRole('button', { name: /marcar/i }));

    await vi.waitFor(() =>
      expect(mockSetTags).toHaveBeenCalledWith('saudacao', ['suporte', 'campanha']),
    );
  });

  it('remover uma tag manda o conjunto SEM ela, e nao um delete', async () => {
    comCatalogo(['suporte', 'campanha']);
    mockSetTags.mockResolvedValue({ name: 'saudacao', tags: ['suporte'] });
    render(<PromptDetailPage />);
    await screen.findByText('campanha');

    await userEvent.click(screen.getByRole('button', { name: /remover a tag campanha/i }));

    await vi.waitFor(() => expect(mockSetTags).toHaveBeenCalledWith('saudacao', ['suporte']));
  });

  it('a recusa TIPADA do servico chega ao operador, nao um erro generico', async () => {
    // `too_many_tags` e `empty_tag` dizem o que fazer; "erro ao salvar" não diz nada. É a mesma
    // lição que o CLAUDE.md deste repositório registra sobre mensagem escrita para o terminal.
    comCatalogo(['suporte']);
    mockSetTags.mockRejectedValue(
      new ApiError(400, { error: 'too_many_tags', message: 'um prompt aceita no maximo 16 tags' }),
    );
    render(<PromptDetailPage />);
    await screen.findByText('suporte');

    await userEvent.type(screen.getByLabelText(/nova tag/i), 'demais');
    await userEvent.click(screen.getByRole('button', { name: /marcar/i }));

    expect(await screen.findByText(/no maximo 16 tags/i)).toBeInTheDocument();
  });
});

/**
 * M18 — a discussão na tela, e quem promove vendo-a ANTES de confirmar.
 *
 * O DoD é explícito: *"a tela de promoção mostra se a revisão-alvo tem comentários antes de
 * confirmar. Discussão que não é lida na hora da decisão não muda decisão nenhuma."*
 */
describe('PromptDetailPage — discussão da revisão (M18)', () => {
  it('a discussao da revisao aparece com autor e data', async () => {
    mockComments.mockResolvedValue([
      { id: 'c1', body: 'rejeitada: verbosa demais', author: 'ana', createdAt: '2026-08-04T10:00:00Z' },
    ]);

    render(<PromptDetailPage />);

    expect(await screen.findByText(/rejeitada: verbosa demais/)).toBeInTheDocument();
    expect(screen.getByText(/ana/)).toBeInTheDocument();
  });

  it('revisao sem discussao DIZ que nao ha, em vez de ficar em branco', async () => {
    // Branco lê como "não carregou". A ausência de discussão é um fato sobre a revisão.
    mockComments.mockResolvedValue([]);

    render(<PromptDetailPage />);

    expect(await screen.findByText(/nenhum comentário/i)).toBeInTheDocument();
  });

  it('comentar pela tela manda o corpo e RELE a discussao', async () => {
    mockComments.mockResolvedValue([]);
    mockAddComment.mockResolvedValue({ name: 'saudacao', version: 3 });
    render(<PromptDetailPage />);
    await screen.findByText(/nenhum comentário/i);

    await userEvent.type(screen.getByLabelText(/comentar esta revisão/i), 'por que a v3?');
    await userEvent.click(screen.getByRole('button', { name: /comentar/i }));

    await vi.waitFor(() =>
      expect(mockAddComment).toHaveBeenCalledWith('saudacao', expect.any(Number), 'por que a v3?'),
    );
  });

  it('a recusa TIPADA por segredo chega ao operador com o motivo', async () => {
    // `secret_in_comment` diz o que fazer; "erro ao salvar" não diz nada. E a mensagem cita o
    // TIPO de credencial, nunca o trecho — o valor não pode voltar à tela.
    mockComments.mockResolvedValue([]);
    mockAddComment.mockRejectedValue(
      new ApiError(400, {
        error: 'secret_in_comment',
        message: 'o comentario parece conter uma chave da plataforma; remova-a antes de enviar',
      }),
    );
    render(<PromptDetailPage />);
    await screen.findByText(/nenhum comentário/i);

    await userEvent.type(screen.getByLabelText(/comentar esta revisão/i), 'colei algo');
    await userEvent.click(screen.getByRole('button', { name: /comentar/i }));

    expect(await screen.findByText(/chave da plataforma/i)).toBeInTheDocument();
  });

  it('QUEM PROMOVE ve que ha discussao antes de confirmar', async () => {
    // O bullet 4 do DoD. Sem isto o operador confirma sem saber que alguém já discutiu a
    // revisão que ele está pondo no ar.
    mockComments.mockResolvedValue([
      { id: 'c1', body: 'não promova: quebra o tom', author: 'bia', createdAt: '2026-08-04T10:00:00Z' },
    ]);
    render(<PromptDetailPage />);
    await screen.findByText(/não promova: quebra o tom/);

    await userEvent.click(screen.getAllByRole('button', { name: /promover/i })[0]);

    expect(await screen.findByText(/comentário/i)).toBeInTheDocument();
  });
});
