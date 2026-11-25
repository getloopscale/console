import type { ProjectStatusDetail, RollbackResponse } from '@/lib/api/types';

/**
 * How a rollback the API accepted with 202 ended.
 *
 * The API finishes a rollback in the background (getloopscale/loopzero#118) and
 * the only place a client reads the outcome is `active_release` of
 * `GET /api/v1/projects/{name}/status`. That field is the environment's ACTIVE
 * release, and the release being rolled back is ROLLING_BACK for as long as the
 * rollback runs, so:
 *
 *   - no active release            the rollback is still running
 *   - `reactivated_release`        it completed
 *   - `rolled_back_release`        it failed, and the API made the previous release active again
 *   - any other release            a deploy took the environment over meanwhile
 */
export type RollbackState = 'in_progress' | 'succeeded' | 'failed' | 'superseded';

export function classifyRollback(
  accepted: RollbackResponse,
  status: Pick<ProjectStatusDetail, 'active_release'>,
): RollbackState {
  const activeId = status.active_release?.id;
  if (!activeId) return 'in_progress';
  if (activeId === accepted.reactivated_release) return 'succeeded';
  if (activeId === accepted.rolled_back_release) return 'failed';
  return 'superseded';
}

/**
 * The API gives the background work 15 minutes (`defaultRollbackCompletionTimeout`)
 * and then up to 30 seconds for each state change that settles the release. One
 * extra minute covers those, so a rollback the API is still finishing is never
 * reported as lost.
 */
export const ROLLBACK_DEADLINE_MS = 16 * 60 * 1000;

/** Same cadence as `useProjectStatus`. */
const ROLLBACK_POLL_INTERVAL_MS = 5000;

export interface RollbackOutcome {
  /** `timed_out`: the deadline passed and the status never showed how the rollback ended. */
  state: Exclude<RollbackState, 'in_progress'> | 'timed_out';
  accepted: RollbackResponse;
  /** The active release when polling stopped; null when there was none or it could not be read. */
  activeReleaseId: string | null;
  /** Why the last status read failed, when it did. Set only on `timed_out`. */
  lastReadError?: Error;
}

export interface FollowRollbackOptions {
  deadlineMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls the project status until the rollback ended or the deadline passed.
 *
 * A status read that fails says nothing about the rollback, which runs on the
 * server whether or not this client can reach it. The loop keeps the error and
 * tries again; if the deadline arrives first, the outcome carries it.
 */
export async function followRollback(
  accepted: RollbackResponse,
  readStatus: () => Promise<Pick<ProjectStatusDetail, 'active_release'> | null>,
  options: FollowRollbackOptions = {},
): Promise<RollbackOutcome> {
  const {
    deadlineMs = ROLLBACK_DEADLINE_MS,
    intervalMs = ROLLBACK_POLL_INTERVAL_MS,
    sleep = realSleep,
    now = Date.now,
  } = options;
  const startedAt = now();
  let lastReadError: Error | undefined;

  for (;;) {
    try {
      const status = await readStatus();
      if (status) {
        lastReadError = undefined;
        const state = classifyRollback(accepted, status);
        if (state !== 'in_progress') {
          return { state, accepted, activeReleaseId: status.active_release?.id ?? null };
        }
      }
    } catch (err) {
      lastReadError = err instanceof Error ? err : new Error(String(err));
    }
    if (now() - startedAt >= deadlineMs) {
      return { state: 'timed_out', accepted, activeReleaseId: null, lastReadError };
    }
    await sleep(intervalMs);
  }
}
