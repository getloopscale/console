import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card, PageShell, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchTrust } from '@/components/trust/trust-api';
import {
  coverageGap,
  unenforcedCount,
  type ViolationsPayload,
  type ValidatorsPayload,
} from '@/components/trust/trust-series';

/**
 * M23 — `/trust`. A tela abre com uma frase, não com três números.
 *
 * A pergunta que ela responde é **o que passa sem ser bloqueado**: o plano de observação enxerga
 * toda conversa ingerida, o inline só bloqueia o que tem guardrail, e a distância entre os dois é
 * onde o risco mora. "12 violações" não diz se elas continuam passando; "3 políticas passando sem
 * guardrail" diz, e aponta o que fazer.
 *
 * Cada linha descoberta é uma decisão, não um item de lista. O caminho de leitura termina numa
 * ação — sem isso a tela é um alarme sem interruptor.
 *
 * 5Q-3s do `DESIGN.md`:
 *   Onde estou?          título "Trust"
 *   O que acontece?      a frase de abertura, em uma linha
 *   Ação principal?      fechar a lacuna da linha de cima (a mais urgente)
 *   Existe risco?        é exatamente o que a abertura mede
 *   O que faço agora?    cada linha descoberta carrega seu próprio próximo passo
 */

export function TrustOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const violationsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'] as const,
    queryFn: () => fetchTrust<ViolationsPayload>('/policy-violations?limit=200'),
  });

  const validatorsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/validators'] as const,
    queryFn: () => fetchTrust<ValidatorsPayload>('/validators'),
  });

  const isLoading = violationsQuery.isLoading || validatorsQuery.isLoading;
  const failed = Boolean(violationsQuery.error);
  // Uma falha ao ler o CATÁLOGO não zera a tela: `coverageGap` conta tudo como descoberto, que é o
  // lado seguro. Mas o operador precisa saber que a coluna "bloqueado" está cega.
  const catalogBlind = Boolean(validatorsQuery.error);

  const coverage = coverageGap(violationsQuery.data, validatorsQuery.data);
  const gaps = unenforcedCount(coverage);

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'] });
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/trust/validators'] });
  };

  return (
    <PageShell
      title="Trust"
      description="O que a camada de confiança observou — e o que dela ainda passa sem ser bloqueado."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível ler a camada de confiança"
          description="Nada abaixo foi carregado — isto NÃO significa ausência de violações. Confira se o serviço trust está no ar na página de status."
        />
      ) : null}

      {catalogBlind && !failed ? (
        <Alert
          intent="warning"
          title="O catálogo de guardrails não respondeu"
          description="Toda política aparece como descoberta abaixo, porque não foi possível confirmar o contrário. Algumas podem já estar bloqueadas."
        />
      ) : null}

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Card>
          {/* A abertura é uma frase, não um número solto: ela já carrega o julgamento. */}
          <p className="mb-4 text-lg">
            {failed ? (
              'Sem leitura da camada de confiança.'
            ) : coverage.length === 0 ? (
              'Nenhuma violação registrada. As guardrails ativas seguem valendo no caminho inline.'
            ) : gaps === 0 ? (
              <>
                Toda política observada <strong>já está sendo bloqueada</strong> no caminho inline.
              </>
            ) : (
              <>
                <strong>
                  {gaps} {gaps === 1 ? 'política observada não está' : 'políticas observadas não estão'}
                </strong>{' '}
                sendo {gaps === 1 ? 'bloqueada' : 'bloqueadas'}.
              </>
            )}
          </p>

          {coverage.length > 0 ? (
            <ul className="divide-y">
              {coverage.map((c) => (
                <li key={c.policy} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <span className="font-mono text-sm">{c.policy}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      observada {c.observed}&times;
                    </span>
                  </div>
                  {c.enforced ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      bloqueada
                    </span>
                  ) : (
                    <Link
                      to={`/trust/violations?policy=${encodeURIComponent(c.policy)}`}
                      className="flex shrink-0 items-center gap-1.5 text-sm font-medium underline"
                    >
                      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      revisar e bloquear
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      )}

      <Card>
        <Link to="/trust/violations" className="text-sm font-medium underline">
          Ver todas as violações &rarr;
        </Link>
      </Card>
    </PageShell>
  );
}
