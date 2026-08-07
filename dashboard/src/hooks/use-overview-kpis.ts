import { useProjects } from './projects/use-projects';
import { useCloudApi } from './use-api';
import { useBuildStats } from './use-build-stats';

/**
 * use-overview-kpis (J-06 T1.1) — the single aggregator hook that feeds the
 * Overview KPI strip. Composes three sources so the strip has one shape to read:
 *   - Projects count + Active envs  → useProjects (total + sum of active_env_count)
 *   - Plan price ("Plan" KPI)       → GET /v1/billing plan_price (observed from
 *                                     Stripe by the webhook — NOT a Go constant;
 *                                     honestly the recurring list price, not spend)
 *   - Deploys (7d)                  → GET /api/v1/builds/stats last_7d_count
 *
 * Fields that have no value resolve to `null`, never a fabricated 0 — the strip
 * renders an honest "—" (EC-1). plan_price is OMITTED by the API for enterprise /
 * not-yet-persisted plans, so `planPrice` is null there by construction.
 */
export interface OverviewPlanPrice {
  amount_minor: number;
  currency: string;
  interval: string;
}

export interface OverviewKPIs {
  projects: number;
  activeEnvs: number;
  /** null while the stats query is in flight or errored → honest "—". */
  deploys7d: number | null;
  /** null when the API omits plan_price (enterprise / not-yet-persisted) → "—". */
  planPrice: OverviewPlanPrice | null;
  loading: boolean;
}

interface BillingShape {
  plan_price?: OverviewPlanPrice;
}

export function useOverviewKPIs(): OverviewKPIs {
  const { projects, total, loading: projectsLoading } = useProjects();
  const { data: billing, loading: billingLoading } = useCloudApi<BillingShape>('/v1/billing');
  const stats = useBuildStats('7d');

  const activeEnvs = projects.reduce((sum, p) => sum + (p.active_env_count ?? 0), 0);

  return {
    projects: total ?? projects.length,
    activeEnvs,
    // Honest degradation: no number until the query resolves cleanly.
    deploys7d: stats.loading || stats.error ? null : stats.last7d,
    // Omitted by the API (enterprise / not-yet-persisted) → null → "—".
    planPrice: billing?.plan_price ?? null,
    loading: projectsLoading || billingLoading || stats.loading,
  };
}
