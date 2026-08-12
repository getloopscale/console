import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ name: 'my-project' }),
    useNavigate: () => vi.fn(),
  };
});

const mockUseCloudApi = vi.fn();
const mockUseEngineApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  useCloudApi: (path: string, opts?: { enabled?: boolean }) => mockUseCloudApi(path, opts),
  useEngineApi: (path: string, opts?: { enabled?: boolean }) => mockUseEngineApi(path, opts),
}));

// PageMetaProvider is consumed by the test render helper — preserve real export.
vi.mock('@/hooks/use-page-meta', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-page-meta')>('@/hooks/use-page-meta');
  return { ...actual, useSetPageTitle: () => {} };
});

const mockUseProject = vi.fn();
vi.mock('@/hooks/projects/use-project', () => ({
  useProject: () => mockUseProject(),
}));

const mockUseProjectStatus = vi.fn(() => ({ status: null as unknown, loading: false }));
vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: () => mockUseProjectStatus(),
}));

const mockUseDeployments = vi.fn(() => ({ builds: [], loading: false }));
vi.mock('@/hooks/projects/use-deployments', () => ({
  useDeployments: () => mockUseDeployments(),
}));

// J-08 Deploy CTA: stub the dialog so the test isolates the page wiring
// (button → open state → dialog receives open + sourceBuild) from the real
// dialog's mutation/QueryClient internals.
vi.mock('@/components/dialogs/redeploy-dialog', () => ({
  RedeployDialog: ({ open, sourceBuild }: { open: boolean; sourceBuild?: { commit_sha: string } }) =>
    open ? <div data-testid="redeploy-dialog">redeploy {sourceBuild?.commit_sha}</div> : null,
}));

