/**
 * The four numbers of the trust layer (B-126, amendment D1-bis).
 *
 * ## Where this comes from
 *
 * This screen already answered — with a VERDICT, which I had argued was the best form in the
 * repository. The owner decided that every capability opens with the same dashboard `memory` opens
 * with, and that call is theirs: whoever operates eight capabilities should not learn eight ways
 * to read the first screen.
 *
 * **The verdict did not go away.** It still sits above these numbers, which is where the amendment
 * puts it. A number says `3`; the sentence says what to do about the `3`.
 *
 * ## Why these four
 *
 * All of them derive from `coverageGap`, which the screen already computes from the two queries it
 * already makes — no new request.
 *
 * `blocked` and `unenforced` partition `policies`: every observed policy either has a guardrail or
 * does not. `violations` belongs to another dimension — it is volume, not coverage — which is why
 * that card comes first: it answers "how much happened", the others answer "how much of it is
 * covered".
 */
import type { PolicyCoverage } from './trust-series';

export interface TrustKpis {
  /** Violations observed in the window that was read. */
  readonly violations: number;
  /** Distinct policies that showed up. */
  readonly policies: number;
  /** Of those, how many DO have a guardrail. */
  readonly blocked: number;
  /** Of those, how many pass with no guardrail. This is the number the verdict above turns into a sentence. */
  readonly unenforced: number;
}

export function trustKpis(coverage: readonly PolicyCoverage[]): TrustKpis {
  let violations = 0;
  let blocked = 0;

  for (const c of coverage) {
    violations += c.observed;
    if (c.enforced) blocked += 1;
  }

  return {
    violations,
    policies: coverage.length,
    blocked,
    unenforced: coverage.length - blocked,
  };
}
