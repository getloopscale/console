import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/projects/use-projects', () => ({ useProjects: vi.fn() }));
vi.mock('@/hooks/use-api', () => ({ useCloudApi: vi.fn() }));
vi.mock('@/hooks/overview/use-build-stats', () => ({ useBuildStats: vi.fn() }));

import { useOverviewKPIs } from '@/hooks/overview/use-overview-kpis';
import { useProjects } from '@/hooks/projects/use-projects';
import { useCloudApi } from '@/hooks/use-api';
import { useBuildStats } from '@/hooks/overview/use-build-stats';

const mProjects = vi.mocked(useProjects);
const mCloud = vi.mocked(useCloudApi);
const mStats = vi.mocked(useBuildStats);

function statsDefault() {
  return { last7d: 0, byDay: [], total: 0, loading: false, error: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mProjects.mockReturnValue({ projects: [], total: 0, loading: false } as ReturnType<typeof useProjects>);
  mCloud.mockReturnValue({ data: null, loading: false, error: false } as ReturnType<typeof useCloudApi>);
  mStats.mockReturnValue(statsDefault());
});

// J-06 T1.1 — the aggregator composes projects + billing + deploys-stats into one
// KPI shape. Fields with no value resolve to null (honest "—"), never a fake 0.
describe('useOverviewKPIs (J-06 T1.1)', () => {
  it('test_aggregates_all_sources', () => {
    mProjects.mockReturnValue({
      projects: [{ active_env_count: 2 }, { active_env_count: 1 }],
      total: 2,
      loading: false,
    } as unknown as ReturnType<typeof useProjects>);
    mCloud.mockReturnValue({
      data: { plan_price: { amount_minor: 2900, currency: 'usd', interval: 'month' } },
      loading: false,
      error: false,
    } as ReturnType<typeof useCloudApi>);
    mStats.mockReturnValue({ ...statsDefault(), last7d: 12 });

    const { result } = renderHook(() => useOverviewKPIs());
    expect(result.current.projects).toBe(2);
    expect(result.current.activeEnvs).toBe(3); // 2 + 1
    expect(result.current.deploys7d).toBe(12);
    expect(result.current.planPrice).toEqual({ amount_minor: 2900, currency: 'usd', interval: 'month' });
    expect(result.current.loading).toBe(false);
  });

  it('test_starter_plan_price_zero_present', () => {
    mCloud.mockReturnValue({
      data: { plan_price: { amount_minor: 0, currency: 'usd', interval: 'month' } },
      loading: false,
      error: false,
    } as ReturnType<typeof useCloudApi>);
    const { result } = renderHook(() => useOverviewKPIs());
    expect(result.current.planPrice).toEqual({ amount_minor: 0, currency: 'usd', interval: 'month' });
  });

  it('test_plan_price_omitted_yields_null', () => {
    // API omits plan_price for enterprise / not-yet-persisted → honest "—".
    mCloud.mockReturnValue({ data: { plan: 'Enterprise' }, loading: false, error: false } as unknown as ReturnType<typeof useCloudApi>);
    const { result } = renderHook(() => useOverviewKPIs());
    expect(result.current.planPrice).toBeNull();
  });

  it('test_stats_loading_yields_null_deploys', () => {
    mStats.mockReturnValue({ ...statsDefault(), loading: true });
    const { result } = renderHook(() => useOverviewKPIs());
    expect(result.current.deploys7d).toBeNull(); // never a fake 0 while loading
  });

  it('test_stats_error_yields_null_deploys', () => {
    mStats.mockReturnValue({ ...statsDefault(), error: true });
    const { result } = renderHook(() => useOverviewKPIs());
    expect(result.current.deploys7d).toBeNull();
  });

  it('test_projects_falls_back_to_length_when_total_absent', () => {
    mProjects.mockReturnValue({
      projects: [{ active_env_count: 0 }, { active_env_count: 0 }, {}],
      loading: false,
    } as unknown as ReturnType<typeof useProjects>);
    const { result } = renderHook(() => useOverviewKPIs());
    expect(result.current.projects).toBe(3); // total absent → projects.length
    expect(result.current.activeEnvs).toBe(0); // missing active_env_count → 0 each
  });
});
