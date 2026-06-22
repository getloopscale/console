import {
  ArrowUpToLine,
  GitBranch,
  GitCommit,
  RefreshCw,
  Undo2,
  XCircle,
} from 'lucide-react';
import { Badge, Button, StatusDot, type StatusKind } from '@usetheo/ui';
import { normalizeBuildStatus, type Build, type BuildStatus } from '@/lib/api/types';
import { useMutationInFlight } from '@/hooks/use-mutation-in-flight';

/**
 * BuildHeader — Plan J-17 T3.5.
 *
 * Header for the deploy detail page. Renders the canonical metadata
 * row (SHA, branch, total duration, status badge) and the action
 * cluster (cancel, rollback, redeploy).
 *
 * Action visibility:
 *   - cancel   : only when status is in-flight (queued/running/cancelling)
 *   - rollback : only when status is succeeded (immutable target needed)
 *   - redeploy : always rendered; disabled while in-flight so users
 *                see a stable affordance instead of a moving target
 *
 * Callbacks are received as props so the layout owns the mutation
 * lifecycle (react-query) and the header stays render-pure.
 */

export interface BuildHeaderProps {
  build: Build;
  branch?: string;
  onCancel: () => void;
  onRollback: () => void;
  onRedeploy: () => void;
  /**
   * Optional. When provided AND the build environment is a preview
   * (i.e. not "production") AND the build status is succeeded, renders
   * the FAANG-canonical contextual "Promote to Production" action.
   * Sponsor LIVE 2026-06-18 PRD: substitui o legacy from→to PromoteDialog
   * pelo padrão Vercel/Netlify (destino implícito = production, source
   * implícito = este deploy). Without the callback the action is hidden,
   * preserving back-compat with call sites that don't wire it yet.
   */
  onPromoteToProduction?: () => void;
  /**
   * Optional project name (slug). When provided, the header subscribes
   * to the shared mutation-in-flight store and swaps the action button
   * for a transitional badge while a promote/rollback is mid-flight on
   * this build. Sponsor LIVE-caught 2026-06-18: after clicking Promote,
   * the toast trail was visible but the detail page's action region
   * stayed quiet, looking unchanged. The transitional badge here makes
   * the in-flight state visible on the same page the user took the
   * action from (the grid badge is for /deployments).
   */
  projectName?: string;
}

const STATUS_MAP: Record<BuildStatus, StatusKind> = {
  succeeded: 'live',
  running: 'building',
  queued: 'building',
  failed: 'failed',
  cancelled: 'idle',
  cancelling: 'idle',
};

const STATUS_LABEL: Record<BuildStatus, string> = {
  succeeded: 'Succeeded',
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
  cancelled: 'Cancelled',
  cancelling: 'Cancelling',
};

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function isInFlight(status: BuildStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'cancelling';
}

export function BuildHeader({
  build,
  branch,
  onCancel,
  onRollback,
  onRedeploy,
  onPromoteToProduction,
  projectName,
}: BuildHeaderProps) {
  const sha = build.commit_sha.slice(0, 7);
  // Backend returns CAPS statuses; normalize once so every comparison
  // and lookup below works uniformly.
  const ns = normalizeBuildStatus(build.status);
  const inFlight = isInFlight(ns);
  // Mutation-in-flight subscription. When the caller passes
  // projectName, we read the shared store and check whether a
  // promote/rollback is mid-flight on THIS build. If so, we swap the
  // action buttons for a transitional badge so the user sees the
  // mutation taking effect on the same surface they triggered it
  // from (not just the global toast trail).
  const mutationInFlight = useMutationInFlight(projectName);
  const inFlightHere =
    mutationInFlight?.targetBuildId === build.build_id
      ? mutationInFlight
      : null;
  const isPromotingHere = inFlightHere?.kind === 'promote';
  const isRollingBackHere = inFlightHere?.kind === 'rollback';
  const showCancel = inFlight;
  // While a promote/rollback is mid-flight on this build, hide the
  // raw action buttons so the user can't double-fire (backend lock
  // would 409 anyway, but the transitional badge is the canonical
  // UX signal).
  const showRollback = ns === 'succeeded' && !inFlightHere;
  // Promote-to-Production visibility:
  //   - callback wired by the caller (back-compat: hidden when absent)
  //   - build is succeeded (no point promoting an in-flight / failed)
  //   - the deploy is in a preview env (production deploys obviously
  //     don't promote to themselves; this is also enforced backend-side
  //     via SAME_ENVIRONMENT)
  //   - no mutation already in flight on this build (avoid double-fire)
  const showPromoteToProduction =
    Boolean(onPromoteToProduction) &&
    ns === 'succeeded' &&
    build.environment !== 'production' &&
    !inFlightHere;

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm">
        <span className="inline-flex items-center gap-1.5 font-mono text-foreground">
          <GitCommit className="size-4 text-muted-foreground" aria-hidden="true" />
          {sha}
        </span>
        {branch && (
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
            {branch}
          </span>
        )}
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(build.duration_seconds)}
        </span>
        <StatusDot status={STATUS_MAP[ns]} label={STATUS_LABEL[ns]} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showCancel && (
          <Button
            variant="destructive"
            size="sm"
            onClick={onCancel}
            aria-label="Cancel build"
          >
            <XCircle className="size-4" aria-hidden="true" />
            Cancel build
          </Button>
        )}
        {showRollback && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRollback}
            aria-label="Rollback to this build"
          >
            <Undo2 className="size-4 text-warning" aria-hidden="true" />
            Rollback
          </Button>
        )}
        {showPromoteToProduction && (
          <Button
            variant="primary"
            size="sm"
            onClick={onPromoteToProduction}
            aria-label="Promote to production"
          >
            <ArrowUpToLine className="size-4" aria-hidden="true" />
            Promote to Production
          </Button>
        )}
        {isPromotingHere && (
          <Badge
            variant="outline"
            className="border-primary/50 bg-primary/10 text-primary text-label uppercase animate-pulse inline-flex items-center gap-1"
            aria-live="polite"
          >
            <ArrowUpToLine className="size-3" aria-hidden="true" />
            Promoting to production…
          </Badge>
        )}
        {isRollingBackHere && (
          <Badge
            variant="outline"
            className="border-warning/50 bg-warning/10 text-warning text-label uppercase animate-pulse inline-flex items-center gap-1"
            aria-live="polite"
          >
            <RefreshCw
              className="size-3 animate-spin"
              aria-hidden="true"
            />
            Rolling back to {sha}…
          </Badge>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={onRedeploy}
          disabled={inFlight}
          aria-label="Redeploy"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Redeploy
        </Button>
      </div>
    </header>
  );
}
