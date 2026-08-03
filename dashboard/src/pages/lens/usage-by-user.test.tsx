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

import { cabeSerie, LensUsageByUserPage } from './usage-by-user';

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
    // `clearAllMocks` limpa CHAMADAS, não a implementação: um caso sem `mockResolvedValue`
    // herdaria em silêncio o fixture do vizinho. `reset` faz esse caso falhar alto.
    vi.resetAllMocks();
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
   * M144 — OS DOIS GRÁFICOS.
   *
   * A série do M143 vem esparsa: um dia sem consumo não produz ponto. O `seriesPath` do
   * `@usetheo/ui@0.32.0` quebra a linha onde encontra `y` não-finito, e `densificar` é quem põe o
   * não-finito lá. O que estes casos protegem é essa cadeia inteira ponta a ponta.
   */
  const COM_SERIE = {
    ...RESPOSTA_REAL,
    users: [
      {
        ...RESPOSTA_REAL.users[0],
        series: [
          { periodStart: '2026-07-20T00:00:00.000Z', inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.5 },
          // 21 AUSENTE — a lacuna
          { periodStart: '2026-07-22T00:00:00.000Z', inputTokens: 300, outputTokens: 60, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 2.5 },
        ],
      },
      {
        ...RESPOSTA_REAL.users[1],
        series: [
          { periodStart: '2026-07-20T00:00:00.000Z', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.1 },
          { periodStart: '2026-07-21T00:00:00.000Z', inputTokens: 20, outputTokens: 6, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.2 },
          { periodStart: '2026-07-22T00:00:00.000Z', inputTokens: 30, outputTokens: 7, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.3 },
        ],
      },
    ],
  };

  it('renderiza DOIS gráficos, com uma linha por usuário', async () => {
    mockCloudFetch.mockResolvedValue(COM_SERIE);
    render(<LensUsageByUserPage />);
    const graficos = await screen.findAllByTestId('usage-chart');
    expect(graficos).toHaveLength(2);
    for (const g of graficos) {
      expect(g.querySelectorAll('[data-slot="trend-chart-line"]')).toHaveLength(2);
    }
    // …e plotam COISAS DIFERENTES. Contar dois Cards não distingue dois gráficos de um gráfico
    // duplicado: medido por mutação, trocar o título do segundo pelo do primeiro passava verde.
    const titulos = graficos.map((g) => g.querySelector('figcaption')?.textContent ?? '');
    expect(titulos[0]).toMatch(/custo/i);
    expect(titulos[1]).toMatch(/tokens/i);
    expect(titulos[0]).not.toBe(titulos[1]);

    // …e o DADO tem de bater com o título, não só o título. Este repositório já pagou por isso:
    // o #178 registra o widget "Tokens by model" roteando por `costByModelSeries` e plotando
    // DÓLARES sob um rótulo de tokens. Comparar títulos não pega isso; comparar o que foi
    // desenhado, sim.
    const custo = graficos[0]?.textContent ?? '';
    const tokens = graficos[1]?.textContent ?? '';
    expect(custo).toMatch(/\$/); // o eixo de custo formata em dólar
    expect(tokens).not.toMatch(/\$/); // o de tokens, não
    // e as geometrias diferem — custo (1.5→2.5) e tokens (140→360) normalizam diferente
    const dDe = (g: Element) => g.querySelector('[data-slot="trend-chart-line"]')?.getAttribute('d') ?? '';
    expect(dDe(graficos[0]!)).not.toBe(dDe(graficos[1]!));
    // …e o VALOR. Sem isto a mutação `serieDe('tokens')` -> `serieDe('inputTokens')` sobrevive:
    // 300 e 360 desenham geometrias diferentes mas ambas passam nas asserções acima. 360 = 300+60.
    // …e o VALOR. Sem isto a mutação `serieDe('tokens')` -> `serieDe('inputTokens')` sobrevive: 300
    // e 360 desenham geometrias diferentes e ambas passam nas asserções acima. 360 = 300 + 60, a
    // soma que a coluna da tabela mostra. A célula, e não o `textContent`: no texto concatenado da
    // tabela acessível "360" fica colado nos vizinhos (`193603720`) e casaria por acidente.
    const celulas = [...graficos[1]!.querySelectorAll('[data-slot="trend-chart-table"] td')].map(
      (c) => c.textContent,
    );
    expect(celulas).toContain('360');
    expect(celulas).not.toContain('300');
  });

  // G6 do review interno: com as janelas ofertadas o `+1` do orçamento nunca muda classificação —
  // a fronteira só difere em 39 × 40 dias, que a UI não oferece. Testada direto.
  it('cabeSerie respeita o dia extra da janela rolante, na fronteira', () => {
    // A ponta de BAIXO: `days` vem da URL sem validação, e `?days=0` passava no teto (50 pontos),
    // pedia bucket, e um piso do serviço derrubaria a tabela junto.
    expect(cabeSerie(0)).toBe(false);
    expect(cabeSerie(-1)).toBe(false);
    expect(cabeSerie(7)).toBe(true);
    expect(cabeSerie(30)).toBe(true);
    expect(cabeSerie(39)).toBe(true); // (39+1) × 50 = 2000, inclusive
    expect(cabeSerie(40)).toBe(false); // (40+1) × 50 = 2050 — sem o `+1` daria 2000 e passaria
    expect(cabeSerie(90)).toBe(false);
    expect(cabeSerie(365)).toBe(false);
  });

  // O CORAÇÃO DO MILESTONE. Ligar por cima afirmaria continuidade que o dado não tem, e desenhar
  // zero seria indistinguível de consumo real zero — a mentira que o M143 pagou para evitar ao
  // devolver a série com lacuna em vez de zeros.
  it('a linha QUEBRA no dia sem consumo — dois subcaminhos, não um contínuo', async () => {
    mockCloudFetch.mockResolvedValue(COM_SERIE);
    render(<LensUsageByUserPage />);
    const grafico = (await screen.findAllByTestId('usage-chart'))[0];
    const linhas = grafico.querySelectorAll('[data-slot="trend-chart-line"]');
    const comLacuna = linhas[0]?.getAttribute('d') ?? '';
    // dois `M` = dois subcaminhos = a linha quebrou
    expect(comLacuna.split('M')).toHaveLength(3);
    // e o usuário SEM lacuna segue com um subcaminho só
    expect((linhas[1]?.getAttribute('d') ?? '').split('M')).toHaveLength(2);
  });

  const legendaDe = (g: Element): string[] =>
    [...g.querySelectorAll('[data-slot="trend-chart-legend"] *')]
      .map((n) => n.textContent ?? '')
      .filter((t) => t.startsWith('user-'));

  /**
   * `toBeLessThanOrEqual(4)` — como este caso afirmava — fica verde com ZERO linhas e fica verde
   * plotando os quatro MENORES sob um título que diz "maiores". É literalmente o modo de falha que
   * este milestone descobriu no design system (gráfico que não desenha nada). Contagem exata mais
   * IDENTIDADE: quem foi plotado é a pergunta, não quantos.
   */
  it('plota exatamente os QUATRO maiores, e são os maiores mesmo', async () => {
    // `outputTokens` NÃO é zero, e a saída MUDA a ordem: por entrada+saída o ranking é
    // 1 (140), 3 (130), 0 (100), 2 (80); contando só a entrada seria 0, 1, 2, 3. Com saída zerada
    // as duas implementações dão a mesma resposta e a mutação "conta só a entrada" sobrevive — foi
    // o que aconteceu na primeira versão deste caso, medido.
    const entrada = [100, 90, 80, 70, 60, 50, 40, 30];
    const saida = [0, 50, 0, 60, 0, 0, 0, 0];
    const oito = entrada.map((i, n) => ({
      ...RESPOSTA_REAL.users[0],
      userId: `user-${n}`,
      inputTokens: i,
      outputTokens: saida[n] as number,
      costUsd: 1,
      series: [{ periodStart: '2026-07-20T00:00:00.000Z', inputTokens: i, outputTokens: saida[n] as number, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 }],
    }));
    mockCloudFetch.mockResolvedValue({ ...RESPOSTA_REAL, users: oito, totalUsers: 8 });
    render(<LensUsageByUserPage />);
    const grafico = (await screen.findAllByTestId('usage-chart'))[1]; // o de tokens
    expect(grafico.querySelectorAll('[data-slot="trend-chart-line"]')).toHaveLength(4);
    expect(legendaDe(grafico)).toEqual(['user-1', 'user-3', 'user-0', 'user-2']);
  });

  /**
   * O BLOCKER do review. A página vem ordenada pelo SERVIÇO por `inputTokens + outputTokens DESC`
   * (verificado no SQL do theo-lens), e o gráfico de CUSTO herdava essa ordem: um usuário num modelo
   * caro com poucos tokens ficava atrás de um usuário num modelo barato com muitos, e não aparecia
   * no gráfico de dólares — sob um título dizendo "maiores".
   *
   * `caro` tem os MENOS tokens de todos e o MAIOR custo. Ele tem de estar no gráfico de custo e
   * fora do de tokens; qualquer implementação que reuse uma ordem só falha aqui.
   */
  it('o gráfico de CUSTO rankeia por dólares, não pela ordem de tokens que veio do serviço', async () => {
    const serie = (i: number, c: number) => [{ periodStart: '2026-07-20T00:00:00.000Z', inputTokens: i, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: c }];
    const usuarios = [
      ...Array.from({ length: 4 }, (_, i) => ({ ...RESPOSTA_REAL.users[0], userId: `user-${i}`, inputTokens: 1000 - i, outputTokens: 0, costUsd: 0.01, series: serie(1000 - i, 0.01) })),
      { ...RESPOSTA_REAL.users[0], userId: 'user-caro', inputTokens: 1, outputTokens: 0, costUsd: 999, series: serie(1, 999) },
    ];
    mockCloudFetch.mockResolvedValue({ ...RESPOSTA_REAL, users: usuarios, totalUsers: 5 });
    render(<LensUsageByUserPage />);
    const [custo, tokens] = await screen.findAllByTestId('usage-chart');
    expect(legendaDe(custo!)).toContain('user-caro');
    expect(legendaDe(tokens!)).not.toContain('user-caro');
  });

  /**
   * Decisão do owner (2026-08-03): o gráfico vem LOGO ACIMA da tabela.
   *
   * O plano tinha decidido o contrário e o revisor de dataviz concordou — mas com até 50 linhas na
   * tabela o gráfico nascia muito abaixo da dobra e podia nunca ser visto. Sem esta asserção a ordem
   * volta em silêncio no próximo refactor, que é a lição que este milestone pagou várias vezes.
   */
  it('o gráfico vem ANTES da tabela no documento', async () => {
    mockCloudFetch.mockResolvedValue(COM_SERIE);
    render(<LensUsageByUserPage />);
    const grafico = (await screen.findAllByTestId('usage-chart'))[0]!;
    const tabela = screen.getAllByRole('table').find((t) => t.closest('[data-slot="trend-chart"]') === null);
    expect(tabela).toBeDefined();
    // DOCUMENT_POSITION_FOLLOWING = a tabela vem DEPOIS do gráfico.
    expect(grafico.compareDocumentPosition(tabela!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fora da primeira página o título NÃO diz "maiores" sem qualificar', async () => {
    mockCloudFetch.mockResolvedValue({ ...COM_SERIE, totalUsers: 120 });
    render(<LensUsageByUserPage />);
    await screen.findAllByTestId('usage-chart');
    await userEvent.click(screen.getByRole('button', { name: /próxima/i }));
    const titulos = (await screen.findAllByTestId('usage-chart')).map((g) => g.textContent ?? '');
    // "4 maiores" na página 2 seriam os de rank 51-54 — a mesma mentira que a faixa de KPI evita.
    for (const t of titulos) expect(t).toMatch(/maiores desta página/);
  });

  it('sem série na resposta, nenhum gráfico é renderizado — E nenhuma explicação falsa', async () => {
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    expect(screen.queryAllByTestId('usage-chart')).toHaveLength(0);
    // Sem esta segunda asserção, inverter o ramo mostraria "o serviço limita a 2000 pontos" para
    // uma janela de 30 dias que cabe folgada — uma explicação FALSA — e o caso seguia verde.
    expect(screen.queryByTestId('usage-chart-indisponivel')).not.toBeInTheDocument();
  });

  /*
   * M144 / DoD-4 — O PEDIDO CONDICIONAL.
   *
   * O gráfico REUSA a chamada da tabela (decisão do owner). O orçamento do M143 é
   * `(days+1) × limit ≤ 2000`, que com 50 linhas corta em 39 dias — então pedir `bucket` em 90 ou
   * 365 dias devolveria 400 e derrubaria A TABELA JUNTO. É o risco R1 do plano, e estes casos são
   * o que impede que ele volte.
   */
  it('janela pequena PEDE bucket', async () => {
    window.history.replaceState(null, '', '/observability/usage-by-user?days=30');
    mockCloudFetch.mockResolvedValue(COM_SERIE);
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    expect(String(mockCloudFetch.mock.calls[0]?.[0] ?? '')).toMatch(/bucket=day/);
  });

  it('janela grande NÃO pede bucket, e a tela declara por quê', async () => {
    window.history.replaceState(null, '', '/observability/usage-by-user?days=365');
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    await screen.findByText('49,373');
    expect(String(mockCloudFetch.mock.calls[0]?.[0] ?? '')).not.toMatch(/bucket/);
    // ausência DECLARADA — um gráfico que some sem explicação é lido como "não há dado"
    const aviso = await screen.findByTestId('usage-chart-indisponivel');
    expect(aviso.textContent ?? '').toMatch(/365/);
    expect(aviso.textContent ?? '').toMatch(/2000/);
  });

  // O caso que prova que reusar a chamada não custou a tabela.
  it('a TABELA sobrevive à janela grande', async () => {
    window.history.replaceState(null, '', '/observability/usage-by-user?days=365');
    mockCloudFetch.mockResolvedValue(RESPOSTA_REAL);
    render(<LensUsageByUserPage />);
    expect(await screen.findByText('49,373')).toBeInTheDocument();
    expect(screen.getByText('$4,179.48')).toBeInTheDocument();
    expect(screen.queryAllByTestId('usage-chart')).toHaveLength(0);
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
