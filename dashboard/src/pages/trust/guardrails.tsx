import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { deleteGuardrail, fetchValidators, serviceMessage } from '@/components/trust/trust-api';
import {
  catalogRows,
  originLabel,
  tenantRowCount,
  type CatalogPayload,
  type CatalogRow,
} from '@/components/trust/guardrail-catalog';

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

const QUERY_KEY = ['cloud', '/v1/dashboard/trust/validators'] as const;

export function TrustGuardrailsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — guardrails'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [pending, setPending] = useState<CatalogRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchValidators<CatalogPayload>(),
  });

  const rows = catalogRows(query.data);
  const failed = Boolean(query.error);

  const columns: DataTableColumn<CatalogRow>[] = [
    {
      key: 'name',
      label: 'Nome',
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
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setPending(null);
    } catch (err) {
      // A linha permanece na lista: sumir otimisticamente diria que a proteção acabou
      // quando ela continua valendo.
      setRemoveError(serviceMessage(err, 'O serviço recusou a remoção; a guardrail continua ativa.'));
    }
  }

  return (
    <PageShell
      title="Guardrails"
      description="O que a camada de confiança bloqueia nas conversas deste workspace, antes de elas acontecerem."
      primaryAction={{
        label: 'Nova guardrail',
        icon: Plus,
        onClick: () => void navigate('/trust/guardrails/new'),
      }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar o catálogo"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há guardrails ativas."
        />
      ) : null}

      {removeError ? (
        <Alert intent="destructive" title="A guardrail não foi removida" description={removeError} />
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
          loading={query.isLoading}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhuma guardrail ativa'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que está valendo.'
                  : 'Nada está sendo bloqueado nas conversas deste workspace no momento.'
              }
              action={
                failed ? undefined : (
                  <Button asChild>
                    <Link to="/trust/guardrails/new">Criar a primeira guardrail</Link>
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
            Os termos desta regra deixam de ser bloqueados nas conversas deste workspace assim que
            ela for removida. Mensagens que hoje são barradas passarão a seguir adiante.{' '}
            <strong>Esta ação não pode ser desfeita.</strong>
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
