import { Link } from 'react-router-dom';
import { Undo2 } from 'lucide-react';
import { Badge, Button, StatusDot, Table } from '@getloopscale/ui';
import { formatDate, formatElapsed, humanizeAuthor } from '@/lib/formatting/format';
import type { RollbackRecord } from '@/lib/api/types';
import { formatDuration } from '@/pages/deploy/components/deployment-row';
import {
  ROLLBACK_STATUS,
  rollbackPath,
  secondsBetween,
  shortRef,
} from '@/pages/deploy/components/rollback-status';

export interface RollbackRowProps {
  projectName: string;
  rollback: RollbackRecord;
  /** The commit of the build the rollback aimed at, when the page has that build. */
  targetCommit?: string;
  /** The moment relative times count from, in epoch ms. */
  now?: number;
}

/**
 * One rollback in the Deployments list, between the builds.
 *
 * It takes the columns of a build row, so the table stays one table: the
 * status, what it aimed at where a build shows its commit, who asked, when,
 * and how long it took.
 */
export function RollbackRow({ projectName, rollback, targetCommit, now }: RollbackRowProps) {
  const status = ROLLBACK_STATUS[rollback.status];
  const target = shortRef(targetCommit, rollback.to.build_id);
  const startedAbs = formatDate(rollback.created_at, 'datetime');
  return (
    <Table.Row data-testid="rollback-row">
      <Table.Cell>
        <span className="inline-flex items-center gap-2">
          <Undo2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <StatusDot status={status.kind} label={status.label} />
        </span>
      </Table.Cell>
      <Table.Cell>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-label text-foreground">
              Rollback to <span className="font-mono">{target}</span>
            </span>
            <Badge variant="outline" className="text-label uppercase">
              {rollback.environment}
            </Badge>
          </div>
          {rollback.failure_reason ? (
            <span className="text-label text-muted-foreground">{rollback.failure_reason}</span>
          ) : null}
          <span className="text-label text-muted-foreground tabular-nums md:hidden" title={startedAbs}>
            {formatElapsed(rollback.created_at, now ?? Date.now())}
          </span>
        </div>
      </Table.Cell>
      <Table.Cell className="hidden md:table-cell">
        <span className="text-body-sm text-muted-foreground" title={rollback.created_by}>
          {humanizeAuthor(rollback.created_by)}
        </span>
      </Table.Cell>
      <Table.Cell className="hidden md:table-cell">
        <span className="text-body-sm text-muted-foreground tabular-nums" title={startedAbs}>
          {formatElapsed(rollback.created_at, now ?? Date.now())}
        </span>
      </Table.Cell>
      <Table.Cell align="right" numeric className="hidden md:table-cell">
        <span className="text-body-sm text-muted-foreground tabular-nums">
          {formatDuration(secondsBetween(rollback.created_at, rollback.finished_at))}
        </span>
      </Table.Cell>
      <Table.Cell align="right">
        <Button variant="ghost" size="sm" asChild>
          <Link to={rollbackPath(projectName, rollback.id)} aria-label={`View rollback to ${target}`}>
            View
          </Link>
        </Button>
      </Table.Cell>
    </Table.Row>
  );
}
