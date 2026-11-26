import { normalizeBuildStatus, type Build, type BuildStatus } from '@/lib/api/types';

type BuildWithDeploy = Pick<Build, 'status' | 'deploy_status'>;

/** Deploy statuses the engine reports for a rollout that did not end with the build running. */
const FAILED_DEPLOY_STATUSES = new Set(['failed', 'rollback_failed']);

/**
 * True for a build whose image was built and whose deploy then failed. `status` says how the
 * build ended and `deploy_status` how its rollout did; the two differ exactly in this case.
 */
export function deployFailed(build: BuildWithDeploy): boolean {
  return (
    normalizeBuildStatus(build.status) === 'succeeded' &&
    FAILED_DEPLOY_STATUSES.has(build.deploy_status ?? '')
  );
}

/**
 * The status a build is shown and filtered by: its own, or `failed` when its deploy failed.
 * Someone looking at the list wants to know whether the deploy worked, not whether the image
 * was built.
 */
export function buildOutcome(build: BuildWithDeploy): BuildStatus {
  return deployFailed(build) ? 'failed' : normalizeBuildStatus(build.status);
}

/** The label for `buildOutcome`: "Deploy failed" tells a failed rollout from a failed build. */
export function buildOutcomeLabel(build: BuildWithDeploy, labels: Record<BuildStatus, string>): string {
  return deployFailed(build) ? 'Deploy failed' : labels[buildOutcome(build)];
}
