import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchEnforcementEvents<EnforcementPayload>(PAGE_LIMIT),
  });

  const rows = enforcementRows(query.data);
  const failed = Boolean(query.error);

  const columns: DataTableColumn<EnforcementRow>[] = [
    {
      key: 'decision',
      label: 'Decisão',
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
      label: 'Quando',
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

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1> (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>Ações registradas</h2>
          </Card.Title>
          <Card.Description>
            {blockedCount(rows)} bloqueio(s) entre {rows.length} registro(s).
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.key}
          loading={query.isLoading}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhuma ação de enforcement registrada'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que foi barrado.'
                  : `Nenhuma mensagem foi bloqueada ou reescrita nas últimas ${PAGE_LIMIT} ocorrências.`
              }
            />
          }
        />
      </Card>
    </PageShell>
  );
}
