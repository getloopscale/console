import { useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, Loader2 } from 'lucide-react';
import { Button, EmptyState, PageShell } from '@getloopscale/ui';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useProjectStatus } from '@/hooks/use-project-status';
import { useKpiReading } from '@/hooks/projects/use-kpi-metric';
import type { SignalName } from '@/hooks/projects/use-status-stream';
import { KPIStripStatus } from '@/pages/projects/components/kpi-strip-status';
import { SignalGrid } from '@/pages/projects/components/signal-grid';
import { SignalDetailSheet } from '@/pages/projects/components/signal-detail-sheet';
import { RefreshButton } from '@/pages/projects/components/refresh-button';

/**
 * ProjectStatusPage — Plan J-18 T4.1 + T4.2 (v1.1).
 *
 * Vercel-style Status page:
 *  - KPI strip (5 cards): replicas, uptime 24h, p95, error rate, RPS
 *  - SignalGrid (8 pills): + status, alerts, last deploy time → click drills down
 *  - SignalDetailSheet (right-side): 7d data + Grafana link
 *  - Refresh button: manual force-refresh per ADR D4
 *
 * T4.2 URL state: `?signal=<name>` opens drill-down sheet on the named signal.
 * Navigation away from this page clears the sheet (EC-9 absorption — useEffect
 * cleanup on route change is implicit via component unmount).
 *
 * SSE realtime: NAO assinado por esta pagina (B-051). O hook useStatusStream
 * existe e e testado, mas assinar sem consumir o retorno abria um EventSource
 * por carregamento para descartar todo evento. Os valores vem do snapshot REST
 * via useProjectStatus; a assinatura volta junto com a UI que a consome.
 */
const VALID_SIGNALS: ReadonlySet<string> = new Set([
  'status',
  'replicas',
  'uptime_24h',
  'p95_latency',
  'error_rate',
  'rps',
  'alerts_active',
  'last_deploy_time',
]);

