import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseAsInteger, useQueryState } from 'nuqs';
import { Button, Card, DataTable, type DataTableColumn, EmptyState, PageShell } from '@usetheo/ui';
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

  const query = useQuery({
    // `days` e `page` FAZEM parte da chave: sem eles o cache devolve a resposta da janela anterior
    // e a tela mente sobre o período que está mostrando.
    queryKey: ['cloud', '/v1/dashboard/lens/usage-by-user', days, page] as const,
    queryFn: () =>
      cloudFetch<UsageResult>(
        `/v1/dashboard/lens/usage-by-user?days=${days}&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
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
  ];

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
          <select
            id="usage-window"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={String(days)}
            onChange={(e) => {
              void setDays(Number(e.target.value));
              setPage(1);
            }}
          >
            {JANELAS.map((d) => (
              <option key={d} value={String(d)}>{`Últimos ${d} dias`}</option>
            ))}
          </select>
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
