import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseAsInteger, useQueryState } from 'nuqs';
import { Button, Card, DataTable, type DataTableColumn, EmptyState, MetricCard, PageShell, Progress, Select } from '@usetheo/ui';
import { Coins, DollarSign, Layers, Users } from 'lucide-react';
import { TrendChart, type TrendSeries } from '@usetheo/ui';
import { densificar, type CampoPlotavel, type PontoDaSerie } from '@/lib/usage-series';
import { resumirConsumo } from '@/lib/usage-summary';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { ApiError, cloudFetch } from '@/lib/api';
import { formatCost, formatNumber, shortId } from '@/lib/format';

/**
 * M142 — /observability/usage-by-user. Consumo (tokens + custo estimado) agrupado por END USER,
 * lendo o BFF `GET /v1/dashboard/lens/usage-by-user` (M141), que proxia o theo-lens (M140).
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

interface UsageRow {
  userId: string;
  /** M144 — presente só quando a chamada pediu `bucket=day`. */
  series?: PontoDaSerie[];
  spans: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}
interface UsageResult {
  users: UsageRow[];
  unpricedSpans: number;
  totalUsers: number;
  windowDays: number;
}

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
export const cabeSerie = (days: number): boolean => (days + 1) * PAGE_SIZE <= MAX_BUCKET_POINTS;
// Exportada de propósito: com as janelas ofertadas (7/30/90/365) o `+1` NÃO muda classificação
// alguma — 30 dias dão 1.500 ou 1.550, ambos sob o teto; 365 dão 18.250 ou 18.300, ambos acima. A
// fronteira só difere em 39 × 40 dias, que a UI não oferece, então a regressão é inalcançável pela
// tela. Testá-la direto é a mesma lição do `serieOrdenada` no M143: lógica isolada é lógica que a
// mutação alcança.

/** Quantas linhas o gráfico plota. Cinquenta é espaguete; a página já vem ordenada por consumo. */
const LINHAS_NO_GRAFICO = 5;

