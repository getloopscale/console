import { Stepper, type StepperStepData } from '@usetheo/ui';
import { useDeploymentStream, type DeploymentStatus } from '@/hooks/deploy/use-deployment-stream';
import type { BuildStep, PhaseGroup } from '@/hooks/deploy/sse-events';
import type { BuildStatus } from '@/lib/api/types';
import { BuildStepTimer } from './build-step-timer';
import { BuildErrorPill } from './build-error-pill';

/**
 * BuildTimelineLive — Plan J-17 T3.1.
 *
 * Reactive replacement for the static BuildTimeline. Subscribes to the
 * build's SSE stream via useDeploymentStream and renders steps grouped
 * by phase (Clone / Install / Build / Sign / Deliver + Other fallback
 * for non-canonical steps from EC-11).
 *
 * States:
 *   - no events yet (queued): renders a 5-row skeleton placeholder
 *   - running: highlights currentStep with animate-pulse
 *   - failed: renders BuildErrorPill below the timeline
 *   - succeeded: all steps green
 */

export interface BuildTimelineLiveProps {
  buildId: string;
  projectName: string;
  /** Optional Last-Event-ID hint seeded from REST (EC-5). */
  initialLastEventID?: string | null;
  /**
   * REST-derived terminal status for the build (parent's `build.status` from
   * `useDeployment`). Red Team theo-cloud#122 — when a build dies BEFORE any
   * SSE step event (e.g. Argo submit Unauthorized), `steps.length === 0`
   * AND the SSE-derived status defaults to 'queued', so the skeleton
   * "Waiting for build to start… / Connecting to build stream…" rendered
   * forever — contradicting the header "Failed" badge. Plumbing the REST
   * status lets us surface an honest terminal-empty state instead.
   */
  restBuildStatus?: BuildStatus;
}

const PHASE_ORDER: PhaseGroup[] = ['clone', 'install', 'build', 'sign', 'deliver', 'other'];

