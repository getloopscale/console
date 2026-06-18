import type { PhaseGroup } from './sse-events';
import type { Phase } from './deploy-timeline-events';

/**
 * Maps the J-17 `phase_group` taxonomy (clone/install/build/sign/deliver/other)
 * onto the 5-phase canonical Deploy Timeline taxonomy.
 *
 * Plan: deploy-timeline-canonical-5-phases follow-up — step-level expansion.
 *
 * Rationale:
 *   - clone / install / build  → 'build'   (everything pre-image is "Build")
 *   - sign                      → 'sign'   (1:1)
 *   - deliver                   → 'release' (manifest emit + gitops push live here)
 *   - other                     → 'build'   (orphan-step fallback; better than dropping)
 *
 * The Deploy Timeline phases 'deploy' and 'live' have no J-17 step events
 * by design — those phases are driven by the aggregator's argocd_app /
 * theoapp_informer / status_url_probe sources (not by build steps).
 */
export function phaseGroupToCanonicalPhase(group: PhaseGroup): Phase {
  switch (group) {
    case 'clone':
    case 'install':
    case 'build':
      return 'build';
    case 'sign':
      return 'sign';
    case 'deliver':
      return 'release';
    case 'other':
    default:
      return 'build';
  }
}
