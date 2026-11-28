import { useEffect, useState } from 'react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { Card, DataTable, type DataTableColumn, EmptyState, MetricCard, Progress, Select } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { Coins, DollarSign, Layers, Users } from 'lucide-react';
import { TrendChart, type TrendSeries } from '@getloopscale/ui';
import { densificar, seriesWindow, type PlottableField } from '@/pages/lens/usage-series';
import { summarizeConsumption } from '@/pages/lens/usage-summary';
import { ListSkeleton } from '@/pages/lens/components/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/http/api';
import { useUsageByUser, type UsageRow } from '@/hooks/lens/use-usage-by-user';
import { usePaginacao } from '@/lib/pagination';
import { Pager } from '@/components/pager';
import { formatCost, formatNumber, shortId } from '@/lib/formatting/format';

/**
 * M142 — /observability/usage-by-user. Consumo (tokens + custo estimado) agrupado por END USER,
 * lendo o BFF `GET /v1/dashboard/lens/usage-by-user` (M141), que proxia o looptrace (M140).
 *
 * Somente leitura, e por construção: o relatório é DERIVADO dos spans ingeridos — não há o que
 * criar, editar ou apagar aqui, do mesmo jeito que na tela de Agents.
 *
 * Três decisões desta tela não são cosméticas, e cada uma tem um teste que fica vermelho se sumir:
 *
 *  1. `unpricedSpans` aparece NA TELA quando > 0. O campo existe para impedir que um total
 *     silenciosamente baixo seja lido como o gasto real, e documentação não é lida por quem olha
 *     uma tabela.
 *  2. `unattributed` é uma LINHA ordinária, ordenada por consumo junto das demais (decisão do
 *     M140) — mas com rótulo, porque "não sabemos de quem foi" e "ninguém consumiu" são fatos
 *     diferentes que levam a decisões diferentes.
 *  3. Um erro do serviço chega com a MENSAGEM dele. A M140 pagou para recusar `days`/`limit` fora
 *     do teto com 400 tipado, e a M141 para esse 400 atravessar o BFF verbatim; desenhar "ocorreu
 *     um erro" jogaria as duas conquistas fora no último metro.
 */


/** Janelas oferecidas. O teto de 365 é o do serviço, que RECUSA acima dele (M140). */
const JANELAS = [7, 30, 90, 365] as const;
const PAGE_SIZE = 50;

/**
 * M144 — o orçamento de pontos do M143: `(days + 1) × limit ≤ 2000`. O `+1` não é margem — uma
 * janela ROLANTE de N dias atravessa N+1 dias de calendário, medido no review daquele milestone.
 *
 * Com `PAGE_SIZE = 50` isso corta em **39 dias**: as janelas de 7 e 30 comportam série, as de 90 e
 * 365 não. E como o gráfico REUSA a chamada da tabela, pedir `bucket` fora do orçamento faria o 400
 * derrubar a tabela junto — por isso o pedido é condicional, e a ausência é declarada.
 */
const MAX_BUCKET_POINTS = 2000;
// `days >= 1` não é zelo: `days` vem da URL sem validação (`parseAsInteger`), e `?days=0` ou
// `?days=-5` passavam no teto (50 e -200 pontos), pediam `bucket`, e um piso do serviço derrubaria
// a TABELA junto — o risco R1 que este guarda existe justamente para impedir.
export const cabeSerie = (days: number): boolean =>
  days >= 1 && (days + 1) * PAGE_SIZE <= MAX_BUCKET_POINTS;
// Exportada de propósito: com as janelas ofertadas (7/30/90/365) o `+1` NÃO muda classificação
// alguma — 30 dias dão 1.500 ou 1.550, ambos sob o teto; 365 dão 18.250 ou 18.300, ambos acima. A
// fronteira só difere em 39 × 40 dias, que a UI não oferece, então a regressão é inalcançável pela
// tela. Testá-la direto é a mesma lição do `serieOrdenada` no M143: lógica isolada é lógica que a
// mutação alcança.

/**
 * Quantas linhas o gráfico plota — QUATRO, e o número saiu de medição, não de gosto.
 *
 * Eram cinco. O validador de paleta da `dataviz` reprovou a paleta de cinco nos dois temas, e
 * reprovou também as seis alternativas que testei: com cinco matizes dentro da faixa de luminosidade
 * do tema escuro, algum par sempre cai abaixo do piso de separação sob daltonismo (o pior foi
 * o roxo contra o índigo, ΔE 0,9 sob protanopia — duas das cinco linhas eram praticamente a mesma).
 * Quatro passa `--pairs all` em claro E escuro. A própria skill antecipa isto: *cinco linhas podem
 * não caber, e a saída é cortar séries, não inventar cor.*
 *
 * `--pairs all` e não só os pares adjacentes porque num gráfico de linhas que se cruzam **quaisquer**
 * duas linhas encostam — a lista honesta é todas contra todas.
 */
