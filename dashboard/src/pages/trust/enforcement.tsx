import { useEffect } from 'react';
import { useTrustEnforcement } from '@/hooks/trust/use-trust';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageShell,
  Timestamp,
  type DataTableColumn,
} from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  blockedCount,
  enforcementRows,
  type EnforcementRow,
} from '@/pages/trust/components/enforcement-rows';

/**
 * M24 T7.1 — `/trust/enforcement`: o que a proteção de fato barrou.
 *
 * Fecha o ciclo que o milestone existe para fechar: configurar uma regra e **observar o efeito
 * dela**. Sem esta tela, o operador cria a guardrail e fica sem saber se ela agiu.
 *
 * O conteúdo já chega redigido da origem — conteúdo bruto nunca entra na tabela do M17. A tela
 * exibe o marcador; ela não redige nada, porque redigir aqui sugeriria que o dado bruto passou
 * por este caminho.
 *
 * Composição igual à das demais listagens do dashboard (`api-keys`, `domains`): `Card` com
 * cabeçalho semântico + `DataTable`, que já traz `loading` e `emptyState` — e não o encadeamento
 * de ternários que esta tela montava à mão.
 */

/** Explícito de propósito: sem `limit` herdaríamos o teto do servidor sem saber qual é. */
const PAGE_LIMIT = 100;

const QUERY_KEY = ['cloud', '/v1/dashboard/trust/enforcement-events'] as const;

export function TrustEnforcementPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — enforcement'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  // B-052 — o limite entra na chave. `QUERY_KEY` era fixa, entao pedir uma
  // janela diferente serviria o cache da anterior — menos linhas do que se
  // pediu, em silencio.
  const query = useTrustEnforcement(PAGE_LIMIT);

  const rows = enforcementRows(query.data);
  const failed = Boolean(query.error);

  const columns: DataTableColumn<EnforcementRow>[] = [
    {
      key: 'decision',
      label: 'Decision',
      // Badge rotulado: a decisão é o dado mais lido da tabela e não pode depender só de cor.
      render: (row) => (
        <Badge
          variant={
            row.decision === 'block' ? 'destructive' : row.decision === 'modify' ? 'warning' : 'outline'
          }
        >
          {row.decisionLabel}
        </Badge>
      ),
    },
    {
      key: 'validatorName',
      label: 'Guardrail',
      render: (row) => <span className="font-mono">{row.validatorName}</span>,
    },
    {
      // Categoria é CONTEXTO — é ela que sai da tela estreita, não o trecho.
      key: 'category',
      label: 'Categoria',
      className: 'hidden lg:table-cell',
      render: (row) => <span className="text-muted-foreground">{row.category}</span>,
    },
    {
      // Sempre visível, inclusive no celular. Esconder o trecho em tela estreita tirava
      // justamente a informação que a tela existe para dar — o e2e mobile pegou isso.
      key: 'redacted',
      label: 'Trecho (redigido)',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.redacted}</span>
      ),
    },
    {
      key: 'createdAt',
      label: 'When',
      align: 'right',
      // Data legível — o ISO cru obriga o operador a converter de cabeça justamente no
      // momento em que ele está investigando um incidente.
      render: (row) =>
        row.createdAt === '—' ? '—' : <Timestamp value={row.createdAt} format="both" />,
    },
  ];

  return (
    <PageShell
      title="Enforcement"
      description="Each row is one time the protection acted on a conversation in this workspace."
      primaryAction={{
        label: 'Refresh',
        icon: RefreshCw,
        onClick: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
      }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Could not load the audit trail"
          description="The list below is empty because the read failed — this does NOT mean nothing was blocked."
        />
      ) : null}

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1> (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>Recorded actions</h2>
          </Card.Title>
          <Card.Description>
            {blockedCount(rows)} block(s) among {rows.length} record(s).
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.key}
          loading={query.loading}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title={failed ? 'No data — the read failed' : 'No enforcement action recorded'}
              description={
                failed
                  ? 'Try again in a moment. Until then, there is no way to know what was stopped.'
                  : `No message was blocked or rewritten in the last ${PAGE_LIMIT} occurrences.`
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