export function ProjectStatusPage() {
  useRequireAuth();
  const { name = '' } = useParams<{ name: string }>();
  useSetPageTitle(`${name} · Status`);

  // T4.2 URL state — ?signal=replicas opens drill-down on initial mount.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSignal = searchParams.get('signal');
  const validatedInitialSignal: SignalName | null =
    initialSignal && VALID_SIGNALS.has(initialSignal) ? (initialSignal as SignalName) : null;

  const [drillDownSignal, setDrillDownSignal] = useState<SignalName | null>(validatedInitialSignal);
  const [sheetOpen, setSheetOpen] = useState<boolean>(validatedInitialSignal !== null);

  // Keep sheet state in sync with URL — closing sheet clears the param.
  useEffect(() => {
    if (!sheetOpen) {
      const next = new URLSearchParams(searchParams);
      if (next.has('signal')) {
        next.delete('signal');
        setSearchParams(next, { replace: true });
      }
    }
  }, [sheetOpen, searchParams, setSearchParams]);

  // EC-9 absorption: navigating away from this page closes sheet implicitly
  // via component unmount; no explicit cleanup needed.

  const { status, loading, error } = useProjectStatus(name);

  // B-051 — a chamada a useStatusStream foi REMOVIDA daqui, nao comentada.
  //
  // Ela existia como scaffold de consumidor, mas o retorno era descartado por
  // completo: nenhuma parte desta pagina lia `signals` ou `connected`. O efeito
  // liquido era abrir um EventSource por carregamento — consumindo uma das ~6
  // conexoes que o browser concede por dominio e mantendo um stream no servidor —
  // para jogar fora todo evento recebido. Pior: como o segundo argumento caia para
  // 'production' antes de `status` carregar, a conexao era aberta com o ambiente
  // errado e REABERTA quando o snapshot chegava.
  //
  // O hook continua existindo e testado (src/hooks/use-status-stream.ts). Quando a
  // SignalGrid consumir realtime, reintroduza a chamada JA lendo o retorno e
  // apenas com `status?.environment` definido:
  //
  //   const { signals, connected } = useStatusStream(name, status?.environment);
  //
  // Assinar um stream para descartar o resultado nao e um scaffold — e custo sem
  // contrapartida, invisivel justamente porque nada quebra.

  // J-18 — current KPI values from the metrics_proxy (last point of a 1h range).
  // Called unconditionally at the top (rules of hooks); the env resolves to
  // status.environment once loaded (undefined → 'production' default in the hook).
  // Unit conversions match the SignalGrid formatters: uptime avg_over_time
  // (0..1) → % (×100); p95 histogram_quantile (seconds) → ms (×1000); error_rate
  // is already a % (loopscale#170 fix → ratio ×100) so ×1; rps passes through. These
  // render "—" honestly until a Prometheus backend is reachable.
  const uptime24hKpi = useKpiReading(name, 'uptime_24h', 100);
  const p95LatencyKpi = useKpiReading(name, 'p95_latency', 1000);
  const errorRateKpi = useKpiReading(name, 'error_rate', 1);
  const rpsKpi = useKpiReading(name, 'rps', 1);
  // Ready replicas from the metrics signal, until the status response carries replicas_ready
  // (getloopscale/loop-runtime#116). The status value wins when present.
  const replicasReadyKpi = useKpiReading(name, 'replicas_ready', 1);

  const handleDrillDown = (signal: SignalName) => {
    setDrillDownSignal(signal);
    setSheetOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set('signal', signal);
    setSearchParams(next, { replace: true });
  };

  const handleSheetOpenChange = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setDrillDownSignal(null);
    }
  };

  if (loading) {
    return (
      <PageShell title="Status">
        <div className="flex items-center justify-center py-12">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-label="Loading status"
          />
        </div>
      </PageShell>
    );
  }

  if (error || !status) {
    return (
      <PageShell title="Status unavailable">
        <EmptyState
          icon={Activity}
          title="Couldn't load project status"
          description="Status will recover when the project is reachable. Auto-refresh continues every 5s."
        />
      </PageShell>
    );
  }

  // Red Team loop-console#98 closure: a preview-only project (no last_build
  // and no active_release in the queried env) used to default to
  // "Progressing" with a perpetual 5s auto-refresh. Both signals were
  // dishonest — there was nothing to refresh into existence, and the
  // status was decidedly NOT "Progressing". When the engine surfaces
  // `other_envs_with_releases` (per the #70/#62 closure), render an
  // honest empty state pointing the user at the sibling env's release
  // page; skip the auto-refresh subtitle entirely.
  const isPreviewOnly =
    !status.last_build &&
    !status.active_release &&
    Array.isArray(status.other_envs_with_releases) &&
    status.other_envs_with_releases.length > 0;

  if (isPreviewOnly) {
    const sibling = status.other_envs_with_releases![0];
    return (
      <PageShell title="Status">
        <div className="mb-4">
          <Button asChild variant="ghost" size="sm">
            <Link
              to={`/projects/${encodeURIComponent(name)}`}
              className="inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span>Back to project</span>
            </Link>
          </Button>
        </div>
        <EmptyState
          icon={Activity}
          title="No production deployment yet"
          description={`Preview deploys only — promote a release to production to see status here. The latest preview release is on the ${sibling.environment} environment.`}
        />
      </PageShell>
    );
  }

  const env = status.environment ?? 'production';

  // Derive KPI values from status snapshot. When T1.3 SSE wires up, these come
  // from useStatusStream signals[]. For now: scaling fields + null for KPIs
  // that need Prometheus (uptime, p95, error_rate, rps) — UI renders "—" honest.
  // Ready replicas, not the configured count: `scaling.replicas` is what was asked for (#553).
  const replicas =
    typeof status.replicas_ready === 'number' ? status.replicas_ready : replicasReadyKpi.value;
  // J-18 — wired to the metrics_proxy (derived above, before the early returns
  // per rules of hooks). Null until Prometheus is reachable → UI renders "—".
  const uptime24h = uptime24hKpi.value;
  const p95LatencyMs = p95LatencyKpi.value;
  const errorRate = errorRateKpi.value;
  const rps = rpsKpi.value;
  const collecting = {
    replicas: replicas === null && replicasReadyKpi.collecting,
    uptime24h: uptime24hKpi.collecting,
    p95LatencyMs: p95LatencyKpi.collecting,
    errorRate: errorRateKpi.collecting,
    rps: rpsKpi.collecting,
  };

  // Red Team loop-console#124 — health-truth fix.
  // Pre-fix: `Healthy` was emitted from active_release.status === 'ACTIVE'
  // ALONE — control-plane SYNC confirmation by ArgoCD. But `synced ≠ serving`.
  // LIVE repro (2026-06-30): build SUCCEEDED + release ACTIVE + sync synced +
  // URL populated, while the Live URL served HTTP 502 sustained ~13min. The
  // UI lied "Status: Healthy" while the data plane was down.
  // Post-fix (family #41/#77/#94): the verdict requires release-active AND
  // at least one data-plane signal. When release is ACTIVE but every serving
  // signal is absent (no replicas_ready, no scaling.replicas, no Prometheus
  // KPI yet wired), emit `Unknown` — the platform must not assert health it
  // cannot prove. Mirrors the empty-state pattern in ProjectHealthCard.
  const replicasReady = replicas;
  const hasServingSignal =
    (replicasReady !== null && replicasReady !== undefined && replicasReady > 0) ||
    uptime24h !== null ||
    p95LatencyMs !== null ||
    errorRate !== null ||
    rps !== null ||
    (status.traffic_5xx_pct_1h !== undefined) ||
    (status.alerts_active !== undefined);
  const releaseActive = status.active_release?.status === 'ACTIVE';

  // 8 signals for the grid — same null pattern.
  const signals = {
    status: releaseActive ? (hasServingSignal ? 'Healthy' : 'Unknown') : 'Progressing',
    replicas,
    uptime_24h: uptime24h,
    p95_latency: p95LatencyMs,
    error_rate: errorRate,
    rps,
    // M15 T2: bind the real alerts_active from the status wire (was hardcoded null).
    alerts_active: (status.alerts_active ?? null) as number | null,
    // When traffic last switched. A rollback serves an old release again, and its
    // creation time is not the moment of the deploy.
    last_deploy_time: status.last_deploy_at ?? status.active_release?.created_at ?? null,
  };

  // Backend T1.1: status response now has `metrics_range_url` populated when
  // operator set LOOPSCALE_GRAFANA_BASE_URL. We pass it to the drill-down sheet so
  // the "Open in Grafana" link is enabled honest.
  const grafanaBaseURL: string | null =
    typeof status.metrics_range_url === 'string' && status.metrics_range_url !== ''
      ? new URL(status.metrics_range_url).origin
      : null;

  return (
    <PageShell title="Status" description="Auto-refresh every 5s.">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/projects/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back to project</span>
          </Link>
        </Button>
        <RefreshButton
          isFetching={loading}
          onRefresh={() => {
            // useQuery refetch — exposed via useProjectStatus future enhancement.
            // For now, parent setSearchParams triggers re-render which TanStack
            // honors via staleTime.
            setSearchParams(new URLSearchParams(searchParams), { replace: true });
          }}
        />
      </div>

      <div className="space-y-6">
        <section aria-label="KPI strip">
          <KPIStripStatus
            replicas={replicas}
            uptime24h={uptime24h}
            p95LatencyMs={p95LatencyMs}
            errorRate={errorRate}
            rps={rps}
            collecting={collecting}
          />
        </section>

        <section aria-label="Signal grid">
          <SignalGrid signals={signals} onDrillDown={handleDrillDown} />
        </section>
      </div>

      <SignalDetailSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        signal={drillDownSignal}
        projectName={name}
        env={env}
        grafanaBaseURL={grafanaBaseURL}
      />
    </PageShell>
  );
}
