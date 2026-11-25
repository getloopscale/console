import type { StatusKind } from '@usetheo/ui';
import type { RollbackRecordStatus } from '@/lib/api/types';

/** How each rollback status reads and which status dot it takes. */
export const ROLLBACK_STATUS: Record<RollbackRecordStatus, { label: string; kind: StatusKind }> = {
  in_progress: { label: 'Rolling back', kind: 'building' },
  succeeded: { label: 'Rolled back', kind: 'live' },
  failed: { label: 'Rollback failed', kind: 'failed' },
  interrupted: { label: 'Rollback interrupted', kind: 'failed' },
};

/** The first characters of a commit, or of a build id when the commit is not known. */
export function shortRef(commit: string | undefined, buildId: string): string {
  return commit ? commit.slice(0, 7) : buildId.replace(/^build-/, '').slice(0, 7);
}

/** The page of one rollback. */
export function rollbackPath(projectName: string, rollbackId: string): string {
  return `/projects/${encodeURIComponent(projectName)}/deployments/rollbacks/${encodeURIComponent(rollbackId)}`;
}

/** Whole seconds between two instants, or null while the second is unknown. */
export function secondsBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** A phase of a rollback, as its page lists it. */
export interface RollbackPhase {
  name: 'Deploy' | 'Live';
  state: 'pending' | 'in_progress' | 'completed' | 'failed' | 'not_reached';
  label: string;
}

/**
 * The two phases a rollback goes through, read from its status.
 *
 * A rollback builds and signs nothing: it delivers the manifests of a release
 * that already exists (Deploy) and the environment then runs it (Live). The
 * API records the outcome, not each phase, so the phases say what the outcome
 * implies and nothing more.
 */
export function rollbackPhases(status: RollbackRecordStatus): RollbackPhase[] {
  switch (status) {
    case 'succeeded':
      return [
        { name: 'Deploy', state: 'completed', label: 'Completed' },
        { name: 'Live', state: 'completed', label: 'Serving the target release' },
      ];
    case 'in_progress':
      return [
        { name: 'Deploy', state: 'in_progress', label: 'Rolling out the target release' },
        { name: 'Live', state: 'pending', label: 'Waiting for the rollout' },
      ];
    case 'failed':
      return [
        { name: 'Deploy', state: 'failed', label: 'Failed' },
        { name: 'Live', state: 'not_reached', label: 'Not reached. The previous release stayed active' },
      ];
    default:
      return [
        { name: 'Deploy', state: 'failed', label: 'Interrupted' },
        { name: 'Live', state: 'not_reached', label: 'Not confirmed' },
      ];
  }
}

/** The rollbacks that left or aimed at a build, in the order given. */
export function rollbacksOfBuild<T extends { from: { build_id: string }; to: { build_id: string } }>(
  rollbacks: readonly T[],
  buildId: string,
): T[] {
  return rollbacks.filter((r) => r.from.build_id === buildId || r.to.build_id === buildId);
}