/** As cores das linhas, em ordem fixa — nunca cicladas por índice de filtro (`dataviz`). */
const CORES = ['#6366f1', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7'] as const;
const UNATTRIBUTED = 'unattributed';

/**
 * A mensagem do serviço quando ela existe; genérica só como último recurso.
 *
 * O padrão vem de `pages/billing.tsx`, e a razão registrada lá vale igual aqui: usar a cópia
 * genérica para TODA falha foi o defeito, não a existência dela. Reusamos o padrão, não o texto —
 * o do billing carrega cópia específica de checkout.
 */
function mensagemDoServico(err: unknown): string | null {
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

  const query = useQuery({
    // `days` e `page` FAZEM parte da chave: sem eles o cache devolve a resposta da janela anterior
    // e a tela mente sobre o período que está mostrando.
    queryKey: ['cloud', '/v1/dashboard/lens/usage-by-user', days, page, comSerie] as const,
    queryFn: () =>
      cloudFetch<UsageResult>(
        `/v1/dashboard/lens/usage-by-user?days=${days}&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}${comSerie ? '&bucket=day' : ''}`,
        {},
        { throwOnError: true },
      ),
  });

  const users = query.data?.users ?? [];
  const total = query.data?.totalUsers ?? 0;
  const unpriced = query.data?.unpricedSpans ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);

  // M143 — a agregação vive fora do componente, pura e testável por mutação. O que quebrou no M142
  // não foi a renderização, foi a aritmética sem oráculo.
  const resumo = resumirConsumo(users, total);

  const columns: DataTableColumn<UsageRow>[] = [
    {
      key: 'userId',
      label: 'End user',
      render: (row) =>
        row.userId === UNATTRIBUTED ? (
          // Rótulo, não substituição: a linha continua sendo a do balde, com seus números.
          <span title="Spans sem user.id — consumo real que não pôde ser atribuído a ninguém">
            Não atribuído <span className="text-xs text-muted-foreground">(sem user.id)</span>
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
      label: 'Custo estimado',
      // `formatCost` mantém 4 casas ABAIXO de 1¢ e 2 acima. O que isso salva não é $0.03 (que já
      // é legível), e sim o custo zero: `$0.0000` diz "não custou", enquanto um `$0.00` de duas
      // casas seria indistinguível de um custo real arredondado para baixo — a leitura perigosa
      // numa tela cujo número as pessoas vão tratar como fatura.
      render: (row) => <span className="tabular-nums">{formatCost(row.costUsd)}</span>,
    },
    {
      key: 'share',
      label: 'Participação',
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
              aria-label={`${pct} do custo exibido`}
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
   * Corta para os cinco maiores ANTES de densificar: densificar a página inteira produziria 50 × N
   * pontos que seriam descartados em seguida. A página já vem ordenada por consumo (decisão do
   * M140), então os cinco primeiros SÃO os cinco maiores.
   *
   * O início da janela é derivado do MAIOR `periodStart` visto, não de `Date.now()`: a janela do
   * serviço é rolante sobre `ingested_at`, e ancorar no relógio do navegador desalinharia o eixo do
   * dado sempre que os dois discordassem — inclusive por fuso.
   */
  const serieDe = (campo: CampoPlotavel): TrendSeries[] => {
    const plotaveis = users.filter((u) => u.series !== undefined).slice(0, LINHAS_NO_GRAFICO);
    if (plotaveis.length === 0) return [];
    const todosOsDias = plotaveis.flatMap((u) => (u.series ?? []).map((p) => Date.parse(p.periodStart)));
    if (todosOsDias.length === 0) return [];
    const fim = Math.max(...todosOsDias);
    const inicio = fim - (days - 1) * 86_400_000;
    return plotaveis.map((u, i) => ({
      name: u.userId === UNATTRIBUTED ? 'Não atribuído' : shortId(u.userId, 12),
      // Cor pela POSIÇÃO na ordem de consumo, fixa — nunca reciclada por filtro (`dataviz`).
      color: CORES[i % CORES.length] as string,
      points: densificar(u.series ?? [], inicio, days, campo),
    }));
  };

  const doServico = query.isError ? mensagemDoServico(query.error) : null;

  return (
    <PageShell
      title="Usage by user"
      description="Consumo de tokens e custo estimado por usuário final (somente leitura)."
    >
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <label htmlFor="usage-window" className="text-sm text-muted-foreground">
            Janela
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
            <Select.Trigger id="usage-window" className="w-[190px]" aria-label="Janela">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {JANELAS.includes(days as (typeof JANELAS)[number]) ? null : (
                <Select.Item value={String(days)} disabled>{`Personalizado: ${days} dias`}</Select.Item>
              )}
              {JANELAS.map((d) => (
                <Select.Item key={d} value={String(d)}>{`Últimos ${d} dias`}</Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>

        {query.isLoading ? (
          <ListSkeleton label="usage" />
        ) : query.isError ? (
          <Alert intent="warning" title={doServico ? 'O serviço recusou a consulta' : 'Não foi possível carregar o consumo'}>
            {doServico ?? 'O serviço de observabilidade está indisponível. Tente novamente em instantes.'}
          </Alert>
        ) : users.length === 0 ? (
          <EmptyState
            title="Nenhum consumo nesta janela"
            description="O consumo é agrupado pela identidade que o seu SDK registrou em user.id (com fallback para o gen_ai.user.id da convenção OpenTelemetry). Instrumente um agente definindo user.id nos spans para começar a ver quem consumiu o quê."
            action={
              <a
                href="https://docs.usetheo.dev/observability/quickstart"
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
                title="Custo estimado"
                value={formatCost(resumo.custoUsd)}
                icon={<DollarSign className="h-4 w-4" />}
                hint={resumo.completo ? `todos os ${total} usuários do período` : `entre os ${users.length} exibidos`}
              />
              <MetricCard
                data-testid="kpi-tokens"
                title="Tokens"
                value={formatNumber(resumo.tokens, 'compact')}
                icon={<Coins className="h-4 w-4" />}
                hint="entrada + saída"
              />
              <MetricCard
                data-testid="kpi-usuarios"
                title="Usuários com consumo"
                value={formatNumber(total, 'grouped')}
                icon={<Users className="h-4 w-4" />}
                hint={`nos últimos ${days} dias`}
              />
              <MetricCard
                data-testid="kpi-cache"
                title="Entrada servida por cache"
                value={resumo.cacheRatio === null ? '—' : formatNumber(resumo.cacheRatio, 'percent')}
                icon={<Layers className="h-4 w-4" />}
                hint={resumo.cacheRatio === null ? 'sem leitura de cache no período' : 'da entrada veio do cache'}
              />
            </div>

            {unpriced > 0 ? (
              <Alert intent="warning" title="O custo mostrado é um piso, não o total" data-testid="usage-unpriced-notice">
                {`${formatNumber(unpriced, 'grouped')} spans têm tokens e nenhum preço na tabela — o custo real é MAIOR que o exibido.`}
              </Alert>
            ) : null}

            {total > 0 ? (
              <p data-testid="usage-count" className="mb-1 text-xs text-muted-foreground">
                {`Mostrando ${firstShown}–${lastShown} de ${total}`}
              </p>
            ) : null}

            <Card>
              <DataTable columns={columns} data={users} rowKey={(row) => row.userId} />
            </Card>

            {/*
              Os gráficos vêm DEPOIS da tabela, de propósito: quem abre esta tela quer saber quem
              consumiu — a evolução é a segunda pergunta. Pô-los acima empurraria a resposta
              principal para baixo da dobra.

              A linha QUEBRA no dia sem consumo. `densificar` põe `NaN` onde o serviço não devolveu
              ponto, e o `seriesPath` do `@usetheo/ui@0.32.0` emite um novo subcaminho ali — a
              convenção de toda biblioteca séria, e a única leitura honesta: ligar afirmaria
              continuidade que o dado não tem, e zero seria indistinguível de consumo real zero.
            */}
            {comSerie && users.some((u) => u.series !== undefined) ? (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Card className="p-4" data-testid="usage-chart">
                  <TrendChart
                    title={`Custo por dia — ${LINHAS_NO_GRAFICO} maiores`}
                    series={serieDe('costUsd')}
                    valueFormatter={(v) => formatCost(v)}
                  />
                </Card>
                <Card className="p-4" data-testid="usage-chart">
                  <TrendChart
                    title={`Tokens por dia — ${LINHAS_NO_GRAFICO} maiores`}
                    series={serieDe('tokens')}
                    valueFormatter={(v) => formatNumber(v, 'compact')}
                  />
                </Card>
              </div>
            ) : !comSerie ? (
              // Gráfico ausente sem explicação é lido como "não há dado". O motivo é o orçamento do
              // serviço, e a tela o diz em vez de sumir em silêncio.
              <p data-testid="usage-chart-indisponivel" className="mt-6 text-sm text-muted-foreground">
                {`A evolução diária não é exibida para ${days} dias: o serviço limita a ${MAX_BUCKET_POINTS} pontos, e ${days} dias × ${PAGE_SIZE} linhas ultrapassam o teto. Escolha 7 ou 30 dias para ver os gráficos.`}
              </p>
            ) : null}

            {pageCount > 1 ? (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
                <Button variant="ghost" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Anterior
                </Button>
                <span className="tabular-nums" data-testid="usage-pager">{`Página ${page} / ${pageCount}`}</span>
                <Button variant="ghost" size="sm" disabled={page >= pageCount || query.isFetching} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
