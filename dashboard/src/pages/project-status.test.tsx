import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { Routes, Route } from 'react-router-dom';
import type { ProjectStatusDetail } from '@/lib/api/types';

// Mock useProjectStatus + useStatusStream so the page renders deterministically.
const mockUseProjectStatus = vi.fn();
vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: () => mockUseProjectStatus(),
}));
vi.mock('@/hooks/use-status-stream', () => ({
  useStatusStream: () => ({ connected: false, signals: [] }),
}));
// useRequireAuth is no-op in tests.
vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => undefined,
}));

import { ProjectStatusPage } from './project-status';

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
    project: 'theokit-example',
    environment: 'production',
    metrics_range_url: '',
    prom_query_keys: [],
    ...overrides,
  } as ProjectStatusDetail;
}

describe('ProjectStatusPage — Red Team theo-cloud#98 closure', () => {
  // Repro per #98 verbatim: a project with 12 builds, ALL environment=preview,
  // queried at ?env=production. Engine emits status.last_build=null +
  // active_release=null + other_envs_with_releases=[{environment:'preview',
  // has_release:true}] (per the theo @1100fd95 closure of #70/#62).
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

    renderAt('/projects/theokit-example/status');

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

  // Negative-axis regression-protector: when a real production active_release
  // is present, the existing UI continues to render (Status: Healthy + the
  // auto-refresh subtitle).
  it('production active release: still shows Healthy + auto-refresh subtitle (happy path preserved)', () => {
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
        url: 'https://acme-prod.usetheo.dev',
      }),
      loading: false,
      error: null,
    });

    renderAt('/projects/acme/status');

    // Auto-refresh blurb still visible on the happy path.
    expect(screen.getByText(/auto-refresh every 5s/i)).toBeInTheDocument();
  });
});
