import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { ArrowLeft, CheckCircle2, Play, RefreshCw } from 'lucide-react';
import { Button, Card, PageShell, Table } from '@usetheo/ui';
import { estadoDaLista } from '@/lib/list-state';
import { noDeploysYet } from '@/pages/deploy/empty-states';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useDeploymentsListStream } from '@/hooks/deploy/use-deployments-list-stream';
import { useProjectStatus } from '@/hooks/use-project-status';
import { useMutationInFlight } from '@/hooks/deploy/use-mutation-in-flight';
import { useBuildEnvs } from '@/hooks/deploy/use-build-envs';
import { RedeployDialog } from '@/components/dialogs/redeploy-dialog';
import { useRollbacks } from '@/hooks/deploy/use-rollbacks';
import { DeploymentRow } from '@/pages/deploy/components/deployment-row';
import { RollbackRow } from '@/pages/deploy/components/rollback-row';
import { deploymentEntries } from '@/pages/deploy/deployment-entries';
import { formatDate } from '@/lib/formatting/format';
import { type Build, type BuildStatus } from '@/lib/api/types';
import { buildOutcome } from '@/pages/deploy/build-outcome';



const STATUS_FILTERS: { value: 'all' | BuildStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'running', label: 'Running' },
  { value: 'failed', label: 'Failed' },
];

// Plan J-17 T4.2 — env filter chips. The backend already accepts ?env=
// (see api/internal/routes/build_list.go:69), no schema change. The
// chip set covers the canonical envs every project has; arbitrary
// custom envs (per-PR previews, per-journey test envs) are still
// reachable via direct URL editing (?env=foo) — the URL state is the
// source of truth, the chips are just shortcuts.
//
// Branch filter intentionally deferred — the builds table doesn't carry
// a branch column yet (only commit_sha), so a `?branch=` predicate
// would need: (a) a schema migration with backfill, (b) wiring through
// the auto-deploy webhook + CLI deploy, (c) a sqlc query change. That
// is a T2 governance change in its own right; this iteration ships
// env-only and documents the gap.
//
// T4.3 finding 3.2 + ADR D3: env filter chips are no longer hardcoded.
// useBuildEnvs(projectName) fetches the distinct envs the project has
// built into; the page builds the chip set dynamically (with a fallback
// to the safe defaults below when the hook is still loading OR returns
// empty for a cold project).
const ENV_FILTERS_FALLBACK: { value: string; label: string }[] = [
  { value: 'all', label: 'All envs' },
  { value: 'production', label: 'Production' },
  { value: 'staging', label: 'Staging' },
  { value: 'preview', label: 'Preview' },
];

function envChipLabel(env: string): string {
  if (env === 'all') return 'All envs';
  return env.charAt(0).toUpperCase() + env.slice(1);
}


/**
 * DeploymentsPage — Plan v1.0 T1.1.
 *
 * Lists builds for the project from URL param `:name`. Pattern matches
 * /environments (PageShell + Card + Table). Click a row → drill into
 * /projects/:name/deployments/:id (T1.2).
 */
