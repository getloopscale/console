import { useEffect, useState } from 'react';
import { useTrustValidators, useInvalidateTrust } from '@/hooks/trust/use-trust';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageShell,
  type DataTableColumn,
} from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { deleteGuardrail, serviceMessage } from '@/hooks/trust/trust-api';
import {
  catalogRows,
  originLabel,
  tenantRowCount,
  type CatalogRow,
} from '@/pages/trust/components/guardrail-catalog';

/**
 * M24 T4.2 — `/trust/guardrails`: o catálogo do que protege as conversas deste workspace.
 *
 * A tela mostra plataforma e tenant JUNTOS, porque a pergunta do operador é "o que está me
 * protegendo agora?" — e separar em duas tabelas esconderia a soma. O que distingue as origens
 * é texto (um `Badge` rotulado), não cor; e a linha de plataforma simplesmente **não tem** ação
 * de remover: ausência, não botão cinza (ADR D2).
 *
 * A listagem é `DataTable` — o mesmo componente de `api-keys` — e não uma `Table` montada à mão:
 * ele já traz `loading`, `emptyState` e `rowActions`, que era o encadeamento condicional que esta
 * tela reimplementava. A confirmação é o `ConfirmDialog` canônico, com `confirmationPhrase`.
 */


export function TrustGuardrailsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — guardrails'), [setPageTitle]);
  useRequireAuth();
  const invalidarTrust = useInvalidateTrust();
  const navigate = useNavigate();

  const [pending, setPending] = useState<CatalogRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // B-052 — o mesmo catálogo que `overview.tsx` lê. Antes eram duas chaves
  // literais para o MESMO endpoint (`fetchValidators` é `fetchTrust('/validators')`,
  // trust-api.ts:32), então o catálogo ocupava duas entradas de cache que nunca
  // se invalidavam juntas.
  const query = useTrustValidators();

  const rows = catalogRows(query.data);
  const failed = Boolean(query.error);

  const columns: DataTableColumn<CatalogRow>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) => <span className="font-mono font-medium">{row.name}</span>,
    },
    {
      key: 'kind',
      label: 'Tipo',
      render: (row) => <span className="text-muted-foreground">{row.kind}</span>,
    },
    {
      // Sem esta coluna o catálogo lista nomes que só quem os escolheu entende — e o operador
      // não tem como decidir se uma regra ainda faz sentido. Na plataforma é a categoria
      // detectada, a mesma chave que `/trust` usa ("credential_leak observada 2×").
      key: 'effect',
      label: 'O que faz',
      render: (row) => <span className="text-muted-foreground">{row.effect}</span>,
    },
    {
      key: 'origin',
      label: 'Origem',
      // Texto, não só cor: a distinção precisa sobreviver a daltonismo e a impressão.
      render: (row) => (
        <Badge variant={row.origin === 'platform' ? 'outline' : 'primary'}>
          {originLabel(row.origin)}
        </Badge>
      ),
    },
    {
      key: 'directions',
      label: 'Atua em',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.directions.length > 0 ? row.directions.join(', ') : '—'}
        </span>
      ),
    },
    {
      // Coluna própria em vez do `rowActions` do DataTable, de propósito: `rowActions` renderiza
      // o gatilho `⋮` em TODA linha, mesmo quando o callback devolve null — a linha de plataforma
      // ganharia um menu vazio, que convida a clicar e não entrega nada. Pior que o botão cinza
      // que o ADR D2 recusa. Aqui a célula fica vazia: ausência de verdade.
      key: 'actions',
      label: '',
      align: 'right',
      width: '1%',
      render: (row) =>
        row.removableId ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remover ${row.name}`}
            onClick={() => {
              setRemoveError(null);
              setPending(row);
            }}
          >
            <Trash2 className="size-4" />
            Remover
          </Button>
        ) : null,
    },
  ];

  async function confirmRemoval() {
    if (!pending?.removableId) return;
    setRemoveError(null);
    try {
      await deleteGuardrail(pending.removableId);
      // B-052 — `QUERY_KEY` era a literal local desta página. Invalidar o
      // domínio alcança também o overview, que conta o mesmo catálogo.
      invalidarTrust();
      setPending(null);
    } catch (err) {
      // A linha permanece na lista: sumir otimisticamente diria que a proteção acabou
      // quando ela continua valendo.
      setRemoveError(serviceMessage(err, 'The service refused the removal; the guardrail is still active.'));
    }
  }

  return (
    <PageShell
      title="Guardrails"
      description="What the trust layer blocks in this workspace conversations, before they happen."
      primaryAction={{
        label: 'New guardrail',
        icon: Plus,
        onClick: () => void navigate('/trust/guardrails/new'),
      }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Could not load the catalog"
          description="The list below is empty because the read failed — this does NOT mean there are no active guardrails."
        />
      ) : null}

      {removeError ? (
        <Alert intent="destructive" title="The guardrail was not removed" description={removeError} />
      ) : null}

      <Card>
        <Card.Header>
          {/* asChild → <h2>: o PageShell já rende o <h1>, e pular de h1 para o h3 padrão do
              Card.Title quebraria a hierarquia (WCAG 1.3.1). Mesmo tratamento de project-detail. */}
          <Card.Title asChild>
            <h2>Regras ativas</h2>
          </Card.Title>
          <Card.Description>
            {rows.length} no total · {tenantRowCount(rows)} criada(s) neste workspace
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
              title={failed ? 'No data — the read failed' : 'No active guardrail'}
              description={
                failed
                  ? 'Try again in a moment. Until then, there is no way to know what is in force.'
                  : 'Nothing is being blocked in this workspace conversations right now.'
              }
              action={
                failed ? undefined : (
                  <Button asChild>
                    <Link to="/trust/guardrails/new">Create the first guardrail</Link>
                  </Button>
                )
              }
            />
          }
        />
      </Card>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // O erro NÃO é limpo aqui. O diálogo fecha ao confirmar, inclusive quando o serviço
          // recusa — e limpar neste ponto apagaria, no mesmo ciclo, a mensagem que explica por
          // que a guardrail continua na lista. Ele é limpo ao ABRIR um novo diálogo.
          if (!open) setPending(null);
        }}
        title={`Remover a guardrail "${pending?.name ?? ''}"?`}
        description={
          <>
            The terms of this rule stop being blocked in this workspace conversations as soon as
            it is removed. Messages that are stopped today will start going through.{' '}
            <strong>This action cannot be undone.</strong>
          </>
        }
        confirmLabel="Remover guardrail"
        intent="destructive"
        confirmationPhrase={pending?.name}
        onConfirm={confirmRemoval}
      />
    </PageShell>
  );
}
