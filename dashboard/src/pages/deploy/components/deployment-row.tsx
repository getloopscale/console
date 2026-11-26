import { Link } from 'react-router-dom';
import { ArrowUpToLine, RefreshCw } from 'lucide-react';
import { Badge, Button, StatusDot, Table, type StatusKind } from '@getloopscale/ui';
import { formatDate, humanizeAuthor } from '@/lib/formatting/format';
import type { MutationInFlight } from '@/hooks/deploy/use-mutation-in-flight';
import { DeploymentRowVisitIcon } from '@/pages/deploy/components/deployment-row-visit-icon';
import { type Build, type BuildStatus } from '@/lib/api/types';
import { buildOutcome, buildOutcomeLabel } from '@/pages/deploy/build-outcome';

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

// T4.3 finding 3.8: extend formatDuration to render hours when the
// build pipeline genuinely exceeds 1h (rare but possible for monorepo
// installs or first-time Docker layer cache misses on a large image).
export function formatDuration(seconds?: number | null): string {
  if (!seconds && seconds !== 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export interface DeploymentRowProps {
  projectName: string;
  /** The build this row shows; `b` below. */
  build: Build;
  /** 1 for the newest build on the page. */
  order: number;
  /** The build the row's own environment serves, when the page knows it. */
  activeBuildId?: string;
  /** The URL of the row's own environment. */
  url?: string;
  /** The long-running mutation of the project, if one is in flight. */
  mutationInFlight: MutationInFlight | null;
}

/** One build in the Deployments list. */
export function DeploymentRow({
  projectName,
  build: b,
  order,
  activeBuildId,
  url,
  mutationInFlight,
}: DeploymentRowProps) {
  const sha = b.commit_sha.slice(0, 7);
  const inFlightHere =
    mutationInFlight?.targetBuildId === b.build_id
      ? mutationInFlight
      : null;
  const isRollingBackTo = inFlightHere?.kind === 'rollback';
  const isPromotingHere = inFlightHere?.kind === 'promote';
  // While a long-running mutation is in flight to THIS row,
  // suppress the canonical Active badge (DB still says old
  // release is active for another ~90s) — the pulsing
  // transitional badge expresses the in-flight state
  // honestly. Same logic covers rollback + promote.
  //
  // Red Team loop-console#121: ACTIVE per the ROW's own env,
  // not the global production active. The page fetches both
  // env statuses (prod + preview); each row marks active when
  // its env's active_release.build_id matches the row's
  // build_id. Cross-env contamination (a preview row matching
  // production's active just because both releases share a
  // build_id via promote) is no longer possible.
  const rowEnvActiveBuildId = activeBuildId;
  const isActive =
    inFlightHere == null && rowEnvActiveBuildId === b.build_id;
  // Ordering signal: filtered is already sorted by created_at
  // desc in the hook (most recent first), so #1 is the newest.
  const orderLabel = `#${order}`;
  const startedAtAbs = b.started_at
    ? formatDate(b.started_at, 'datetime')
    : undefined;
  return (
    <Table.Row>
      <Table.Cell className="hidden sm:table-cell">
        <span className="font-mono text-label tabular-nums text-muted-foreground">
          {orderLabel}
        </span>
      </Table.Cell>
      <Table.Cell>
        {(() => {
          const ns = buildOutcome(b);
          return (
            <StatusDot
              status={STATUS_MAP[ns]}
              label={buildOutcomeLabel(b, STATUS_LABEL)}
            />
          );
        })()}
      </Table.Cell>
      <Table.Cell>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-label text-foreground">
              {sha}
            </span>
            {isActive && (
              <Badge
                variant="outline"
                className="border-success/50 bg-success/10 text-success text-label uppercase"
              >
                ● Active
              </Badge>
            )}
            {isRollingBackTo && (
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
            {isPromotingHere && (
              <Badge
                variant="outline"
                className="border-primary/50 bg-primary/10 text-primary text-label uppercase animate-pulse inline-flex items-center gap-1"
                aria-live="polite"
              >
                <ArrowUpToLine
                  className="size-3"
                  aria-hidden="true"
                />
                Promoting {sha} to production…
              </Badge>
            )}
            {b.environment && (
              <Badge
                variant="outline"
                className="text-label uppercase"
              >
                {b.environment}
              </Badge>
            )}
          </div>
          {/* Timestamp always visible — primary ordering
              signal that mobile users were missing. The
              title carries the absolute timestamp for
              precision when relative format gets ambiguous
              (multiple deploys in the same minute). */}
          <span
            className="text-label text-muted-foreground tabular-nums"
            title={startedAtAbs}
          >
            {b.started_at
              ? formatDate(b.started_at, 'relative')
              : '—'}
          </span>
        </div>
      </Table.Cell>
      <Table.Cell className="hidden md:table-cell">
        {/* Red Team loop-console#52/#78 closure: the backend
            field `created_by` is the user's UUID — rendering
            it verbatim leaks an opaque 36-char identifier
            that means nothing to the operator. Humanize via
            the canonical helper so an email becomes the
            local-part (`paulo@example.com → paulo`), a UUID
            collapses to a short suffix (`4d6ae2dd`), and a
            real name stays as-is. */}
        <span
          className="text-body-sm text-muted-foreground"
          title={b.created_by}
        >
          {humanizeAuthor(b.created_by)}
        </span>
      </Table.Cell>
      <Table.Cell className="hidden md:table-cell">
        <span
          className="text-body-sm text-muted-foreground tabular-nums"
          title={startedAtAbs}
        >
          {b.started_at
            ? formatDate(b.started_at, 'relative')
            : '—'}
        </span>
      </Table.Cell>
      <Table.Cell
        align="right"
        numeric
        className="hidden md:table-cell"
      >
        <span className="text-body-sm text-muted-foreground tabular-nums">
          {formatDuration(b.duration_seconds)}
        </span>
      </Table.Cell>
      <Table.Cell align="right">
        <div className="inline-flex items-center gap-1">
          {/* T3.1 J-25 — active-only ExternalLink icon
              (anti-trap UX: only currently-serving row
              gets the open-in-new-tab affordance).
              Red Team loop-console#121: URL is the ROW's
              env URL (preview → preview URL, production
              → production URL) — pre-fix this passed
              prodStatus?.url unconditionally, so a preview
              row marked active would link to production. */}
          <DeploymentRowVisitIcon
            isActive={isActive}
            url={url}
          />
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={`/projects/${encodeURIComponent(projectName)}/deployments/${b.build_id}`}
              aria-label={`View deployment ${sha}`}
            >
              View
            </Link>
          </Button>
        </div>
      </Table.Cell>
    </Table.Row>
  );
}
