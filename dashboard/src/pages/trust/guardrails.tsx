import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, PageShell, Skeleton } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
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
import { GuardrailDeleteDialog } from '@/components/trust/guardrail-delete-dialog';

/**
 * M24 T4.2 — `/trust/guardrails`: o catálogo do que protege as conversas deste workspace.
 *
 * A tela mostra plataforma e tenant JUNTOS, porque a pergunta do operador é "o que está me
 * protegendo agora?" — e separar em duas tabelas esconderia a soma. O que distingue as origens
 * é texto, não cor (`DESIGN.md`), e a linha de plataforma simplesmente **não tem** ação de
 * remover: ausência, não botão cinza (ADR D2).
 */

const QUERY_KEY = ['cloud', '/v1/dashboard/trust/validators'] as const;

export function TrustGuardrailsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — guardrails'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<CatalogRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchValidators<CatalogPayload>(),
  });

  const rows = catalogRows(query.data);
  const failed = Boolean(query.error);

  async function confirmRemoval() {
    if (!pending?.removableId) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteGuardrail(pending.removableId);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setPending(null);
    } catch (err) {
      // A linha permanece na lista: sumir otimisticamente diria que a proteção acabou
      // quando ela continua valendo.
      setRemoveError(serviceMessage(err, 'O serviço recusou a remoção; a guardrail continua ativa.'));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <PageShell
      title="Guardrails"
      description="O que a camada de confiança bloqueia nas conversas deste workspace, antes de elas acontecerem."
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar o catálogo"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há guardrails ativas."
        />
      ) : null}

      {query.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {rows.length} regra(s) ativa(s) · {tenantRowCount(rows)} criada(s) aqui
            </h2>
            <Link to="/trust/guardrails/new" className="rounded border px-3 py-2 text-sm">
              Nova guardrail
            </Link>
          </div>

          {rows.length === 0 ? (
            <div className="space-y-2 py-6 text-center">
              <p className="text-sm font-medium">
                {failed ? 'Sem dados — a leitura falhou.' : 'Nenhuma guardrail ativa'}
              </p>
              {!failed ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Nada está sendo bloqueado nas conversas deste workspace no momento.
                  </p>
                  <Link to="/trust/guardrails/new" className="inline-block text-sm underline">
                    Criar a primeira guardrail
                  </Link>
                </>
              ) : null}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Nome</th>
                  <th className="py-2 font-medium">Tipo</th>
                  <th className="py-2 font-medium">Origem</th>
                  <th className="py-2 font-medium">Atua em</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b last:border-0">
                    <td className="py-2 font-mono">{row.name}</td>
                    <td className="py-2">{row.kind}</td>
                    <td className="py-2">{originLabel(row.origin)}</td>
                    <td className="py-2 text-muted-foreground">
                      {row.directions.length > 0 ? row.directions.join(', ') : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {/* Linha de plataforma não renderiza ação alguma — ADR D2. */}
                      {row.removableId ? (
                        <button
                          type="button"
                          className="text-sm underline"
                          onClick={() => {
                            setRemoveError(null);
                            setPending(row);
                          }}
                        >
                          Remover
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {pending ? (
        <GuardrailDeleteDialog
          name={pending.name}
          busy={removing}
          error={removeError}
          onCancel={() => {
            setPending(null);
            setRemoveError(null);
          }}
          onConfirm={() => void confirmRemoval()}
        />
      ) : null}
    </PageShell>
  );
}
