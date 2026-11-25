import { useMemo } from 'react';
import { useProjects } from '@/hooks/projects/use-projects';
import { useProjectStatus } from '@/hooks/use-project-status';
import { useProjectConnected } from '@/hooks/projects/use-project-connection';
import { useSecrets } from '@/hooks/infra/use-secrets';
import { useDomains } from '@/hooks/infra/use-domains';
import { SIGNALS, type SignalName } from '@/hooks/projects/signals';
import { RULES, readCustomDomain, readMeasurements } from '@/hooks/projects/readiness-rules';
import type { ReadinessStatus } from '@/hooks/projects/status-icons';

/**
 * J-21 Readiness Score plan v1.1 — useReadinessSignals(projectName)
 *
 * Composes the foundation-first chain hooks into a tristate Pass/Fail/Unknown
 * checklist with weighted score 0-100.
 *
 * Per ADR D1: pure-frontend composition; zero new backend endpoints. Per
 * ADR D2: weights hardcoded in `signals.ts` for v1; per-team customization
 * deferred to v2.
 *
 * Tristate semantics (EC-2 absorption):
 *   - pass = signal computed AND meets threshold (e.g., replicas >= 2)
 *   - fail = signal computed AND fails threshold (e.g., replicas == 1)
 *   - unknown = signal could not be computed (hook error, missing data) —
 *     EXCLUDED from BOTH score numerator AND denominator so operator
 *     outage doesn't make every row red
 *
 * Score formula (per ADR D2): Σ(weight × pass) / Σ(weight × known) × 100,
 * then Math.ceil() per EC-8. Returns null while ANY input hook is loading
 * (EC-6 no-flicker absorption).
 */

export interface ReadinessSignal {
  name: SignalName;
  status: ReadinessStatus;
  weight: number;
  fixPath: string;
}

export interface UseReadinessSignalsResult {
  /** Per-signal tristate state keyed by canonical SignalName. */
  signals: Record<SignalName, ReadinessSignal>;
  /** Weighted score 0-100 (Math.ceil), or null while any input loading. */
  score: number | null;
  /** True while ANY composed hook is still loading (EC-6). */
  loading: boolean;
  /** Signals with a measured status. The score covers only these. */
  measuredSignals: number;
  totalSignals: number;
}

/**
 * useReadinessSignals — production hook.
 *
 * Hook composition + tristate computation + score rollup. Per EC-5, a
 * composed hook's failure does NOT collapse its derived signals into
 * `fail` — they become `unknown` so the user does NOT see a red row when
 * the real cause is LoopScale's measurement layer being degraded (canonical
 * J-18 v0.15.0 "empty omitempty" lesson family).
 */
export function useReadinessSignals(
  projectName: string | undefined,
): UseReadinessSignalsResult {
  const projects = useProjects();
  const status = useProjectStatus(projectName);
  const connection = useProjectConnected(projectName);
  const secrets = useSecrets({ project: projectName ?? '' });
  const domains = useDomains();

  return useMemo(() => {
    const loading =
      projects.loading || status.loading || connection.isLoading || secrets.loading || domains.isLoading;

    if (loading) {
      return {
        signals: emptySignals(),
        score: null,
        loading: true,
        measuredSignals: 0,
        totalSignals: SIGNALS.length,
      };
    }

    const measurements = readMeasurements({
      project: projects.projects?.find((p) => p.name === projectName),
      statusError: status.error,
      status: status.status,
      repositoryConnected: connection.isError ? null : (connection.data?.connected ?? null),
      secretCount: secrets.measured && !secrets.error ? secrets.secrets.length : null,
      customDomain:
        domains.isError || !projectName ? null : readCustomDomain(projectName, domains.data),
    });

    // Each signal is a pure rule in `readiness-rules.ts` (B-182/B-225). This block reads the hooks
    // once, builds the measurements and applies the table.
    const signals = Object.fromEntries(
      SIGNALS.map((def) => [def.name, buildSignal(def.name, RULES[def.name](measurements))]),
    ) as Record<SignalName, ReadinessSignal>;

    const measuredSignals = Object.values(signals).filter((s) => s.status !== 'unknown').length;
    return {
      signals,
      score: computeScore(signals),
      loading: false,
      measuredSignals,
      totalSignals: SIGNALS.length,
    };
  }, [
    projects.loading,
    projects.projects,
    status.loading,
    status.error,
    status.status,
    connection.isLoading,
    connection.isError,
    connection.data,
    secrets.loading,
    secrets.error,
    secrets.measured,
    secrets.secrets,
    domains.isLoading,
    domains.isError,
    domains.data,
    projectName,
  ]);
}

function buildSignal(name: SignalName, status: ReadinessStatus): ReadinessSignal {
  const def = SIGNALS.find((s) => s.name === name)!;
  return { name, status, weight: def.weight, fixPath: def.fixPath };
}

function emptySignals(): Record<SignalName, ReadinessSignal> {
  return Object.fromEntries(
    SIGNALS.map((s) => [
      s.name,
      { name: s.name, status: 'unknown' as ReadinessStatus, weight: s.weight, fixPath: s.fixPath },
    ]),
  ) as Record<SignalName, ReadinessSignal>;
}

/**
 * Score formula per ADR D2 + EC-2 + EC-8 absorption.
 *
 * Numerator: Σ(weight) for signals with status === 'pass'
 *            + 0.5 × Σ(weight) for signals with status === 'warn'
 * Denominator: Σ(weight) for signals with status !== 'unknown'
 *
 * Multiplied by 100, then Math.ceil() so 89.001 → 90 (matches Vercel
 * "round generous" UX). Returns 0 when all signals unknown (denominator
 * would be 0); ScoreCard renders this as "—" via score=null fallback.
 */
function computeScore(signals: Record<SignalName, ReadinessSignal>): number {
  let num = 0;
  let den = 0;
  for (const sig of Object.values(signals)) {
    if (sig.status === 'unknown') continue;
    den += sig.weight;
    if (sig.status === 'pass') num += sig.weight;
    else if (sig.status === 'warn') num += sig.weight * 0.5;
  }
  if (den === 0) return 0;
  return Math.ceil((num / den) * 100);
}

/**
 * Exported for hermetic tests so the EC-8 boundary cases can be asserted
 * directly without rendering the whole hook tree.
 */
export const __test_computeScore = computeScore;
