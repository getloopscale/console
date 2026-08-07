import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
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
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchTrust } from '@/pages/trust/components/trust-api';
import {
  coverageGap,
  unenforcedCount,
  type PolicyCoverage,
  type ViolationsPayload,
  type ValidatorsPayload,
} from '@/pages/trust/components/trust-series';

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
 * A frase de julgamento é o `Card.Title`, e não um `<p>` solto: ela É o título daquele cartão —
 * o veredito que o resto detalha. As linhas usam `DataTable`, o mesmo componente de `api-keys` e
 * do catálogo de guardrails, em vez de uma `<ul>` montada à mão.
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

  const columns: DataTableColumn<PolicyCoverage>[] = [
    {
      key: 'policy',
      label: 'Política',
      render: (row) => <span className="font-mono font-medium">{row.policy}</span>,
    },
    {
      key: 'observed',
      label: 'Observada',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.observed}&times;</span>
      ),
    },
    {
      key: 'enforced',
      label: 'No caminho inline',
      align: 'right',
      // A linha descoberta termina numa AÇÃO, não num rótulo: uma tela que só avisa é um alarme
      // sem interruptor. A bloqueada termina num Badge, porque não há nada a decidir nela.
      render: (row) =>
        row.enforced ? (
          <Badge variant="outline">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Bloqueada
          </Badge>
        ) : (
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/trust/violations?policy=${encodeURIComponent(row.policy)}`}>
              <ShieldAlert className="size-4" aria-hidden="true" />
              Revisar e bloquear
            </Link>
          </Button>
        ),
    },
  ];

  /** O veredito da tela, em uma frase — já com o julgamento embutido. */
  const headline = failed
    ? 'Sem leitura da camada de confiança.'
    : coverage.length === 0
      ? 'Nenhuma violação registrada.'
      : gaps === 0
        ? 'Toda política observada já está sendo bloqueada.'
        : `${gaps} ${gaps === 1 ? 'política observada não está sendo bloqueada' : 'políticas observadas não estão sendo bloqueadas'}.`;

  return (
    <PageShell
      title="Trust"
      description="O que a camada de confiança observou — e o que dela ainda passa sem ser bloqueado."
      primaryAction={{ label: 'Atualizar', icon: RefreshCw, onClick: onRefresh }}
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

      <Card>
        <Card.Header>
          {/* A frase de julgamento É o título deste cartão — não um parágrafo solto acima dele.
              asChild → <h2> porque o PageShell já rende o <h1> (WCAG 1.3.1). */}
          <Card.Title asChild>
            <h2>{headline}</h2>
          </Card.Title>
          <Card.Description>
            O plano de observação vê toda conversa; o inline só bloqueia o que tem guardrail. A
            distância entre os dois é o que esta lista mede.
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={coverage}
          rowKey={(row) => row.policy}
          loading={isLoading}
          emptyState={
            <EmptyState
              icon={failed ? ShieldAlert : ShieldCheck}
              title={failed ? 'Sem dados — a leitura falhou' : 'Nenhuma violação registrada'}
              description={
                failed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber o que passou.'
                  : 'As guardrails ativas seguem valendo no caminho inline.'
              }
            />
          }
        />

        <Card.Footer>
          <Button variant="ghost" asChild>
            <Link to="/trust/violations">
              Ver todas as violações
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </Card.Footer>
      </Card>
    </PageShell>
  );
}
