import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockUseEngineApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  useEngineApi: () => mockUseEngineApi(),
  useCloudApi: () => mockUseEngineApi(),
}));

import { EnvironmentsPage } from './environments';

describe('EnvironmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_environments_renders_table_with_headers', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'prod', status: 'live', projects: 3, protected: true },
        ],
      },
      loading: false,
      error: false,
    });
    render(<EnvironmentsPage />);
    // J-10 v1.1 + M2 v1.2 surface: Name, Health, Status, Protected (no
    // Domain column — that was removed before J-10 v1.1 shipped).
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getAllByText('Protected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('prod')).toBeInTheDocument();
  });

  it('test_environments_status_dot_reflects_state', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'prod', status: 'live', projects: 1, protected: false },
          { name: 'staging', status: 'failed', projects: 0, protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    render(<EnvironmentsPage />);
    // T-D.2 (P-4): StatusDot label title-cased via statusLabel helper.
    // 'live' → 'Live', 'failed' → 'Failed'.
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  // T-D.2 EC-9: multi-word snake_case status title-cased
  it('test_environments_status_label_title_cases_multi_word', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'pr-1247', status: 'pending_verification', projects: 1, protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    render(<EnvironmentsPage />);
    // EC-9: 'pending_verification' should render as 'Pending Verification',
    // NOT 'Pending_verification' (broken cap-only-first behavior).
    expect(screen.getByText('Pending Verification')).toBeInTheDocument();
  });

  // J-10 v1.1 surface: protected envs render Lock + "Protected" label
  // (the v1.0 Domain column was removed). This replaces the legacy
  // test_environments_timestamp_relative_format placeholder.
  it('test_environments_protected_env_renders_lock_indicator', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'prod', status: 'live', projects: 5, protected: true },
        ],
      },
      loading: false,
      error: false,
    });
    render(<EnvironmentsPage />);
    // "Protected" appears as table header AND as cell indicator.
    expect(screen.getAllByText('Protected').length).toBeGreaterThanOrEqual(2);
  });

  // Replaces the v1.0 copy-button test. Delete button is hidden for
  // protected envs (J-10 source line 263-275); unprotected envs render
  // it with aria-label `Delete <name>`.
  it('test_environments_unprotected_env_renders_delete_button', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'staging', status: 'live', projects: 1, protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    render(<EnvironmentsPage />);
    expect(screen.getByLabelText('Delete staging')).toBeInTheDocument();
  });

  // ===========================================================================
  // M20 — environments are project-scoped (route /projects/:name/environments).
  // The project is the ROUTE param, not a guess. The page shows only THIS
  // project's environments.
  // ===========================================================================

  function renderAt(path: string) {
    return render(
      <Routes>
        <Route path="/projects/:name/environments" element={<EnvironmentsPage />} />
      </Routes>,
      { initialEntries: [path] },
    );
  }

  it('test_M20_scopes_to_the_route_project_only', () => {
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'staging', status: 'active', project: 'web', protected: false },
          { name: 'production', status: 'active', project: 'web', protected: true },
          { name: 'qa', status: 'active', project: 'api', protected: false }, // other project
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/web/environments');
    // web's envs are shown…
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    // …and another project's env is NOT (no cross-project mixing).
    expect(screen.queryByText('qa')).not.toBeInTheDocument();
  });

  it('test_M20_uses_route_project_not_a_guess', () => {
    // The page must scope by the ROUTE param (api), never a guessed first
    // project or the old 'teste' fixture.
    mockUseEngineApi.mockReturnValue({
      data: {
        environments: [
          { name: 'production', status: 'active', project: 'web', protected: true },
          { name: 'preview', status: 'active', project: 'api', protected: false },
        ],
      },
      loading: false,
      error: false,
    });
    renderAt('/projects/api/environments');
    expect(screen.getByText('preview')).toBeInTheDocument();
    expect(screen.queryByText('production')).not.toBeInTheDocument();
    expect(screen.getByText(/environments for api/i)).toBeInTheDocument();
  });
});
