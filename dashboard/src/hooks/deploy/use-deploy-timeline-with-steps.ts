import { useMemo } from 'react';
import {
  useDeployTimeline,
  type UseDeployTimelineResult,
  type UseDeployTimelineOptions,
  buildStepToPhaseStep,
} from './use-deploy-timeline';
import { useDeploymentStream } from './use-deployment-stream';
import { phaseGroupToCanonicalPhase } from '@/hooks/deploy/phase-group-mapping';

/**
 * useDeployTimelineWithSteps — Plan deploy-timeline-canonical-5-phases
 * follow-up: composes the 5-phase canonical hook with the J-17 step
 * stream and joins steps INTO their owning phase via phase_group →
 * canonical phase mapping.
 *
 * One hook, one render — the consumer (DeployTimelineHero) reads the
 * SAME PhaseState[] shape but now with .steps populated where the
 * J-17 stream provided step events.
 *
 * EC-1 stream-merge: useDeployTimeline + useDeploymentStream share
 * neither buffer nor event types — the two SSE channels run side-by-side
 * and the memo fuses them. Last-Event-ID resume is per-channel; deploy
 * timeline events use the new endpoint, step events keep the J-17 one.
 */
export function useDeployTimelineWithSteps(
  deployID: string | null | undefined,
  options: UseDeployTimelineOptions = {},
): UseDeployTimelineResult {
  const timeline = useDeployTimeline(deployID, options);
  const stepStream = useDeploymentStream(deployID, {
    initialLastEventID: options.initialLastEventID ?? null,
  });

  return useMemo(() => {
    // Group J-17 steps by canonical phase.
    const stepsByPhase = new Map<string, ReturnType<typeof buildStepToPhaseStep>[]>();
    for (const s of stepStream.steps) {
      const canonical = phaseGroupToCanonicalPhase(s.phase_group, s.step_name);
      const arr = stepsByPhase.get(canonical) ?? [];
      arr.push(buildStepToPhaseStep(s));
      stepsByPhase.set(canonical, arr);
    }
    // Sort each bucket by startedAt for stable display.
    for (const arr of stepsByPhase.values()) {
      arr.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    }
    const phases = timeline.phases.map((p) => ({
      ...p,
      steps: stepsByPhase.get(p.phase) ?? [],
    }));
    return { ...timeline, phases };
  }, [timeline, stepStream.steps]);
}
