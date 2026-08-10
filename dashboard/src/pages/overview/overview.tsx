import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  FolderKanban,
  Globe,
  Loader2,
  Plus,
  Rocket,
  Users,
} from 'lucide-react';
import {
  Card,
  EmptyState,
  PageShell,
  ProjectCard,
} from '@usetheo/ui';
import { UsageMeter } from '@theokit/ui';
import { ContentGrid } from '@/components/layout';
import { OverviewKPIStrip } from '@/pages/overview/components/overview-kpi-strip';
import { DeploysActivity } from '@/pages/overview/components/deploys-activity';
import { CapabilityGrid } from '@/pages/overview/capability-grid';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useProjects } from '@/hooks/projects/use-projects';
import { useBuildStats } from '@/hooks/overview/use-build-stats';
import { useCloudApi } from '@/hooks/use-api';
import { formatDate, formatNumber, isZeroTime } from '@/lib/formatting/format';

interface UsageMetricShape {
  used: number;
  limit: number | null;
}

interface BillingResponse {
  plan: string;
  team: string;
  usage: Record<string, UsageMetricShape>;
  period_start?: string;
  period_end?: string;
}

/**
 * OverviewPage — mockup-aligned literal implementation per
 * cloud/dashboard/design/theo_overview_dashboard_mockup.html (Pattern D-1
 * of plan v1.2). 2-asymmetric grid (1.2fr:1fr) with Usage + Alerts on
 * left, Projects + Recent Previews on right.
 *
 * Usage data sourced from /v1/billing (BillingResponse.usage map) per T-A.2
 * of plan v1.1. Per ADR-D1.bis: limit:null renders "Unlimited" (Enterprise
 * tier). Per EC-6: used>limit renders actual numeric (over-quota visual).
 */
