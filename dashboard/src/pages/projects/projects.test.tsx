import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, fireEvent } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockUseProjects = vi.fn();
vi.mock('@/hooks/projects/use-projects', () => ({
  useProjects: () => mockUseProjects(),
}));

import { ProjectsPage } from './projects';

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_projects_renders_grid_of_cards', () => {
    mockUseProjects.mockReturnValue({
      projects: [
        { name: 'alpha', apps: [], last_deploy: '2026-05-23' },
        { name: 'beta', apps: [], last_deploy: '2026-05-22' },
      ],
      loading: false,
    });
    render(<ProjectsPage />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('test_projects_empty_state_when_no_data', () => {
    mockUseProjects.mockReturnValue({ projects: [], loading: false });
    render(<ProjectsPage />);
    // Sprint 3 T3.3: EmptyProjectsHero replaces PageShell.empty when projects.length === 0.
    // Hero shows hero title + 3 template cards.
    // Sprint 4 qa-sprint4-cleanup-2026-06-25 #32 (closes "theo init" inexistente):
    // per-template names — Next.js → my-nextjs-app, Express → my-express-api, Go → my-go-service.
    // Plain "Or from your own repo" block uses `theo project create my-app`.
    expect(screen.getByText('Deploy your first project')).toBeInTheDocument();
    // Multiple "theo project create …" matches expected — assert at least one
    expect(screen.getAllByText(/theo project create/i).length).toBeGreaterThan(0);
    // EC-5 absorption: per-template names lock the UX signal — the 3 starter
    // cards must emit DISTINCT cliCommand strings (NOT identical `my-app`).
    expect(screen.getByText('theo project create my-nextjs-app')).toBeInTheDocument();
    expect(screen.getByText('theo project create my-express-api')).toBeInTheDocument();
    expect(screen.getByText('theo project create my-go-service')).toBeInTheDocument();
    // Defense: legacy misleading `theo init` strings MUST be gone.
    expect(screen.queryByText(/theo init/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create project from dashboard/i }),
    ).toBeInTheDocument();
  });

  it('test_projects_loading_state_renders_skeleton', () => {
    // Post Brief #5 migration: DataTable loading state renders 5 skeleton
    // rows (replaced standalone Loader2 spinner with built-in skeleton).
    // Skeleton elements have `aria-busy="true"` or role="status".
    mockUseProjects.mockReturnValue({ projects: [], loading: true });
    const { container } = render(<ProjectsPage />);
    // DataTable renders skeleton with aria-busy on body
    expect(container.querySelector('[aria-busy="true"], [role="status"]')).toBeInTheDocument();
  });

  it('test_projects_search_filters_by_name', async () => {
    mockUseProjects.mockReturnValue({
      projects: [
        { name: 'alpha', apps: [] },
        { name: 'beta', apps: [] },
      ],
      loading: false,
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    const search = screen.getByPlaceholderText('Search projects...');
    await user.type(search, 'alp');
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('beta')).not.toBeInTheDocument();
  });

  // Red Team theo-cloud#57 re-open: the page-level search input on /projects
  // is rendered by PageShell.search (packaged @usetheo/ui ActionBar) which
  // did NOT carry aria-label. A patch-package patch derives aria-label from
  // the placeholder so screen readers announce the field even after the
  // user starts typing (placeholder vanishes).
  it('page-level search input has aria-label derived from placeholder (#57 re-open)', () => {
    mockUseProjects.mockReturnValue({ projects: [], loading: false });
    render(<ProjectsPage />);
    expect(screen.getByLabelText('Search projects')).toBeInTheDocument();
  });

  // Red Team theo-cloud#77 re-open (2026-06-28): the engine
  // MapProjectStatus returns last_deploy_status='live' for theokit-example
  // even when production_env_count===0 AND latest_build_environment==='preview'
  // (preview-only project). The /projects table MUST derive isPreviewOnly
  // from those two fields and render the "Preview" badge regardless of
  // the engine's misleading 'live' verdict. User-path proof per
  // feedback_ready_to_read_team_user_path_not_serverside_2026_06_25.
  it('renders Preview badge when production_env_count=0 and latest_build_environment=preview, overriding last_deploy_status=live (#77 re-open)', () => {
    mockUseProjects.mockReturnValue({
      projects: [
        {
          name: 'theokit-example',
          last_deploy_status: 'live',
          production_env_count: 0,
          latest_build_environment: 'preview',
          apps: [],
        },
      ],
      loading: false,
    });
    render(<ProjectsPage />);
    expect(screen.getByText('theokit-example')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  // Red Team theo-cloud#77 second-pass (2026-06-29): the previous fix
  // required production_env_count===0, but the LIVE state captured is
  // production_env_count===1 (env PROVISIONED but with active_release=null)
  // — the latest deploy was preview, prod was never released. Detail
  // page correctly says "URL PENDING / no production release" yet the
  // list shows "Live". Per Red Team prescription: badge MUST derive
  // from `latest_build_environment === 'preview'` ALONE (preview deploy
  // ⇒ preview badge), regardless of prod env shell existence.
  it('renders Preview badge when production_env_count=1 but latest_build_environment=preview (env provisioned, no prod release — #77 second-pass)', () => {
    mockUseProjects.mockReturnValue({
      projects: [
        {
          name: 'theokit-example',
          last_deploy_status: 'live',
          production_env_count: 1,
          latest_build_environment: 'preview',
          apps: [],
        },
      ],
      loading: false,
    });
    render(<ProjectsPage />);
    expect(screen.getByText('theokit-example')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  // T4.2 of plan dashboard-badge-data-plane-poller closing Red Team
  // theo-cloud#128 (badge lies "Live" when control-plane ACTIVE +
  // data-plane 502). 4-state derivation Live/Deployed/Unknown/Down
  // from the DataPlanePoller snapshot surfaced via last_replicas_ready_*.
  // Time-frozen against 2026-07-01T12:00:00Z so the staleness math is
  // deterministic (avoids Date.now() drift between test start and assert).
  describe('4-state data-plane-aware badge (#128)', () => {
    const NOW = new Date('2026-07-01T12:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Test A — replicas>0 AND staleness < LIVE_MS (90s) → Live badge.
    // The canonical Live case: poller has fresh evidence the data plane
    // is serving at least one replica.
    it('renders Live badge when last_replicas_ready_value=3 and snapshot is fresh (#128 test A)', () => {
      mockUseProjects.mockReturnValue({
        projects: [
          {
            name: 'hello-world',
            last_deploy_status: 'live',
            production_env_count: 1,
            latest_build_environment: 'production',
            last_replicas_ready_value: 3,
            last_replicas_ready_at: '2026-07-01T11:59:30Z', // 30s ago — fresh
            apps: [],
          },
        ],
        loading: false,
      });
      render(<ProjectsPage />);
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    // Test B — Red Team #128 core regression test. replicas=0 with fresh
    // scrape MUST NOT render Live; renders Down instead so the operator
    // sees the honest verdict that matches HTTP 502.
    it('renders Down badge (not Live) when last_replicas_ready_value=0 with fresh scrape (#128 test B, core regression)', () => {
      mockUseProjects.mockReturnValue({
        projects: [
          {
            name: 'hello-world',
            last_deploy_status: 'live',
            production_env_count: 1,
            latest_build_environment: 'production',
            last_replicas_ready_value: 0,
            last_replicas_ready_at: '2026-07-01T11:59:30Z', // 30s ago
            apps: [],
          },
        ],
        loading: false,
      });
      render(<ProjectsPage />);
      expect(screen.getByText('Down')).toBeInTheDocument();
      expect(screen.queryByText('Live')).not.toBeInTheDocument();
    });

    // Test C — replicas>0 but staleness in [LIVE_MS, DEPLOYED_MS) window
    // (90s < age < 5min) → Deployed badge. The data plane was serving at
    // last scrape but the signal is not fresh enough to assert "Live" — a
    // less committal verdict prevents false Live during Prometheus hiccups.
    it('renders Deployed badge when replicas=3 but snapshot is 2 minutes old (#128 test C, staleness in Deployed window)', () => {
      mockUseProjects.mockReturnValue({
        projects: [
          {
            name: 'hello-world',
            last_deploy_status: 'live',
            production_env_count: 1,
            latest_build_environment: 'production',
            last_replicas_ready_value: 3,
            last_replicas_ready_at: '2026-07-01T11:58:00Z', // 2 min ago
            apps: [],
          },
        ],
        loading: false,
      });
      render(<ProjectsPage />);
      expect(screen.getByText('Deployed')).toBeInTheDocument();
      expect(screen.queryByText('Live')).not.toBeInTheDocument();
    });

    // Test D — no snapshot yet (both fields absent). Cleanroom warm-up
    // window before the first DataPlanePoller tick populates the row.
    // Absence is honestly reported as Unknown — NOT collapsed to Live/Down.
    it('renders Unknown badge when last_replicas_ready_* fields are absent (#128 test D, cold Cleanroom)', () => {
      mockUseProjects.mockReturnValue({
        projects: [
          {
            name: 'hello-world',
            last_deploy_status: 'live',
            production_env_count: 1,
            latest_build_environment: 'production',
            // last_replicas_ready_value + last_replicas_ready_at intentionally
            // omitted — the poller has not emitted a snapshot yet.
            apps: [],
          },
        ],
        loading: false,
      });
      render(<ProjectsPage />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    // Test E — snapshot exists but staleness > UNKNOWN_MS (5 min).
    // Prometheus outage OR poller crashed OR scrape target gone. The
    // stale signal is not evidence — degrade to Unknown, not "Live".
    it('renders Unknown badge when snapshot is 10 minutes stale (#128 test E, Prometheus outage)', () => {
      mockUseProjects.mockReturnValue({
        projects: [
          {
            name: 'hello-world',
            last_deploy_status: 'live',
            production_env_count: 1,
            latest_build_environment: 'production',
            last_replicas_ready_value: 3,
            last_replicas_ready_at: '2026-07-01T11:50:00Z', // 10 min ago
            apps: [],
          },
        ],
        loading: false,
      });
      render(<ProjectsPage />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
      expect(screen.queryByText('Live')).not.toBeInTheDocument();
    });
  });
});

// J-07 D4 — multi-select surfaces the bulk-delete action bar.
describe('ProjectsPage bulk select (J-07 D4)', () => {
  it('test_selecting_a_project_shows_bulk_delete_action_bar', async () => {
    mockUseProjects.mockReturnValue({
      projects: [
        { name: 'alpha', last_deploy_status: 'idle' },
        { name: 'beta', last_deploy_status: 'idle' },
      ],
      total: 2,
      loading: false,
    });
    render(<ProjectsPage />);
    // No action bar until something is selected.
    expect(screen.queryByRole('button', { name: /delete 1 project/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select alpha'));
    expect(screen.getByRole('button', { name: /delete 1 project/i })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