const ROWS_IN_CHART = 4;

/**
 * Okabe-Ito, escalonada para a superfície ESCURA — e só para ela, de propósito.
 *
 * O dashboard é travado em escuro (`main.tsx`: `defaultMode: 'dark'`, `respectSystemMode: false`,
 * sem theme picker), então uma segunda paleta para o tema claro seria código para um caso que não
 * existe. A paleta clara equivalente reprova a faixa de luminosidade do escuro em dois dos quatro
 * passos — se um dia houver seletor de tema, é aqui que ele entra, e não antes.
 *
 * Medido com `validate_palette.js --mode dark --pairs all`: `ALL CHECKS PASS`. A anterior
 * (índigo, âmbar, verde, ciano e roxo do Tailwind) reprovava: `#22c55e↔#f59e0b` ΔE 5,7 sob protanopia,
 * abaixo do piso de 6 — nem a cláusula de encoding secundário a salvava.
 */
const CORES = ['#0072B2', '#A87200', '#009E73', '#9E5A80'] as const;
const UNATTRIBUTED = 'unattributed';

/**
 * Como o eixo X do gráfico é lido. Esta é a única tela do produto cujo `x` é epoch-ms — as outras
 * cinco fábricas de série passam índice de balde —, então é a única que pode datar o eixo hoje.
 *
 * `UTC` de propósito: o serviço agrupa por `date_trunc('day', ingested_at)` em UTC, e formatar no
 * fuso do navegador deslocaria o rótulo em relação ao balde que ele nomeia. Um gráfico que diz
 * "21/07" sobre o balde de 22/07 é pior que um sem data — erra com confiança.
 */
const axisDay = (x: number): string =>
  new Date(x).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/**
 * A mensagem do serviço quando ela existe; genérica só como último recurso.
 *
 * O padrão vem de `pages/billing.tsx`, e a razão registrada lá vale igual aqui: usar a cópia
 * genérica para TODA falha foi o defeito, não a existência dela. Reusamos o padrão, não o texto —
 * o do billing carrega cópia específica de checkout.
 */
function serviceMessage(err: unknown): string | null {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const body = err.body as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim().length > 0) return body.message;
  }
  return null;
}

