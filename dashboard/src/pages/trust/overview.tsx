import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, ShieldAlert, ShieldCheck, ShieldX, Siren } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  MetricCard,
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
import { CategoryBars } from '@/components/charts/category-bars';
import { trustKpis } from './components/trust-kpis';
import {
  coverageGap,
  unenforcedCount,
  type PolicyCoverage,
} from '@/pages/trust/components/trust-series';

/**
 * @overview-answers: kpi
 * @overview-answers: verdict
 *
 * Amendment D1-bis (owner's decision, 2026-08-11): every capability overview opens with the same
 * four-KPI dashboard `memory` opens with. Consistency of surface is a property of the product —
 * whoever operates eight capabilities should not learn eight ways to read the first screen.
 *
 * The VERDICT stays, ABOVE the numbers. A number says `3`; the sentence says what to do about the
 * `3`. The amendment adds the dashboard; it does not replace the verdict.
 *
 * B-126, decisão D1 de `capability-overviews-answer-a-question-plan.md` — a forma segue a existência de uma REGRA, não a maioria.
 *
 * Existe a REGRA: toda política observada deveria estar sendo bloqueada. O veredito nasceu aqui,
 * antes da decisão D1 — este marcador o registra como padrão em vez de o deixar como exceção.
 *
 * O marcador é lido por `lib/capability-overview.test.ts`, que reprova a tela que não
 * declarar nenhuma forma — foi assim que `skills` ficou mudo entre sete telas.
 */

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
  // B-161 — uma AFIRMAÇÃO ("nenhuma violação registrada") exige leitura estabilizada das
  // DUAS queries. `!failed && !isLoading` abria offline no mount, com `data === undefined`,
  // e a tela dizia que nada passou quando nada foi lido — numa superfície de compliance.
  // Os dois blocos exigem coisas diferentes, e o docblock de `overview.test.tsx` já nomeia
  // os três estados. KPIs e veredito valem no caso 3 (violações lidas, catálogo cego): a
  // lista é verdadeira e a cegueira aparece como aviso. O GRÁFICO não vale, porque codifica
  // "bloqueado" em COR: sem catálogo toda barra sai âmbar, e o operador lê um all-clear
  // falso onde o código sabe apenas que não sabe (B-161).
  const readingSettled = violationsQuery.isSuccess;
  const coverageSettled = violationsQuery.isSuccess && validatorsQuery.isSuccess;
  // O GRAFICO exige tambem o catalogo (B-161/B-227). Ele codifica "bloqueado" em COR: sem
  // catalogo toda barra sai ambar, e o operador le um all-clear falso onde o codigo sabe
  // apenas que nao sabe. A tabela abaixo continua valendo no caso 3 e carrega o aviso de
  // cegueira; o grafico nao tem como carregar ressalva nenhuma.
  const failed = violationsQuery.error;
  // Uma falha ao ler o CATÁLOGO não zera a tela: `coverageGap` conta tudo como descoberto, que é o
  // lado seguro. Mas o operador precisa saber que a coluna "bloqueado" está cega.
  const catalogBlind = validatorsQuery.error;

  const coverage = coverageGap(violationsQuery.data, validatorsQuery.data);
  const gaps = unenforcedCount(coverage);
  // B-126, amendment D1-bis — the four numbers every capability opens with. They derive from the
  // `coverage` the screen already computes; no new request.
  const kpis = trustKpis(coverage);

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
      label: 'Observed',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.observed}&times;</span>
      ),
    },
    {
      key: 'enforced',
      label: 'On the inline path',
      align: 'right',
      // An uncovered row ends in an ACTION, not a label: a screen that only warns is an alarm with
      // no switch. A blocked row ends in a Badge, because there is nothing to decide about it.
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
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh }}
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

      {/* B-126, amendment D1-bis (owner's decision) — the same four-KPI dashboard `memory` opens
          with, so whoever operates eight capabilities does not learn eight ways to read the first
          screen.

          The VERDICT below stays. It was this screen's only answer and remains the best part of
          it: a number says `3`, the sentence says what to do about the `3`. The amendment adds the
          dashboard; it does not replace it.

          Renders only once the read has settled — four zeros over a failure would be fabricated
          numbers standing where an error belongs, which is what the Alert above exists to show. */}
      {readingSettled ? (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard title="Violations" value={kpis.violations} icon={<Siren className="h-4 w-4" aria-hidden="true" />} />
          <MetricCard title="Policies seen" value={kpis.policies} icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />} />
          <MetricCard title="Blocked" value={kpis.blocked} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} />
          <MetricCard title="Unblocked" value={kpis.unenforced} icon={<ShieldX className="h-4 w-4" aria-hidden="true" />} />
        </div>
      ) : null}

      {/* B-129 — the table below lists these same rows; the bars add the PROPORTION. `40 / 2 / 1`
          and `15 / 14 / 14` are the same three rows and completely different situations, and the
          table makes you read three numbers to see which.

          The tone carries the coverage, so the chart answers both questions at once: how much, and
          whether anything is stopping it. An unblocked policy is amber; a blocked one is muted,
          because it is present without being the point.

          Bars and not a line, deliberately: `PolicyViolation` declares `detectedAt` and the real
          deploy DOES NOT SEND IT (`hooks/trust/trust-payloads.ts:26`). A time series here would be
          empty in production while looking correct against the mock. */}
      {coverageSettled ? (
        <Card className="mb-4">
          <Card.Body>
            <h2 className="mb-3 text-base font-semibold">Violations by policy</h2>
            {/* B-187 — o âmbar era o ÚNICO portador de "esta política não está sendo aplicada",
                e ele vivia dentro do elemento `aria-hidden` da barra. Numa tela de compliance,
                uma leitura que só existe em cor é uma leitura que não existe para quem usa leitor
                de tela ou não distingue as duas cores (WCAG 2.2 SC 1.4.1). `toneLabel` diz em
                palavras o que o tom diz em cor — e diz o que ele significa AQUI, que é algo que o
                primitivo não tem como saber. */}
            <CategoryBars
              title="Violations by policy"
              bars={coverage.map((c) => ({
                label: c.policy,
                value: c.observed,
                tone: c.enforced ? ('muted' as const) : ('warning' as const),
                toneLabel: c.enforced ? 'enforced' : 'not enforced',
              }))}
            />
          </Card.Body>
        </Card>
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
                  : 'The active guardrails still apply on the inline path.'
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