export function DeploymentsPage() {
  useRequireAuth();
  const { name = '' } = useParams<{ name: string }>();
  useSetPageTitle(name ? `${name} · Deployments` : 'Deployments');
  // T2.3 + EC-05 wire: status filter lives in URL (bookmarkable, browser
  // back/forward works). Filter value flows into useDeployments → queryKey
  // → new cache miss → automatic refetch. NÃO filtra client-side.
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringEnum<'all' | BuildStatus>([
      'all',
      'succeeded',
      'running',
      'queued',
      'failed',
      'cancelled',
      'cancelling',
    ]).withDefault('all'),
  );
  // T4.2: env filter persisted in URL. Free-form string (not enum) so
  // `?env=staging-eu-1` style custom envs work via direct URL even if
  // they don't have a chip. `all` is the sentinel for "no filter".
  const [envFilter, setEnvFilter] = useQueryState(
    'env',
    parseAsString.withDefault('all'),
  );
  // T4.1: realtime SSE stream replaces interval polling. The hook keeps
  // the same shape ({builds, loading}) so the render below is unchanged.
  // New builds + status transitions arrive over SSE; the snapshot REST
  // call only fires on mount + on unknown-build-id invalidations + on
  // explicit refetch (sponsor Refresh button).
  //
  // 2026-06-06 polish: pagination. Backend caps a single request at
  // limit=50; "Load more" bumps the page state by 20 so the next REST
  // fetch returns up to that count. We do NOT migrate to useInfiniteQuery
  // for this iteration — sponsor scope is a polish, not a refactor.
  // Tradeoff: PG OFFSET degrades past ~10k rows, so when real-world
  // tenants approach that scale we can migrate to cursor-based without
  // touching the page (the queryKey already includes limit).
  const PAGE_BUMP = 20;
  const [pageLimit, setPageLimit] = useState<number>(PAGE_BUMP);
  // T6.1: deploy dialog open state. The dialog is the existing
  // RedeployDialog (Plan T6.4) re-used here as the "Deploy" primary
  // action — semantically identical (clone the currently active
  // build's commit + env, submit a fresh build) and avoids a parallel
  // deploy flow we'd have to test separately.
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  // B-167 — `error` já vinha do hook e era descartado aqui.
  // B-177 — `filters` era um literal inline, logo um objeto NOVO a cada render, e o efeito de
  // `useDeploymentsListStream` o tem nas dependências: ele re-executava a cada render. O custo
  // medido é overhead de re-execução, não uma tempestade de refetch (`refetchedFor` suprime a
  // invalidação) — mas um efeito que roda por identidade e não por valor é uma armadilha para
  // quem acrescentar a próxima linha dentro dele.
  const filtros = useMemo(
    () => ({
      ...(statusFilter === 'all' ? {} : { status: statusFilter }),
      ...(envFilter === 'all' ? {} : { env: envFilter }),
      limit: pageLimit,
    }),
    [statusFilter, envFilter, pageLimit],
  );
  const { builds, total, loading, fetching, refetch, error: readError } = useDeploymentsListStream(
    name,
    filtros,
  );

  // Pull the production status so the table can mark which build is
  // currently serving traffic + the page header can summarize at a glance
  // (LIVE bug 2026-06-06: sponsor reported the table had no ordering
  // signal nor "which one is live" indicator).
  //
  // SHA derivation: prefer the active_release.git_commit (the release
  // currently SERVING production) over last_build.commit_sha (the most
  // recent build, regardless of status). They diverge while a new build
  // is RUNNING — the banner would otherwise lie that the in-flight commit
  // is already serving traffic.
  const { status: prodStatus } = useProjectStatus(name);
  // Red Team theo-cloud#121 (P0 eixo 2 — UI honesty): pre-fix `isActive`
  // compared the global production active_release.build_id against
  // every row regardless of the row's env. When production's active
  // release was PROMOTED from a preview build, both env_targets carry
  // the SAME build_id (promote copies the build reference; per
  // promotion_orchestrator.go:155-165 the new release row points at
  // the source build), so the preview row matched and incorrectly got
  // the production ACTIVE badge + Live URL → production. The row
  // labeled [PRODUCTION] (an older superseded build) got nothing.
  //
  // Fix: fetch each env's status independently and key the per-row
  // active marker + Live URL by the ROW's own environment. A row is
  // "active" when ITS env's active_release.build_id matches the row's
  // build_id. Live URL on a row reflects THAT env's URL.
  const { status: previewStatus } = useProjectStatus(name, { env: 'preview' });
  // Sponsor 2026-06-18 — honest progress badge during the ~90s sync gap
  // between submit and DB flip. The dialog publishes the target row id;
  // we suppress the canonical "● Active" badge on it and render a
  // pulsing transitional badge instead, until the DB flips and the
  // mutation-in-flight store clears. The label depends on the kind
  // discriminator ("Rolling back…" / "Promoting…" / "Redeploying…")
  // so a single subscription serves every long-running mutation —
  // rollback was the first; promote was added in the FAANG PRD ship
  // of the same day (sponsor caught the missing badge LIVE).
  const mutationInFlight = useMutationInFlight(name);
  const activeBuildId = prodStatus?.active_release?.build_id;
  // Per-env active build_id map for #121 fix. The dashboard treats env
  // as the row identity for "active" — only production-style envs we
  // know about ship explicit status calls; other env names fall back
  // to the no-match path (no badge / no URL), which is honest.
  const activeBuildIdByEnv: Record<string, string | undefined> = {
    production: prodStatus?.active_release?.build_id,
    preview: previewStatus?.active_release?.build_id,
  };
  const urlByEnv: Record<string, string | undefined> = {
    production: prodStatus?.url,
    preview: previewStatus?.url,
  };

  // T4.3 finding 3.2 + ADR D3: dynamic env filter chip set sourced
  // from the build-envs endpoint. While loading OR for cold projects
  // returning empty, fall back to the safe defaults so the chip group
  // is never empty (UX honest — at minimum "All envs" is reachable).
  const { envs: knownEnvs } = useBuildEnvs(name);
  const envFilterOptions = useMemo(() => {
    if (knownEnvs.length === 0) return ENV_FILTERS_FALLBACK;
    return [
      { value: 'all', label: 'All envs' },
      ...knownEnvs.map((env) => ({ value: env, label: envChipLabel(env) })),
    ];
  }, [knownEnvs]);
  // T6.1: resolve the Build object for the active release so the
  // Deploy primary action can hand it to RedeployDialog. If the
  // active build is outside the current page (rare — would mean
  // production is serving something older than the last 20 deploys),
  // fall back to the most recent build in view. Deploy button is
  // disabled outright when we have no build at all (cold project).
  const activeBuild = useMemo(
    () => builds.find((b) => b.build_id === activeBuildId) ?? builds[0],
    [builds, activeBuildId],
  );
  const activeSha = (
    prodStatus?.active_release?.git_commit ??
    prodStatus?.last_build?.commit_sha
  )?.slice(0, 7);
  // Prefer the release activation time (when traffic switched) over the
  // build finished_at (which only times the build pipeline, not the
  // release sync).
  const activeFinishedAt =
    prodStatus?.active_release?.created_at ?? prodStatus?.last_build?.finished_at;

  // Server already filtered (when status / env != all) — client filter
  // mantém como fallback safety net se server ignorar query param.
  // A build whose deploy failed is filtered as failed (build-outcome.ts).
  const filtered = useMemo<Build[]>(() => {
    let out = builds;
    if (statusFilter !== 'all') {
      out = out.filter((b) => buildOutcome(b) === statusFilter);
    }
    if (envFilter !== 'all') {
      out = out.filter((b) => b.environment === envFilter);
    }
    return out;
  }, [builds, statusFilter, envFilter]);
  // A rollback is a row of its own, where it happened among the builds.
  const { rollbacks } = useRollbacks(name);
  const entries = useMemo(
    () =>
      deploymentEntries(filtered, rollbacks, {
        status: statusFilter,
        env: envFilter,
        moreBuildsOnServer: builds.length < total,
      }),
    [filtered, rollbacks, statusFilter, envFilter, builds.length, total],
  );
  const commitByBuild = useMemo(
    () => new Map(builds.map((b) => [b.build_id, b.commit_sha])),
    [builds],
  );
  const rollbacksShown = entries.length - filtered.length;

  return (
    <PageShell
      title={name || 'Deployments'}
      description={`Build and release history for ${name}.`}
      loading={loading}
      empty={estadoDaLista(
        {
          failure: readError,
          empty: loading || builds.length > 0 ? undefined : noDeploysYet(name),
        },
        'deployments',
      )}
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/projects/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back to project</span>
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((f) => {
              // T4.3 finding 3.4 + ADR D7: aria-pressed on status chips
              // mirrors the env chip pattern below.
              const isActive = statusFilter === f.value;
              return (
                <Button
                  key={f.value}
                  variant={isActive ? 'primary' : 'ghost'}
                  size="sm"
                  aria-pressed={isActive}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                </Button>
              );
            })}
          </div>
          {/* T4.2 — env chip group. Backend already accepts ?env=
              (see use-deployments + build_list.go). Combo semantics
              are AND: backend applies both predicates server-side. */}
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Filter by environment"
          >
            {envFilterOptions.map((f) => {
              // T4.3 finding 3.4 + ADR D7: aria-pressed on every chip
              // so screen readers announce which chip is the active
              // filter (visual `variant="primary"` is decorative; a11y
              // needs the explicit state).
              const isActive = envFilter === f.value;
              return (
                <Button
                  key={f.value}
                  variant={isActive ? 'primary' : 'ghost'}
                  size="sm"
                  aria-pressed={isActive}
                  onClick={() => setEnvFilter(f.value)}
                >
                  {f.label}
                </Button>
              );
            })}
          </div>
          {/* Clear filters — visible only when at least one filter is
              non-default, so the control doesn't add visual noise in
              the common case. Click resets every chip + page state
              back to the empty defaults (URL updates in lockstep). */}
          {(statusFilter !== 'all' || envFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void setStatusFilter('all');
                void setEnvFilter('all');
                setPageLimit(PAGE_BUMP);
              }}
            >
              Clear filters
            </Button>
          )}
          {/* Refresh — explicit re-snapshot. SSE keeps flowing in the
              background, but the sponsor explicitly asked for a manual
              control (e.g. after a backfill / out-of-band change). The
              icon spins while a fetch is in flight, the button is
              disabled to prevent click storms. aria-label keeps the
              control screen-reader-friendly (icon-only button). */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={fetching}
            aria-label="Refresh deployments list"
            title="Refresh"
          >
            <RefreshCw
              className={`size-4 ${fetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </Button>
          {/* T6.1: Deploy primary action. Reuses RedeployDialog (T6.4)
              with `activeBuild` (current production release) as source
              — semantically identical to "Deploy" in Vercel: clone the
              last good commit + env and submit a fresh build. Disabled
              while the page has no build to clone from (cold project). */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setDeployDialogOpen(true)}
            disabled={!activeBuild}
            title={
              activeBuild
                ? `Redeploy ${activeBuild.commit_sha.slice(0, 7)}`
                : 'No build available to deploy'
            }
          >
            <Play className="size-4" aria-hidden="true" />
            Deploy
          </Button>
        </div>
      </div>

      {/* T4.3 finding 3.1: banner hides when the user has filtered to
          a non-production env — the "production active" label is
          irrelevant context for someone scoped to staging/qa/preview.
          Honest UX: only show the banner when it's actually about the
          current view (production filter OR 'all').
          T4.3 finding 3.3: activeSha is now a Link to its build detail
          so the operator can drill into the active release directly.
       */}
      {activeSha && (envFilter === 'all' || envFilter === 'production') && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-body-sm"
          aria-label={`Production active commit ${activeSha}`}
        >
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          <span className="text-foreground">Currently serving production:</span>
          {activeBuildId ? (
            <Link
              to={`/projects/${encodeURIComponent(name)}/deployments/${activeBuildId}`}
              className="font-mono font-medium text-foreground underline-offset-2 hover:underline"
              aria-label={`Open build ${activeSha} detail`}
            >
              {activeSha}
            </Link>
          ) : (
            <span className="font-mono font-medium text-foreground">{activeSha}</span>
          )}
          {activeFinishedAt && (
            <span
              className="text-muted-foreground tabular-nums"
              title={formatDate(activeFinishedAt, 'datetime')}
            >
              · deployed {formatDate(activeFinishedAt, 'relative')}
            </span>
          )}
        </div>
      )}

      <Card>
        <Card.Body className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell className="hidden sm:table-cell">#</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Commit</Table.HeaderCell>
                <Table.HeaderCell className="hidden md:table-cell">
                  Author
                </Table.HeaderCell>
                <Table.HeaderCell className="hidden md:table-cell">
                  Started
                </Table.HeaderCell>
                <Table.HeaderCell
                  align="right"
                  className="hidden md:table-cell"
                >
                  Duration
                </Table.HeaderCell>
                <Table.HeaderCell align="right">
                  <span className="sr-only">View deployment</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) =>
                entry.kind === 'build' ? (
                  <DeploymentRow
                    key={entry.build.build_id}
                    projectName={name}
                    build={entry.build}
                    order={entry.order}
                    activeBuildId={activeBuildIdByEnv[entry.build.environment]}
                    url={urlByEnv[entry.build.environment]}
                    mutationInFlight={mutationInFlight}
                  />
                ) : (
                  <RollbackRow
                    key={entry.rollback.id}
                    projectName={name}
                    rollback={entry.rollback}
                    targetCommit={commitByBuild.get(entry.rollback.to.build_id)}
                  />
                ),
              )}
            </Table.Body>
          </Table>
        </Card.Body>
      </Card>

      {/* Pagination footer. Only renders when there's at least one row —
          empty states are handled by PageShell's `empty` prop above.
          Two pieces of information FAANG users want to see together:
            1. "Showing N of M" — N is the rows the filters leave on
               screen, M the server total (is there more, and how much).
            2. "Load more" — incremental fetch. Hidden when the page
               already shows every build, OR when the active status
               filter has narrowed the result smaller than the page
               size. Server caps a single request at 50; "Load more"
               bumps page state by 20 and the queryKey change triggers
               a fresh REST snapshot up to the new limit. */}
      {builds.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-body-sm text-muted-foreground">
          <span className="tabular-nums">
            Showing {filtered.length} of {total} deployments
            {rollbacksShown > 0
              ? ` and ${rollbacksShown} ${rollbacksShown === 1 ? 'rollback' : 'rollbacks'}`
              : ''}
          </span>
          {builds.length < total && (
            <Button
              variant="ghost"
              size="sm"
              disabled={fetching}
              onClick={() =>
                setPageLimit((prev) => Math.min(prev + PAGE_BUMP, total))
              }
            >
              {fetching ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}

      {/* T6.1 Deploy primary action — Dialog mounts only when both
          we have an active build to clone AND the user opened it.
          Conditional mount avoids running the dialog's internal
          useMutation hook against `undefined` props. */}
      {activeBuild && (
        <RedeployDialog
          open={deployDialogOpen}
          onOpenChange={setDeployDialogOpen}
          projectName={name}
          sourceBuild={activeBuild}
        />
      )}
    </PageShell>
  );
}
