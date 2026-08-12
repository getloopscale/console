import { useMemo, useRef } from 'react';
import { useSSEStream } from '@/hooks/deploy/use-sse-stream';
import {
  TIMELINE_EVENT_TYPES,
  type Phase,
  type PhaseStatus,
} from '@/hooks/deploy/deploy-timeline-events';
import type { BuildStep } from '@/hooks/deploy/sse-events';
import {
  aplicarEvento,
  estadoInicial,
  faseCorrente,
  type TimelineState,
} from '@/hooks/deploy/deploy-timeline-reducer';

/**
 * Step-level detail rendered inside an expandable PhaseCell.
 * Sourced from the J-17 build.step.* events via useDeployTimelineSteps,
 * mapped to canonical Deploy Timeline phases via phaseGroupToCanonicalPhase.
 */
export interface PhaseStep {
  name: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  errorMessage?: string;
}

/** Map BuildStep → PhaseStep (UI-narrow shape). */
export function buildStepToPhaseStep(s: BuildStep): PhaseStep {
  return {
    name: s.step_name,
    status: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    durationSeconds: s.duration_seconds,
    errorMessage: s.error_message,
  };
}

/**
 * useDeployTimeline — Plan deploy-timeline-canonical-5-phases (dashboard half).
 *
 * Wraps useSSEStream<unknown> for the canonical
 * /engine/api/v1/deploys/{deployID}/timeline endpoint and reduces the
 * event sequence into a stable map<phase, PhaseState>. Returns the UI
 * model: phases array (always 5 entries in canonical order), currentPhase,
 * derived overall status, aggregator-degraded reason (if any), and the
 * connected flag.
 *
 * Empty payload guard: server always emits scrubbed text, but during
 * early reconnect or before any event arrives, substateMessage may be
 * undefined — the rendering layer falls back to PHASE_DEFAULT_SUBSTATE.
 *
 * Last-Event-ID resume per EC-1 of the backend plan: SSE retransmits
 * from afterID = client's last seen — useSSEStream binds the browser's
 * native Last-Event-ID header.
 */

export interface PhaseState {
  phase: Phase;
  status: PhaseStatus | 'pending';
  /** ISO timestamp of the first event for this phase (start moment). */
  startedAt: string | null;
  /** ISO timestamp of the completed/failed/canceled transition. */
  endedAt: string | null;
  /** Pre-scrubbed text safe for direct render. */
  substateMessage: string | null;
  /** Pre-scrubbed text safe for direct render. */
  degradedReason: string | null;
  /**
   * Step-level detail for the expandable PhaseCell (Vercel-style
   * progressive disclosure). Empty array means no step-level signal
   * (phases 'deploy' / 'live' inherently have none — they are driven
   * by argocd_app / status_url_probe sources, not by build steps).
   */
  steps: PhaseStep[];
}

export type OverallStatus =
  | 'queued'
  | 'running'
  | 'live'
  | 'failed'
  | 'canceled'
  | 'degraded'
  | 'unknown';

export interface UseDeployTimelineResult {
  /** Always 5 entries in canonical order (build → sign → release → deploy → live). */
  phases: PhaseState[];
  /** The current "active" phase — the first in_progress OR the last terminal one. */
  currentPhase: PhaseState | null;
  /** Aggregator-level degraded reason (panic / source error / invalid transition). */
  aggregatorDegradedReason: string | null;
  /** Derived overall status for the hero header. */
  overall: OverallStatus;
  /** SSE connection live signal (drives a subtle pulse dot). */
  connected: boolean;
  /** Last-Event-ID observed; useful for resume hint. */
  lastEventID: string | null;
}

export interface UseDeployTimelineOptions {
  /** Optional Last-Event-ID hint seeded from REST (EC-1 of backend plan). */
  initialLastEventID?: string | null;
  /** Freeze updates without closing the connection. */
  paused?: boolean;
}

export function useDeployTimeline(
  deployID: string | null | undefined,
  options: UseDeployTimelineOptions = {},
): UseDeployTimelineResult {
  // Caddy + cloud BFF proxies /engine/* to theo-api per the canonical
  // pattern documented in use-deployment-stream.ts (J-17 LIVE catch).
  const path = deployID
    ? `/engine/api/v1/deploys/${encodeURIComponent(deployID)}/timeline`
    : null;

  const stream = useSSEStream(path, {
    eventTypes: TIMELINE_EVENT_TYPES,
    initialLastEventID: options.initialLastEventID ?? null,
    paused: options.paused,
    // Canonical 5 phases × 6 statuses + degraded events + cushion.
    maxEvents: 60,
  });

  // B-181 — o estado ACUMULADO atravessa os renders. `stream.events` é um FIFO com teto de 60
  // (logo abaixo): quando o 61º evento chega, o primeiro é descartado. Derivar o estado varrendo
  // esse buffer a partir do zero — como este hook fazia — significa que um
  // `deploy_timeline.build.completed` despejado devolve a fase de build a `pending` numa tela que
  // já a mostrou concluída. Guardar o acumulado num ref é o que torna o estado durável: o buffer
  // passa a dizer só o que MUDOU, e nunca mais o que É.
  //
  // Reaplicar um evento que continua no buffer é inofensivo — `aplicarEvento` é idempotente por
  // evento (o `startedAt ??` preserva o primeiro instante, e reafirmar um status dá o mesmo
  // status), e é essa idempotência que também absorve o replay de uma reconexão e o duplo render
  // do StrictMode. Por isso o acumulado é seguro apesar de a mutação do ref acontecer dentro do
  // useMemo.
  const acumulado = useRef<TimelineState>(estadoInicial());

  return useMemo(() => {
    // B-182 — o corpo deste useMemo media CCN 31, a maior do repositório: aplicar evento, herdar
    // conclusão para trás, escolher a fase corrente e derivar o estado geral, tudo num bloco só.
    // As três primeiras agora moram em `deploy-timeline-reducer.ts`, puras e testáveis sem montar
    // componente.
    const estado = stream.events.reduce(aplicarEvento, acumulado.current);
    acumulado.current = estado;
    const phases = estado.phases as PhaseState[];

    return {
      phases,
      currentPhase: faseCorrente(phases),
      aggregatorDegradedReason: estado.aggregatorDegradedReason,
      overall: deriveOverall(phases, estado.aggregatorDegradedReason),
      connected: stream.connected,
      lastEventID: stream.lastEventID,
    };
  }, [stream.events, stream.connected, stream.lastEventID]);
}

function deriveOverall(
  phases: PhaseState[],
  aggregatorReason: string | null,
): OverallStatus {
  if (aggregatorReason) return 'degraded';
  const live = phases[phases.length - 1];
  if (live.status === 'completed') return 'live';
  for (const p of phases) {
    if (p.status === 'failed') return 'failed';
    if (p.status === 'canceled') return 'canceled';
    if (p.status === 'degraded') return 'degraded';
  }
  for (const p of phases) {
    if (p.status === 'in_progress') return 'running';
  }
  if (phases.every((p) => p.status === 'pending')) return 'queued';
  return 'unknown';
}
