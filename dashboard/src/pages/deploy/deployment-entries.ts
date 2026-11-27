import type { Build, RollbackRecord } from '@/lib/api/types';

/**
 * One row of the Deployments list: a build, or a rollback of the environment.
 *
 * A rollback changes what production runs and builds nothing, so it has a row
 * of its own between the builds, where it happened in time.
 */
export type DeploymentEntry =
  | { kind: 'build'; build: Build; at: number }
  | { kind: 'rollback'; rollback: RollbackRecord; at: number };

export interface DeploymentEntryFilters {
  /** The status chip: `all` or a build status. */
  status: string;
  /** The environment chip: `all` or an environment name. */
  env: string;
  /** True while "Load more" would bring older builds. */
  moreBuildsOnServer: boolean;
}

/** The status chip a rollback falls under, by how it ended. */
function rollbackStatusChip(rollback: RollbackRecord): string {
  switch (rollback.status) {
    case 'succeeded':
      return 'succeeded';
    case 'in_progress':
      return 'running';
    default:
      return 'failed';
  }
}

function instant(iso: string | undefined): number {
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Builds and rollbacks as one list, newest first.
 *
 * `builds` arrives already filtered. Rollbacks are filtered here by the same
 * chips. While the server still has older builds, a rollback older than the
 * last build loaded is left out: it belongs below builds the page has not
 * fetched, and would otherwise sit under the wrong one.
 */
export function deploymentEntries(
  builds: readonly Build[],
  rollbacks: readonly RollbackRecord[],
  filters: DeploymentEntryFilters,
): DeploymentEntry[] {
  const buildRows = builds.map((build) => ({
    kind: 'build' as const,
    build,
    at: instant(build.started_at ?? build.created_at),
  }));
  const oldestBuild = buildRows.reduce((min, row) => Math.min(min, row.at), Number.POSITIVE_INFINITY);

  const rollbackRows = rollbacks
    .filter((r) => filters.env === 'all' || r.environment === filters.env)
    .filter((r) => filters.status === 'all' || rollbackStatusChip(r) === filters.status)
    .map((rollback) => ({ kind: 'rollback' as const, rollback, at: instant(rollback.created_at) }))
    .filter((row) => !filters.moreBuildsOnServer || row.at >= oldestBuild);

  return [...buildRows, ...rollbackRows].sort((a, b) => b.at - a.at);
}