// Prose-style label (portado do antigo step card deletado no M7 — EC-14 preservado
// pelo truncamento com title do Stepper da lib).
function displayLabel(stepName: string): string {
  const stripped = stepName.replace(/[-_]/g, ' ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// M7 T2.2: mapeia o vocabulário SSE para o StepStatus da lib; a causa da falha
// vai na description (convenção da lib — lida pelo SR no mesmo item).
function toStepperStep(step: BuildStep): StepperStepData {
  // review M7 F-dom-3: SSE é fronteira de wire — vocabulário desconhecido degrada
  // para pending (disciplina da lib), nunca para failed silencioso.
  const status =
    step.status === 'succeeded'
      ? 'done'
      : step.status === 'running'
        ? 'active'
        : step.status === 'failed'
          ? 'failed'
          : 'pending';
  return {
    id: step.step_name,
    label: displayLabel(step.step_name),
    status,
    description:
      step.status === 'failed'
        ? `failed: ${step.error_class ?? 'unknown'}${step.error_message ? ` — ${step.error_message}` : ''}`
        : undefined,
    timestamp:
      step.started_at || step.duration_seconds !== undefined ? (
        <BuildStepTimer
          startedAt={step.started_at}
          endedAt={step.ended_at}
          paused={step.status !== 'running'}
        />
      ) : undefined,
  };
}

const PHASE_LABEL: Record<PhaseGroup, string> = {
  clone: 'Clone',
  install: 'Install',
  build: 'Build',
  sign: 'Sign',
  deliver: 'Deliver',
  other: 'Other',
};

export function BuildTimelineLive({
  buildId,
  projectName,
  initialLastEventID,
  restBuildStatus,
}: BuildTimelineLiveProps) {
  // currentStep saiu do destructuring no M7 T2.2: o estado active agora vem do
  // status de CADA step (Stepper da lib), não de um ponteiro externo.
  const { steps, status, error, connected } = useDeploymentStream(buildId, {
    initialLastEventID,
  });

  const grouped = groupByPhase(steps);
  const empty = steps.length === 0;
  // Red Team theo-cloud#122 — when the REST build status is terminal-failure
  // AND no SSE events arrived (build died at submit, before emitting any
  // step), render the honest empty-state instead of the misleading
  // "Connecting to build stream…" skeleton. `cancelled` is terminal in the
  // same shape (no steps to surface) — the canonical Build state machine
  // (pkg/statemachine) makes both `failed` and `cancelled` terminal.
  const terminalEmpty =
    empty && (restBuildStatus === 'failed' || restBuildStatus === 'cancelled');

  return (
    <div className="space-y-6" data-status={status}>
      {terminalEmpty ? (
        <TerminalEmptyState status={restBuildStatus as 'failed' | 'cancelled'} />
      ) : empty ? (
        <Skeleton connected={connected} />
      ) : (
        PHASE_ORDER.map((phase) => {
          const phaseSteps = grouped[phase] ?? [];
          if (phaseSteps.length === 0) return null;
          return (
            <section key={phase} aria-label={`${PHASE_LABEL[phase]} phase`}>
              <h3 className="mb-2 text-label uppercase tracking-wide text-muted-foreground">
                {PHASE_LABEL[phase]}
              </h3>
              <Stepper
                label={`${PHASE_LABEL[phase]} steps`}
                steps={phaseSteps.map(toStepperStep)}
              />
            </section>
          );
        })
      )}

      {error && (
        <BuildErrorPill
          errorClass={error.error_class}
          errorMessage={error.error_message}
          suggestion={error.suggestion}
          projectName={projectName}
          buildId={buildId}
        />
      )}

      {status === 'succeeded' && !error && (
        <div
          className="rounded-md border border-success/40 bg-success/5 p-3 text-body-sm text-success"
          role="status"
        >
          Deploy complete — release is live.
        </div>
      )}
    </div>
  );
}

function groupByPhase(steps: BuildStep[]): Partial<Record<PhaseGroup, BuildStep[]>> {
  const result: Partial<Record<PhaseGroup, BuildStep[]>> = {};
  for (const step of steps) {
    (result[step.phase_group] ??= []).push(step);
  }
  return result;
}

interface SkeletonProps {
  connected: boolean;
}

// Red Team theo-cloud#122 — honest empty-state for builds that died before
// emitting any SSE step. Rendered in lieu of `<Skeleton>` when REST status
// is terminal-failure (`failed` / `cancelled`) AND zero step events arrived.
// The header's BuildErrorPanel carries the API `error` (e.g. "argo: create
// workflow: Unauthorized"); this surface gives the timeline a matching
// honest signal instead of "Connecting to build stream…" forever.
function TerminalEmptyState({ status }: { status: 'failed' | 'cancelled' }) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body-sm text-destructive"
      role="status"
      aria-label={status === 'failed' ? 'Build failed before any step ran' : 'Build cancelled before any step ran'}
    >
      {status === 'failed'
        ? 'Build failed before any step ran — see the error above for the cause. No step logs were emitted.'
        : 'Build cancelled before any step ran. No step logs were emitted.'}
    </div>
  );
}

function Skeleton({ connected }: SkeletonProps) {
  return (
    <div className="space-y-3" aria-label="Waiting for build to start">
      <p className="text-body-sm text-muted-foreground">
        {connected ? 'Waiting for build to start…' : 'Connecting to build stream…'}
      </p>
      {PHASE_ORDER.slice(0, 5).map((phase) => (
        <div key={phase} className="rounded-md border border-dashed border-border/60 p-3">
          <div className="h-3 w-24 rounded bg-muted-foreground/10" />
          <div className="mt-2 h-2 w-40 rounded bg-muted-foreground/5" />
        </div>
      ))}
    </div>
  );
}

// Re-export so consumers (TimelineTab) can use the canonical type.
export type { DeploymentStatus };
