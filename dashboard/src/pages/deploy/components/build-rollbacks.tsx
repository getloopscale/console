import { Link } from 'react-router-dom';
import { Undo2 } from 'lucide-react';
import { formatDate } from '@/lib/formatting/format';
import { useRollbacks } from '@/hooks/deploy/use-rollbacks';
import {
  ROLLBACK_STATUS,
  rollbackPath,
  rollbacksOfBuild,
} from '@/pages/deploy/components/rollback-status';

/**
 * The rollbacks that touched a build, on that build's page.
 *
 * The timeline of a build tells the history of the build. A rollback is an
 * operation of its own with its own page, so the build links to it and says
 * on which side of it the build was.
 */
export function BuildRollbacks({ projectName, buildId }: { projectName: string; buildId: string }) {
  const { rollbacks } = useRollbacks(projectName);
  const touching = rollbacksOfBuild(rollbacks, buildId);
  if (touching.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label="Rollbacks of this build" data-testid="build-rollbacks">
      {touching.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
          <Undo2 className="size-4" aria-hidden="true" />
          <span>
            {r.to.build_id === buildId ? 'Rollback to this build' : 'Rolled back from this build'}
          </span>
          <span className="tabular-nums" title={formatDate(r.created_at, 'datetime')}>
            {formatDate(r.created_at, 'relative')}
          </span>
          <Link className="text-foreground underline-offset-2 hover:underline" to={rollbackPath(projectName, r.id)}>
            {ROLLBACK_STATUS[r.status].label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
