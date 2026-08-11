import { useMemo } from 'react';
import { useSSEStream } from '@/hooks/deploy/use-sse-stream';
import {
  PHASE_ORDER,
  TIMELINE_EVENT_TYPES,
  type DeployTimelineEventPayload,
  type Phase,
  type PhaseStatus,
} from '@/hooks/deploy/deploy-timeline-events';
import type { BuildStep } from '@/hooks/deploy/sse-events';

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

function initialPhases(): PhaseState[] {
  return PHASE_ORDER.map((phase) => ({
    phase,
    status: 'pending' as const,
    startedAt: null,
    endedAt: null,
    substateMessage: null,
    degradedReason: null,
    steps: [],
  }));
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

  return useMemo(() => {
    const phases = initialPhases();
    const byPhase = new Map<Phase, PhaseState>();
    for (const p of phases) byPhase.set(p.phase, p);

    let aggregatorDegradedReason: string | null = null;

    for (const ev of stream.events) {
      if (ev.type === 'deploy_timeline.aggregator.degraded') {
        const payload = ev.data as { degraded_reason?: string };
        aggregatorDegradedReason = payload.degraded_reason ?? 'Timeline temporarily unavailable.';
        continue;
      }
      // Expect "deploy_timeline.<phase>.<status>"
      const parts = ev.type.split('.');
      if (parts.length !== 3 || parts[0] !== 'deploy_timeline') continue;
      const phase = parts[1] as Phase;
      const status = parts[2] as PhaseStatus;
      const cell = byPhase.get(phase);
      if (!cell) continue;

      const payload = ev.data as DeployTimelineEventPayload;
      cell.status = status;
      if (!cell.startedAt && payload.timestamp) cell.startedAt = payload.timestamp;
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'canceled'
      ) {
        cell.endedAt = payload.timestamp ?? cell.endedAt;
      }
      if (payload.substate_message) cell.substateMessage = payload.substate_message;
      if (payload.degraded_reason) cell.degradedReason = payload.degraded_reason;
    }

    // Cascade: phases ordered AFTER the current active one stay 'pending'.
    // Phases BEFORE a completed one inherit completed too (defensive vs
    // out-of-order arrival on reconnect).
    let foundActive = false;
    for (const cell of phases) {
      if (foundActive && cell.status === 'pending') {
        // Already pending — no-op (keeps initial state).
      }
      if (
        cell.status === 'in_progress' ||
        cell.status === 'degraded' ||
        cell.status === 'failed' ||
        cell.status === 'canceled'
      ) {
        foundActive = true;
      }
    }

    // currentPhase = first non-pending non-completed; fallback to last
    // terminal; fallback to first pending (initial pre-event state).
    let currentPhase: PhaseState | null = null;
    for (const cell of phases) {
      if (cell.status === 'in_progress' || cell.status === 'degraded') {
        currentPhase = cell;
        break;
      }
    }
    if (!currentPhase) {
      // No live in-progress phase — pick last non-pending; otherwise first pending.
      const reversed = [...phases].reverse();
      currentPhase =
        reversed.find((c) => c.status !== 'pending') ?? phases[0];
    }

    const overall = deriveOverall(phases, aggregatorDegradedReason);

    return {
      phases,
      currentPhase,
      aggregatorDegradedReason,
      overall,
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