import { ProjectDetailPage } from './project-detail';

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjectStatus.mockReturnValue({ status: null, loading: false });
    mockUseCloudApi.mockReturnValue({ data: null, loading: false, error: false, isSuccess: true });
    mockUseEngineApi.mockReturnValue({ data: null, loading: false, error: false, isSuccess: true });
    // Default project that satisfies the existing test suite. Per-test
    // overrides re-mock with the scenario-specific shape.
    mockUseProject.mockReturnValue({
      project: {
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
      },
      loading: false,
    });
  });

  it('test_project_detail_heading_hierarchy_h1_to_h2_no_skip_closes_25', () => {
    // Sprint 3 Phase 5 (#25) v1.1 — WCAG 1.3.1 Info and Relationships.
    // PageShell renders the page h1 (project name); Card.Title default of h3
    // was promoted to h2 via asChild so AT navigation under the page heading
    // is unbroken (no level skip).
    render(<ProjectDetailPage />);
    const headings = screen.getAllByRole('heading');
    const levels = headings.map((h) => parseInt(h.tagName.slice(1), 10));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
    }
    // At least one h2 must exist (the Card.Title we promoted via asChild).
    expect(levels).toContain(2);
  });

  // Red Team theo-cloud#41 regression-protector (2026-06-27 UI follow-up):
  // when production_env_count === 0 AND latest_build_environment ===
  // 'preview', the LiveUrlHero MUST render the "Preview only" empty
  // state — NOT the misleading "URL pending" hint. Catches the case
  // where the mapper's `last_deploy_status` field is NOT 'preview' (e.g.
  // a failed preview build still mapped to 'failed' via the legacy path)
  // but the SQL signals still indicate preview-only project shape.
  it('test_project_detail_renders_preview_only_when_no_prod_env_and_preview_build (#41)', () => {
    mockUseProject.mockReturnValue({
      project: {
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
        last_deploy_status: 'failed',  // legacy mapper path; NOT 'preview'
        production_env_count: 0,        // canonical signal — no production env
        environment_count: 0,
        latest_build_environment: 'preview',
      },
      loading: false,
    });
    render(<ProjectDetailPage />);
    // The hero MUST surface the preview-only copy + Badge.
    expect(screen.getByText(/Preview deploys only/i)).toBeInTheDocument();
    expect(screen.getByText(/Preview only/i)).toBeInTheDocument();
    // The misleading default copy MUST NOT render.
    expect(screen.queryByText(/URL pending/i)).not.toBeInTheDocument();
  });

  // Red Team theo-cloud#41 regression-protector: the "Live envs" metric
  // MUST come from production_env_count (kind='permanent' subset), NOT
  // the legacy environment_count which collapses preview env_targets.
  // The Red Team scenario: environment_count=1 but production_env_count=0
  // → "Live envs" must show 0 (truth), not 1 (legacy bug).
  // Red Team theo-cloud#97 closure: each "Recent deployments" row MUST
  // surface status + environment badges so the user can tell a failed
  // preview deploy apart from a successful one.
  it('renders status + environment badges per Recent deployments row (#97)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockUseDeployments as any).mockReturnValueOnce({
      builds: [
        {
          build_id: 'b1',
          commit_sha: 'abc1234abcdefabcdef',
          created_by: 'paulo',
          environment: 'preview',
          status: 'succeeded',
          started_at: '2026-06-27T10:00:00Z',
        },
        {
          build_id: 'b2',
          commit_sha: 'def5678abcdefabcdef',
          created_by: 'paulo',
          environment: 'preview',
          status: 'failed',
          started_at: '2026-06-27T09:00:00Z',
        },
      ],
      loading: false,
    });
    render(<ProjectDetailPage />);
    // Both badges (succeeded + failed) MUST render somewhere on the page.
    expect(screen.getByText(/^succeeded$/i)).toBeInTheDocument();
    expect(screen.getByText(/^failed$/i)).toBeInTheDocument();
    // Environment text MUST render too — verifies the env badge fires.
    expect(screen.getAllByText(/^preview$/i).length).toBeGreaterThanOrEqual(2);
  });

  it('test_project_detail_uses_production_env_count_for_live_envs_metric (#41)', () => {
    mockUseProject.mockReturnValue({
      project: {
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
        last_deploy_status: 'live',
        environment_count: 1,
        production_env_count: 0,
        latest_build_environment: 'preview',
      },
      loading: false,
    });
    render(<ProjectDetailPage />);
    const liveEnvsLabel = screen.getByText(/Live envs/i);
    const liveEnvsValueNode = liveEnvsLabel.parentElement?.querySelector('.tabular-nums');
    expect(liveEnvsValueNode?.textContent).toBe('0');
  });

  // Red Team theo-cloud#134 regression-protector: preview env WITH an
  // ACTIVE release + Live URL serving MUST render "Live envs: 1" — the
  // pre-fix legacy semantics used production_env_count which returned 0
  // for preview-only projects, contradicting the Live URL exposed on
  // the SAME page. active_env_count is the new canonical field that
  // counts env_targets (any kind) with a corresponding release ACTIVE.
  it('test_project_detail_uses_active_env_count_for_live_envs_metric (#134)', () => {
    mockUseProject.mockReturnValue({
      project: {
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
        last_deploy_status: 'live',
        environment_count: 1,
        production_env_count: 0, // no permanent env wired (preview-only)
        active_env_count: 1,     // preview env has ACTIVE release
        latest_build_environment: 'preview',
      },
      loading: false,
    });
    render(<ProjectDetailPage />);
    const liveEnvsLabel = screen.getByText(/Live envs/i);
    const liveEnvsValueNode = liveEnvsLabel.parentElement?.querySelector('.tabular-nums');
    expect(liveEnvsValueNode?.textContent).toBe('1');
  });

  // J-08 Project Detail Overview — the product's center page needs a primary
  // "Deploy" action (Vercel-parity). It reuses RedeployDialog with the active
  // release build as source (clone last-good commit + env, submit fresh build).
  describe('J-08 Deploy primary CTA', () => {
    const buildFixture = {
      build_id: 'b-active',
      commit_sha: 'abc1234def5678',
      status: 'SUCCEEDED',
      environment: 'production',
      created_at: '2026-06-02T00:00:00Z',
    };

    it('renders a Deploy primary action and opens the redeploy dialog with the active build', () => {
      (mockUseDeployments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        builds: [buildFixture],
        loading: false,
      });
      render(<ProjectDetailPage />);
      const deployBtn = screen.getByRole('button', { name: 'Deploy' });
      expect(deployBtn).toBeInTheDocument();
      // Dialog is closed until the CTA is clicked.
      expect(screen.queryByTestId('redeploy-dialog')).not.toBeInTheDocument();
      fireEvent.click(deployBtn);
      const dialog = screen.getByTestId('redeploy-dialog');
      expect(dialog).toBeInTheDocument();
      // Source build handed to the dialog is the (only) build.
      expect(dialog).toHaveTextContent('abc1234def5678');
    });

    it('deploys the ACTIVE-release build as source, not merely the latest build', () => {
      // active_release points at the SECOND build; builds[0] is a newer,
      // non-active build. The CTA must clone the ACTIVE release (Deploy =
      // re-ship the last good release), proving the `builds.find(...)` match
      // branch — not the `?? builds[0]` fallback.
      mockUseProjectStatus.mockReturnValue({
        status: { active_release: { build_id: 'b-active' } },
        loading: false,
      });
      (mockUseDeployments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        builds: [
          { ...buildFixture, build_id: 'b-latest', commit_sha: 'latest00newer', status: 'RUNNING' },
          { ...buildFixture, build_id: 'b-active', commit_sha: 'active11good', status: 'SUCCEEDED' },
        ],
        loading: false,
      });
      render(<ProjectDetailPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
      const dialog = screen.getByTestId('redeploy-dialog');
      expect(dialog).toHaveTextContent('active11good');
      expect(dialog).not.toHaveTextContent('latest00newer');
    });

    it('does NOT render a Deploy action for a cold project with no builds', () => {
      (mockUseDeployments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        builds: [],
        loading: false,
      });
      render(<ProjectDetailPage />);
      expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
    });
  });
});

