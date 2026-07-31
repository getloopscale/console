import { aggregateCost, hasRecordedTokens, type TraceSpanNode } from '@/lib/trace-layout';
import { isSpanError } from '@/lib/span-status';
import { durationMs, flattenAll } from './helpers';

/**
 * The trace-level headline the detail view was missing (M72): total wall-clock duration (from the root
 * span), summed cost + tokens across every span, the error-span count, and the distinct models used.
 * Pure + deterministic so it is unit-tested in isolation. Absent values are honestly `null` (rendered
 * as an em-dash by the header), never a fabricated 0 — except a genuine sum of zero.
 */
export interface TraceSummary {
  durationMs: number | null;
  costUsd: number;
  /** #186 — NaN (rendered `—`) when NO span recorded a count; a measured 0 stays 0. */
  totalTokens: number;
  errorCount: number;
  models: string[];
}

export function traceSummary(root: TraceSpanNode): TraceSummary {
  const spans = flattenAll(root);
  let totalTokens = 0;
  // #186 — a trace where NO span ever recorded a token count is UNKNOWN, not zero. Summing `?? 0` over
  // it produced a fabricated "0" in the header while the per-span rows right below already showed `—`
  // (M89): the two surfaces disagreeing about the same trace. A trace that DID measure and measured 0
  // keeps its 0 — that is a fact, and reporting `—` for it would be the mirror-image lie.
  let anyMeasured = false;
  let errorCount = 0;
  const models = new Set<string>();
  for (const s of spans) {
    if (hasRecordedTokens(s)) anyMeasured = true;
    totalTokens += (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    if (isSpanError(s.statusCode)) errorCount += 1;
    if (s.model) models.add(s.model);
  }
  return {
    durationMs: durationMs(root),
    // M53 / theo-lens#73: prefer the authoritative trace cost the lens attaches to the root
    // (the stored `traces.cost_usd`, same number the list shows) over re-summing per-span costs —
    // which are absent for interaction/tool spans ($0.0000) and would double-count if a child ever
    // carried its own cost. Fall back to the aggregate only when the root has no stored cost.
    costUsd: root.costUsd ?? aggregateCost(root),
    totalTokens: anyMeasured ? totalTokens : NaN,
    errorCount,
    models: [...models].sort(),
  };
}
