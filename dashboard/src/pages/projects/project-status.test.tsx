import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';
import { Routes, Route } from 'react-router-dom';
import type { ProjectStatusDetail } from '@/lib/api/types';

// Mock useProjectStatus + useStatusStream so the page renders deterministically.
const mockUseProjectStatus = vi.fn();
vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: () => mockUseProjectStatus(),
}));
vi.mock('@/hooks/projects/use-status-stream', () => ({
  useStatusStream: () => ({ connected: false, signals: [] }),
}));
// J-18 KPI metrics: default null (renders "—") so the existing tests are
// unaffected; the wiring test overrides it per-signal.
const mockUseKpiMetric = vi.fn(
  (_n: string, _e: string | undefined, _signal: string, _mult?: number): number | null => null,
);
vi.mock('@/hooks/projects/use-kpi-metric', () => ({
  useKpiMetric: (n: string, e: string | undefined, signal: string, mult?: number) =>
    mockUseKpiMetric(n, e, signal, mult),
  // Same mock behind the reading the page uses: `collecting` only when a test sets it.
  useKpiReading: (n: string, signal: string, mult?: number) => ({
    value: mockUseKpiMetric(n, signal, signal, mult),
    collecting: mockCollecting.has(signal),
  }),
}));
const mockCollecting = new Set<string>();
// useRequireAuth is no-op in tests.
vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => undefined,
}));

import { ProjectStatusPage } from './project-status';

// Reset the KPI metric mock to the default (null → "—") before each test so a
// per-test mockImplementation never leaks into another test.
beforeEach(() => {
  mockUseKpiMetric.mockReset();
  mockUseKpiMetric.mockReturnValue(null);
  mockCollecting.clear();
});

