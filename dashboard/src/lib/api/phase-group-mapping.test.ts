import { describe, expect, it } from 'vitest';
import { phaseGroupToCanonicalPhase } from './phase-group-mapping';

describe('phaseGroupToCanonicalPhase', () => {
  it.each([
    ['clone', 'build'],
    ['install', 'build'],
    ['build', 'build'],
    ['sign', 'sign'],
    ['deliver', 'release'],
    ['other', 'build'],
  ] as const)('maps %s -> %s', (group, expected) => {
    expect(phaseGroupToCanonicalPhase(group)).toBe(expected);
  });
});
