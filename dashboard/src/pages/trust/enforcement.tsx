import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Card, PageShell, Skeleton } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchEnforcementEvents } from '@/components/trust/trust-api';
import {
  blockedCount,
  enforcementRows,
  type EnforcementPayload,
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
        label: 'Refresh',
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
        <Card>
          <div className="space-y-2 py-6 text-center">
            <p className="text-sm font-medium">
              {failed ? 'Sem dados — a leitura falhou.' : 'Nenhuma ação de enforcement registrada'}
            </p>
            {!failed ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma mensagem foi bloqueada ou reescrita nas últimas {PAGE_LIMIT} ocorrências.
              </p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-muted-foreground">
            {blockedCount(rows)} bloqueio(s) entre {rows.length} registro(s).
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Decisão</th>
                <th className="py-2 font-medium">Guardrail</th>
                <th className="py-2 font-medium">Categoria</th>
                <th className="py-2 font-medium">Trecho (redigido)</th>
                <th className="py-2 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  {/* Texto, não só cor: a distinção precisa sobreviver a daltonismo e impressão. */}
                  <td className="py-2 font-medium">{row.decisionLabel}</td>
                  <td className="py-2 font-mono">{row.validatorName}</td>
                  <td className="py-2">{row.category}</td>
                  <td className="py-2 font-mono text-muted-foreground">{row.redacted}</td>
                  <td className="py-2 tabular-nums">{row.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PageShell>
  );
}
