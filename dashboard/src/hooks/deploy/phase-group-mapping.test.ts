import { describe, expect, it } from 'vitest';
import { phaseGroupToCanonicalPhase } from './phase-group-mapping';

describe('phaseGroupToCanonicalPhase', () => {
  describe('direct phase_group bucket mapping', () => {
    it.each([
      ['clone', 'build'],
      ['install', 'build'],
      ['build', 'build'],
      ['sign', 'sign'],
      ['deliver', 'release'],
    ] as const)('maps %s -> %s', (group, expected) => {
      expect(phaseGroupToCanonicalPhase(group)).toBe(expected);
    });
  });

  describe('other-bucket step-name heuristic (LIVE-caught 2026-06-18)', () => {
    it.each([
      // Sign-phase canonical steps
      ['sign-image-app', 'sign'],
      ['sign-image-worker', 'sign'],
      ['sbom-app', 'sign'],
      ['attest-image-app', 'sign'],
      // Release-phase canonical steps
      ['generate-manifests', 'release'],
      ['gitops-push', 'release'],
      ['emit-release-event', 'release'],
      ['release-rollout', 'release'],
      // Build-phase fallback steps (real LIVE inventory)
      ['restore-cache', 'build'],
      ['save-cache', 'build'],
      ['validate-workspace', 'build'],
      ['install-deps', 'build'],
      ['build-apps', 'build'],
      ['security-scan', 'build'],
      ['generate-dockerfile', 'build'],
      ['build-image-app', 'build'],
      // Empty / undefined defaults to build
      ['', 'build'],
    ] as const)('other + %s -> %s', (stepName, expected) => {
      expect(phaseGroupToCanonicalPhase('other', stepName)).toBe(expected);
    });

    it('undefined stepName falls back to build', () => {
      expect(phaseGroupToCanonicalPhase('other')).toBe('build');
    });
  });
});
