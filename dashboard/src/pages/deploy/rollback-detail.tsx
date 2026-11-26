import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Circle, Loader2, Undo2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageShell, StatusDot } from '@getloopscale/ui';
import { formatDate, humanizeAuthor } from '@/lib/formatting/format';
import { useRequireAuth } from '@/hooks/use-auth';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRollbacks } from '@/hooks/deploy/use-rollbacks';
import type { RollbackSide } from '@/lib/api/types';
import { formatDuration } from '@/pages/deploy/components/deployment-row';
import {
  ROLLBACK_STATUS,
  rollbackPhases,
  secondsBetween,
  shortRef,
  type RollbackPhase,
} from '@/pages/deploy/components/rollback-status';

const PHASE_ICON: Record<RollbackPhase['state'], typeof Check> = {
  completed: Check,
  in_progress: Loader2,
  failed: X,
  pending: Circle,
  not_reached: Circle,
};

function BackToDeployments({ projectName }: { projectName: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link
        to={`/projects/${encodeURIComponent(projectName)}/deployments`}
        className="inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        <span>Back to deployments</span>
      </Link>
    </Button>
  );
}

function Side({ title, side, projectName }: { title: string; side: RollbackSide; projectName: string }) {
  return (
    <div className="min-w-0">
      <p className="text-label uppercase text-muted-foreground">{title}</p>
      <Link
        className="font-mono text-body-sm text-foreground underline-offset-2 hover:underline"
        to={`/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(side.build_id)}`}
      >
        {side.build_id}
      </Link>
      <p className="font-mono text-label text-muted-foreground">{side.release_id}</p>
    </div>
  );
}

/**
 * The page of one rollback: who asked, the release the environment left and
 * the one it aimed at, how it ended and, when it failed, why.
 */
export function RollbackDetailPage() {
  useRequireAuth();
  const { name = '', rollbackId = '' } = useParams<{ name: string; rollbackId: string }>();
  useSetPageTitle(name ? `${name} · Rollback` : 'Rollback');
  const { rollbacks, loading, error } = useRollbacks(name);
  const rollback = rollbacks.find((r) => r.id === rollbackId);

  if (loading) {
    return (
      <PageShell title="Rollback">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading rollback" />
        </div>
      </PageShell>
    );
  }

  if (!rollback) {
    return (
      <PageShell title="Rollback not found">
        <EmptyState
          icon={Undo2}
          title={error ? 'The rollbacks of this project could not be read' : `No rollback with id "${rollbackId}"`}
          description={
            error
              ? 'Try again in a moment.'
              : 'It is not among the latest rollbacks of this project, or the URL is wrong.'
          }
          action={<BackToDeployments projectName={name} />}
        />
      </PageShell>
    );
  }

  const status = ROLLBACK_STATUS[rollback.status];
  const duration = secondsBetween(rollback.created_at, rollback.finished_at);

  return (
    <PageShell
      title={`Rollback to ${shortRef(undefined, rollback.to.build_id)}`}
      description={`Rollback ${rollback.id}`}
    >
      <div className="mb-4">
        <BackToDeployments projectName={name} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-body-sm text-muted-foreground">
        <StatusDot status={status.kind} label={status.label} />
        <Badge variant="outline" className="text-label uppercase">
          {rollback.environment}
        </Badge>
        <span title={rollback.created_by}>by {humanizeAuthor(rollback.created_by)}</span>
        <span className="tabular-nums" title={formatDate(rollback.created_at, 'datetime')}>
          started {formatDate(rollback.created_at, 'relative')}
        </span>
        {duration !== null ? <span className="tabular-nums">took {formatDuration(duration)}</span> : null}
      </div>

      {rollback.failure_reason ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-body-sm"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="leading-snug">{rollback.failure_reason}</p>
        </div>
      ) : null}

      <Card className="mb-4">
        <Card.Body>
          <div className="flex flex-wrap items-center gap-4">
            <Side title="From" side={rollback.from} projectName={name} />
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            <Side title="To" side={rollback.to} projectName={name} />
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <ol className="grid gap-3 md:grid-cols-2" aria-label="Rollback phases">
            {rollbackPhases(rollback.status).map((phase) => {
              const Icon = PHASE_ICON[phase.state];
              return (
                <li
                  key={phase.name}
                  data-state={phase.state}
                  className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2"
                >
                  <Icon
                    size={16}
                    className={['mt-0.5 shrink-0', phase.state === 'in_progress' ? 'animate-spin' : ''].join(' ')}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-body-sm font-medium text-foreground">{phase.name}</p>
                    <p className="text-label text-muted-foreground">{phase.label}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card.Body>
      </Card>
    </PageShell>
  );
}
