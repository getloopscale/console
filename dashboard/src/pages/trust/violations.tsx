import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryState } from 'nuqs';
import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageShell,
  Timestamp,
  type DataTableColumn,
} from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { ConversationPanel } from '@/pages/trust/components/conversation-panel';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchTrust } from '@/pages/trust/components/trust-api';
import {
  filterByPolicy,
  type ViolationsPayload,
  type PolicyViolation,
  type ConversationPayload,
} from '@/pages/trust/components/trust-series';

/**
 * M23 — `/trust/violations`: a lista de violações de política, navegável até a conversa de origem.
 *
 * O detalhe da conversa é buscado sob demanda (`?conversation=<id>` na URL), e não junto da lista:
 * carregar N conversas para exibir uma seria N-1 requisições desperdiçadas por render, cada uma
 * cunhando chave no broker. O id vive na URL para que o operador possa compartilhar o link exato do
 * que está vendo.
 *
 * `?policy=<X>` filtra a lista. `/trust` manda o operador para cá dizendo "revisar e bloquear
 * AQUELA política" — ignorar o parâmetro quebraria a promessa em silêncio: ele não veria erro
 * algum, só uma lista que não corresponde ao que clicou.
 */

/**
 * Chave estável de uma linha. O id pode vir por dois nomes conforme a origem do registro; sem
 * nenhum dos dois, deriva do próprio conteúdo — nunca do índice, que muda quando o filtro entra
 * e faria o React reusar a linha errada.
 */
function rowKey(v: PolicyViolation): string {
  return (
    v.id ??
    v.messageId ??
    `${v.policy ?? 'sem-politica'}@${v.detectedAt ?? 'sem-data'}`
  );
}

/** Severidades que merecem destaque — o resto vai neutro, para o destaque significar algo. */
const LOUD_SEVERITY = new Set(['critical', 'high', 'error']);

/** Ausência de valor. Um traço apagado, nunca um espaço em branco que parece defeito de render. */
const DASH = <span className="text-muted-foreground">&mdash;</span>;

/**
 * As colunas da tabela de violacoes, exportadas para poderem ser exercitadas sem montar a pagina
 * inteira (que exige router, query client e a rede stubada).
 */
export function violationColumns(
  onOpen: (id: string | null) => void = () => undefined,
): DataTableColumn<PolicyViolation>[] {
  return [
    {
      // #347 — a coluna VOLTOU. Ela tinha sido removida com medicao ("o /policy-violations do
      // deploy nao devolve detectedAt"), e a decisao estava certa na epoca: coluna
      // permanentemente vazia e ruido. A EVIDENCIA venceu — o LT-001 corrigiu a omissao e esta
      // validado, entao o campo chega.
      //
      // Sem data, duas violacoes iguais em politica e severidade sao indistinguiveis, e "isso e
      // de agora ou de semanas atras?" e a primeira pergunta de quem abre a tela.
      key: 'detectedAt',
      label: 'Detectada em',
      render: (row) =>
        row.detectedAt ? (
          <Timestamp value={row.detectedAt} format="both" />
        ) : (
          DASH
        ),
    },

    {
      key: 'policy',
      label: 'Política',
      render: (row) => (
        <span className="font-mono font-medium">{row.policy ?? '—'}</span>
      ),
    },
    {
      key: 'severity',
      label: 'Severidade',
      render: (row) =>
        row.severity ? (
          <Badge
            variant={
              LOUD_SEVERITY.has(row.severity.toLowerCase())
                ? 'destructive'
                : 'outline'
            }
          >
            {row.severity}
          </Badge>
        ) : (
          DASH
        ),
    },
    {
      // O que foi detectado — já redigido pelo serviço, nunca o conteúdo bruto. É o único campo
      // que descreve a violação, e ocupa a coluna que `detectedAt` ocuparia: medido em
      // 2026-08-01, o `/policy-violations` do deploy não devolve `detectedAt`, e uma coluna
      // permanentemente vazia é ruído que empurra a informação real para fora da tela.
      key: 'redacted',
      label: 'Trecho (redigido)',
      render: (row) =>
        row.redacted ? (
          <code className="font-mono text-xs">{row.redacted}</code>
        ) : (
          DASH
        ),
    },
    {
      key: 'conversation',
      label: 'Conversa',
      align: 'right',
      render: (row) =>
        row.conversationId ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpen(row.conversationId ?? null)}
          >
            Abrir
          </Button>
        ) : (
          DASH
        ),
    },
  ];
}

export function TrustViolationsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — violações'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useQueryState('conversation');
  const [policy, setPolicy] = useQueryState('policy');

  const listQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'] as const,
    queryFn: () =>
      fetchTrust<ViolationsPayload>('/policy-violations?limit=100'),
  });

  const detailQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/conversations', selected] as const,
    // Só busca quando há uma conversa selecionada — ver nota de N+1 no cabeçalho.
    enabled: Boolean(selected),
    queryFn: () =>
      fetchTrust<ConversationPayload>(
        `/conversations/${encodeURIComponent(selected ?? '')}`,
      ),
  });

  const all = Array.isArray(listQuery.data?.violations)
    ? listQuery.data.violations
    : [];
  const rows = filterByPolicy(all, policy);
  const failed = Boolean(listQuery.error);

  const onRefresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'],
    });
  };

  const columns: DataTableColumn<PolicyViolation>[] =
    violationColumns(setSelected);
  return (
    <PageShell
      title="Violações de política"
      description="Cada linha é um sinal que a camada de confiança registrou. Abra para ver a conversa de origem."
      primaryAction={{
        label: 'Atualizar',
        icon: RefreshCw,
        onClick: onRefresh,
      }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar as violações"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há violações."
        />
      ) : null}

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1> (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>{policy ? `Violações de ${policy}` : 'Todas as violações'}</h2>
          </Card.Title>
          <Card.Description>
            {rows.length} de {all.length} registro(s) na janela.
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={rowKey}
          loading={listQuery.isLoading}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title={
                failed
                  ? 'Sem dados — a leitura falhou'
                  : policy
                    ? `Nenhuma violação de ${policy}`
                    : 'Nenhuma violação registrada'
              }
              description={
                failed
                  ? 'Tente novamente em instantes.'
                  : policy
                    ? 'Nenhum registro desta política na janela atual.'
                    : 'Nenhuma violação registrada para este workspace.'
              }
              action={
                policy ? (
                  <Button
                    variant="secondary"
                    onClick={() => void setPolicy(null)}
                  >
                    Ver todas as violações
                  </Button>
                ) : undefined
              }
            />
          }
        />

        {/* O filtro precisa ser visível E removível: um recorte silencioso faz o operador ler a
            lista parcial como se fosse o total. */}
        {policy ? (
          <Card.Footer>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void setPolicy(null)}
            >
              <X className="size-4" aria-hidden="true" />
              Limpar filtro
            </Button>
          </Card.Footer>
        ) : null}
      </Card>

      {selected ? (
        <ConversationPanel
          conversationId={selected}
          data={detailQuery.data}
          isLoading={detailQuery.isLoading}
          failed={Boolean(detailQuery.error)}
          onClose={() => void setSelected(null)}
        />
      ) : null}
    </PageShell>
  );
}
