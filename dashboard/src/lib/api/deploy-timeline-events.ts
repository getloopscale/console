/**
 * Canonical Deploy Timeline event types — mirror the
 * theo/api/internal/aggregator emission contract.
 *
 * Event types follow `deploy_timeline.<phase>.<status>` per ADR D1.
 * Payloads are PRE-SCRUBBED server-side (ADR D4a) — internal terms
 * NEVER reach this UI per Cross-Project Rule 9.
 */

export type Phase = 'build' | 'sign' | 'release' | 'deploy' | 'live';

export type PhaseStatus =
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'degraded';

export const PHASE_ORDER: Phase[] = ['build', 'sign', 'release', 'deploy', 'live'];

/** User-facing label per Cross-Project Rule 9. */
export const PHASE_LABEL: Record<Phase, string> = {
  build: 'Build',
  sign: 'Sign',
  release: 'Release',
  deploy: 'Deploy',
  live: 'Live',
};

/**
 * Scrubbed substate hint shown beneath the phase name. Strict whitelist
 * of product-language verbs — the server already replaced internal
 * terms; this fallback is for the EMPTY-payload case so the UI always
 * displays something sensible during early reconnects.
 */
export const PHASE_DEFAULT_SUBSTATE: Record<Phase, string> = {
  build: 'clone · install · build image',
  sign: 'image signing · supply-chain manifest',
  release: 'manifest · the deployment system',
  deploy: 'the deployment system · pods up',
  live: 'live URL responds 200',
};

/** Aggregator event payload (mirrors emitPhaseEvent in aggregator.go). */
export interface DeployTimelineEventPayload {
  deploy_id: string;
  phase: Phase;
  status: PhaseStatus;
  /** Pre-scrubbed text safe for direct render. */
  degraded_reason?: string;
  /** Pre-scrubbed text safe for direct render. */
  substate_message?: string;
  /** Aggregator-attached source id (loki_markers, release_db, etc). */
  source?: string;
  /** RFC3339Nano timestamp from the source-system. */
  timestamp: string;
}

/** Aggregator DEGRADED event when the aggregator itself recovers a panic. */
export interface DeployTimelineAggregatorDegradedPayload {
  deploy_id: string;
  degraded_reason: string;
  timestamp: string;
}

export const TIMELINE_EVENT_TYPES: string[] = (() => {
  const out: string[] = [];
  for (const phase of PHASE_ORDER) {
    for (const status of [
      'ready',
      'in_progress',
      'completed',
      'failed',
      'canceled',
      'degraded',
    ] as PhaseStatus[]) {
      out.push(`deploy_timeline.${phase}.${status}`);
    }
  }
  out.push('deploy_timeline.aggregator.degraded');
  return out;
})();

/** Terminal event types — stream consumer closes after observing one. */
export const TERMINAL_TIMELINE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'deploy_timeline.live.completed',
  'deploy_timeline.build.failed',
  'deploy_timeline.sign.failed',
  'deploy_timeline.release.failed',
  'deploy_timeline.deploy.failed',
  'deploy_timeline.live.failed',
  'deploy_timeline.build.canceled',
  'deploy_timeline.sign.canceled',
  'deploy_timeline.release.canceled',
  'deploy_timeline.deploy.canceled',
]);
