import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExploreCard } from '@/components/explore-card';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Brain, Code2, Database, FlaskConical, RefreshCw, Settings as SettingsIcon, Share2, Sparkles, Zap } from 'lucide-react';
import { Button, Card, MetricCard, PageShell, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { CategoryBars } from '@/components/charts/category-bars';
import { ContentGrid } from '@/components/layout';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';

/**
 * @overview-answers: kpi
 *
 * B-126, decisão D1 de `capability-overviews-answer-a-question-plan.md` — a forma segue a existência de uma REGRA, não a maioria.
 *
 * Volume: memórias, entidades, escritas. `1.284 memórias` não é bom nem ruim, e transformá-lo
 * numa frase de julgamento seria inventar um critério que ninguém definiu.
 *
 * O marcador é lido por `lib/capability-overview.test.ts`, que reprova a tela que não
 * declarar nenhuma forma — foi assim que `skills` ficou mudo entre sete telas.
 */

/**
 * Plan 1 of dashboard-memory-section-roadmap.md, T1.6.
 *
 * /memory landing page — the first customer-visible Memory surface. Renders
 * 4 KPIs from GET /v1/dashboard/memory/metrics + 2 trend charts + a Refresh button.
 *
 * Per ADR D3 of the plan: empty pgvector returns 0 from every numeric field
 * (never null, never NaN). This page renders that 0 cleanly via MetricCard —
 * the first-time user sees four "0" cards explaining what's coming, not
 * broken NaN tiles.
 *
 * Trend chart points are derived from the backend metrics for now (one
 * data point per refresh; multi-day trend wired by P2 once we have a
 * usage-aggregator background job).
 */

interface MemoryMetrics {
  total_memories: number;
  retrieval_api_usage: number;
  add_events: number;
  entity_count: number;
}

export function MemoryPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Memory'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const metricsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/metrics'] as const,
    // dashboard-memory-error-surfacing T1.3 (decisão D2 do plano): opt into throwOnError so a
    // backend non-2xx routes to `isError` (showing the error Alert) instead of
    // resolving to null + masking the outage as fabricated zeros.
    queryFn: () => cloudFetch<MemoryMetrics>('/v1/dashboard/memory/metrics', {}, { throwOnError: true }),
  });

  // A successful-but-empty 2xx (null body edge) falls back to zeros so the
  // dashboard never renders NaN. On ERROR the KPI strip is NOT rendered (decisão D2 do plano),
  // so these zeros are never used to mask an outage.
  const metrics: MemoryMetrics = metricsQuery.data ?? {
    total_memories: 0,
    retrieval_api_usage: 0,
    add_events: 0,
    entity_count: 0,
  };

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/memory/metrics'] });
  };

  // UX pass 2026-07-22: the previous TokenUsageChart pair plotted MEMORY counts
  // under the chart's baked-in "Input tokens / Output tokens" copy — semantically
  // wrong labels (Rule 3). Until the P2 usage aggregator ships multi-day series,
  // the honest composition is a correctly-labeled proportional summary (below),
  // not a one-point pseudo-trend with token axis copy.

  return (
    <PageShell
      title="Memory"
      description="Your agent's persistent memory — what it knows, who it remembers, and how often."
      primaryAction={{
        label: 'Refresh',
        icon: RefreshCw,
        onClick: onRefresh,
        loading: metricsQuery.isFetching,
      }}
    >
      {/* PageShell wraps its content children in a single gap-less <div>, so
          multi-section pages MUST provide their own vertical rhythm with a
          space-y wrapper — the canonical pattern from overview.tsx +
          project-detail.tsx. Without it the sections render flush. */}
      <div className="space-y-6">
        {metricsQuery.isError ? (
          <Alert intent="warning" title="Could not load memory metrics">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : null}

        {/* Loading state (ADR D2, /review F-fe-1/F-fe-2): while the query is
            pending — including the retry window before isError settles — show a
            skeleton, NEVER the `data ?? zeros` fallback. Gating the strip on a
            settled success is what guarantees fabricated 0/0/0/0 can never paint
            over an outage OR a slow load. */}
        {metricsQuery.isPending ? (
          <div
            data-testid="memory-metrics-loading"
            role="status"
            aria-label="Loading memory metrics"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        {/* KPI strip + trends render ONLY on a settled success (ADR D2: never
            substitute fabricated zeros for an outage or a pending load — the
            error Alert / skeleton above are the honest states). ContentGrid only
            supports up-to-3 columns, so the KPI strip uses a direct Tailwind grid. */}
        {metricsQuery.isSuccess ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Total memories" value={metrics.total_memories} icon={<Brain className="h-4 w-4" aria-hidden="true" />} />
              <MetricCard title="Retrieval API calls" value={metrics.retrieval_api_usage} icon={<Zap className="h-4 w-4" aria-hidden="true" />} />
              <MetricCard title="Add events" value={metrics.add_events} icon={<Sparkles className="h-4 w-4" aria-hidden="true" />} />
              <MetricCard title="Distinct entities" value={metrics.entity_count} icon={<Database className="h-4 w-4" aria-hidden="true" />} />
            </div>

            <ContentGrid columns="2-equal">
              <Card>
                <Card.Body className="space-y-4">
                  <h3 className="text-sm font-semibold">Activity today</h3>
                  <CategoryBars
                    title="Activity today"
                    valueFormatter={(v) => v.toLocaleString()}
                    bars={[
                      { label: 'Memories written', value: metrics.add_events },
                      { label: 'Memories retrieved', value: metrics.retrieval_api_usage },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    Writes vs reads since the last reset. Multi-day trends arrive with the
                    usage aggregator.
                  </p>
                </Card.Body>
              </Card>
              <Card>
                <Card.Body className="space-y-4">
                  <h3 className="text-sm font-semibold">Graph coverage</h3>
                  <CategoryBars
                    title="Graph coverage"
                    valueFormatter={(v) => v.toLocaleString()}
                    bars={[
                      { label: 'Memories stored', value: metrics.total_memories },
                      { label: 'Entities extracted', value: metrics.entity_count },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {metrics.total_memories > 0
                      ? `≈ ${(metrics.entity_count / metrics.total_memories).toFixed(2)} entities per memory in the knowledge graph.`
                      : 'Entities appear here as your agent stores memories.'}
                  </p>
                </Card.Body>
              </Card>
            </ContentGrid>
          </>
        ) : null}

        <Card>
          <Card.Body className="space-y-2">
            <h2 className="text-base font-semibold">Getting started</h2>
            <p className="text-sm text-muted-foreground">
              Use the SDK to remember facts from your agent. Anything you write
              here is queryable via <code>theo.memory.user(&apos;u&apos;).recall()</code>.
            </p>
            <Button asChild variant="ghost" >
              <Link to="/memory/memories">Browse memories →</Link>
            </Button>
          </Card.Body>
        </Card>

        {/* Plan 2 of dashboard-memory-section-roadmap.md, T2.4 — Explore grid. */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Explore</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ExploreCard
              icon={SettingsIcon}
              title="Customize"
              description="Tune memory categories and lifecycle rules."
              href="/settings"
            />
            <ExploreCard
              icon={Code2}
              title="Integration examples"
              description="Drop-in SDK snippets for your stack."
              href="/api-keys"
            />
            <ExploreCard
              icon={FlaskConical}
              title="Try Playground"
              description="Remember and recall live, no code required."
              href="/memory/playground"
            />
            <ExploreCard
              icon={Code2}
              title="Browse Skills"
              description="See the executable skills your agent has learned, per repo."
              href="/memory/skills"
            />
            <ExploreCard
              icon={Share2}
              title="View Graph"
              description="See how the entities your agent remembers relate to each other."
              href="/memory/graph"
            />
            <ExploreCard
              icon={BookOpen}
              title="Documentation"
              description="Read the architecture + every endpoint."
              href="https://docs.usetheo.dev/"
            />
          </div>
        </section>
      </div>
    </PageShell>
  );
}

/* B-129 — o `ActivityBar` local saiu daqui: ele fazia o mesmo que `CategoryBars`, e com um
   defeito próprio. O piso `Math.max(2, …)` desenhava uma barra de 2% para um valor 0, ou seja
   "quase nada" onde a verdade é "nada" — e num workspace novo, onde TODOS os números são zero,
   isso era o gráfico inteiro mentindo baixinho.

   Duas implementações de "barra proporcional" no mesmo dashboard também eram conhecimento
   duplicado: a escala é a mesma regra escrita duas vezes, e só uma delas tinha teste. */