export function OverviewPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  const navigate = useNavigate();
  const { projects, loading } = useProjects();
  const { data: billing } = useCloudApi<BillingResponse>('/v1/billing');
  const deployStats = useBuildStats('7d');
  const usage = billing?.usage ?? {};
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Pull metric (used, limit) from billing.usage with fallback for null billing.
  // EC: /v1/billing null → defaults to 0/limit per acceptance criteria.
  // EC-5: limit may be null (Enterprise unlimited) — propagate as-is.
  function pickMetric(key: string, defaultLimit: number): { value: number; max: number | null } {
    const m = usage[key];
    if (!m) return { value: 0, max: defaultLimit };
    return { value: m.used, max: m.limit };
  }

  // Formatter for UsageMeter metric row's value/max text.
  // Per ADR-D1.bis: limit===null renders "{used} / Unlimited".
  // UsageMeter primitive natively handles over-quota (value>max → text-warning + warning intent).
  // Uses formatNumber() from lib/format.ts per T-C.2 migration (en-US locale per ADR-D1).
  function fmtMetric(value: number, max: number | null): string {
    if (max === null) return `${formatNumber(value, 'grouped')} / Unlimited`;
    return `${formatNumber(value, 'grouped')} / ${formatNumber(max, 'grouped')}`;
  }

  // T-P0: bind to the REAL /v1/billing.usage keys (billing.go getLimitsForPlan /
  // getUsageForTenant), NOT the Vercel-mockup vocabulary that never populated.
  // Fallback limits mirror the starter-plan defaults so a null billing response
  // still renders honest caps (projects 2, builds 100, environments 1, seats 1).
  // secrets_per_env / services_per_project are per-scope caps (not account totals)
  // and are intentionally omitted here (ADR-3).
  const projectsMetric = pickMetric('projects', 2);
  const buildsMetric = pickMetric('builds_per_month', 100);
  const envsMetric = pickMetric('environments', 1);
  const seatsMetric = pickMetric('seats', 1);

  return (
    <PageShell
      title="Overview"
      onTitleChange={setPageTitle}
      search={{
        placeholder: 'Search projects...',
        value: searchQuery,
        onChange: setSearchQuery,
      }}
      primaryAction={{
        label: 'Add New',
        icon: Plus,
        onClick: () => navigate('/projects'),
      }}
    >
      {/* J-06 T3.1: the KPI strip is the authenticated home's at-a-glance row. */}
      <div className="mb-6">
        <OverviewKPIStrip />
      </div>
      {/* B-112 — a Overview é da PLATAFORMA, e esta seção é o que faz dela isso.
          Antes daqui a tela consumia `useProjects`, `useBuildStats` e billing, e as OITO
          capacidades que o menu declara não apareciam nela: quem chegava concluía, da tela
          inicial, que o produto é um PaaS de deploy. Fica ACIMA do grid de duas colunas de
          propósito — o que a plataforma oferece vem antes do detalhe de um subsistema dela. */}
      <section className="mb-6">
        <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
          Platform
        </h2>
        <CapabilityGrid />
      </section>
      <ContentGrid columns="2-asymmetric" gap={6}>
        {/* Left column — Usage + Alerts */}
        <div className="space-y-6">
          <section>
            <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
              Usage
            </h2>
            {/* T-DR-2.5 v1.2 (closes V-8 from Vercel benchmark): max-h
                + overflow-y-auto acomoda 5+ KPIs sem inflar página.
                Vercel pattern: panel scrolls internally rather than
                forcing page growth. */}
            <div className="max-h-[400px] overflow-y-auto">
              <UsageMeter
                title="This billing period"
                action={
                  <Link
                    to="/billing"
                    className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Upgrade
                  </Link>
                }
                metrics={[
                {
                  label: 'Projects',
                  value: projectsMetric.value,
                  max: projectsMetric.max ?? Number.MAX_SAFE_INTEGER,
                  unit: '',
                  formatter: (v) => fmtMetric(v, projectsMetric.max),
                },
                {
                  label: 'Builds this month',
                  value: buildsMetric.value,
                  max: buildsMetric.max ?? Number.MAX_SAFE_INTEGER,
                  unit: '',
                  formatter: (v) => fmtMetric(v, buildsMetric.max),
                },
                {
                  label: 'Environments',
                  value: envsMetric.value,
                  max: envsMetric.max ?? Number.MAX_SAFE_INTEGER,
                  unit: '',
                  formatter: (v) => fmtMetric(v, envsMetric.max),
                },
                {
                  label: 'Seats',
                  value: seatsMetric.value,
                  max: seatsMetric.max ?? Number.MAX_SAFE_INTEGER,
                  unit: '',
                  formatter: (v) => fmtMetric(v, seatsMetric.max),
                },
              ]}
              />
            </div>
          </section>

          {/* T-P1: deploy activity — the "what happened recently" view, from the
              real /api/v1/builds/stats 7-day series (useBuildStats). Pairs with the
              "Deploys (7d)" KPI: the KPI is the count, these bars are the distribution. */}
          <section>
            <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
              Deploy activity
            </h2>
            <DeploysActivity byDay={deployStats.byDay} loading={deployStats.loading} error={deployStats.error} />
          </section>
        </div>

        {/* Right column — Projects + Recent Previews */}
        <div className="space-y-6">
          <section>
            <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
              Projects
            </h2>
            {loading ? (
              <Card>
                <Card.Body className="py-8 text-center">
                  <Loader2
                    className="mx-auto size-5 text-muted-foreground animate-spin"
                    aria-label="Loading projects"
                  />
                </Card.Body>
              </Card>
            ) : filteredProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title={searchQuery ? 'No matching projects' : 'Deploy your first project'}
                description={
                  searchQuery ? (
                    <>Try a different search term.</>
                  ) : (
                    <>
                      Run{' '}
                      <code className="bg-muted px-2 py-0.5 rounded font-mono">
                        theo project create my-app
                      </code>{' '}
                      in your terminal to connect a repo and ship.
                    </>
                  )
                }
              />
            ) : (
              <div className="space-y-3">
                {filteredProjects.slice(0, 3).map((p) => (
                  <ProjectCard
                    key={p.name}
                    project={{
                      id: p.name,
                      name: p.name,
                      // #120 (qa-dogfood-cleanup-2026-06-21 T4.1 / ADR-Q3):
                      // hardcoded 'main' is the legacy placeholder until
                      // the wire payload exposes `deploy_branch` for the
                      // listing. Until then, render 'main' as a sensible
                      // default WITH a follow-up note: the Repository
                      // panel surfaces the canonical deploy branch with
                      // an explicit "Deploy branch (Theo)" label per the
                      // same ADR. Tracked by #120 follow-up — wire-side
                      // exposure of connection.branch on the projects
                      // summary is additive and non-breaking.
                      branch: 'main',
                      commitSha: '',
                      // Release-aware status (#119, qa-dogfood-cleanup-2026-06-21
                      // T3.2 / ADR-Q2): backend already maps the aggregate
                      // status via pkg/enforcement.MapProjectStatus, exposed
                      // as `last_deploy_status` enum ('live'|'building'|
                      // 'failed'|'idle'|'queued'). Consume it directly rather
                      // than deriving from `last_deploy ? 'live' : 'queued'`
                      // which contradicts the hero/list state when releases
                      // are absent. Fallback 'queued' preserves prior shape
                      // when older backends omit the field.
                      // Map backend ProjectStatus to UI DeploymentStatus enum
                      // @usetheo/ui@0.13.1 / @theokit/ui@0.18.0 added
                      // 'idle' to DeploymentStatus — projects that have
                      // never deployed now render with a neutral gray
                      // badge + "Idle" label (vs the prior stopgap that
                      // collapsed 'idle' to 'cancelled'). Distinguishes
                      // from amber-pulsing 'queued' (deploy in progress).
                      // Closes #119 canonical end-to-end (qa-dogfood-
                      // cleanup-2026-06-21).
                      status: (p.last_deploy_status ?? 'idle') as
                        | 'queued'
                        | 'building'
                        | 'live'
                        | 'failed'
                        | 'cancelled'
                        | 'idle',
                      // Zero-time guard (#118 T3.1): backend now serializes
                      // *time.Time omitempty so absent → undefined here;
                      // isZeroTime catches legacy zero-literal regress.
                      // Red Team theo-cloud#53/#76 closure: previously we
                      // forwarded the raw RFC3339Nano ISO string and let
                      // ProjectCard render it verbatim — producing the
                      // "2026-06-26T14:16:43.712767Z" leak the Red Team
                      // caught. We now humanize via the same canonical
                      // `formatDate(..., 'relative')` helper the /projects
                      // list uses on line 126, so both views render
                      // identical "32 minutes ago"-style copy. Empty
                      // string still routes ProjectCard's internal
                      // null-guard to "Never deployed".
                      lastDeployedAt:
                        !p.last_deploy || isZeroTime(p.last_deploy)
                          ? ''
                          : formatDate(p.last_deploy, 'relative'),
                      framework: p.apps?.[0]?.framework,
                    }}
                    href={`/projects/${p.name}`}
                  />
                ))}
                {/* T-P2: the preview shows the first 3; link to the full list
                    when there are more, carrying the real count. */}
                {filteredProjects.length > 3 ? (
                  <Link
                    to="/projects"
                    className="flex items-center justify-center gap-1.5 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    View all {filteredProjects.length} projects
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            )}
          </section>

          {/* Quick actions — UI-only nav aids (replaces removed Recent Previews
              section v1.2 T0.7 fold). Reduz a sensação de "anêmico" do Overview
              sem inventar dados. Cada action é navegação real para surface
              existente; nenhuma depende de backend novo. */}
          <section>
            <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
              Quick actions
            </h2>
            <Card>
              <ul className="divide-y divide-border">
                <li>
                  <button
                    type="button"
                    onClick={() => navigate('/projects')}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <Rocket className="size-4 text-primary" aria-hidden="true" />
                      <span className="font-medium text-foreground">Deploy a project</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigate('/team')}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <Users className="size-4 text-primary" aria-hidden="true" />
                      <span className="font-medium text-foreground">Invite teammates</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigate('/domains')}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <Globe className="size-4 text-primary" aria-hidden="true" />
                      <span className="font-medium text-foreground">Add a custom domain</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            </Card>
          </section>
        </div>
      </ContentGrid>
    </PageShell>
  );
}