export function LensUsageByUserPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Usage by user'), [setPageTitle]);
  useRequireAuth();

  // A janela vive na URL: um relatório de consumo é algo que se COMPARTILHA, e estado só em
  // memória perde o período ao colar o link — quem recebe vê outro número achando que vê o mesmo.
  const [days, setDays] = useQueryState('days', parseAsInteger.withDefault(30));
  const [page, setPage] = useState(1);

  // M144 — `bucket` entra na MESMA chamada da tabela, e só quando o orçamento comporta. Pedi-lo
  // fora dele devolveria 400 e a tabela morreria junto com o gráfico.
  const comSerie = cabeSerie(days);

  const query = useUsageByUser({ days, page, pageSize: PAGE_SIZE, withSeries: comSerie });

  const users = query.data?.users ?? [];
  const total = query.data?.totalUsers ?? 0;
  const unpriced = query.data?.unpricedSpans ?? 0;
  // B-184 — a aritmética vinha copiada, e esta cópia já tinha divergido: o resumo abaixo estava
  // em português enquanto as outras quatro telas diziam "Showing … of …".
  const paginacao = usePaginacao({
    total,
    pageSize: PAGE_SIZE,
    page,
    setPage,
    notSettled: query.isFetching || !query.data,
  });

  // M143 — a agregação vive fora do componente, pura e testável por mutação. O que quebrou no M142
  // não foi a renderização, foi a aritmética sem oráculo.
  const resumo = summarizeConsumption(users, total);

  const columns: DataTableColumn<UsageRow>[] = [
    {
      key: 'userId',
      label: 'End user',
      render: (row) =>
        row.userId === UNATTRIBUTED ? (
          // Rótulo, não substituição: a linha continua sendo a do balde, com seus números.
          <span title="Spans with no user.id — real usage that could not be attributed to anyone">
            Unattributed <span className="text-xs text-muted-foreground">(no user.id)</span>
          </span>
        ) : (
          // `shortId` encurta para leitura; o valor completo fica no title para cópia.
          <span title={row.userId} className="font-mono">{shortId(row.userId, 12)}</span>
        ),
    },
    { key: 'spans', label: 'Spans', render: (row) => <span className="tabular-nums">{formatNumber(row.spans, 'grouped')}</span> },
    {
      key: 'inputTokens',
      label: 'Tokens',
      render: (row) => <span className="tabular-nums">{formatNumber(row.inputTokens + row.outputTokens, 'grouped')}</span>,
    },
    {
      key: 'costUsd',
      label: 'Estimated cost',
      // `formatCost` mantém 4 casas ABAIXO de 1¢ e 2 acima. O que isso salva não é $0.03 (que já
      // é legível), e sim o custo zero: `$0.0000` diz "não custou", enquanto um `$0.00` de duas
      // casas seria indistinguível de um custo real arredondado para baixo — a leitura perigosa
      // numa tela cujo número as pessoas vão tratar como fatura.
      render: (row) => <span className="tabular-nums">{formatCost(row.costUsd)}</span>,
    },
    {
      key: 'share',
      label: 'Share',
      /**
       * Barra + rótulo direto, não donut: `dataviz/choosing-a-form` — magnitude comparada entre
       * categorias é barra, e mantê-la NA tabela deixa o rótulo (o `userId`) ao lado da magnitude
       * em vez de duplicar a lista num gráfico à parte. Uma série só ⇒ sem legenda.
       *
       * A barra sozinha é cor, e cor sozinha não é acessível — daí o `aria-label` com o número e o
       * percentual visível ao lado dela.
       */
      render: (row) => {
        const p = resumo.participacoes[users.indexOf(row)];
        // Sem denominador nenhuma fatia é afirmável — nem 0%, nem NaN%, nem barra vazia enganosa.
        if (p === null || p === undefined) return <span className="text-muted-foreground">—</span>;
        // `0%` para quem custou $0.034032 afirma zero sobre um ARREDONDAMENTO — a mesma leitura
        // perigosa que `$0.00` seria, e que a coluna de custo paga 4 casas para evitar. Mas a
        // distinção vale nos dois sentidos: quem custou exatamente zero É 0%, e um `<0,1%`
        // universal seria o erro simétrico.
        const pct = p > 0 && p < 0.001 ? '<0.1%' : formatNumber(p, 'percent');
        return (
          <div className="flex items-center gap-2">
            <Progress
              value={p * 100}
              height="h-1.5"
              className="w-16"
              aria-label={`${pct} of the cost shown`}
              data-testid="usage-share"
            />
            <span className="tabular-nums text-xs text-muted-foreground">{pct}</span>
          </div>
        );
      },
    },
  ];

  /**
   * M144 — as séries dos gráficos.
   *
   * Corta para os maiores ANTES de densificar: densificar a página inteira produziria 50 × N
   * pontos que seriam descartados em seguida.
   *
   * O corte é reordenado POR GRANDEZA. A ordem que vem do serviço é por tokens
   * (`inputTokens + outputTokens DESC`), e ela NÃO serve para o gráfico de custo: tokens e dólares
   * rankeiam diferente assim que há mais de um modelo em jogo.
   *
   * A janela vem de `janelaDaSerie` (pura, testável): `days + 1` fatias — o mesmo que o orçamento
   * de `cabeSerie` paga — terminando HOJE, para que os dias finais sem consumo apareçam como lacuna
   * em vez de desaparecerem do eixo.
   */
  /**
   * O total da janela na grandeza plotada — o critério de "maiores". Vem da LINHA (agregado que o
   * serviço já devolve para a janela inteira), não da soma da série: são o mesmo número, e usar o
   * agregado evita que um recorte de série mude quem entra no gráfico.
   */
  /**
   * O que o título pode honestamente afirmar. O corte sai da PÁGINA, então "maiores" só é verdade na
   * primeira: na página 2 os quatro primeiros são os de rank 51-54, e um título dizendo "4 maiores"
   * ali mentiria — a mesma armadilha que a faixa de KPI já evita ao declarar escopo parcial.
   */
  const escopoDoGrafico =
    page === 1 ? `top ${ROWS_IN_CHART}` : `top ${ROWS_IN_CHART} on this page`;

  const totalDe = (u: UsageRow, field: PlottableField): number =>
    field === 'costUsd' ? u.costUsd : u.inputTokens + u.outputTokens;

  const serieDe = (field: PlottableField): TrendSeries[] => {
    // O ranking é POR GRANDEZA PLOTADA. A página vem ordenada pelo serviço por
    // `inputTokens + outputTokens DESC` — tokens, não custo —, e os quatro primeiros dessa ordem
    // não são os quatro maiores em dólares: um usuário num modelo caro com poucos tokens fica atrás
    // de um usuário num modelo barato com muitos, e ficava de fora do gráfico de CUSTO enquanto o
    // título dizia "maiores". O título afirmava sobre o eixo de dólares uma ordem de tokens.
    const plotaveis = [...users]
      .filter((u) => u.series !== undefined)
      .sort((a, b) => totalDe(b, field) - totalDe(a, field))
      .slice(0, ROWS_IN_CHART);
    if (plotaveis.length === 0) return [];
    const daysWithPoint = plotaveis.flatMap((u) => (u.series ?? []).map((p) => Date.parse(p.periodStart)));
    const { start, windowDays } = seriesWindow(daysWithPoint, days, Date.now());
    return plotaveis.map((u, i) => ({
      name: u.userId === UNATTRIBUTED ? 'Unattributed' : shortId(u.userId, 12),
      // A cor segue a POSIÇÃO no recorte, não a entidade: com quatro slots e um conjunto ilimitado
      // de usuários, cor estável por usuário não é alcançável sem colisão. Quem carrega a identidade
      // é a LEGENDA, que nomeia cada linha — a cor é pista secundária. O que importa e é garantido:
      // o mesmo usuário tem a mesma cor nos DOIS gráficos do mesmo render, que é o que permite
      // cruzar custo e tokens. Trocar a janela troca o recorte e repinta; está registrado como
      // limitação, não disfarçado de estabilidade.
      color: CORES[i % CORES.length] as string,
      points: densificar(u.series ?? [], start, windowDays, field),
    }));
  };

  const fromService = query.isError ? serviceMessage(query.error) : null;

  return (
    <PageShell
      title="Usage by user"
      description="Token usage and estimated cost per end user (read only)."
    >
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <label htmlFor="usage-window" className="text-sm text-muted-foreground">
            Window
          </label>
          {/*
            `Select` do design system, não `<select>` nativo. Esta era a ÚNICA tela do lens com o
            controle do sistema operacional — as outras cinco (alerts, dashboards, evaluators,
            traces/filter-bar, playground) já usavam o do design system. Não era preferência
            estética: era uma inconsistência que eu introduzi, e ela salta aos olhos num painel.
          */}
          <Select
            value={String(days)}
            onValueChange={(v) => {
              void setDays(Number(v));
              setPage(1);
            }}
          >
            {/*
              Uma janela vinda da URL que não esteja em `JANELAS` PRECISA de uma opção própria.
              Sem ela o DOM cai na primeira da lista e o controle passa a dizer "Últimos 7 dias"
              enquanto o serviço recusou 9999 — quem lê entende que 7 dias foi recusado, e a
              mensagem `days must be at most 365` vira absurdo ao lado disso (#383).

              Desabilitada porque não é uma janela ofertada: serve para EXIBIR a consulta feita,
              não para ser reescolhida. Clampar o valor seria a alternativa, e joga fora a recusa
              tipada que a M140 pagou para ter.
            */}
            <Select.Trigger id="usage-window" className="w-[190px]" aria-label="Window">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {JANELAS.includes(days as (typeof JANELAS)[number]) ? null : (
                <Select.Item value={String(days)} disabled>{`Personalizado: ${days} dias`}</Select.Item>
              )}
              {JANELAS.map((d) => (
                <Select.Item key={d} value={String(d)}>{`Last ${d} days`}</Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>

        {query.isLoading ? (
          <ListSkeleton label="usage" />
        ) : query.isError ? (
          <Alert intent="warning" title={fromService ? 'The service refused the query' : 'Could not load the usage'}>
            {fromService ?? 'The observability service is unavailable. Try again in a moment.'}
          </Alert>
        ) : users.length === 0 ? (
          <EmptyState
            title="No usage in this window"
            description="Usage is grouped by the identity your SDK recorded in user.id (falling back to the OpenTelemetry convention gen_ai.user.id). Instrument an agent by setting user.id on spans to start seeing who consumed what."
            action={
              <a
                href="https://docs.getloopscale.com/observability/quickstart"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                Instrument an agent →
              </a>
            }
          />
        ) : (
          <>
            {/*
              A FAIXA DE KPIs (M143). Quatro números, e cada `hint` existe para o número não ser lido
              como algo que ele não é:

               • Custo e Tokens somam as linhas EXIBIDAS. A resposta do serviço não traz totais
                 agregados, então com 400 usuários e página de 50 o cabeçalho cobre 50 — e chamar
                 isso de "total" é a mesma classe de mentira que `unpricedSpans` impede.
               • Usuários vem de `totalUsers`: é o único exato mesmo paginado.
               • Cache é razão entre as DUAS pontas (leitura ÷ (leitura + entrada fresca)). O rótulo
                 descreve o FATO ("da entrada veio do cache"), não o benefício — 99% de cache não é
                 99% de desconto, e prometer isso seria vender número.

              NENHUM delta: não há série temporal na resposta, e uma seta desenhada sobre número
              inventado é o defeito que a campanha de mutação do M142 gastou uma tarde para expulsar.
            */}
            <div data-testid="usage-kpis" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                data-testid="kpi-custo"
                title="Estimated cost"
                value={formatCost(resumo.costUsd)}
                icon={<DollarSign className="h-4 w-4" />}
                hint={resumo.completo ? `all ${total} users in the period` : `among the ${users.length} shown`}
              />
              <MetricCard
                data-testid="kpi-tokens"
                title="Tokens"
                value={formatNumber(resumo.tokens, 'compact')}
                icon={<Coins className="h-4 w-4" />}
                hint="input + output"
              />
              <MetricCard
                data-testid="kpi-usuarios"
                title="Users with usage"
                value={formatNumber(total, 'grouped')}
                icon={<Users className="h-4 w-4" />}
                hint={`in the last ${days} days`}
              />
              <MetricCard
                data-testid="kpi-cache"
                title="Entrada servida por cache"
                value={resumo.cacheRatio === null ? '—' : formatNumber(resumo.cacheRatio, 'percent')}
                icon={<Layers className="h-4 w-4" />}
                hint={resumo.cacheRatio === null ? 'no cache reading in the period' : 'of the input came from cache'}
              />
            </div>

            {unpriced > 0 ? (
              <Alert intent="warning" title="The cost shown is a floor, not the total" data-testid="usage-unpriced-notice">
                {`${formatNumber(unpriced, 'grouped')} spans have tokens and no price in the table — the real cost is HIGHER than shown.`}
              </Alert>
            ) : null}

            {/*
              Os gráficos vêm LOGO ACIMA da tabela, por decisão do owner (2026-08-03).
              O plano tinha decidido o contrário — a tabela primeiro, porque "quem consumiu" seria a
              pergunta de abertura e a evolução a segunda —, e o revisor de dataviz concordou com
              aquela ordem. Ambos estavam errados sobre o leitor real: com até 50 linhas na tabela, o
              gráfico nascia muito abaixo da dobra e podia nunca ser visto. A ressalva do próprio
              revisor previa isso.

              A linha QUEBRA no dia sem consumo. `densificar` põe `NaN` onde o serviço não devolveu
              ponto, e o `seriesPath` do `@getloopscale/ui` emite um novo subcaminho ali — a
              convenção de toda biblioteca séria, e a única leitura honesta: ligar afirmaria
              continuidade que o dado não tem, e zero seria indistinguível de consumo real zero.
            */}
            {comSerie && users.some((u) => u.series !== undefined) ? (
              <div className="mb-6 grid gap-4 lg:grid-cols-2">
                <Card className="p-4" data-testid="usage-chart">
                  <TrendChart
                    title={`Cost per day — ${escopoDoGrafico}`}
                    series={serieDe('costUsd')}
                    valueFormatter={(v) => formatCost(v)}
                    xFormatter={axisDay}
                    xLabel="Day"
                  />
                </Card>
                <Card className="p-4" data-testid="usage-chart">
                  <TrendChart
                    title={`Tokens per day — ${escopoDoGrafico}`}
                    series={serieDe('tokens')}
                    valueFormatter={(v) => formatNumber(v, 'compact')}
                    xFormatter={axisDay}
                    xLabel="Day"
                  />
                </Card>
              </div>
            ) : !comSerie ? (
              // Gráfico ausente sem explicação é lido como "não há dado". O motivo é o orçamento do
              // serviço, e a tela o diz em vez de sumir em silêncio.
              <p data-testid="usage-chart-indisponivel" className="mb-6 text-sm text-muted-foreground">
                {`The daily trend is not shown for ${days} days: the service caps at ${MAX_BUCKET_POINTS} points, and (${days} + 1) days × ${PAGE_SIZE} rows exceed it. Pick 7 or 30 days to see the charts.`}
              </p>
            ) : null}

            {total > 0 ? (
              <p data-testid="usage-count" className="mb-1 text-xs text-muted-foreground">
                {paginacao.resumo}
              </p>
            ) : null}

            <Card>
              <DataTable columns={columns} data={users} rowKey={(row) => row.userId} />
            </Card>

            <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
              <Pager paginacao={paginacao} ocupado={query.isFetching} testId="usage-pager" />
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