describe('B-243 — "no deployments" is a claim about the project, not about a failed read', () => {
  it('says there are no deployments when the read SUCCEEDED and returned none', () => {
    (mockUseDeployments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      builds: [],
      loading: false,
      error: false,
    });

    render(<ProjectDetailPage />);

    expect(screen.getByText(/no deployments yet/i)).toBeInTheDocument();
  });

  it('does NOT say there are no deployments when the read FAILED', () => {
    // `useDeployments` returns `{ builds, total, loading, error, refetch }`
    // (hooks/projects/use-deployments.ts). The page destructured `builds` alone, so a failed
    // read arrived as `[]` and the screen invited the user to deploy their first project —
    // over a list nobody managed to read. "You have none" and "I could not tell" ask for
    // opposite next steps.
    (mockUseDeployments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      builds: [],
      loading: false,
      error: true,
    });

    render(<ProjectDetailPage />);

    // Asserted on the title that IS rendered. Exactly one empty-state title occupies this
    // slot, so a regression rewrites it rather than removing it — which is precisely what an
    // absence assertion cannot detect (src/lib/absence-assertion-ratchet.test.ts).
    expect(screen.getByText(/could not read deployments/i)).toBeInTheDocument();
    expect(screen.getAllByText(/deployments|deploy/i).map((n) => n.textContent).join(' ')).not.toMatch(
      /no deployments yet/i,
    );
  });

  it('says the deployments could not be read, and offers a retry rather than a first deploy', () => {
    const refetch = vi.fn();
    (mockUseDeployments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      builds: [],
      loading: false,
      error: true,
      refetch,
    });

    render(<ProjectDetailPage />);

    expect(screen.getByText(/could not read deployments/i)).toBeInTheDocument();
  });
});
