import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageShell, Skeleton, Table } from '@usetheo/ui';

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
 * A confirmação de remoção é o `ConfirmDialog` canônico do dashboard, com `confirmationPhrase` —
 * o mesmo type-to-confirm que `domains` e `previews` usam. Uma versão local desse diálogo seria
 * uma quarta coreografia destrutiva no produto, e o `DESIGN.md § 2.2` existe justamente para que
 * exista uma só.
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
      primaryAction={{ label: 'Nova guardrail', icon: Plus, onClick: () => void navigate('/trust/guardrails/new') }}
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

      {query.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
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
      ) : (
        <Card>
          <p className="mb-4 text-sm text-muted-foreground">
            {rows.length} regra(s) ativa(s) · {tenantRowCount(rows)} criada(s) aqui
          </p>

          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Nome</Table.HeaderCell>
                <Table.HeaderCell>Tipo</Table.HeaderCell>
                <Table.HeaderCell>Origem</Table.HeaderCell>
                <Table.HeaderCell className="hidden md:table-cell">Atua em</Table.HeaderCell>
                <Table.HeaderCell align="right">Ações</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.key}>
                  <Table.Cell className="font-mono">{row.name}</Table.Cell>
                  <Table.Cell className="text-muted-foreground">{row.kind}</Table.Cell>
                  <Table.Cell>
                    {/* Texto, não só cor: a distinção precisa sobreviver a daltonismo e a impressão. */}
                    <Badge variant={row.origin === 'platform' ? 'outline' : 'primary'}>
                      {originLabel(row.origin)}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {row.directions.length > 0 ? row.directions.join(', ') : '—'}
                  </Table.Cell>
                  <Table.Cell align="right">
                    {/* Linha de plataforma não renderiza ação alguma — ADR D2. */}
                    {row.removableId ? (
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
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      )}

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
