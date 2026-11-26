import { ROLLBACKS_QUERY_KEY } from '@/hooks/deploy/use-rollbacks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { ProjectStatusDetail, RollbackResponse } from '@/lib/api/types';
import { followRollback, type RollbackOutcome } from '@/hooks/deploy/rollback-outcome';

export interface UseRollbackOptions {
  /** Time between status reads. Defaults to 5 seconds, the cadence of `useProjectStatus`. */
  pollIntervalMs?: number;
  /** How long to wait for the outcome. Defaults to `ROLLBACK_DEADLINE_MS`. */
  deadlineMs?: number;
}

/**
 * useRollback: return an environment to an earlier build, and wait for it.
 *
 * Sibling of `usePromote`: the call lives here and not in the dialog, so it can
 * be tested without a modal and every caller gets the same cache refresh.
 *
 * The API answers the POST with 202 and finishes the rollback in the background
 * (getloopscale/loop-runtime#118). The mutation therefore stays pending after the
 * 202 and resolves with how the rollback ended, read from the project status
 * (see `rollback-outcome.ts`). A rollback that failed in the background RESOLVES
 * with `state: 'failed'`; the mutation rejects only when the API refused the
 * POST. It resolves null when the session ended before the 202.
 */
export function useRollback(options: UseRollbackOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      projectName: string;
      environment: string;
      buildId: string;
    }): Promise<RollbackOutcome | null> => {
      const project = encodeURIComponent(vars.projectName);
      const accepted = await engineFetch<RollbackResponse>(
        `/api/v1/projects/${project}/rollback`,
        {
          method: 'POST',
          // One key per call, never per dialog: a rollback changes what serves
          // traffic, and a double click or a network retry must not run it twice.
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            environment: vars.environment,
            build_id: vars.buildId,
          }),
        },
        { throwOnError: true },
      );
      if (!accepted) return null;
      // The rollback has a record from this moment; the list shows it in progress.
      void queryClient.invalidateQueries({ queryKey: ROLLBACKS_QUERY_KEY });

      const environment = accepted.environment || vars.environment;
      return followRollback(
        accepted,
        () =>
          engineFetch<ProjectStatusDetail>(
            `/api/v1/projects/${project}/status?env=${encodeURIComponent(environment)}`,
            undefined,
            { throwOnError: true },
          ),
        { intervalMs: options.pollIntervalMs, deadlineMs: options.deadlineMs },
      );
    },
    // Runs when the rollback ended, whichever way: the lists show the release
    // that is active now, which a failed rollback also changed back.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.builds.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.environments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectStatus.all });
      queryClient.invalidateQueries({ queryKey: ROLLBACKS_QUERY_KEY });
    },
  });
}
