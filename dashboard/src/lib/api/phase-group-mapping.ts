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
 *   - other                     → step-name heuristic (LIVE-caught 2026-06-18:
 *     the real J-17 emitter buckets most steps as 'other', so a flat fallback
 *     would collapse the Sign + Release phases. The step-name heuristic below
 *     restores correct grouping for the canonical step inventory.)
 *
 * The Deploy Timeline phases 'deploy' and 'live' have no J-17 step events
 * by design — those phases are driven by the aggregator's argocd_app /
 * theoapp_informer / status_url_probe sources (not by build steps).
 */
export function phaseGroupToCanonicalPhase(group: PhaseGroup, stepName?: string): Phase {
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
      return stepNameHeuristic(stepName);
  }
}

/**
 * Step-name heuristic for the J-17 'other' bucket. Returns the canonical
 * Phase the step semantically belongs to. Defaults to 'build' so an unknown
 * step is at least visible (under the biggest phase) rather than dropped.
 *
 * The heuristic is conservative — adds rules only for step names we see in
 * the real build pipeline (verified against sse_events at 2026-06-18).
 * Adding more is safe; removing existing rules is a UX regression.
 */
function stepNameHeuristic(stepName: string | undefined): Phase {
  if (!stepName) return 'build';
  const n = stepName.toLowerCase();
  // Sign-phase steps: image signing + supply-chain manifest emit.
  if (n.startsWith('sign-') || n.startsWith('sbom-') || n.startsWith('attest-')) {
    return 'sign';
  }
  // Release-phase steps: manifests + gitops push.
  if (
    n.includes('manifest') ||
    n.startsWith('gitops-') ||
    n.startsWith('release-') ||
    n.startsWith('emit-')
  ) {
    return 'release';
  }
  // Everything else (clone, install, build, validate, cache, security-scan,
  // build-image, generate-dockerfile, save-cache) lives in Build.
  return 'build';
}
