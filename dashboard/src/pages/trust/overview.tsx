import { useEffect } from 'react';
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
import {
  useTrustViolations,
  useTrustValidators,
  useInvalidateTrust,
} from '@/hooks/trust/use-trust';
import {
  coverageGap,
  unenforcedCount,
  type PolicyCoverage,
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
  const invalidarTrust = useInvalidateTrust();

  // B-052 — o acesso a dados mora em `hooks/trust/use-trust.ts`. As chaves
  // literais que estavam aqui colidiam com as de `violations.tsx`, que pede o
  // MESMO endpoint com limite 100: o TanStack servia quem cacheasse primeiro, e
  // o `coverageGap` abaixo podia calcular a cobertura sobre 100 violações em vez
  // de 200 — sub-reportando lacunas numa tela de compliance.
  const violationsQuery = useTrustViolations(200);
  const validatorsQuery = useTrustValidators();

  const isLoading = violationsQuery.loading || validatorsQuery.loading;
  const failed = violationsQuery.error;
  // Uma falha ao ler o CATÁLOGO não zera a tela: `coverageGap` conta tudo como descoberto, que é o
  // lado seguro. Mas o operador precisa saber que a coluna "bloqueado" está cega.
  const catalogBlind = validatorsQuery.error;

  const coverage = coverageGap(violationsQuery.data, validatorsQuery.data);
  const gaps = unenforcedCount(coverage);

  const onRefresh = () => {
    // Uma invalidação alcança o domínio inteiro. Antes eram duas chamadas com
    // chaves literais, e cada tela precisava saber a chave de todas as outras —
    // era por isso que criar um guardrail em `guardrails.tsx` nunca atualizava
    // a contagem aqui.
    invalidarTrust();
  };

  const columns: DataTableColumn<PolicyCoverage>[] = [
    {
      key: 'policy',
      label: 'Policy',
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
            Blocked
          </Badge>
        ) : (
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/trust/violations?policy=${encodeURIComponent(row.policy)}`}>
              <ShieldAlert className="size-4" aria-hidden="true" />
              Review and block
            </Link>
          </Button>
        ),
    },
  ];

  /** O veredito da tela, em uma frase — já com o julgamento embutido. */
  const headline = failed
    ? 'No reading from the trust layer.'
    : coverage.length === 0
      ? 'No violation recorded.'
      : gaps === 0
        ? 'Every observed policy is already being blocked.'
        : `${gaps} observed ${gaps === 1 ? 'policy is' : 'policies are'} not being blocked.`;

  return (
    <PageShell
      title="Trust"
      description="What the trust layer observed — and what of it still gets through unblocked."
      primaryAction={{ label: 'Atualizar', icon: RefreshCw, onClick: onRefresh }}
    >
      {failed ? (
        <Alert
          intent="destructive"
          title="Could not read the trust layer"
          description="Nothing below was loaded — this does NOT mean there are no violations. Check whether the trust service is up on the status page."
        />
      ) : null}

      {catalogBlind && !failed ? (
        <Alert
          intent="warning"
          title="The guardrail catalog did not respond"
          description="Every policy appears as discovered below, because the opposite could not be confirmed. Some may already be blocked."
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
            The observation plane sees every conversation; the inline one only blocks what has a
            guardrail. The distance between the two is what this list measures.
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
              title={failed ? 'No data — the read failed' : 'No violation recorded'}
              description={
                failed
                  ? 'Try again in a moment. Until then, there is no way to know what got through.'
                  : 'As guardrails ativas seguem valendo no caminho inline.'
              }
            />
          }
        />

        <Card.Footer>
          <Button variant="ghost" asChild>
            <Link to="/trust/violations">
              See all violations
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </Card.Footer>
      </Card>
    </PageShell>
  );
}
