import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

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

const mockUseProjects = vi.fn();
vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock('@/hooks/use-project-status', () => ({
  useProjectStatus: () => ({ status: null, loading: false }),
}));

vi.mock('@/hooks/use-deployments', () => ({
  useDeployments: () => ({ builds: [], loading: false }),
}));

import { ProjectDetailPage } from './project-detail';

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCloudApi.mockReturnValue({ data: null, loading: false, error: false });
    mockUseEngineApi.mockReturnValue({ data: null, loading: false, error: false });
    // Default project that satisfies the existing test suite. Per-test
    // overrides re-mock with the scenario-specific shape.
    mockUseProjects.mockReturnValue({
      projects: [{
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
      }],
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
    mockUseProjects.mockReturnValue({
      projects: [{
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
        last_deploy_status: 'failed',  // legacy mapper path; NOT 'preview'
        production_env_count: 0,        // canonical signal — no production env
        environment_count: 0,
        latest_build_environment: 'preview',
      }],
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
  it('test_project_detail_uses_production_env_count_for_live_envs_metric (#41)', () => {
    mockUseProjects.mockReturnValue({
      projects: [{
        name: 'my-project',
        apps: [{ name: 'web' }],
        created_at: '2026-06-01T00:00:00Z',
        last_deploy_status: 'live',
        environment_count: 1,
        production_env_count: 0,
        latest_build_environment: 'preview',
      }],
      loading: false,
    });
    render(<ProjectDetailPage />);
    const liveEnvsLabel = screen.getByText(/Live envs/i);
    const liveEnvsValueNode = liveEnvsLabel.parentElement?.querySelector('.tabular-nums');
    expect(liveEnvsValueNode?.textContent).toBe('0');
  });
});
