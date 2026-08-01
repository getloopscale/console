import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge, Card, EmptyState, PageShell, Skeleton, Table, Timestamp } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchEnforcementEvents } from '@/components/trust/trust-api';
import {
  blockedCount,
  enforcementRows,
  type EnforcementPayload,
  type EnforcementRow,
} from '@/components/trust/enforcement-rows';

/**
 * M24 T7.1 — `/trust/enforcement`: o que a proteção de fato barrou.
 *
 * Fecha o ciclo que o milestone existe para fechar: configurar uma regra e **observar o efeito
 * dela**. Sem esta tela, o operador cria a guardrail e fica sem saber se ela agiu.
 *
 * O conteúdo já chega redigido da origem — conteúdo bruto nunca entra na tabela do M17. A tela
 * exibe o marcador; ela não redige nada, porque redigir aqui sugeriria que o dado bruto passou
 * por este caminho.
 */

/** Explícito de propósito: sem `limit` herdaríamos o teto do servidor sem saber qual é. */
const PAGE_LIMIT = 100;

const QUERY_KEY = ['cloud', '/v1/dashboard/trust/enforcement-events'] as const;

/** A decisão é o dado mais lido da tabela — vai como Badge rotulado, nunca só como cor. */
function decisionBadge(row: EnforcementRow) {
  const variant = row.decision === 'block' ? 'destructive' : row.decision === 'modify' ? 'warning' : 'outline';
  return <Badge variant={variant}>{row.decisionLabel}</Badge>;
}

export function TrustEnforcementPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — enforcement'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchEnforcementEvents<EnforcementPayload>(PAGE_LIMIT),
  });

  const rows = enforcementRows(query.data);
  const failed = Boolean(query.error);

  return (
    <PageShell
      title="Enforcement"
      description="Cada linha é uma vez em que a proteção agiu numa conversa deste workspace."
      primaryAction={{
        label: 'Atualizar',
        icon: RefreshCw,
        onClick: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
      }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar a auditoria"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que nada foi bloqueado."
        />
      ) : null}

      {query.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={failed ? 'Sem dados — a leitura falhou' : 'Nenhuma ação de enforcement registrada'}
          description={
            failed
              ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que foi barrado.'
              : `Nenhuma mensagem foi bloqueada ou reescrita nas últimas ${PAGE_LIMIT} ocorrências.`
          }
        />
      ) : (
        <Card>
          <p className="mb-4 text-sm text-muted-foreground">
            {blockedCount(rows)} bloqueio(s) entre {rows.length} registro(s).
          </p>

          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Decisão</Table.HeaderCell>
                <Table.HeaderCell>Guardrail</Table.HeaderCell>
                <Table.HeaderCell>Categoria</Table.HeaderCell>
                <Table.HeaderCell className="hidden lg:table-cell">Trecho (redigido)</Table.HeaderCell>
                <Table.HeaderCell align="right">Quando</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.key}>
                  <Table.Cell>{decisionBadge(row)}</Table.Cell>
                  <Table.Cell className="font-mono">{row.validatorName}</Table.Cell>
                  <Table.Cell className="text-muted-foreground">{row.category}</Table.Cell>
                  <Table.Cell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                    {row.redacted}
                  </Table.Cell>
                  <Table.Cell align="right" numeric>
                    {/* Data legível — o ISO cru obriga o operador a converter de cabeça
                        no momento em que ele está investigando um incidente. */}
                    {row.createdAt === '—' ? '—' : <Timestamp value={row.createdAt} format="both" />}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      )}
    </PageShell>
  );
}
