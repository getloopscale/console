import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

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

const mockUseCloudApi = vi.fn();
vi.mock('@/hooks/use-api', () => ({
  useCloudApi: () => mockUseCloudApi(),
  useEngineApi: () => mockUseCloudApi(),
}));

// T-P1: the deploys-activity + KPI strip read useBuildStats (engineFetch). Mock it
// so the Overview test is deterministic and never hits the network.
const mockUseBuildStats = vi.fn();
vi.mock('@/hooks/use-build-stats', () => ({
  useBuildStats: () => mockUseBuildStats(),
}));

import { OverviewPage } from './overview';

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjects.mockReturnValue({ projects: [], loading: false, total: 0 });
    // Default: billing returns null (covers fallback path)
    mockUseCloudApi.mockReturnValue({ data: null, loading: false, error: false });
    // Default: no deploy activity (deterministic empty state)
    mockUseBuildStats.mockReturnValue({ byDay: [], last7d: 0, total: 0, loading: false, error: false });
  });

  it('test_overview_renders_action_bar_with_add_new', () => {
    render(<OverviewPage />);
    expect(screen.getByRole('button', { name: /add new/i })).toBeInTheDocument();
  });

  it('test_overview_usage_binds_real_backend_keys_not_vercel_mockup', () => {
    // T-P0: the Usage panel must read the REAL /v1/billing.usage keys
    // (projects, builds_per_month, environments, seats), NOT the Vercel-mockup
    // vocabulary that never bound to a Theo metered dimension.
    render(<OverviewPage />);
    // "Projects" also appears as the KPI + the section header, so assert the
    // Usage-unique labels for presence; "Projects" via getAllByText.
    expect(screen.getAllByText('Projects').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Builds this month')).toBeInTheDocument();
    expect(screen.getByText('Environments')).toBeInTheDocument();
    expect(screen.getByText('Seats')).toBeInTheDocument();
    // The fabricated keys must be gone.
    expect(screen.queryByText('Fast Data Transfer')).not.toBeInTheDocument();
    expect(screen.queryByText('Edge Requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Concurrent Builds')).not.toBeInTheDocument();
  });

  it('test_overview_no_alerts_section_removed_v12', () => {
    // T-DR-1.1 v1.2: Alerts EmptyState removed (closes P1-1 CC-3 violation).
    // Re-introduce when backend alert engine ships, as inline Alert banner.
    render(<OverviewPage />);
    expect(screen.queryByText('Get alerted for anomalies')).not.toBeInTheDocument();
  });

  it('test_overview_renders_projects_empty_when_no_data', () => {
    mockUseProjects.mockReturnValue({ projects: [], loading: false });
    render(<OverviewPage />);
    // Copy reform v1.2 (audit Section 6 fold): "No projects yet" → "Deploy your first project"
    expect(screen.getByText('Deploy your first project')).toBeInTheDocument();
  });

  it('test_overview_renders_project_cards_when_data_present', () => {
    mockUseProjects.mockReturnValue({
      projects: [
        { name: 'alpha', apps: [], last_deploy: '2026-05-23' },
        { name: 'beta', apps: [], last_deploy: '2026-05-22' },
      ],
      loading: false,
    });
    render(<OverviewPage />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('test_overview_no_recent_previews_section_removed_v12', () => {
    // T-DR-1.1 v1.2: Recent Previews EmptyState removed (closes P1-1 CC-3
    // violation, section ≥240px cortado). Re-introduce when preview list
    // backend endpoint ships, as compact inline list.
    render(<OverviewPage />);
    expect(screen.queryByText('No recent previews')).not.toBeInTheDocument();
  });

  it('test_overview_search_input_filters_projects', async () => {
    mockUseProjects.mockReturnValue({
      projects: [
        { name: 'alpha', apps: [] },
        { name: 'beta', apps: [] },
      ],
      loading: false,
    });
    const user = userEvent.setup();
    render(<OverviewPage />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    const search = screen.getByPlaceholderText('Search projects...');
    await user.type(search, 'alp');
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('beta')).not.toBeInTheDocument();
  });

  // ---- T-P0: real-key Usage binding ----

  it('test_overview_usage_reflects_real_billing_data_when_loaded', () => {
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {
          projects: { used: 2, limit: 3 },
          builds_per_month: { used: 37, limit: 100 },
          environments: { used: 2, limit: 5 },
          seats: { used: 1, limit: 3 },
        },
      },
      loading: false,
      error: false,
    });
    render(<OverviewPage />);
    // Real "used" numbers from billing fixture must appear.
    expect(screen.getByText(/^2 \/ 3$/)).toBeInTheDocument();
    expect(screen.getByText(/^37 \/ 100$/)).toBeInTheDocument();
    expect(screen.getByText(/^2 \/ 5$/)).toBeInTheDocument();
  });

  it('test_overview_usage_falls_back_to_plan_defaults_when_billing_null', () => {
    mockUseCloudApi.mockReturnValue({ data: null, loading: false, error: false });
    render(<OverviewPage />);
    // No billing → starter-plan defaults (projects 0/2, builds 0/100, envs 0/1, seats 0/1)
    expect(screen.getByText(/^0 \/ 2$/)).toBeInTheDocument();
    expect(screen.getByText(/^0 \/ 100$/)).toBeInTheDocument();
    // 0 / 1 appears twice (environments + seats)
    expect(screen.getAllByText(/^0 \/ 1$/).length).toBeGreaterThanOrEqual(1);
  });

  it('test_overview_usage_renders_unlimited_when_limit_null', () => {
    // Enterprise tier returns limit:null → "Unlimited".
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'enterprise',
        team: 'acme',
        usage: {
          projects: { used: 12, limit: null },
          builds_per_month: { used: 500, limit: null },
          environments: { used: 8, limit: null },
          seats: { used: 20, limit: null },
        },
      },
      loading: false,
      error: false,
    });
    render(<OverviewPage />);
    const unlimitedLabels = screen.getAllByText(/\/ Unlimited/);
    expect(unlimitedLabels.length).toBe(4);
  });

  it('test_overview_usage_renders_over_quota', () => {
    // used > limit renders real numeric + UsageMeter warning styling.
    mockUseCloudApi.mockReturnValue({
      data: {
        plan: 'pro',
        team: 'acme',
        usage: {
          projects: { used: 4, limit: 3 },
          builds_per_month: { used: 37, limit: 100 },
          environments: { used: 2, limit: 5 },
          seats: { used: 1, limit: 3 },
        },
      },
      loading: false,
      error: false,
    });
    const { container } = render(<OverviewPage />);
    expect(screen.getByText(/^4 \/ 3$/)).toBeInTheDocument();
    expect(container.querySelector('.text-warning')).toBeInTheDocument();
  });

  // ---- T-P3: Upgrade is a real link, not a dead badge ----

  it('test_overview_upgrade_is_a_link_to_billing', () => {
    render(<OverviewPage />);
    const upgrade = screen.getByRole('link', { name: /upgrade/i });
    expect(upgrade).toHaveAttribute('href', '/billing');
  });

  // ---- T-P2: projects "View all" affordance ----

  it('test_overview_view_all_projects_link_when_more_than_three', () => {
    mockUseProjects.mockReturnValue({
      projects: [
        { name: 'a', apps: [] },
        { name: 'b', apps: [] },
        { name: 'c', apps: [] },
        { name: 'd', apps: [] },
        { name: 'e', apps: [] },
      ],
      loading: false,
      total: 5,
    });
    render(<OverviewPage />);
    // Only 3 cards shown, plus a "View all" link carrying the real count.
    const viewAll = screen.getByRole('link', { name: /view all 5 projects/i });
    expect(viewAll).toHaveAttribute('href', '/projects');
  });

  it('test_overview_no_view_all_link_with_three_or_fewer', () => {
    mockUseProjects.mockReturnValue({
      projects: [{ name: 'a', apps: [] }, { name: 'b', apps: [] }],
      loading: false,
      total: 2,
    });
    render(<OverviewPage />);
    expect(screen.queryByRole('link', { name: /view all/i })).not.toBeInTheDocument();
  });

  // Red Team theo-cloud#53/#76 closure: the Overview project card used to
  // pass the raw RFC3339Nano ISO string (e.g. "2026-06-26T14:16:43.712767Z")
  // to ProjectCard.lastDeployedAt, which rendered it verbatim. The
  // /projects list humanizes the same field via formatDate(..., 'relative').
  // The card MUST now render a humanized "X ago" form — never the raw ISO.
  it('overview project card renders humanized relative timestamp (#53/#76)', () => {
    const recent = new Date(Date.now() - 32 * 60 * 1000).toISOString(); // ~32min ago
    mockUseProjects.mockReturnValue({
      projects: [
        {
          name: 'theokit-example',
          last_deploy: recent,
          last_deploy_status: 'live',
          apps: [],
        },
      ],
      loading: false,
    });
    render(<OverviewPage />);
    // RED #53/#76: the raw ISO MUST NOT appear anywhere.
    expect(screen.queryByText(recent)).not.toBeInTheDocument();
    // RED #53/#76: a relative phrase ("ago" / "yesterday" / "in") MUST
    // render somewhere within the card. The Intl.RelativeTimeFormat
    // English locale always emits these tokens for past times.
    const card = screen
      .getByRole('link', { name: /theokit-example/i })
      .closest('article, div, section');
    expect(card?.textContent ?? '').toMatch(/ago|yesterday|just now/i);
  });

  it('test_overview_heading_hierarchy_h1_to_h2_no_skip_closes_25', () => {
    // Sprint 3 Phase 5 (#25) v1.1 — WCAG 1.3.1 Info and Relationships.
    // PageShell renders the page h1; section labels (Usage, Projects, Quick
    // actions) must be h2 (not h3 / h4) so AT users navigate unbroken.
    render(<OverviewPage />);
    const headings = screen.getAllByRole('heading');
    const levels = headings.map((h) => parseInt(h.tagName.slice(1), 10));
    // Walk the document order — no step may jump by more than +1.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
    }
    // At least one h2 must exist (the section labels we promoted).
    expect(levels).toContain(2);
  });
});
