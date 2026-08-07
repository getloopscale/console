import { useCallback } from 'react';
import {
  useMutationInFlight,
  useStartMutation,
  useEndMutation,
  __resetMutationInFlightStore,
  type MutationInFlight,
} from './deploy/use-mutation-in-flight';

/**
 * use-rollback-in-flight — back-compat wrapper around use-mutation-in-
 * flight. The original 2026-06-18 hook was rollback-specific; it was
 * generalized later the same day to cover promote + redeploy too. This
 * wrapper preserves the original public surface so existing rollback
 * call sites + tests keep working unchanged.
 *
 * Reading: a rollback-specific reader filters the shared store down
 * to only return when kind === 'rollback'. If a promote happens to be
 * in flight, this reader returns null — the legacy "rollback row
 * badge" code path stays semantic.
 */

export interface RollbackInFlight {
  projectName: string;
  targetBuildId: string;
  targetSha: string;
  startedAt: number;
}

function dropKind(m: MutationInFlight | null): RollbackInFlight | null {
  if (m == null || m.kind !== 'rollback') return null;
  return {
    projectName: m.projectName,
    targetBuildId: m.targetBuildId,
    targetSha: m.targetSha,
    startedAt: m.startedAt,
  };
}

export function useRollbackInFlight(
  projectName: string | undefined,
): RollbackInFlight | null {
  const m = useMutationInFlight(projectName);
  return dropKind(m);
}

export function useStartRollback(): (info: RollbackInFlight) => void {
  const start = useStartMutation();
  return useCallback(
    (info: RollbackInFlight) => start({ ...info, kind: 'rollback' }),
    [start],
  );
}

export function useEndRollback(): (projectName: string) => void {
  return useEndMutation();
}

/**
 * Test-only: delegates to the shared store reset so tests don't see
 * leaks across mutation kinds.
 */
export function __resetRollbackInFlightStore(): void {
  __resetMutationInFlightStore();
}
