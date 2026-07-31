import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryState } from 'nuqs';
import { RefreshCw } from 'lucide-react';
import { Card, PageShell, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchTrust } from '@/components/trust/trust-api';
import type { ViolationsPayload, PolicyViolation } from '@/components/trust/trust-series';

/**
 * M23 — `/trust/violations`: a lista de violações de política, navegável até a conversa de origem.
 *
 * O detalhe da conversa é buscado sob demanda (`?conversation=<id>` na URL), e não junto da lista:
 * carregar N conversas para exibir uma seria N-1 requisições desperdiçadas por render, cada uma
 * cunhando chave no broker. O id vive na URL para que o operador possa compartilhar o link exato do
 * que está vendo.
 *
 * O conteúdo da conversa É o dado sensível que a violação denuncia. Esta tela mostra o que o
 * serviço devolve — que já vem redigido do lado do `theo-trust` — e nunca reconstrói o trecho
 * bruto a partir da violação.
 */

/** Uma linha da lista; o id pode vir por dois nomes conforme a origem do registro. */
function rowId(v: PolicyViolation, i: number): string {
  return v.id ?? v.messageId ?? `row-${i}`;
}

export function TrustViolationsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — violações'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useQueryState('conversation');

  const listQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'] as const,
    queryFn: () => fetchTrust<ViolationsPayload>('/policy-violations?limit=100'),
  });

  const detailQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/conversations', selected] as const,
    // Só busca quando há uma conversa selecionada — ver nota de N+1 no cabeçalho.
    enabled: Boolean(selected),
    queryFn: () =>
      fetchTrust<Record<string, unknown>>(`/conversations/${encodeURIComponent(selected ?? '')}`),
  });

  const rows = Array.isArray(listQuery.data?.violations) ? listQuery.data.violations : [];
  const failed = Boolean(listQuery.error);

  const onRefresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'],
    });
  };

  return (
    <PageShell
      title="Violações de política"
      description="Cada linha é um sinal que a camada de confiança registrou. Abra para ver a conversa de origem."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar as violações"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que não há violações."
        />
      ) : null}

      {listQuery.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {failed
              ? 'Sem dados — a leitura falhou.'
              : 'Nenhuma violação registrada para este workspace.'}
          </p>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Política</th>
                <th className="py-2 font-medium">Severidade</th>
                <th className="py-2 font-medium">Detectada em</th>
                <th className="py-2 font-medium">Conversa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={rowId(v, i)} className="border-b last:border-0">
                  <td className="py-2 font-mono">{v.policy ?? '—'}</td>
                  <td className="py-2">{v.severity ?? '—'}</td>
                  <td className="py-2 tabular-nums">{v.detectedAt ?? '—'}</td>
                  <td className="py-2">
                    {v.conversationId ? (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void setSelected(v.conversationId ?? null)}
                      >
                        abrir
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected ? (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Conversa <span className="font-mono">{selected}</span>
            </h2>
            <button type="button" className="text-sm underline" onClick={() => void setSelected(null)}>
              fechar
            </button>
          </div>
          {detailQuery.isLoading ? (
            <Skeleton className="h-24" />
          ) : detailQuery.error ? (
            <Alert
              intent="destructive"
              title="Não foi possível carregar a conversa"
              description="A violação continua válida; apenas o detalhe não pôde ser lido agora."
            />
          ) : (
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(detailQuery.data, null, 2)}
            </pre>
          )}
        </Card>
      ) : null}
    </PageShell>
  );
}
