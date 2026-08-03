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
  beforeEach(() => {
    vi.clearAllMocks();
    // A janela vive na URL (`useQueryState`), e o jsdom compartilha `window.location` entre casos
    // do mesmo arquivo. Sem este reset, um teste que seleciona `days=7` faz o SEGUINTE começar já
    // em 7 — selecionar 7 vira no-op, nenhuma busca nova acontece e o teste falha por dependência
    // de ordem, não por defeito. Medido ao acrescentar os casos de paginação; é exatamente o que
    // `testing.md § 3` proíbe ("nenhum estado mutável compartilhado, nenhuma ordem importa").
    window.history.replaceState(null, '', '/observability/usage-by-user');
  });

  // DoD-2 — o e2e derivado do registro prova que a tela MONTA (heading, sem error boundary). Uma
  // tabela vazia por erro de mapeamento de campo passaria por ele. Este teste é o que afirma
  // CONTEÚDO: números que vieram do serviço, renderizados.
  it('mostra os números que vieram do serviço', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);

    // contagem de spans, agrupada
    expect(await screen.findByText('49,373')).toBeInTheDocument();
    // A coluna Tokens soma entrada + saída. Medido por mutação: contar só `inputTokens` deixava
    // TODOS os testes verdes e subnotificava o maior consumidor em 12,6 milhões de tokens
    // (3.261.202 em vez de 15.851.609 — perda de ~79%). Nenhuma asserção olhava esta coluna.
    expect(screen.getByText('15,851,609')).toBeInTheDocument();
    // custo com 2 casas acima de 1¢
    expect(screen.getByText('$4,179.48')).toBeInTheDocument();
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

    // O SENTIDO, não só a presença. A asserção anterior era `/maior|menor|incomplet/i` — uma
    // alternância que casa com AS DUAS DIREÇÕES. Medido por mutação: trocar "o custo real é MAIOR
    // que o exibido" por "MENOR" na produção deixava este teste VERDE, e a tela passaria a dizer
    // ao operador que ele gasta menos do que o número mostrado. Numa tela cujo número as pessoas
    // tratam como fatura, é a pior inversão possível — e é exatamente o que `unpricedSpans`
    // existe para impedir.
    expect(aviso.textContent ?? '').toMatch(/maior que o exibido/i);
    expect(aviso.textContent ?? '').not.toMatch(/menor que o exibido/i);
    // …e o título carrega o mesmo sentido, para quem lê só ele.
    expect(aviso.textContent ?? '').toMatch(/piso, não o total/i);
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

  // `shortId(userId, 12)` trunca para caber na coluna; o valor INTEIRO só existe no `title`. Sem
  // ele não há como correlacionar a linha com os próprios logs — e some sem quebrar nada.
  it('mantém o userId completo acessível, não só o truncado', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const completo = RESPOSTA_REAL.users[0].userId;
    expect(await screen.findByTitle(completo)).toBeInTheDocument();
  });

  // DoD-5 — a M140 pagou para recusar com 400 tipado e a M141 para esse 400 atravessar o BFF
  // verbatim. Um "ocorreu um erro" aqui joga as duas conquistas fora no último metro.
  it('mostra a MENSAGEM do serviço quando ele recusa', async () => {
    mockCloudFetch.mockRejectedValue(
      new ApiError(400, { code: 'INVALID_QUERY', message: 'limit must be at most 500' }),
    );
    render(<LensUsageByUserPage />);
    expect(await screen.findByText(/limit must be at most 500/i)).toBeInTheDocument();
    // O TÍTULO também distingue os dois casos. "O serviço recusou a sua consulta" e "o serviço
    // está indisponível" levam a ações diferentes — corrigir o parâmetro vs esperar e tentar de
    // novo. Medido por mutação: genericizar só o título deixava a suíte verde.
    expect(await screen.findByText(/o serviço recusou a consulta/i)).toBeInTheDocument();
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

  /*
   * M143 — A FAIXA DE KPIs.
   *
   * A tabela do M142 responde "quem consumiu o quê". Quem lidera pergunta "quanto gastamos, com quem
   * isso se concentra, e estamos sendo eficientes" — e tinha de somar colunas de cabeça.
   *
   * O que estes casos protegem NÃO é o layout: é a honestidade de cada número. A resposta do serviço
   * não traz totais agregados, então somar no cliente cobre a PÁGINA, e o rótulo tem de dizer isso.
   */

  it('mostra o custo somado e declara que cobre TODOS os usuários do período', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const kpi = await screen.findByTestId('kpi-custo');
    // 4179.475464 + 0 + 0 + 0.034032
    expect(kpi).toHaveTextContent('$4,179.51');
    expect(kpi.textContent ?? '').toMatch(/todos os 4/i);
  });

  it('declara escopo PARCIAL quando há mais usuários do que linhas — e nunca diz "total"', async () => {
    mockCloudFetch.mockResolvedValue({ ...RESPOSTA_REAL, totalUsers: 400 });
    render(<LensUsageByUserPage />);
    const kpi = await screen.findByTestId('kpi-custo');
    // "exibidos", não "total": com 400 usuários o cabeçalho cobre 4, e chamar isso de total é a
    // mesma classe de mentira que `unpricedSpans` existe para impedir.
    expect(kpi.textContent ?? '').toMatch(/exibid/i);
    expect(screen.getByTestId('usage-kpis').textContent ?? '').not.toMatch(/\btotal\b/i);
  });

  it('mostra quantos usuários consumiram, e esse número é o do serviço', async () => {
    mockCloudFetch.mockResolvedValue({ ...RESPOSTA_REAL, totalUsers: 400 });
    render(<LensUsageByUserPage />);
    // `totalUsers` é exato mesmo paginado — é o único KPI que não depende da página.
    expect(await screen.findByTestId('kpi-usuarios')).toHaveTextContent('400');
  });

  it('mostra que a entrada foi servida por cache, derivando das DUAS pontas', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    // 6.405.671.505 de cache contra 3.278.653 de entrada fresca → 99.9%
    expect(await screen.findByTestId('kpi-cache')).toHaveTextContent('99.9%');
  });

  it('não afirma percentual de cache quando não houve leitura de cache alguma', async () => {
    mockCloudFetch.mockResolvedValue({
      ...RESPOSTA_REAL,
      users: RESPOSTA_REAL.users.map((u) => ({ ...u, cacheReadTokens: 0 })),
    });
    render(<LensUsageByUserPage />);
    const kpi = await screen.findByTestId('kpi-cache');
    // "não usou cache" e "não sabemos" são fatos diferentes; um 0% afirma o primeiro sobre o segundo
    expect(kpi.textContent ?? '').not.toMatch(/0(\.0)?%/);
  });

  // Não há série temporal na resposta. Uma seta de tendência aqui seria desenhada sobre número
  // inventado — o defeito exato que o M142 gastou uma campanha de mutação para expulsar.
  it('não renderiza tendência alguma — não há série que a sustente', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const kpis = await screen.findByTestId('usage-kpis');
    expect(kpis.textContent ?? '').not.toMatch(/[+-]\d+(\.\d+)?%/);
  });

  it('mostra a participação de cada linha no custo, com rótulo acessível', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const barras = await screen.findAllByTestId('usage-share');
    expect(barras).toHaveLength(4);
    // o maior consumidor é 99,999% do custo — a barra tem de dizer isso, não só colorir
    expect(barras[0].getAttribute('aria-label') ?? '').toMatch(/100(\.0)?%|99\.9/);
  });

  /*
   * `0%` para quem custou $0.034032 é a MESMA leitura perigosa que `$0.00` seria: afirma zero sobre
   * um arredondamento. A tela já paga o preço de 4 casas no custo justamente para não fazer isso —
   * fazê-lo na coluna ao lado desfaz a conquista.
   *
   * E a distinção tem de ser nos DOIS sentidos: a linha `unattributed` custou exatamente zero, e
   * para ela `0%` é a verdade. Um `<0.1%` universal seria o erro simétrico.
   */
  it('distingue participação arredondada para zero de participação REALMENTE zero', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    const barras = await screen.findAllByTestId('usage-share');

    // b08873a43f7f: $0.034032 de $4179.51 = 0,0008% — arredonda para 0%, mas NÃO é zero
    const minusculo = barras[3].closest('td') ?? barras[3].parentElement!;
    expect(minusculo.textContent ?? '').toMatch(/<\s*0[.,]1\s*%/);

    // unattributed: custo exatamente zero — aqui 0% é o fato, não um arredondamento
    const zero = barras[1].closest('td') ?? barras[1].parentElement!;
    expect(zero.textContent ?? '').not.toMatch(/</);
  });

  it('não afirma participação quando o custo somado é zero', async () => {
    mockCloudFetch.mockResolvedValue({
      ...RESPOSTA_REAL,
      users: RESPOSTA_REAL.users.map((u) => ({ ...u, costUsd: 0 })),
    });
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    // sem denominador nenhuma fatia é afirmável — nem 0%, nem NaN%, nem barra cheia
    expect(screen.queryAllByTestId('usage-share')).toHaveLength(0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('não renderiza KPIs sobre dados que não existem quando o serviço recusa', async () => {
    mockCloudFetch.mockRejectedValue(new ApiError(400, { code: 'INVALID_QUERY', message: 'days must be at most 365' }));
    render(<LensUsageByUserPage />);
    await screen.findByText(/days must be at most 365/i);
    expect(screen.queryByTestId('usage-kpis')).not.toBeInTheDocument();
  });

  /*
   * PAGINAÇÃO — quatro mutações sobreviveram aqui, todas pelo mesmo motivo: o fixture tem
   * `totalUsers: 4` e `PAGE_SIZE` é 50, então o paginador NUNCA renderizava em teste algum. O
   * código existia e nunca fora exercitado.
   *
   * Não é detalhe de conforto. O R3 do plano — "tabela grande travando o navegador", risco
   * escolhido explicitamente — declara como mitigação "paginação limita o DOM". Com `offset`
   * ignorando a página, ou `pageCount` fixo em 1, a mitigação é ficção: `Próxima` devolveria a
   * mesma página, ou o paginador nem apareceria.
   */
  const MUITOS = {
    ...RESPOSTA_REAL,
    totalUsers: 120, // 3 páginas de 50
  };

  it('pagina de verdade: o paginador aparece e a página seguinte pede o offset seguinte', async () => {
    mockCloudFetch.mockResolvedValue(MUITOS);
    render(<LensUsageByUserPage />);

    // `pageCount` derivado de `totalUsers` — fixá-lo em 1 esconde o paginador inteiro.
    expect(await screen.findByTestId('usage-pager')).toHaveTextContent('Página 1 / 3');
    // e o contador diz ONDE dentro do total, não só quantos vieram.
    expect(screen.getByTestId('usage-count')).toHaveTextContent('Mostrando 1–50 de 120');

    const primeiraUrl = String(mockCloudFetch.mock.calls.at(-1)?.[0] ?? '');
    expect(primeiraUrl).toMatch(/offset=0/);
    // `limit` acompanha o tamanho da página. Fixá-lo em 500 desalinha os offsets e PULA linhas.
    // O DELIMITADOR não é zelo: `/limit=50/` casa DENTRO de `limit=500` como substring, e foi
    // assim que esta mutação sobreviveu à primeira correção — mesma família do aviso invertido,
    // um padrão frouxo demais para distinguir o certo do errado.
    expect(primeiraUrl).toMatch(/[?&]limit=50(?:&|$)/);

    await userEvent.click(screen.getByRole('button', { name: /próxima/i }));

    await vi.waitFor(() => {
      expect(String(mockCloudFetch.mock.calls.at(-1)?.[0] ?? '')).toMatch(/offset=50/);
    });
    expect(await screen.findByTestId('usage-pager')).toHaveTextContent('Página 2 / 3');
  });

  it('trocar a janela volta para a primeira página', async () => {
    mockCloudFetch.mockResolvedValue(MUITOS);
    render(<LensUsageByUserPage />);
    await userEvent.click(await screen.findByRole('button', { name: /próxima/i }));
    await vi.waitFor(() => {
      expect(String(mockCloudFetch.mock.calls.at(-1)?.[0] ?? '')).toMatch(/offset=50/);
    });

    // Radix: clicar no gatilho, depois na opção — `selectOptions` só serve a `<select>` nativo.
    await userEvent.click(screen.getByRole('combobox', { name: /janela/i }));
    await userEvent.click(await screen.findByRole('option', { name: /7 dias/i }));

    // Sem o reset, a janela nova é consultada a partir do offset 150 de um resultado que pode ser
    // mais curto — e o operador troca o período para ver uma tela vazia sem entender por quê.
    await vi.waitFor(() => {
      const url = String(mockCloudFetch.mock.calls.at(-1)?.[0] ?? '');
      expect(url).toMatch(/days=7/);
      expect(url).toMatch(/offset=0/);
    });
  });

  /*
   * #383 — o seletor mentia sobre QUAL consulta foi recusada. Com um `days` fora de `JANELAS`, o
   * `<select>` não tinha `<option>` correspondente, o DOM caía na PRIMEIRA opção e o controle
   * exibia "Últimos 7 dias" enquanto o alerta dizia `days must be at most 365` — leitura
   * impossível, porque 7 É no máximo 365. A tela acertava o erro e errava a pergunta.
   */
  it('reflete no seletor a janela que veio da URL, mesmo fora da lista de janelas', async () => {
    window.history.replaceState(null, '', '/observability/usage-by-user?days=9999');
    mockCloudFetch.mockRejectedValue(
      new ApiError(400, { code: 'INVALID_QUERY', message: 'days must be at most 365' }),
    );
    render(<LensUsageByUserPage />);

    // Com o `Select` do design system o valor selecionado é o TEXTO do gatilho, não `.value` de um
    // `<select>` nativo — a asserção muda de forma, a garantia é a mesma.
    const seletor = await screen.findByRole('combobox', { name: /janela/i });
    // O rótulo visível nomeia o número de fato pedido, não a primeira opção da lista, para o
    // alerta ao lado fazer sentido.
    expect(seletor).toHaveTextContent('9999');
    // A recusa do serviço continua sendo mostrada verbatim (DoD-5) — o conserto do controle não
    // pode clampar o valor e engolir a recusa tipada que a M140 pagou para ter.
    expect(await screen.findByText(/days must be at most 365/i)).toBeInTheDocument();
  });

  it('não acrescenta a opção personalizada quando a janela é uma das ofertadas', async () => {
    window.history.replaceState(null, '', '/observability/usage-by-user?days=90');
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);

    const seletor = await screen.findByRole('combobox', { name: /janela/i });
    expect(seletor).toHaveTextContent('90');
    // Abrir a lista é o único jeito de contá-la no Radix — o conteúdo só existe montado.
    await userEvent.click(seletor);
    expect(await screen.findAllByRole('option')).toHaveLength(4);
  });

  // Acceptance criterion de T1.2 — sem `days` na queryKey o cache devolve a resposta da janela
  // anterior, e a tela mente sobre o período que está mostrando.
  it('trocar a janela refaz a busca com o novo days na URL', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    const chamadasAntes = mockCloudFetch.mock.calls.length;

    // Radix: clicar no gatilho, depois na opção — `selectOptions` só serve a `<select>` nativo.
    await userEvent.click(screen.getByRole('combobox', { name: /janela/i }));
    await userEvent.click(await screen.findByRole('option', { name: /7 dias/i }));

    await vi.waitFor(() => {
      expect(mockCloudFetch.mock.calls.length).toBeGreaterThan(chamadasAntes);
    });
    const ultimaUrl = String(mockCloudFetch.mock.calls.at(-1)?.[0] ?? '');
    expect(ultimaUrl).toMatch(/days=7/);
  });
});
