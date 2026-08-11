// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { trustKpis } from './trust-kpis';

/**
 * The four numbers of the trust layer (B-126, amendment D1-bis).
 *
 * This screen already answered with a verdict. The owner decided that every capability opens with
 * the `memory` dashboard, and the verdict STAYS above it — a number says `3`, the sentence says
 * what to do about the `3`.
 */

const p = (policy: string, observed: number, enforced: boolean) => ({ policy, observed, enforced });

describe("coverage's four numbers", () => {
  it('sums violations and partitions policies into covered and uncovered', () => {
    const k = trustKpis([p('pii-email', 40, true), p('jailbreak', 2, false), p('profanity', 1, false)]);

    expect(k.violations, 'violations sum OCCURRENCES, not policies').toBe(43);
    expect(k.policies).toBe(3);
    expect(k.blocked).toBe(1);
    expect(k.unenforced).toBe(2);
  });

  it('blocked and unenforced always add up to policies', () => {
    // The partition is what makes the two cards side by side readable: every observed policy either
    // has a guardrail or does not, and there is no third state. If one day there is, this case
    // breaks instead of the screen showing numbers that do not add up.
    const k = trustKpis([p('a', 1, true), p('b', 1, false), p('c', 5, true)]);
    expect(k.blocked + k.unenforced).toBe(k.policies);
  });

  it('with no violation observed, four zeros', () => {
    // Zero is a valid reading, and it is what a fresh workspace sees. `memory` documents the same
    // choice: four "0"s explaining what is coming, not broken cards.
    expect(trustKpis([])).toEqual({ violations: 0, policies: 0, blocked: 0, unenforced: 0 });
  });

  it('one policy with many occurrences does not inflate the policy count', () => {
    // The misreading the two numbers side by side prevent: `500 violations / 1 policy` is a
    // different story from `500 violations / 60 policies`, and a single card cannot tell them apart.
    const k = trustKpis([p('pii-email', 500, false)]);
    expect(k.violations).toBe(500);
    expect(k.policies).toBe(1);
  });
});
