import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/hooks/projects/use-projects', () => ({ useProjects: vi.fn() }));
vi.mock('@/hooks/use-project-status', () => ({ useProjectStatus: vi.fn() }));

import { useReadinessSignals, __test_computeScore } from './use-readiness-signals';
import { useProjects } from '@/hooks/projects/use-projects';
import { useProjectStatus } from '@/hooks/use-project-status';
import { SIGNALS, TOTAL_WEIGHT } from '@/hooks/projects/signals';

const mockedUseProjects = vi.mocked(useProjects);
const mockedUseProjectStatus = vi.mocked(useProjectStatus);

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function mockAllSettled({
  statusErr = false,
  project = { name: 'my-api', last_deploy: '2026-06-15T00:00:00Z' },
  status = {
    project: 'my-api',
    environment: 'production',
    replicas_ready: 3,
    replicas_desired: 5,
    traffic_5xx_pct_1h: 0.001,
    alerts_active: 0,
  },
}: {
  statusErr?: boolean;
  project?: any;
  status?: any;
} = {}) {
  mockedUseProjects.mockReturnValue({ projects: [project], total: 1, loading: false } as any);
  mockedUseProjectStatus.mockReturnValue({
    status: statusErr ? null : status,
    loading: false,
    error: statusErr,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useReadinessSignals (J-21 v1.1)', () => {
  it('test_use_readiness_signals_throws_use_status_yields_unknown (EC-5)', () => {
    mockAllSettled({ statusErr: true });
    const { result } = renderHook(() => useReadinessSignals('my-api'), { wrapper: wrapper() });
    // status hook in error → hpa/two-replicas/alerts/logs collapse to unknown.
    // EC-5 absorption: NEVER 'fail' for a hook error.
    expect(result.current.signals.hpa_configured.status).toBe('unknown');
    expect(result.current.signals.two_plus_replicas.status).toBe('unknown');
    expect(result.current.signals.logs_healthy.status).toBe('unknown');
    expect(result.current.signals.hpa_configured.status).not.toBe('fail');
  });

  it('test_use_readiness_signals_unknown_excluded_from_score (EC-2)', () => {
    mockAllSettled();
    const { result } = renderHook(() => useReadinessSignals('my-api'), { wrapper: wrapper() });
    // auto_deploy, two_plus and logs pass; hpa, cache, secrets, domain and alerts are unknown and
    // excluded from both sides. Score = 100.
    expect(result.current.score).toBe(100);
  });

  it('marks signals unknown when the status response omits the fields they read', () => {
    // GET /projects/hello/status on staging: no replica counts, no 5xx rate, while the Rollout
    // served 2 ready replicas. Missing fields used to read as 0: "2+ replicas" failed and
    // "logs healthy" passed with no measurement.
    mockAllSettled({ status: { project: 'my-api', environment: 'production' } });
    const { result } = renderHook(() => useReadinessSignals('my-api'), { wrapper: wrapper() });
    expect(result.current.signals.two_plus_replicas.status).toBe('unknown');
    expect(result.current.signals.logs_healthy.status).toBe('unknown');
    expect(result.current.signals.hpa_configured.status).toBe('unknown');
    expect(result.current.signals.cache_hit_rate.status).toBe('unknown');
  });

  it('does not read several desired replicas as an HPA', () => {
    mockAllSettled({
      status: { project: 'my-api', environment: 'production', replicas_desired: 5, replicas_ready: 5 },
    });
    const { result } = renderHook(() => useReadinessSignals('my-api'), { wrapper: wrapper() });
    expect(result.current.signals.hpa_configured.status).toBe('unknown');
  });

  it('test_use_readiness_signals_no_flicker_until_all_settled (EC-6)', () => {
    mockedUseProjects.mockReturnValue({ projects: [], total: 0, loading: true } as any);
    mockedUseProjectStatus.mockReturnValue({ status: null, loading: false, error: false } as any);
    const { result } = renderHook(() => useReadinessSignals('my-api'), { wrapper: wrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.score).toBeNull();
  });

  it('test_use_readiness_signals_score_rounding_ceil_canonical (EC-8)', () => {
    // SIGNALS weights sum exactly to 100 by construction; assert it so the
    // boundary cases below are stable against future weight tweaks.
    expect(TOTAL_WEIGHT).toBe(100);

    // Direct test of the score function via the test-only export — exercises
    // the EC-8 boundary cases without re-mocking 3 hooks.
    const buildSig = (name: any, status: any, weight: number) => ({
      name, status, weight, fixPath: '',
    });

    // 89.4/100 → ceil(89.4) = 90
    const synth1: any = Object.fromEntries(
      SIGNALS.map((s) => [s.name, buildSig(s.name, 'unknown', s.weight)]),
    );
    synth1.auto_deploy = buildSig('auto_deploy', 'pass', 89.4);
    synth1.hpa_configured = buildSig('hpa_configured', 'fail', 10.6);
    expect(__test_computeScore(synth1)).toBe(90);

    // 90.0 boundary
    const synth2: any = Object.fromEntries(
      SIGNALS.map((s) => [s.name, buildSig(s.name, 'unknown', s.weight)]),
    );
    synth2.auto_deploy = buildSig('auto_deploy', 'pass', 90);
    synth2.hpa_configured = buildSig('hpa_configured', 'fail', 10);
    expect(__test_computeScore(synth2)).toBe(90);

    // 100% pass
    const synth3: any = Object.fromEntries(
      SIGNALS.map((s) => [s.name, buildSig(s.name, 'pass', s.weight)]),
    );
    expect(__test_computeScore(synth3)).toBe(100);

    // 0% (all unknown) → returns 0 sentinel; ScoreCard renders as "—".
    const synth4: any = Object.fromEntries(
      SIGNALS.map((s) => [s.name, buildSig(s.name, 'unknown', s.weight)]),
    );
    expect(__test_computeScore(synth4)).toBe(0);
  });
});