function renderAt(path: string) {
  return render(
    <Routes>
      <Route path="/projects/:name/status" element={<ProjectStatusPage />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

function makeStatus(overrides: Partial<ProjectStatusDetail> = {}): ProjectStatusDetail {
  return {
    project: 'loopzero-example',
    environment: 'production',
    metrics_range_url: '',
    prom_query_keys: [],
    ...overrides,
  } as ProjectStatusDetail;
}

describe('ProjectStatusPage — Red Team loop-console#98 closure', () => {
  // Repro per #98 verbatim: a project with 12 builds, ALL environment=preview,
  // queried at ?env=production. Engine emits status.last_build=null +
  // active_release=null + other_envs_with_releases=[{environment:'preview',
  // has_release:true}] (per the loopscale @1100fd95 closure of #70/#62).
  //
  // The dashboard MUST surface that honest "no production deploy yet" copy
  // (NOT 'Progressing'), and MUST stop the perpetual 5s auto-refresh blurb.
  it('preview-only project: shows "No production deployment yet" empty state instead of Progressing', () => {
    mockUseProjectStatus.mockReturnValue({
      status: makeStatus({
        last_build: undefined,
        active_release: undefined,
        other_envs_with_releases: [
          { environment: 'preview', has_release: true },
        ],
      }),
      loading: false,
      error: null,
    });

    renderAt('/projects/loopzero-example/status');

    // RED #98: must NOT default to 'Progressing'.
    expect(screen.queryByText(/^Progressing$/)).not.toBeInTheDocument();
    // RED #98: must show the honest empty-state copy.
    expect(
      screen.getByText(/no production deployment yet/i),
    ).toBeInTheDocument();
    // RED #98: the misleading "Auto-refresh every 5s" subtitle must NOT
    // appear when there's nothing to refresh.
    expect(screen.queryByText(/auto-refresh every 5s/i)).not.toBeInTheDocument();
  });

  // B-242 — the anchor for `queryByText(/^Progressing$/)` above. No case in this file ever rendered
  // that word, so the denial was satisfied by the honest empty state AND by a page that stopped
  // producing the label at all: rename it at `project-status.tsx:220` and the #98 regression test
  // stays green while having stopped guarding #98. This case renders it, so the word is now under
  // test on both sides.
  it('B-242 — a release that is present but NOT active DOES show "Progressing"', () => {
    mockUseProjectStatus.mockReturnValue({
      status: makeStatus({
        active_release: {
          id: 'rel-1',
          build_id: 'bld-1',
          status: 'PENDING', // present, not ACTIVE — the branch that produces the label
          created_at: '2026-06-27T10:00:00Z',
        },
      }),
      loading: false,
      error: null,
    });

    renderAt('/projects/loopzero-example/status');

    expect(screen.getByText(/^Progressing$/)).toBeInTheDocument();
  });

  // Negative-axis regression-protector: when a real production active_release
  // is present AND there is at least one proof of serving (replicas_ready > 0),
  // the existing UI continues to render (Status: Healthy + the auto-refresh
  // subtitle).
  // Red Team loop-console#124 contract: Healthy requires release-active AND a
  // serving signal — `scaling.replicas` OR `replicas_ready` > 0.
  it('production active release WITH replica proof: still shows Healthy + auto-refresh subtitle (happy path preserved)', () => {
    mockUseProjectStatus.mockReturnValue({
      status: makeStatus({
        environment: 'production',
        active_release: {
          id: 'rel-1',
          build_id: 'bld-1',
          status: 'ACTIVE',
          created_at: '2026-06-27T10:00:00Z',
        },
        last_build: {
          id: 'bld-1',
          status: 'SUCCEEDED',
          commit_sha: 'abc123',
          created_at: '2026-06-27T10:00:00Z',
        },
        url: 'https://acme-prod.getloopscale.com',
        // Serving proof: replicas_ready > 0 corroborates the data plane is up.
        replicas_ready: 2,
        replicas_desired: 2,
      }),
      loading: false,
      error: null,
    });

    renderAt('/projects/acme/status');

    // Auto-refresh blurb still visible on the happy path.
    expect(screen.getByText(/auto-refresh every 5s/i)).toBeInTheDocument();
    // The page is named after its menu entry, "Health"; the route keeps /status.
    expect(screen.getByRole('heading', { name: 'Health' })).toBeInTheDocument();
    expect(document.title).toContain('acme · Health');
  });

  // J-18 — the KPI strip renders the current metric value derived from the
  // metrics_proxy (via useKpiMetric), formatted by the SignalGrid.
  it('renders the current uptime KPI from the metrics_proxy (99.5 → "99.50%")', () => {
    mockUseKpiMetric.mockImplementation((_n, signal) =>
      signal === 'uptime_24h' ? 99.5 : null,
    );
    mockUseProjectStatus.mockReturnValue({
      status: makeStatus({
        environment: 'production',
        active_release: {
          id: 'rel-1',
          build_id: 'bld-1',
          status: 'ACTIVE',
          created_at: '2026-06-27T10:00:00Z',
        },
        last_build: {
          id: 'bld-1',
          status: 'SUCCEEDED',
          commit_sha: 'abc123',
          created_at: '2026-06-27T10:00:00Z',
        },
        url: 'https://acme-prod.getloopscale.com',
        replicas_ready: 2,
        replicas_desired: 2,
      }),
      loading: false,
      error: null,
    });

    renderAt('/projects/acme/status');

    // Rendered in both the KPI strip card and the SignalGrid uptime pill.
    expect(screen.getAllByText('99.50%').length).toBeGreaterThanOrEqual(1);
  });
});

// Red Team loop-console#124 — health-truth divergence.
// Repro (LIVE 2026-06-30): build SUCCEEDED + release ACTIVE + sync_status=synced +
// URL populated, BUT the Live URL serves HTTP 502 sustained ~13min. The dashboard
// emitted `Status: Healthy` based on `active_release.status === 'ACTIVE'` alone,
// without consulting ANY data-plane signal (replicas_ready / 5xx / alerts).
// Family of #41/#77/#94 — the platform must not assert "healthy" without proof
// of serving. The fix makes the SignalGrid status verdict signal-aware: emits
// 'Unknown' when release is ACTIVE but every serving signal is absent.
describe('ProjectStatusPage — Red Team loop-console#124 closure (health-truth)', () => {
  it('active release + sync synced + URL populated BUT zero serving signals → Status: Unknown, NOT Healthy', () => {
    mockUseProjectStatus.mockReturnValue({
      status: makeStatus({
        environment: 'preview',
        active_release: {
          id: 'rel-8871a12bedc024dc',
          build_id: 'build-c9d67ba338ef6a28',
          status: 'ACTIVE',
          created_at: '2026-06-30T15:36:16Z',
        },
        last_build: {
          id: 'build-c9d67ba338ef6a28',
          status: 'SUCCEEDED',
          commit_sha: '013e5ca017a1f01b04fa3850f40d1f7392266674',
          created_at: '2026-06-30T15:28:49Z',
        },
        sync_status: 'synced',
        url: 'https://tn-0f13cba71527997c-loopzero-example-app-preview.prod-dev.getloopscale.com',
        // Repro: NO scaling, NO replicas_ready, NO 5xx, NO alerts. The
        // control plane is fully green but the data plane is unproven.
      }),
      loading: false,
      error: null,
    });

    renderAt('/projects/loopzero-example/status');

    // Pre-fix (#124 verbatim): UI showed `Status: Healthy` here.
    // Post-fix: must emit `Status: Unknown` because nothing on the response
    // proves the data plane is serving. ACTIVE = sync confirmed by ArgoCD;
    // `synced ≠ serving`. Pod may be 502 (CrashLoop / ImagePull / network).
    expect(screen.queryByRole('button', { name: /Status: Healthy/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Status: Unknown/i })).toBeInTheDocument();
  });
});

describe('ProjectStatusPage — replicas and collecting signals', () => {
  const activeStatus = (extra: Partial<ProjectStatusDetail>) =>
    makeStatus({
      environment: 'production',
      active_release: { id: 'rel-1', build_id: 'bld-1', status: 'ACTIVE', created_at: '2026-11-25T10:00:00Z' },
      ...extra,
    });

  it('reads ready replicas from the metrics signal when the status does not carry them', () => {
    // Staging: the status had no replicas_ready while signal=replicas_ready answered 2 (#553).
    mockUseKpiMetric.mockImplementation((_n, signal) => (signal === 'replicas_ready' ? 2 : null));
    mockUseProjectStatus.mockReturnValue({ status: activeStatus({}), loading: false, error: null });
    renderAt('/projects/acme/status');
    expect(screen.getByLabelText('Project KPI strip')).toHaveTextContent(/Replicas2/);
  });

  // A rollback makes an old release serve again. Its creation time read as "18m ago" five
  // minutes after the rollback, while the API answered the real moment in last_deploy_at.
  it('dates the last deploy by last_deploy_at, not by the creation of the release', () => {
    mockUseKpiMetric.mockReturnValue(null);
    mockUseProjectStatus.mockReturnValue({
      status: activeStatus({ last_deploy_at: new Date(Date.now() - 5 * 60_000).toISOString() }),
      loading: false,
      error: null,
    });
    renderAt('/projects/acme/status');
    expect(screen.getByText('Last deploy').closest('button, div')).toHaveTextContent(/5m ago/);
  });

  // Staging read "Healthy" beside an error rate of 20% (#615). The pill applies the 5xx bands
  // of the Readiness screen to the worst of the two readings the page has.
  it.each([
    [0, 0, 'Healthy'],
    [0.02, 0, 'Degraded'],
    [0.2, 0, 'Unhealthy'],
    [0, 20, 'Unhealthy'],
    [undefined, 0.03, 'Degraded'],
  ])('a 5xx share of %s over the hour and %s now reads %s', (hourPct, nowPct, label) => {
    mockUseKpiMetric.mockImplementation((_n, signal) => (signal === 'error_rate' ? nowPct : null));
    mockUseProjectStatus.mockReturnValue({
      status: activeStatus({ replicas_ready: 2, traffic_5xx_pct_1h: hourPct as number | undefined }),
      loading: false,
      error: null,
    });
    renderAt('/projects/acme/status');
    expect(screen.getByLabelText(`Status: ${String(label)}`)).toBeInTheDocument();
  });

  it('prefers replicas_ready from the status response', () => {
    mockUseKpiMetric.mockImplementation((_n, signal) => (signal === 'replicas_ready' ? 1 : null));
    mockUseProjectStatus.mockReturnValue({
      status: activeStatus({ replicas_ready: 3 }),
      loading: false,
      error: null,
    });
    renderAt('/projects/acme/status');
    expect(screen.getByLabelText('Project KPI strip')).toHaveTextContent(/Replicas3/);
  });

  it('says uptime is being collected when the API answers collecting', () => {
    mockCollecting.add('uptime_24h');
    mockUseProjectStatus.mockReturnValue({
      status: activeStatus({ replicas_ready: 2 }),
      loading: false,
      error: null,
    });
    renderAt('/projects/acme/status');
    expect(screen.getByLabelText('Project KPI strip')).toHaveTextContent(/Uptime 24hCollecting…/);
  });
});
